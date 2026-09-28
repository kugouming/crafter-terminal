#!/usr/bin/env node

/**
 * crafter-terminal-demo - Cross-platform demo server
 *
 * Starts a local HTTP server with WebSocket PTY support.
 * Run with: npx crafter-terminal-demo
 */

import fs from 'fs';
import http from 'http';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Node-pty for cross-platform PTY support
import pty from '@lydell/node-pty';
// WebSocket server
import { WebSocketServer } from 'ws';

import {
  createAuthConfig,
  isLoopbackHost,
  isWildcardBindHost,
  validateTokenRequest,
  validateWebSocketRequest,
} from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEV_MODE = process.argv.includes('--dev');
const HTTP_PORT = parsePort(process.env.PORT || (DEV_MODE ? '8000' : '8080'));
const AUTH_CONFIG = createAuthConfig();
const HOST = AUTH_CONFIG.bindHost;

function parsePort(value) {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer from 1 to 65535: ${value}`);
  }
  return port;
}

// ============================================================================
// Locate crafter-terminal assets
// ============================================================================

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

function findGhosttyWeb() {
  // In dev mode, we use Vite - no need to find built assets
  if (DEV_MODE) {
    const repoRoot = path.join(__dirname, '..', '..');
    const wasmPath = path.join(repoRoot, 'ghostty-vt.wasm');
    if (!fs.existsSync(wasmPath)) {
      console.error('Error: ghostty-vt.wasm not found.');
      console.error('Run: bun run build:wasm');
      process.exit(1);
    }
    return { distPath: null, wasmPath, repoRoot };
  }

  // First, check for local development (repo root dist/)
  const localDist = path.join(__dirname, '..', '..', 'dist');
  const localJs = path.join(localDist, 'crafter-terminal.js');
  const localWasm = path.join(__dirname, '..', '..', 'ghostty-vt.wasm');

  if (fs.existsSync(localJs) && fs.existsSync(localWasm)) {
    return { distPath: localDist, wasmPath: localWasm, repoRoot: path.join(__dirname, '..', '..') };
  }

  // Use require.resolve to find the installed crafter-terminal package
  try {
    const ghosttyWebMain = require.resolve('crafter-terminal');
    // Strip dist/... from path to get package root (regex already gives us the root)
    const ghosttyWebRoot = ghosttyWebMain.replace(/[/\\]dist[/\\].*$/, '');
    const distPath = path.join(ghosttyWebRoot, 'dist');
    const wasmPath = path.join(ghosttyWebRoot, 'ghostty-vt.wasm');

    if (fs.existsSync(path.join(distPath, 'crafter-terminal.js')) && fs.existsSync(wasmPath)) {
      return { distPath, wasmPath, repoRoot: null };
    }
  } catch (e) {
    // require.resolve failed, package not found
  }

  console.error('Error: Could not find crafter-terminal package.');
  console.error('');
  console.error('If developing locally, run: bun run build');
  console.error('If using npx, the package should install automatically.');
  process.exit(1);
}

const { distPath, wasmPath, repoRoot } = findGhosttyWeb();

// ============================================================================
// Native Ghostty config bridge
// ============================================================================

// The browser can't read local files, so the server exposes the demo's
// bundled config and the user's Ghostty config (and theme) as JSON. The client
// parses them with the library's `parseGhosttyConfig` / `toTerminalOptions`,
// which keeps all of the parsing logic in one place.
//
// Precedence: the bundled config (demo/ghostty.config) is the base, and the
// local Ghostty config is layered on top when it exists.
const BUNDLED_CONFIG_PATH = path.join(__dirname, '..', 'ghostty.config');
const BUNDLED_FONT_DIR = path.join(__dirname, '..', 'fonts');

const LOCAL_CONFIG_PATH =
  process.env.GHOSTTY_CONFIG ??
  path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), 'ghostty', 'config');

const MAX_CONFIG_INCLUDE_DEPTH = 5;

function ghosttyThemeDirs() {
  const dirs = [];
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config');
  dirs.push(path.join(xdgConfig, 'ghostty', 'themes'));
  dirs.push(path.join(homedir(), '.local', 'share', 'ghostty', 'themes'));
  for (const dir of (process.env.XDG_DATA_DIRS ?? '/usr/local/share:/usr/share').split(':')) {
    if (dir) dirs.push(path.join(dir, 'ghostty', 'themes'));
  }
  if (process.platform === 'darwin') {
    dirs.push('/Applications/Ghostty.app/Contents/Resources/ghostty/themes');
  }
  return dirs;
}

/** Extract `theme = ...` names from config text (client does the real parsing). */
function extractThemeNames(text) {
  const names = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== 'theme') continue;

    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    for (const part of value.split(',')) {
      const entry = part.trim();
      if (entry === '') continue;
      const colon = entry.indexOf(':');
      const name = colon === -1 ? entry : entry.slice(colon + 1).trim();
      if (name) names.push(name);
    }
  }
  return names;
}

/** Extract `config-file = ...` includes from config text. */
function extractConfigFiles(text) {
  const files = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== 'config-file') continue;
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value) files.push(value);
  }
  return files;
}

/**
 * Read a config file and its `config-file` includes.
 * Returns `null` when the file does not exist.
 */
function readConfigFile(filePath, depth = 0, files = []) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  files.push(filePath);

  const parts = [text];
  if (depth < MAX_CONFIG_INCLUDE_DEPTH) {
    for (const include of extractConfigFiles(text)) {
      const includePath = path.isAbsolute(include)
        ? include
        : path.join(path.dirname(filePath), include);
      const included = readConfigFile(includePath, depth + 1, files);
      if (included) parts.push(included.text);
    }
  }

  return { text: parts.join('\n'), files };
}

function readGhosttyConfigPayload() {
  const files = [];

  // Bundled defaults first, then the local config on top of it.
  const bundled = readConfigFile(BUNDLED_CONFIG_PATH, 0, files);
  const local = readConfigFile(LOCAL_CONFIG_PATH, 0, files);

  if (!bundled && !local) {
    return {
      available: false,
      bundledConfigPath: BUNDLED_CONFIG_PATH,
      localConfigPath: LOCAL_CONFIG_PATH,
      error: `neither ${BUNDLED_CONFIG_PATH} nor ${LOCAL_CONFIG_PATH} could be read`,
    };
  }

  const configText = [bundled?.text, local?.text].filter(Boolean).join('\n');

  // Resolve the first theme that exists on disk
  let themeText = null;
  let themeName = null;
  for (const name of extractThemeNames(configText)) {
    for (const dir of ghosttyThemeDirs()) {
      const themePath = path.join(dir, name);
      try {
        themeText = fs.readFileSync(themePath, 'utf8');
        themeName = name;
        files.push(themePath);
        break;
      } catch {
        // try the next directory
      }
    }
    if (themeText !== null) break;
  }

  return {
    available: true,
    // Texts are kept separate so the client can give the local config
    // precedence over the bundled defaults.
    bundledConfigText: bundled?.text ?? null,
    localConfigText: local?.text ?? null,
    // Combined text, handy for debugging (the client uses the two above)
    configText,
    bundledConfigPath: BUNDLED_CONFIG_PATH,
    localConfigPath: LOCAL_CONFIG_PATH,
    localConfigFound: local !== null,
    themeText,
    themeName,
    files,
  };
}

/** Serve the fonts bundled with the demo (see demo/fonts). */
function handleFontRequest(req, res, url) {
  if (!url.pathname.startsWith('/fonts/')) return false;

  // Only allow plain file names inside the font directory.
  const name = path.basename(url.pathname);
  const filePath = path.join(BUNDLED_FONT_DIR, name);
  if (!filePath.startsWith(BUNDLED_FONT_DIR) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return true;
  }

  serveFile(filePath, res);
  return true;
}

function handleGhosttyConfigRequest(req, res, url) {
  if (url.pathname !== '/ghostty-config.json') return false;

  let payload;
  try {
    payload = readGhosttyConfigPayload();
  } catch (error) {
    payload = { available: false, error: String(error) };
  }

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
  return true;
}

// ============================================================================
// HTML Template
// ============================================================================

const HTML_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>crafter</title>
    <style>
      /*
       * Maple Mono, bundled with the demo so the terminal renders the same
       * everywhere (SIL OFL 1.1 - see fonts/LICENSE.txt).
       */
      @font-face {
        font-family: 'Maple Mono';
        src: url('./fonts/MapleMono-Regular.woff2') format('woff2');
        font-weight: 400;
        font-style: normal;
        font-display: block;
      }

      @font-face {
        font-family: 'Maple Mono';
        src: url('./fonts/MapleMono-Bold.woff2') format('woff2');
        font-weight: 700;
        font-style: normal;
        font-display: block;
      }

      @font-face {
        font-family: 'Maple Mono';
        src: url('./fonts/MapleMono-Italic.woff2') format('woff2');
        font-weight: 400;
        font-style: italic;
        font-display: block;
      }

      @font-face {
        font-family: 'Maple Mono';
        src: url('./fonts/MapleMono-BoldItalic.woff2') format('woff2');
        font-weight: 700;
        font-style: italic;
        font-display: block;
      }

      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      /*
       * Page scrollbar: the native one is hidden and replaced by a thin
       * indicator that only fades in while scrolling (see the script below).
       */
      html {
        scrollbar-width: none; /* Firefox */
      }

      html::-webkit-scrollbar {
        display: none; /* Chrome, Safari, Edge */
      }

      .page-scrollbar {
        position: fixed;
        top: 0;
        right: 3px;
        width: 5px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.16);
        opacity: 0;
        transition: opacity 0.25s ease;
        pointer-events: none;
        z-index: 10;
      }

      .page-scrollbar.visible {
        opacity: 1;
      }

      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
      }

      .terminal-window {
        width: 100%;
        max-width: 1000px;
        background: #1e1e1e;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        overflow: hidden;
      }

      .title-bar {
        background: #2d2d2d;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        border-bottom: 1px solid #1a1a1a;
      }

      .traffic-lights {
        display: flex;
        gap: 8px;
      }

      .light {
        width: 12px;
        height: 12px;
        border-radius: 50%;
      }

      .light.red { background: #ff5f56; }
      .light.yellow { background: #ffbd2e; }
      .light.green { background: #27c93f; }

      .title {
        color: #e5e5e5;
        font-size: 13px;
        font-weight: 500;
        letter-spacing: 0.3px;
      }

      .connection-status {
        margin-left: auto;
        font-size: 11px;
        color: #888;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #888;
      }

      .status-dot.connected { background: #27c93f; }
      .status-dot.disconnected { background: #ff5f56; }
      .status-dot.connecting { background: #ffbd2e; animation: pulse 1s infinite; }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      .terminal-content {
        height: 600px;
        padding: 16px;
        background: #1e1e1e;
        position: relative;
        overflow: hidden;
      }

      /* Ensure terminal canvas can handle scrolling */
      .terminal-content canvas {
        display: block;
      }

      @media (max-width: 768px) {
        .terminal-content {
          height: 500px;
        }
      }
    </style>
  </head>
  <body>
    <div class="terminal-window">
      <div class="title-bar">
        <div class="traffic-lights">
          <div class="light red"></div>
          <div class="light yellow"></div>
          <div class="light green"></div>
        </div>
        <span class="title">crafter</span>
        <div class="connection-status">
          <div class="status-dot connecting" id="status-dot"></div>
          <span id="status-text">Connecting...</span>
        </div>
      </div>
      <div class="terminal-content" id="terminal"></div>
    </div>
    <div class="page-scrollbar" id="page-scrollbar"></div>

    <script type="module">
      import {
        init,
        Terminal,
        FitAddon,
        isFontAvailable,
        parseGhosttyConfig,
        mergeGhosttyConfigs,
        toTerminalOptions,
      } from '/dist/crafter-terminal.js';

      // Maple Mono, bundled with the demo (see fonts/, SIL OFL 1.1) so the
      // glyphs and cell metrics don't depend on what is installed locally.
      const BUNDLED_FONT_FAMILY = 'Maple Mono';

      await init();

      /** Wait for the bundled webfont so metrics are measured with it. */
      async function loadBundledFonts() {
        if (!document.fonts) return;
        try {
          await Promise.all([
            document.fonts.load('400 14px "' + BUNDLED_FONT_FAMILY + '"'),
            document.fonts.load('700 14px "' + BUNDLED_FONT_FAMILY + '"'),
            document.fonts.load('italic 400 14px "' + BUNDLED_FONT_FAMILY + '"'),
            document.fonts.load('italic 700 14px "' + BUNDLED_FONT_FAMILY + '"'),
          ]);
        } catch (error) {
          console.warn('crafter-terminal: could not load the bundled font', error);
        }
      }
      await loadBundledFonts();

      /**
       * Metrics read from the bundled font's own tables
       * (fonts/MapleMono-metrics.json, generated by
       * scripts/build-font-metrics.py). They make the grid identical on every
       * browser and platform; the renderer ignores them if another font ends
       * up being used.
       */
      async function loadBundledFontMetrics() {
        try {
          const response = await fetch('./fonts/MapleMono-metrics.json');
          if (!response.ok) return undefined;
          return await response.json();
        } catch (error) {
          console.warn('crafter-terminal: could not load the bundled font metrics', error);
          return undefined;
        }
      }

      // The bundled config (demo/ghostty.config) is the base; a local Ghostty
      // config is layered on top when the server found one. Falls back to the
      // library defaults (which are Ghostty's defaults) when unavailable.
      let terminalOptions = {};
      let padding = null;
      let configNotice = null;

      try {
        const response = await fetch('/ghostty-config.json');
        if (response.ok) {
          const payload = await response.json();
          if (payload.available) {
            const bundled = payload.bundledConfigText
              ? parseGhosttyConfig(payload.bundledConfigText)
              : null;
            const local = payload.localConfigText
              ? parseGhosttyConfig(payload.localConfigText)
              : null;

            let config;
            if (bundled && local) {
              config = mergeGhosttyConfigs([bundled, local]);
              // A local config that sets font-family replaces the bundled one
              // (accumulating would make the bundled font win over the user's).
              if (local.fontFamily.length > 0) config.fontFamily = [...local.fontFamily];
            } else {
              config = bundled ?? local;
            }

            if (config) {
              // The bundled webfont is always available, so keep it as a
              // fallback behind whatever the user configured.
              if (!config.fontFamily.includes(BUNDLED_FONT_FAMILY)) {
                config.fontFamily.push(BUNDLED_FONT_FAMILY);
              }

              const { options, warnings } = toTerminalOptions(config, {
                themeText: payload.themeText,
              });
              terminalOptions = options;
              if (config.windowPaddingX && config.windowPaddingY) {
                padding = {
                  x: config.windowPaddingX.topLeft,
                  y: config.windowPaddingY.topLeft,
                };
              }
              configNotice = local
                ? 'Using your Ghostty config' +
                  (payload.themeName ? ' (' + payload.themeName + ')' : '')
                : 'Using the bundled demo config';
              for (const warning of warnings) console.warn('crafter-terminal:', warning);

              // The renderer falls back when the configured font is missing;
              // tell the user why the glyphs differ.
              const primary = local && local.fontFamily[0];
              if (primary && isFontAvailable(primary, config.fontSize ?? 14) === false) {
                configNotice =
                  'Font not installed: ' + primary + ' (using ' + BUNDLED_FONT_FAMILY + ')';
                console.warn(
                  'crafter-terminal: font "' +
                    primary +
                    '" is not installed for this browser; rendering with the bundled "' +
                    BUNDLED_FONT_FAMILY +
                    '" instead'
                );
              }
            }
          } else {
            configNotice = 'No Ghostty config found; using defaults';
          }
        }
      } catch (error) {
        console.warn('crafter-terminal: could not load Ghostty config', error);
      }

      const fontMetrics = await loadBundledFontMetrics();

      const term = new Terminal({
        cols: 80,
        rows: 24,
        ...terminalOptions,
        // Only applies when the bundled font is the one in use
        fontMetrics,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      const container = document.getElementById('terminal');
      if (padding) {
        container.style.padding = padding.y + 'px ' + padding.x + 'px';
      }
      if (terminalOptions.theme && terminalOptions.theme.background) {
        document.querySelector('.terminal-window').style.background =
          terminalOptions.theme.background;
      }
      await term.open(container);
      fitAddon.fit();
      fitAddon.observeResize(); // Auto-fit when container resizes

      // Status elements
      const statusDot = document.getElementById('status-dot');
      const statusText = document.getElementById('status-text');

      function setStatus(status, text) {
        statusDot.className = 'status-dot ' + status;
        statusText.textContent = text;
      }

      if (configNotice) {
        const notice = document.createElement('div');
        notice.textContent = configNotice;
        notice.style.cssText = 'font-size:11px;color:#888;margin-bottom:6px;';
        container.parentElement.insertBefore(notice, container);
      }

      // Connect to WebSocket PTY server (use same origin as HTTP server)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let ws;

      async function fetchAuthToken() {
        const response = await fetch('/api/token', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Token request failed with HTTP ' + response.status);
        }

        const body = await response.json();
        if (!body || typeof body.token !== 'string' || body.token.length === 0) {
          throw new Error('Token response did not include a token');
        }

        return body.token;
      }

      function buildWebSocketUrl(token) {
        const params = new URLSearchParams();
        params.set('cols', String(term.cols));
        params.set('rows', String(term.rows));
        params.set('token', token);
        return protocol + '//' + window.location.host + '/ws?' + params.toString();
      }

      async function connect() {
        setStatus('connecting', 'Authenticating...');

        let token;
        try {
          token = await fetchAuthToken();
        } catch (error) {
          console.error('Authentication failed:', error);
          setStatus('disconnected', 'Auth error');
          term.write('\\r\\n\\x1b[31mAuthentication failed. Retrying in 2s...\\x1b[0m\\r\\n');
          setTimeout(connect, 2000);
          return;
        }

        setStatus('connecting', 'Connecting...');
        ws = new WebSocket(buildWebSocketUrl(token));

        ws.onopen = () => {
          setStatus('connected', 'Connected');
        };

        ws.onmessage = (event) => {
          term.write(event.data);
        };

        ws.onclose = () => {
          setStatus('disconnected', 'Disconnected');
          term.write('\\r\\n\\x1b[31mConnection closed. Reconnecting in 2s...\\x1b[0m\\r\\n');
          setTimeout(connect, 2000);
        };

        ws.onerror = () => {
          setStatus('disconnected', 'Error');
        };
      }

      connect();

      // Send terminal input to server
      term.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // Handle resize - notify PTY when terminal dimensions change
      term.onResize(({ cols, rows }) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      });

      // Also handle window resize (for browsers that don't trigger ResizeObserver on window resize)
      window.addEventListener('resize', () => {
        fitAddon.fit();
      });

      // Handle mobile keyboard showing/hiding using visualViewport API
      if (window.visualViewport) {
        const terminalContent = document.querySelector('.terminal-content');
        const terminalWindow = document.querySelector('.terminal-window');
        const originalHeight = terminalContent.style.height;
        const body = document.body;

        window.visualViewport.addEventListener('resize', () => {
          const keyboardHeight = window.innerHeight - window.visualViewport.height;
          if (keyboardHeight > 100) {
            body.style.padding = '0';
            body.style.alignItems = 'flex-start';
            terminalWindow.style.borderRadius = '0';
            terminalWindow.style.maxWidth = '100%';
            terminalContent.style.height = (window.visualViewport.height - 60) + 'px';
            window.scrollTo(0, 0);
          } else {
            body.style.padding = '40px 20px';
            body.style.alignItems = 'center';
            terminalWindow.style.borderRadius = '12px';
            terminalWindow.style.maxWidth = '1000px';
            terminalContent.style.height = originalHeight || '600px';
          }
          fitAddon.fit();
        });
      }

      /**
       * Thin page scrollbar that only shows up while scrolling.
       *
       * The native scrollbar is hidden in CSS (see the stylesheet); this
       * mirrors the scroll position with a faint bar that fades in on scroll
       * and out again shortly after.
       */
      function initPageScrollbar() {
        const bar = document.getElementById('page-scrollbar');
        const HIDE_DELAY_MS = 900;
        let hideTimer;

        const update = (show) => {
          const doc = document.documentElement;
          const scrollable = doc.scrollHeight - window.innerHeight;

          if (scrollable <= 1) {
            bar.classList.remove('visible');
            return;
          }

          const height = Math.max(32, (window.innerHeight / doc.scrollHeight) * window.innerHeight);
          const top = (window.scrollY / scrollable) * (window.innerHeight - height);
          bar.style.height = height + 'px';
          bar.style.transform = 'translateY(' + top + 'px)';

          if (!show) return;
          bar.classList.add('visible');
          clearTimeout(hideTimer);
          hideTimer = setTimeout(() => bar.classList.remove('visible'), HIDE_DELAY_MS);
        };

        window.addEventListener('scroll', () => update(true), { passive: true });
        window.addEventListener('resize', () => update(false));
        // Position it without flashing it on load
        update(false);
      }

      initPageScrollbar();
    </script>
  </body>
</html>`;

// ============================================================================
// MIME Types
// ============================================================================

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ============================================================================
// HTTP Server
// ============================================================================

const httpServer = http.createServer((req, res) => {
  const url = parseRequestUrl(req);
  if (!url) {
    writeHttpDecision(res, { status: 400, reason: 'Bad Request' });
    return;
  }

  if (handleTokenRequest(req, res, url)) {
    return;
  }

  if (handleGhosttyConfigRequest(req, res, url)) {
    return;
  }

  const pathname = url.pathname;

  // Serve index page
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML_TEMPLATE);
    return;
  }

  // Serve dist files
  if (pathname.startsWith('/dist/')) {
    const filePath = path.join(distPath, pathname.slice(6));
    serveFile(filePath, res);
    return;
  }

  // Serve bundled fonts
  if (handleFontRequest(req, res, url)) {
    return;
  }

  // Serve WASM file
  if (pathname === '/ghostty-vt.wasm') {
    serveFile(wasmPath, res);
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not Found');
});

function serveFile(filePath, res) {
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function parseRequestUrl(req) {
  try {
    return new URL(req.url || '/', 'http://127.0.0.1');
  } catch (_error) {
    return null;
  }
}

function writeHttpDecision(res, decision) {
  res.writeHead(decision.status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(decision.reason);
}

function writeTokenResponse(res) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify({ token: AUTH_CONFIG.token }));
}

function handleTokenRequest(req, res, url) {
  if (url.pathname !== '/api/token') {
    return false;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, {
      Allow: 'GET',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end('Method Not Allowed');
    return true;
  }

  const decision = validateTokenRequest(AUTH_CONFIG, {
    host: req.headers.host,
    origin: req.headers.origin,
  });

  if (!decision.ok) {
    writeHttpDecision(res, decision);
    return true;
  }

  writeTokenResponse(res);
  return true;
}

// ============================================================================
// WebSocket Server (using ws package)
// ============================================================================

const sessions = new Map();

function getShell() {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

function createPtySession(cols, rows) {
  const shell = getShell();
  const shellArgs = process.platform === 'win32' ? [] : [];

  const ptyProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: cols,
    rows: rows,
    cwd: homedir(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });

  return ptyProcess;
}

// WebSocket server attached to HTTP server (same port)
const wss = new WebSocketServer({ noServer: true });

function rejectUpgrade(socket, decision) {
  if (socket.destroyed) {
    return;
  }

  const body = decision.reason + '\n';
  socket.write(
    `HTTP/1.1 ${decision.status} ${decision.reason}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      'X-Content-Type-Options: nosniff\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      '\r\n' +
      body
  );
  socket.destroy();
}

function handleWebSocketUpgrade(req, socket, head) {
  const url = parseRequestUrl(req);
  if (!url) {
    rejectUpgrade(socket, { status: 400, reason: 'Bad Request' });
    return true;
  }

  if (url.pathname !== '/ws') {
    return false;
  }

  const decision = validateWebSocketRequest(AUTH_CONFIG, {
    host: req.headers.host,
    origin: req.headers.origin,
    token: url.searchParams.get('token'),
  });

  if (!decision.ok) {
    rejectUpgrade(socket, decision);
    return true;
  }

  if (!socket.destroyed && !socket.readableEnded) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }
  return true;
}

// Handle HTTP upgrade for WebSocket connections
httpServer.on('upgrade', (req, socket, head) => {
  if (!handleWebSocketUpgrade(req, socket, head)) {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  const url = parseRequestUrl(req);
  if (!url) {
    ws.close();
    return;
  }
  const cols = Number.parseInt(url.searchParams.get('cols') || '80');
  const rows = Number.parseInt(url.searchParams.get('rows') || '24');

  // Create PTY
  const ptyProcess = createPtySession(cols, rows);
  sessions.set(ws, { pty: ptyProcess });

  // PTY -> WebSocket
  ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(`\r\n\x1b[33mShell exited (code: ${exitCode})\x1b[0m\r\n`);
      ws.close();
    }
  });

  // WebSocket -> PTY
  ws.on('message', (data) => {
    const message = data.toString('utf8');

    // Check for resize message
    if (message.startsWith('{')) {
      try {
        const msg = JSON.parse(message);
        if (msg.type === 'resize') {
          ptyProcess.resize(msg.cols, msg.rows);
          return;
        }
      } catch (e) {
        // Not JSON, treat as input
      }
    }

    // Send to PTY
    ptyProcess.write(message);
  });

  ws.on('close', () => {
    const session = sessions.get(ws);
    if (session) {
      session.pty.kill();
      sessions.delete(ws);
    }
  });

  ws.on('error', () => {
    // Ignore socket errors (connection reset, etc.)
  });

  // Send welcome message
  const C = '\x1b[1;36m'; // Cyan
  const G = '\x1b[1;32m'; // Green
  const Y = '\x1b[1;33m'; // Yellow
  const R = '\x1b[0m'; // Reset
  ws.send(`${C}╔══════════════════════════════════════════════════════════════╗${R}\r\n`);
  ws.send(
    `${C}║${R}  ${G}Welcome to crafter!${R}                                         ${C}║${R}\r\n`
  );
  ws.send(`${C}║${R}                                                              ${C}║${R}\r\n`);
  ws.send(`${C}║${R}  You have a real shell session with full PTY support.        ${C}║${R}\r\n`);
  ws.send(
    `${C}║${R}  Try: ${Y}ls${R}, ${Y}cd${R}, ${Y}top${R}, ${Y}vim${R}, or any command!                      ${C}║${R}\r\n`
  );
  ws.send(`${C}╚══════════════════════════════════════════════════════════════╝${R}\r\n\r\n`);
});

// ============================================================================
// Startup
// ============================================================================

function formatUrlHost(host) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function printBanner(url) {
  console.log('\n' + '═'.repeat(60));
  console.log('  🚀 crafter-terminal demo server' + (DEV_MODE ? ' (dev mode)' : ''));
  console.log('═'.repeat(60));
  console.log(`\n  📺 Open: ${url}`);
  console.log(`  📡 WebSocket PTY: same endpoint /ws`);
  console.log('  🔐 WebSocket auth: per-run same-origin token');
  console.log(`  🐚 Shell: ${getShell()}`);
  console.log(`  📁 Home: ${homedir()}`);
  if (DEV_MODE) {
    console.log(`  🔥 Hot reload enabled via Vite`);
  } else if (repoRoot) {
    console.log(`  📦 Using local build: ${distPath}`);
  }
  console.log('\n  ⚠️  This server provides shell access.');
  console.log('     It binds to ' + HOST + ' and rejects cross-origin WebSockets.');
  if (isWildcardBindHost(HOST) || !isLoopbackHost(HOST)) {
    console.log(
      '     Remote access requires GHOSTTY_ALLOWED_HOSTS and can expose your shell if misconfigured.'
    );
  }
  console.log('     Only use for local development.\n');
  console.log('═'.repeat(60));
  console.log('  Press Ctrl+C to stop.\n');
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  for (const [ws, session] of sessions.entries()) {
    session.pty.kill();
    ws.close();
  }
  wss.close();
  process.exit(0);
});

// Start HTTP/Vite server
if (DEV_MODE) {
  // Dev mode: use Vite for hot reload
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: repoRoot,
    plugins: [
      {
        name: 'ghostty-demo-auth',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = parseRequestUrl(req);
            if (!url) {
              writeHttpDecision(res, { status: 400, reason: 'Bad Request' });
              return;
            }

            if (handleTokenRequest(req, res, url)) {
              return;
            }

            if (handleGhosttyConfigRequest(req, res, url)) {
              return;
            }

            next();
          });
        },
      },
    ],
    server: {
      host: HOST,
      port: HTTP_PORT,
      strictPort: true,
      cors: false,
      allowedHosts: AUTH_CONFIG.allowedHosts,
    },
  });

  await vite.listen();

  // Attach WebSocket handler AFTER Vite has fully initialized
  // Use prependListener (not prependOnceListener) so it runs for every request
  // This ensures our handler runs BEFORE Vite's handlers
  if (vite.httpServer) {
    vite.httpServer.prependListener('upgrade', (req, socket, head) => {
      // ONLY handle /ws - everything else passes through unchanged to Vite.
      if (handleWebSocketUpgrade(req, socket, head)) {
        return;
      }

      // For non-/ws paths, explicitly do nothing and let the event propagate.
      // The key is: don't return, don't touch the socket, just let Vite process it.
    });
  }

  printBanner(`http://${formatUrlHost(HOST)}:${HTTP_PORT}/demo/`);
} else {
  // Production mode: static file server
  httpServer.listen(HTTP_PORT, HOST, () => {
    printBanner(`http://${formatUrlHost(HOST)}:${HTTP_PORT}`);
  });
}
