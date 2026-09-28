/**
 * Ghostty configuration parsing.
 *
 * Turns a native Ghostty configuration (`~/.config/ghostty/config`) into
 * options for {@link Terminal}, so a web terminal can render exactly like the
 * user's native terminal: same font, same size, same theme, same cursor, and
 * the same font metric adjustments.
 *
 * The parser is pure (no filesystem access) so it also works in the browser;
 * the `load*` helpers at the bottom use Node/Bun APIs and are only imported
 * when you call them.
 *
 * Supported keys: font-family, font-size, font-thicken, adjust-*, cursor-style,
 * cursor-style-blink, cursor-opacity, theme, palette, background, foreground,
 * cursor-color, cursor-text, selection-background, selection-foreground,
 * faint-opacity, background-opacity, window-padding-x/y, config-file.
 */

import type { ITerminalOptions, ITheme } from './interfaces';
import type { MetricModifiers } from './metrics';
import { DEFAULT_FONT_FAMILY, GHOSTTY_DEFAULT_THEME } from './renderer';

// ============================================================================
// Types
// ============================================================================

/** Padding value as Ghostty accepts it: `N` (all sides) or `X,Y`. */
export interface GhosttyPadding {
  topLeft: number;
  bottomRight: number;
}

export interface GhosttyConfig {
  /** Font families in priority order (`font-family`, repeatable) */
  fontFamily: string[];
  /** True when the config contained `font-family = ""`, which clears the list */
  fontFamilyReset?: boolean;
  fontSize?: number;
  fontThicken?: boolean;
  /** `adjust-*` options, keyed by their Ghostty names */
  adjustments: MetricModifiers;
  cursorStyle?: 'block' | 'bar' | 'underline' | 'block_hollow';
  cursorStyleBlink?: boolean;
  cursorOpacity?: number;
  /** Theme name(s) from `theme = ...` */
  themes: string[];
  background?: string;
  foreground?: string;
  cursorColor?: string;
  cursorText?: string;
  selectionBackground?: string;
  selectionForeground?: string;
  faintOpacity?: number;
  backgroundOpacity?: number;
  windowPaddingX?: GhosttyPadding;
  windowPaddingY?: GhosttyPadding;
  /** Palette overrides, index -> color */
  palette: Record<number, string>;
  /** `config-file` includes, in order */
  configFiles: string[];
  /** Every key/value pair seen, in order (for anything not modelled above) */
  raw: Array<[string, string]>;
}

export interface ResolveThemeOptions {
  /** Theme file contents (e.g. the contents of `themes/Catppuccin Mocha`) */
  themeText?: string;
  /** Fallback used when a color is not set anywhere: Ghostty's defaults */
  base?: ITheme;
}

export interface ToTerminalOptionsResult {
  options: ITerminalOptions;
  /** Theme colors resolved from the config (already merged with defaults) */
  theme: Required<ITheme>;
  /** Warnings worth surfacing to the user (e.g. unsupported keys) */
  warnings: string[];
}

// ============================================================================
// Parsing
// ============================================================================

const REPEATABLE_KEYS = new Set([
  'font-family',
  'font-family-bold',
  'font-family-italic',
  'font-family-bold-italic',
  'palette',
  'config-file',
  'keybind',
  'font-feature',
  'font-variation',
  'font-codepoint-map',
  'env',
  'command',
]);

/**
 * Split a config line into key/value, following Ghostty's rules:
 * - whitespace around the line, the key and the value is trimmed
 * - a line whose first character is `#` is a comment (there are no trailing
 *   comments, so `background = #282c34` keeps its `#`)
 * - the value is split on the first `=`
 * - a value wrapped in double quotes has the quotes removed
 */
export function parseConfigLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;

  const eq = trimmed.indexOf('=');
  if (eq === -1) return null;

  const key = trimmed.slice(0, eq).trim();
  if (key === '') return null;

  let value = trimmed.slice(eq + 1).trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

function parseBool(value: string): boolean | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return undefined;
}

function parseNumber(value: string): number | undefined {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

function parsePadding(value: string): GhosttyPadding | undefined {
  const parts = value.split(',').map((p) => Number.parseFloat(p.trim()));
  if (parts.some((p) => !Number.isFinite(p))) return undefined;
  if (parts.length === 1) return { topLeft: parts[0], bottomRight: parts[0] };
  return { topLeft: parts[0], bottomRight: parts[1] };
}

/** Normalize a color: `#RRGGBB`, `RRGGBB` or `#RGB` -> `#rrggbb` (lowercase). */
export function normalizeColor(value: string): string | undefined {
  const hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex}`.toLowerCase();
  return undefined;
}

/**
 * Parse a Ghostty config file.
 *
 * Repeatable keys (font-family, palette, config-file, ...) accumulate; all
 * other keys use the last value, matching Ghostty's own behavior.
 */
export function parseGhosttyConfig(text: string): GhosttyConfig {
  const config: GhosttyConfig = {
    fontFamily: [],
    adjustments: {},
    themes: [],
    palette: {},
    configFiles: [],
    raw: [],
  };

  for (const line of text.split(/\r?\n/)) {
    const parsed = parseConfigLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    config.raw.push([key, value]);

    switch (key) {
      case 'font-family':
        if (value !== '') {
          config.fontFamily.push(value);
        } else {
          // An empty value clears the list (see Ghostty's font-family docs)
          config.fontFamily = [];
          config.fontFamilyReset = true;
        }
        break;

      case 'font-size': {
        const n = parseNumber(value);
        if (n !== undefined) config.fontSize = n;
        break;
      }

      case 'font-thicken': {
        const b = parseBool(value);
        if (b !== undefined) config.fontThicken = b;
        break;
      }

      case 'adjust-cell-width':
        config.adjustments.cellWidth = value;
        break;
      case 'adjust-cell-height':
        config.adjustments.cellHeight = value;
        break;
      case 'adjust-font-baseline':
        config.adjustments.fontBaseline = value;
        break;
      case 'adjust-underline-position':
        config.adjustments.underlinePosition = value;
        break;
      case 'adjust-underline-thickness':
        config.adjustments.underlineThickness = value;
        break;
      case 'adjust-strikethrough-position':
        config.adjustments.strikethroughPosition = value;
        break;
      case 'adjust-strikethrough-thickness':
        config.adjustments.strikethroughThickness = value;
        break;
      case 'adjust-overline-position':
        config.adjustments.overlinePosition = value;
        break;
      case 'adjust-overline-thickness':
        config.adjustments.overlineThickness = value;
        break;
      case 'adjust-cursor-height':
        config.adjustments.cursorHeight = value;
        break;
      case 'adjust-cursor-thickness':
        config.adjustments.cursorThickness = value;
        break;

      case 'cursor-style':
        if (
          value === 'block' ||
          value === 'bar' ||
          value === 'underline' ||
          value === 'block_hollow'
        ) {
          config.cursorStyle = value;
        }
        break;

      case 'cursor-style-blink': {
        const b = parseBool(value);
        if (b !== undefined) config.cursorStyleBlink = b;
        break;
      }

      case 'cursor-opacity': {
        const n = parseNumber(value);
        if (n !== undefined) config.cursorOpacity = Math.min(1, Math.max(0, n));
        break;
      }

      case 'theme':
        // `theme = light:Foo,dark:Bar` -> prefer the dark variant, but keep the
        // light one as a fallback in case the dark theme file is missing.
        for (const entry of value.split(',')) {
          const part = entry.trim();
          if (part === '') continue;
          const colon = part.indexOf(':');
          if (colon === -1) {
            config.themes.push(part);
          } else {
            const variant = part.slice(0, colon).trim();
            const name = part.slice(colon + 1).trim();
            if (variant === 'dark') config.themes.unshift(name);
            else config.themes.push(name);
          }
        }
        break;

      case 'palette': {
        const eq = value.indexOf('=');
        if (eq === -1) break;
        const index = Number.parseInt(value.slice(0, eq).trim(), 0);
        const color = normalizeColor(value.slice(eq + 1));
        if (Number.isInteger(index) && index >= 0 && index < 256 && color) {
          config.palette[index] = color;
        }
        break;
      }

      case 'background': {
        const c = normalizeColor(value);
        if (c) config.background = c;
        break;
      }
      case 'foreground': {
        const c = normalizeColor(value);
        if (c) config.foreground = c;
        break;
      }
      case 'cursor-color': {
        const c = normalizeColor(value);
        if (c) config.cursorColor = c;
        break;
      }
      case 'cursor-text': {
        const c = normalizeColor(value);
        if (c) config.cursorText = c;
        break;
      }
      case 'selection-background': {
        const c = normalizeColor(value);
        if (c) config.selectionBackground = c;
        break;
      }
      case 'selection-foreground': {
        const c = normalizeColor(value);
        if (c) config.selectionForeground = c;
        break;
      }

      case 'faint-opacity': {
        const n = parseNumber(value);
        if (n !== undefined) config.faintOpacity = n;
        break;
      }
      case 'background-opacity': {
        const n = parseNumber(value);
        if (n !== undefined) config.backgroundOpacity = n;
        break;
      }

      case 'window-padding-x': {
        const p = parsePadding(value);
        if (p) config.windowPaddingX = p;
        break;
      }
      case 'window-padding-y': {
        const p = parsePadding(value);
        if (p) config.windowPaddingY = p;
        break;
      }

      case 'config-file':
        config.configFiles.push(value);
        break;

      default:
        break;
    }
  }

  return config;
}

/**
 * Merge configs in load order (later values win, repeatable keys accumulate).
 * Used for `config-file` includes.
 */
export function mergeGhosttyConfigs(configs: GhosttyConfig[]): GhosttyConfig {
  const merged: GhosttyConfig = {
    fontFamily: [],
    adjustments: {},
    themes: [],
    palette: {},
    configFiles: [],
    raw: [],
  };

  for (const config of configs) {
    // An explicit `font-family = ""` clears previously accumulated families
    if (config.fontFamilyReset) merged.fontFamily = [];
    merged.fontFamily.push(...config.fontFamily);
    if (config.fontSize !== undefined) merged.fontSize = config.fontSize;
    if (config.fontThicken !== undefined) merged.fontThicken = config.fontThicken;
    Object.assign(merged.adjustments, config.adjustments);
    if (config.cursorStyle !== undefined) merged.cursorStyle = config.cursorStyle;
    if (config.cursorStyleBlink !== undefined) merged.cursorStyleBlink = config.cursorStyleBlink;
    if (config.cursorOpacity !== undefined) merged.cursorOpacity = config.cursorOpacity;
    if (config.themes.length > 0) merged.themes = [...config.themes];
    if (config.background !== undefined) merged.background = config.background;
    if (config.foreground !== undefined) merged.foreground = config.foreground;
    if (config.cursorColor !== undefined) merged.cursorColor = config.cursorColor;
    if (config.cursorText !== undefined) merged.cursorText = config.cursorText;
    if (config.selectionBackground !== undefined)
      merged.selectionBackground = config.selectionBackground;
    if (config.selectionForeground !== undefined)
      merged.selectionForeground = config.selectionForeground;
    if (config.faintOpacity !== undefined) merged.faintOpacity = config.faintOpacity;
    if (config.backgroundOpacity !== undefined) merged.backgroundOpacity = config.backgroundOpacity;
    if (config.windowPaddingX !== undefined) merged.windowPaddingX = config.windowPaddingX;
    if (config.windowPaddingY !== undefined) merged.windowPaddingY = config.windowPaddingY;
    Object.assign(merged.palette, config.palette);
    merged.configFiles.push(...config.configFiles);
    merged.raw.push(...config.raw);
  }

  return merged;
}

// ============================================================================
// Theme Resolution
// ============================================================================

const ANSI_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;

/**
 * Resolve the effective theme for a config.
 *
 * Ghostty applies theme files first and explicit config keys afterwards, so a
 * `palette` entry in the config overrides the same index from the theme.
 * Colors that are set nowhere fall back to Ghostty's built-in defaults.
 */
export function resolveTheme(
  config: GhosttyConfig,
  options: ResolveThemeOptions = {}
): Required<ITheme> {
  const theme: Required<ITheme> = { ...GHOSTTY_DEFAULT_THEME, ...options.base };

  const themeConfig = options.themeText ? parseGhosttyConfig(options.themeText) : null;
  if (themeConfig) {
    applyThemeFile(theme, themeConfig);
  }

  applyThemeFile(theme, config);
  return theme;
}

function applyThemeFile(theme: ITheme, config: GhosttyConfig): void {
  if (config.background) theme.background = config.background;
  if (config.foreground) theme.foreground = config.foreground;
  if (config.cursorColor) theme.cursor = config.cursorColor;
  if (config.cursorText) theme.cursorAccent = config.cursorText;
  if (config.selectionBackground) theme.selectionBackground = config.selectionBackground;
  if (config.selectionForeground) theme.selectionForeground = config.selectionForeground;

  for (const [indexStr, color] of Object.entries(config.palette)) {
    const index = Number(indexStr);
    if (index >= 0 && index < 16) {
      (theme as Record<string, string>)[ANSI_KEYS[index]] = color;
    }
  }
}

// ============================================================================
// Terminal Options
// ============================================================================

/**
 * Convert a parsed Ghostty config into {@link ITerminalOptions}.
 *
 * ```ts
 * const config = parseGhosttyConfig(await readFile(ghosttyConfigPath, 'utf8'));
 * const { options, theme } = toTerminalOptions(config, { themeText });
 * const term = new Terminal({ ...options, theme });
 * ```
 */
export function toTerminalOptions(
  config: GhosttyConfig,
  options: ResolveThemeOptions = {}
): ToTerminalOptionsResult {
  const warnings: string[] = [];
  const theme = resolveTheme(config, options);

  const terminalOptions: ITerminalOptions = {
    theme,
    adjustments: config.adjustments,
  };

  if (config.fontFamily.length > 0) {
    // CSS font stacks are comma separated; quote families containing spaces.
    const families = config.fontFamily.map((family) =>
      /[^a-zA-Z0-9-]/.test(family) ? `"${family}"` : family
    );
    // Keep a monospace fallback at the end of the stack: if the configured
    // font isn't installed, the browser would otherwise fall back to a
    // proportional font, which renders as text with gaps between characters.
    terminalOptions.fontFamily = [...families, DEFAULT_FONT_FAMILY].join(', ');
  }

  if (config.fontSize !== undefined) terminalOptions.fontSize = config.fontSize;

  if (config.cursorStyle !== undefined) {
    if (config.cursorStyle === 'block_hollow') {
      // Not supported by the renderer yet; a block is the closest match.
      warnings.push('cursor-style = block_hollow is rendered as a solid block');
      terminalOptions.cursorStyle = 'block';
    } else {
      terminalOptions.cursorStyle = config.cursorStyle;
    }
  }

  // Ghostty blinks the cursor by default when `cursor-style-blink` is unset.
  terminalOptions.cursorBlink = config.cursorStyleBlink ?? true;

  if (config.cursorOpacity !== undefined) terminalOptions.cursorOpacity = config.cursorOpacity;

  if (config.fontThicken) {
    warnings.push('font-thicken is a macOS text-rendering feature with no exact canvas equivalent');
  }

  return { options: terminalOptions, theme, warnings };
}

// ============================================================================
// Filesystem helpers (Node / Bun only)
// ============================================================================

export interface LoadGhosttyConfigOptions {
  /** Config file path. Defaults to `$XDG_CONFIG_HOME/ghostty/config` or `~/.config/ghostty/config`. */
  configPath?: string;
  /** Extra theme directories to search */
  themeDirs?: string[];
  /** Maximum `config-file` include depth (default: 5) */
  maxIncludeDepth?: number;
}

export interface LoadedGhosttyConfig {
  config: GhosttyConfig;
  /** Theme file contents, when a theme was resolved */
  themeText?: string;
  /** Theme name that was resolved */
  themeName?: string;
  /** Paths of the files that were read */
  files: string[];
  warnings: string[];
}

/**
 * Load a Ghostty config (and its includes + theme) from disk.
 *
 * Node/Bun only; the rest of this module is environment agnostic.
 */
export async function loadGhosttyConfig(
  options: LoadGhosttyConfigOptions = {}
): Promise<LoadedGhosttyConfig> {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');

  const home = os.homedir();
  const configPath =
    options.configPath ??
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'ghostty', 'config');

  const warnings: string[] = [];
  const files: string[] = [];
  const configs: GhosttyConfig[] = [];

  const readConfig = async (file: string, depth: number): Promise<void> => {
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      if (depth === 0) throw new Error(`Could not read Ghostty config: ${file}`);
      warnings.push(`Could not read included config: ${file}`);
      return;
    }
    files.push(file);
    const config = parseGhosttyConfig(text);
    configs.push(config);

    if (depth >= (options.maxIncludeDepth ?? 5)) return;
    for (const include of config.configFiles) {
      const includePath = include.startsWith('/')
        ? include
        : path.join(path.dirname(file), include);
      await readConfig(includePath, depth + 1);
    }
  };

  await readConfig(configPath, 0);
  const config = mergeGhosttyConfigs(configs);

  // Resolve the first theme that exists on disk.
  let themeText: string | undefined;
  let themeName: string | undefined;
  if (config.themes.length > 0) {
    const dirs = options.themeDirs ?? defaultThemeDirs();
    outer: for (const name of config.themes) {
      for (const dir of dirs) {
        const themePath = path.join(dir, name);
        try {
          themeText = await fs.readFile(themePath, 'utf8');
          themeName = name;
          files.push(themePath);
          break outer;
        } catch {
          // try the next directory
        }
      }
      warnings.push(`Theme not found: ${name}`);
    }
  }

  return { config, themeText, themeName, files, warnings };
}

/** Default directories Ghostty looks in for theme files. */
export function defaultThemeDirs(): string[] {
  const dirs: string[] = [];
  const home = process.env.HOME ?? '';
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? (home ? `${home}/.config` : '');
  if (xdgConfig) dirs.push(`${xdgConfig}/ghostty/themes`);
  if (home) dirs.push(`${home}/.local/share/ghostty/themes`);

  const dataDirs = (process.env.XDG_DATA_DIRS ?? '/usr/local/share:/usr/share').split(':');
  for (const dir of dataDirs) {
    if (dir) dirs.push(`${dir}/ghostty/themes`);
  }

  // macOS app bundle
  if (process.platform === 'darwin') {
    dirs.push('/Applications/Ghostty.app/Contents/Resources/ghostty/themes');
  }

  return dirs;
}
