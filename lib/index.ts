/**
 * Public API for @becrafter/ghostty-web
 *
 * Main entry point following xterm.js conventions
 */

import { Ghostty } from './ghostty';

// Module-level Ghostty instance (initialized by init())
let ghosttyInstance: Ghostty | null = null;

/**
 * Initialize the ghostty-web library by loading the WASM module.
 * Must be called before creating any Terminal instances.
 *
 * This creates a shared WASM instance that all Terminal instances will use.
 * For test isolation, pass a Ghostty instance directly to Terminal constructor.
 *
 * @example
 * ```typescript
 * import { init, Terminal } from '@becrafter/ghostty-web';
 *
 * await init();
 * const term = new Terminal();
 * term.open(document.getElementById('terminal'));
 * ```
 */
export async function init(): Promise<void> {
  if (ghosttyInstance) {
    return; // Already initialized
  }
  ghosttyInstance = await Ghostty.load();
}

/**
 * Get the initialized Ghostty instance.
 * Throws if init() hasn't been called.
 * @internal
 */
export function getGhostty(): Ghostty {
  if (!ghosttyInstance) {
    throw new Error(
      '@becrafter/ghostty-web not initialized. Call init() before creating Terminal instances.\n' +
        'Example:\n' +
        '  import { init, Terminal } from "@becrafter/ghostty-web";\n' +
        '  await init();\n' +
        '  const term = new Terminal();\n\n' +
        'For tests, pass a Ghostty instance directly:\n' +
        '  import { Ghostty, Terminal } from "@becrafter/ghostty-web";\n' +
        '  const ghostty = await Ghostty.load();\n' +
        '  const term = new Terminal({ ghostty });'
    );
  }
  return ghosttyInstance;
}

// Main Terminal class
export { Terminal } from './terminal';

// xterm.js-compatible interfaces
export type {
  ITerminalOptions,
  ITheme,
  ITerminalAddon,
  ITerminalCore,
  IDisposable,
  IEvent,
  IBufferRange,
  IKeyEvent,
  IUnicodeVersionProvider,
} from './interfaces';

// Ghostty WASM components (for advanced usage)
export {
  Ghostty,
  GhosttyTerminal,
  KeyEncoder,
  CellFlags,
  DirtyState,
  KeyEncoderOption,
} from './ghostty';
export { Key, KeyAction, Mods } from './types';
export type { KeyEvent, GhosttyCell, RGB, Cursor, TerminalHandle } from './types';

// Low-level components (for custom integrations)
export {
  CanvasRenderer,
  GHOSTTY_DEFAULT_THEME,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
} from './renderer';
export type { RendererOptions, IRenderable } from './renderer';

// Font metrics (Ghostty-parity measurement)
export {
  measureFontMetrics,
  applyMetricModifiers,
  parseMetricModifier,
  fallbackFontMetrics,
  isFontAvailable,
  isMonospaceFont,
  firstAvailableFontFamily,
  splitFontStack,
} from './metrics';
export type {
  FaceMetrics,
  FontMetrics,
  MetricModifier,
  MetricModifiers,
  MeasureFontMetricsOptions,
} from './metrics';

// Sprites (box drawing / block elements, drawn like Ghostty)
export { drawBoxDrawing, drawBlockElement, hasSprite } from './sprites';
export type { SpriteMetrics } from './sprites';

// Scrollbar geometry (shared by the renderer and hit-testing)
export {
  SCROLLBAR_MARGIN,
  SCROLLBAR_WIDTH,
  SCROLLBAR_PADDING,
  SCROLLBAR_MIN_THUMB_HEIGHT,
  SCROLLBAR_THUMB_OPACITY_SCROLLED,
  SCROLLBAR_THUMB_OPACITY_IDLE,
  computeScrollbarLayout,
  isOnScrollbar,
} from './scrollbar';
export type { ScrollbarLayout } from './scrollbar';
export { InputHandler } from './input-handler';
export { EventEmitter } from './event-emitter';
export { SelectionManager } from './selection-manager';
export type { SelectionCoordinates } from './selection-manager';

// Addons
export { FitAddon } from './addons/fit';
export type { ITerminalDimensions } from './addons/fit';

// Ghostty config bridge (match a native Ghostty terminal)
export {
  parseGhosttyConfig,
  parseConfigLine,
  mergeGhosttyConfigs,
  resolveTheme,
  toTerminalOptions,
  normalizeColor,
  loadGhosttyConfig,
  defaultThemeDirs,
} from './ghostty-config';
export type {
  GhosttyConfig,
  GhosttyPadding,
  LoadedGhosttyConfig,
  LoadGhosttyConfigOptions,
  ResolveThemeOptions,
  ToTerminalOptionsResult,
} from './ghostty-config';

// Link providers
export { OSC8LinkProvider } from './providers/osc8-link-provider';
export { UrlRegexProvider } from './providers/url-regex-provider';
export { LinkDetector } from './link-detector';
export type { ILink, ILinkProvider, IBufferCellPosition } from './types';
