# @ghostty-web/demo

Cross-platform demo server for [ghostty-web](https://github.com/coder/ghostty-web) terminal emulator.

## Quick Start

```bash
npx @ghostty-web/demo@next
```

This starts a local web server with a fully functional terminal connected to your shell.
Works on **Linux** and **macOS** (no Windows support yet).

## What it does

- Starts an HTTP server on `127.0.0.1:8080` by default (`PORT` and `HOST` are configurable)
- Serves WebSocket PTY on the same port at `/ws` endpoint
- Protects `/ws` with a per-run same-origin token from `/api/token`
- Rejects cross-origin WebSocket handshakes
- Opens a real shell session (bash, zsh, etc.)
- Provides full PTY support (colors, cursor positioning, resize, etc.)
- Renders with the same font and theme everywhere (see below)
- Hides the native page scrollbar and shows a faint indicator only while scrolling

## Appearance

The demo's appearance is pinned by this package rather than by the machine it
runs on:

- `ghostty.config` — a regular Ghostty config (Catppuccin Mocha palette on the
  demo's original `#1e1e1e` background, Maple Mono 14, bar cursor, 10/8 window
  padding) that the demo applies by default. Parsed by the library's
  `parseGhosttyConfig`.
- `fonts/` — [Maple Mono](https://github.com/subframe7536/maple-font) regular,
  bold, italic and bold-italic as woff2 (~320 KB total), loaded with
  `@font-face` and served from `/fonts/`. Licensed under the SIL Open Font
  License 1.1 (`fonts/LICENSE.txt`). Latin glyphs are identical on every
  machine; CJK and Nerd Font glyphs still come from the system.
- `fonts/MapleMono-metrics.json` — the font's own metrics (ascent, descent, line
  gap, advance width, underline/strikethrough), extracted with
  `bun run build:font-metrics` and passed to `Terminal` as `fontMetrics`. The
  cell grid is computed from these numbers instead of the platform font APIs,
  so it is identical across browsers and operating systems. The renderer ignores
  them when a different font is in use.

Your own `~/.config/ghostty/config` is layered on top of `ghostty.config` when
it exists, so on your machine the web terminal keeps mirroring your native
terminal. Point the demo at a different config with
`GHOSTTY_CONFIG=/path/to/config`.

The server exposes all of this to the page at `/ghostty-config.json`; the page
parses it with `parseGhosttyConfig` / `toTerminalOptions` from `ghostty-web`.

## Usage

```bash
# Default (port 8080)
npx @ghostty-web/demo@next

# Custom port
PORT=3000 npx @ghostty-web/demo@next

# Explicit bind host for intentional non-default access
HOST=192.0.2.10 GHOSTTY_ALLOWED_HOSTS=demo.example npx @ghostty-web/demo@next
```

Then open http://127.0.0.1:8080 in your browser.

## Bind host and proxy configuration

The demo binds to `127.0.0.1` by default and only allows loopback hostnames (`localhost`, `127.0.0.1`, and `::1`) unless configured otherwise. Set `HOST=<host>` to change the bind address. If you serve the demo through another hostname, or bind to a wildcard such as `HOST=0.0.0.0`, add the browser-visible hostnames with `GHOSTTY_ALLOWED_HOSTS=host1,host2`.

The browser client fetches `/api/token` from the same origin before opening `/ws`, and the server rejects `/ws` when the token is missing, the `Host` is not allowed, or the WebSocket `Origin` does not match the request host. Do not set permissive CORS in front of `/api/token`.

### Example with nginx

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

## Security Warning

⚠️ **This server provides full shell access.**

Only use for local development and demos. Keep the default loopback bind unless you intentionally need remote access and have configured `HOST` and `GHOSTTY_ALLOWED_HOSTS` for the exact hostnames you trust.
