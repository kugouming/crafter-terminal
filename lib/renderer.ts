/**
 * Canvas Renderer for Terminal Display
 *
 * High-performance canvas-based renderer that draws the terminal using
 * Ghostty's WASM terminal emulator. Features:
 * - Font metrics measurement with DPI scaling
 * - Full color support (256-color palette + RGB)
 * - All text styles (bold, italic, underline, strikethrough, etc.)
 * - Multiple cursor styles (block, underline, bar)
 * - Dirty line optimization for 60 FPS
 */

import type { ITheme } from './interfaces';
import {
  type FaceMetrics,
  type FontMetrics,
  type MetricModifiers,
  firstAvailableFontFamily,
  isMonospaceFont,
  measureFontMetrics,
} from './metrics';
import {
  SCROLLBAR_MARGIN,
  SCROLLBAR_THUMB_OPACITY_IDLE,
  SCROLLBAR_THUMB_OPACITY_SCROLLED,
  computeScrollbarLayout,
} from './scrollbar';
import type { SelectionManager } from './selection-manager';
import { drawBlockElement, drawBoxDrawing } from './sprites';
import type { GhosttyCell, ILink } from './types';
import { CellFlags } from './types';

// Interface for objects that can be rendered
export interface IRenderable {
  getLine(y: number): GhosttyCell[] | null;
  getCursor(): { x: number; y: number; visible: boolean };
  getDimensions(): { cols: number; rows: number };
  isRowDirty(y: number): boolean;
  /** Returns true if a full redraw is needed (e.g., screen change) */
  needsFullRedraw?(): boolean;
  clearDirty(): void;
  /**
   * Get the full grapheme string for a cell at (row, col).
   * For cells with grapheme_len > 0, this returns all codepoints combined.
   * For simple cells, returns the single character.
   */
  getGraphemeString?(row: number, col: number): string;
}

export interface IScrollbackProvider {
  getScrollbackLine(offset: number): GhosttyCell[] | null;
  getScrollbackLength(): number;
}

// ============================================================================
// Type Definitions
// ============================================================================

export interface RendererOptions {
  fontSize?: number; // Default: 13 on macOS, 12 elsewhere (matches Ghostty)
  fontFamily?: string; // Default: platform monospace stack (matches Ghostty)
  cursorStyle?: 'block' | 'underline' | 'bar'; // Default: 'block'
  cursorBlink?: boolean; // Default: false
  cursorOpacity?: number; // Default: 1
  theme?: ITheme;
  devicePixelRatio?: number; // Default: window.devicePixelRatio
  /** Metric adjustments, mirroring Ghostty's `adjust-*` options */
  adjustments?: MetricModifiers;
  /** Explicit metric overrides, applied after measurement and adjustments */
  metrics?: Partial<FontMetrics>;
  /**
   * Metrics read from the font's tables (see `scripts/build-font-metrics.py`).
   * When set, the grid is computed from these instead of from browser font
   * APIs, so it is identical on every browser and platform. Only used when the
   * pinned family is the one that actually resolves.
   */
  fontMetrics?: FaceMetrics;
  /**
   * Draw box-drawing and block-element characters as sprites instead of using
   * the font's glyphs, like Ghostty does. Default: true.
   */
  sprites?: boolean;
}

export type { FontMetrics };

// ============================================================================
// Default Theme
// ============================================================================

/**
 * Ghostty's built-in default theme ("Ghostty Default Style"), so that an
 * unconfigured web terminal renders identically to an unconfigured native one.
 *
 * Source: `src/config/Config.zig` (background/foreground) and
 * `src/terminal/color.zig` (`Name.default`, the Tomorrow Night palette).
 */
export const GHOSTTY_DEFAULT_THEME: Required<ITheme> = {
  foreground: '#ffffff',
  background: '#282c34',
  // The cursor defaults to the window foreground color, and the text under a
  // block cursor to the window background color.
  cursor: '#ffffff',
  cursorAccent: '#282c34',
  // With no `selection-*` configuration, Ghostty inverts the window
  // foreground/background for selections.
  selectionBackground: '#ffffff',
  selectionForeground: '#282c34',
  black: '#1d1f21',
  red: '#cc6666',
  green: '#b5bd68',
  yellow: '#f0c674',
  blue: '#81a2be',
  magenta: '#b294bb',
  cyan: '#8abeb7',
  white: '#c5c8c6',
  brightBlack: '#666666',
  brightRed: '#d54e53',
  brightGreen: '#b9ca4a',
  brightYellow: '#e7c547',
  brightBlue: '#7aa6da',
  brightMagenta: '#c397d8',
  brightCyan: '#70c0b1',
  brightWhite: '#eaeaea',
};

/** @deprecated Use {@link GHOSTTY_DEFAULT_THEME}. Kept as an alias for compatibility. */
export const DEFAULT_THEME: Required<ITheme> = GHOSTTY_DEFAULT_THEME;

// ============================================================================
// Default Font
// ============================================================================

function detectMacOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  if (/Mac|iPhone|iPad|iPod/.test(ua)) return true;
  const platform = (navigator as Navigator & { platform?: string }).platform ?? '';
  return platform.startsWith('Mac');
}

/** Ghostty's default font size: 13 on macOS, 12 everywhere else. */
export const DEFAULT_FONT_SIZE = detectMacOS() ? 13 : 12;

/**
 * Default font stack. Ghostty uses the system monospace font when `font-family`
 * is unset; this stack picks the same font the platform's browsers use for
 * `monospace` while avoiding the "last resort" font that browsers fall back to
 * when a generic family is not configured.
 */
export const DEFAULT_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, "DejaVu Sans Mono", "Liberation Mono", "Courier New", monospace';

// ============================================================================
// Helpers
// ============================================================================

interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse `#rgb`, `#rrggbb` (with or without `#`) into RGB components.
 */
export function parseHexColor(value: string | undefined): RGB | null {
  if (!value) return null;
  let hex = value.trim().replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

/**
 * Ghostty paints "covering" glyphs using the foreground color as the cell
 * background, so that they always cover the cell completely.
 *
 * Mirrors `isCovering` in `src/renderer/cell.zig`, which currently only
 * matches U+2588 FULL BLOCK.
 */
export function isCovering(codepoint: number): boolean {
  return codepoint === 0x2588;
}

// ============================================================================
// CanvasRenderer Class
// ============================================================================

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private fontSize: number;
  private fontFamily: string;
  private cursorStyle: 'block' | 'underline' | 'bar';
  private cursorBlink: boolean;
  private cursorOpacity: number;
  private theme: Required<ITheme>;
  private devicePixelRatio: number;
  private metrics: FontMetrics;
  private adjustments: MetricModifiers;
  private metricsOverride: Partial<FontMetrics>;
  private fontMetrics?: FaceMetrics;
  private sprites: boolean;
  private palette: string[];
  /** Theme background as RGB, used to detect cells with no explicit background */
  private defaultBg: RGB;
  /** Last canvas size in CSS pixels (canvas.width is in device pixels) */
  private canvasCssWidth: number = 0;
  private canvasCssHeight: number = 0;

  // Cursor blinking state
  private cursorVisible: boolean = true;
  private cursorBlinkInterval?: number;
  private lastCursorPosition: { x: number; y: number } = { x: 0, y: 0 };

  // Viewport tracking (for scrolling)
  private lastViewportY: number = 0;

  // Current buffer being rendered (for grapheme lookups)
  private currentBuffer: IRenderable | null = null;

  // Selection manager (for rendering selection)
  private selectionManager?: SelectionManager;
  // Cached selection coordinates for current render pass (viewport-relative)
  private currentSelectionCoords: {
    startCol: number;
    startRow: number;
    endCol: number;
    endRow: number;
  } | null = null;

  // Link rendering state
  private hoveredHyperlinkId: number = 0;
  private previousHoveredHyperlinkId: number = 0;

  // Regex link hover tracking (for links without hyperlink_id)
  private hoveredLinkRange: { startX: number; startY: number; endX: number; endY: number } | null =
    null;
  private previousHoveredLinkRange: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null = null;

  constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context');
    }
    this.ctx = ctx;

    // Apply options
    this.fontSize = options.fontSize ?? DEFAULT_FONT_SIZE;
    this.fontFamily = options.fontFamily ?? DEFAULT_FONT_FAMILY;
    this.cursorStyle = options.cursorStyle ?? 'block';
    this.cursorBlink = options.cursorBlink ?? false;
    this.cursorOpacity = options.cursorOpacity ?? 1;
    this.theme = { ...GHOSTTY_DEFAULT_THEME, ...options.theme };
    this.devicePixelRatio = options.devicePixelRatio ?? window.devicePixelRatio ?? 1;
    this.adjustments = options.adjustments ?? {};
    this.metricsOverride = options.metrics ?? {};
    this.fontMetrics = options.fontMetrics;
    this.sprites = options.sprites ?? true;

    // Build color palette (16 ANSI colors)
    this.palette = this.buildPalette();
    this.defaultBg = parseHexColor(this.theme.background) ?? { r: 0, g: 0, b: 0 };

    // Measure font metrics
    this.resolveFontFamily();
    this.metrics = this.measureFont();

    // Setup cursor blinking if enabled
    if (this.cursorBlink) {
      this.startCursorBlink();
    }
  }

  // ==========================================================================
  // Font Metrics Measurement
  // ==========================================================================

  /**
   * Make sure the configured font is actually usable as a terminal font.
   *
   * If the family (or the first available family in the stack) is not
   * monospace, the browser has fallen back to a proportional font - usually
   * because the configured font is not installed. Drawing a grid with a
   * proportional font puts every glyph in a cell sized for the widest
   * character, which looks broken, so we switch to the default monospace
   * stack instead.
   */
  private resolveFontFamily(): void {
    const monospace = isMonospaceFont(this.fontFamily, this.fontSize * this.devicePixelRatio);
    if (monospace === false) {
      console.warn(
        `ghostty-web: "${this.fontFamily}" is not available as a monospace font in this ` +
          `browser (is it installed?); falling back to the default monospace stack`
      );
      this.fontFamily = DEFAULT_FONT_FAMILY;
    }
  }

  /**
   * Pick the metrics source: the font's own tables when the pinned family is
   * the one that will actually be used, browser measurement otherwise.
   *
   * Pinned metrics describe one specific font, so using them while rendering a
   * different one (because the font is missing, or because the user configured
   * another family that is installed) would produce a wrong grid.
   */
  private resolveFaceMetrics(): FaceMetrics | undefined {
    const face = this.fontMetrics;
    if (!face) return undefined;

    if (!face.family) {
      console.warn('ghostty-web: fontMetrics has no family, ignoring the pinned metrics');
      return undefined;
    }

    const px = this.fontSize * this.devicePixelRatio;
    const resolved = firstAvailableFontFamily(this.fontFamily, px);
    if (resolved !== null && resolved.toLowerCase() === face.family.toLowerCase()) {
      return face;
    }

    console.warn(
      `ghostty-web: pinned metrics are for "${face.family}" but "${resolved ?? this.fontFamily}" ` +
        'resolves first; measuring the font instead'
    );
    return undefined;
  }

  /**
   * Measure font metrics using Ghostty's algorithm (see `lib/metrics.ts`).
   */
  private measureFont(): FontMetrics {
    const measured = measureFontMetrics({
      fontSize: this.fontSize,
      fontFamily: this.fontFamily,
      devicePixelRatio: this.devicePixelRatio,
      adjustments: this.adjustments,
      face: this.resolveFaceMetrics(),
    });

    const hasOverride = Object.keys(this.metricsOverride).length > 0;
    const result = hasOverride ? { ...measured, ...this.metricsOverride } : measured;

    // Keep derived values consistent when the caller overrides primitives.
    if (hasOverride) {
      if (this.metricsOverride.cursorHeight === undefined) {
        result.cursorHeight = result.height;
      }
      if (this.metricsOverride.overlineThickness === undefined) {
        result.overlineThickness = result.underlineThickness;
      }
    }

    return result;
  }

  /**
   * Remeasure font metrics (call after font loads or changes)
   */
  public remeasureFont(): void {
    this.metrics = this.measureFont();
  }

  // ==========================================================================
  // Color Conversion
  // ==========================================================================

  private rgbToCSS(r: number, g: number, b: number): string {
    return `rgb(${r}, ${g}, ${b})`;
  }

  // ==========================================================================
  // Canvas Sizing
  // ==========================================================================

  /**
   * Resize canvas to fit terminal dimensions
   */
  public resize(cols: number, rows: number): void {
    const cssWidth = cols * this.metrics.width;
    const cssHeight = rows * this.metrics.height;

    // Device-pixel canvas size. Metrics can be fractional CSS pixels (e.g. a
    // cell width of 8.5 at DPR 2), so round to whole device pixels and let the
    // canvas cover any remainder.
    const pixelWidth = Math.round(cssWidth * this.devicePixelRatio);
    const pixelHeight = Math.round(cssHeight * this.devicePixelRatio);

    // Set CSS size (what user sees)
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;

    // Set actual canvas size (scaled for DPI)
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;

    // Scale context to match DPI (setting canvas.width/height resets the context)
    this.ctx.scale(pixelWidth / cssWidth, pixelHeight / cssHeight);
    this.canvasCssWidth = cssWidth;
    this.canvasCssHeight = cssHeight;

    // Set text rendering properties for crisp text
    this.ctx.textBaseline = 'alphabetic';
    this.ctx.textAlign = 'left';

    // Fill background after resize
    this.ctx.fillStyle = this.theme.background;
    this.ctx.fillRect(0, 0, cssWidth, cssHeight);
  }

  // ==========================================================================
  // Main Rendering
  // ==========================================================================

  /**
   * Render the terminal buffer to canvas
   */
  public render(
    buffer: IRenderable,
    forceAll: boolean = false,
    viewportY: number = 0,
    scrollbackProvider?: IScrollbackProvider,
    scrollbarOpacity: number = 1
  ): void {
    // Store buffer reference for grapheme lookups in renderCell
    this.currentBuffer = buffer;

    // getCursor() calls update() internally to ensure fresh state.
    // Multiple update() calls are safe - dirty state persists until clearDirty().
    const cursor = buffer.getCursor();
    const dims = buffer.getDimensions();
    const scrollbackLength = scrollbackProvider ? scrollbackProvider.getScrollbackLength() : 0;

    // Check if buffer needs full redraw (e.g., screen change between normal/alternate)
    if (buffer.needsFullRedraw?.()) {
      forceAll = true;
    }

    // Resize canvas if dimensions changed
    const needsResize =
      this.canvas.width !== Math.round(dims.cols * this.metrics.width * this.devicePixelRatio) ||
      this.canvas.height !== Math.round(dims.rows * this.metrics.height * this.devicePixelRatio);

    if (needsResize) {
      this.resize(dims.cols, dims.rows);
      forceAll = true; // Force full render after resize
    }

    // Force re-render when viewport changes (scrolling)
    if (viewportY !== this.lastViewportY) {
      forceAll = true;
      this.lastViewportY = viewportY;
    }

    // Check if cursor position changed or if blinking (need to redraw cursor line)
    const cursorMoved =
      cursor.x !== this.lastCursorPosition.x || cursor.y !== this.lastCursorPosition.y;
    if (cursorMoved || this.cursorBlink) {
      // Mark cursor lines as needing redraw
      if (!forceAll && !buffer.isRowDirty(cursor.y)) {
        // Need to redraw cursor line
        const line = buffer.getLine(cursor.y);
        if (line) {
          this.renderLine(line, cursor.y, dims.cols);
        }
      }
      if (cursorMoved && this.lastCursorPosition.y !== cursor.y) {
        // Also redraw old cursor line if cursor moved to different line
        if (!forceAll && !buffer.isRowDirty(this.lastCursorPosition.y)) {
          const line = buffer.getLine(this.lastCursorPosition.y);
          if (line) {
            this.renderLine(line, this.lastCursorPosition.y, dims.cols);
          }
        }
      }
    }

    // Check if we need to redraw selection-related lines
    const hasSelection = this.selectionManager && this.selectionManager.hasSelection();
    const selectionRows = new Set<number>();

    // Cache selection coordinates for use during cell rendering
    // This is used by isInSelection() to determine if a cell needs selection colors
    this.currentSelectionCoords = hasSelection ? this.selectionManager!.getSelectionCoords() : null;

    // Mark current selection rows for redraw (includes programmatic selections)
    if (this.currentSelectionCoords) {
      const coords = this.currentSelectionCoords;
      for (let row = coords.startRow; row <= coords.endRow; row++) {
        selectionRows.add(row);
      }
    }

    // Always mark dirty selection rows for redraw (to clear old overlay)
    if (this.selectionManager) {
      const dirtyRows = this.selectionManager.getDirtySelectionRows();
      if (dirtyRows.size > 0) {
        for (const row of dirtyRows) {
          selectionRows.add(row);
        }
        // Clear the dirty rows tracking after marking for redraw
        this.selectionManager.clearDirtySelectionRows();
      }
    }

    // Track rows with hyperlinks that need redraw when hover changes
    const hyperlinkRows = new Set<number>();
    const hyperlinkChanged = this.hoveredHyperlinkId !== this.previousHoveredHyperlinkId;
    const linkRangeChanged =
      JSON.stringify(this.hoveredLinkRange) !== JSON.stringify(this.previousHoveredLinkRange);

    if (hyperlinkChanged) {
      // Find rows containing the old or new hovered hyperlink
      // Must check the correct buffer based on viewportY (scrollback vs screen)
      for (let y = 0; y < dims.rows; y++) {
        let line: GhosttyCell[] | null = null;

        // Same logic as rendering: fetch from scrollback or screen
        if (viewportY > 0) {
          if (y < viewportY && scrollbackProvider) {
            // This row is from scrollback
            // Floor viewportY for array access (handles fractional values during smooth scroll)
            const scrollbackOffset = scrollbackLength - Math.floor(viewportY) + y;
            line = scrollbackProvider.getScrollbackLine(scrollbackOffset);
          } else {
            // This row is from visible screen
            const screenRow = y - Math.floor(viewportY);
            line = buffer.getLine(screenRow);
          }
        } else {
          // At bottom - fetch from visible screen
          line = buffer.getLine(y);
        }

        if (line) {
          for (const cell of line) {
            if (
              cell.hyperlink_id === this.hoveredHyperlinkId ||
              cell.hyperlink_id === this.previousHoveredHyperlinkId
            ) {
              hyperlinkRows.add(y);
              break; // Found hyperlink in this row
            }
          }
        }
      }
      // Update previous state
      this.previousHoveredHyperlinkId = this.hoveredHyperlinkId;
    }

    // Track rows affected by link range changes (for regex URLs)
    if (linkRangeChanged) {
      // Add rows from old range
      if (this.previousHoveredLinkRange) {
        for (
          let y = this.previousHoveredLinkRange.startY;
          y <= this.previousHoveredLinkRange.endY;
          y++
        ) {
          hyperlinkRows.add(y);
        }
      }
      // Add rows from new range
      if (this.hoveredLinkRange) {
        for (let y = this.hoveredLinkRange.startY; y <= this.hoveredLinkRange.endY; y++) {
          hyperlinkRows.add(y);
        }
      }
      this.previousHoveredLinkRange = this.hoveredLinkRange;
    }

    // Track if anything was actually rendered
    let anyLinesRendered = false;

    // Determine which rows need rendering.
    // We also include adjacent rows (above and below) for each dirty row to handle
    // glyph overflow - tall glyphs like Devanagari vowel signs can extend into
    // adjacent rows' visual space.
    const rowsToRender = new Set<number>();
    for (let y = 0; y < dims.rows; y++) {
      // When scrolled, always force render all lines since we're showing scrollback
      const needsRender =
        viewportY > 0
          ? true
          : forceAll || buffer.isRowDirty(y) || selectionRows.has(y) || hyperlinkRows.has(y);

      if (needsRender) {
        rowsToRender.add(y);
        // Include adjacent rows to handle glyph overflow
        if (y > 0) rowsToRender.add(y - 1);
        if (y < dims.rows - 1) rowsToRender.add(y + 1);
      }
    }

    // Render each line
    for (let y = 0; y < dims.rows; y++) {
      if (!rowsToRender.has(y)) {
        continue;
      }

      anyLinesRendered = true;

      // Fetch line from scrollback or visible screen
      let line: GhosttyCell[] | null = null;
      if (viewportY > 0) {
        // Scrolled up - need to fetch from scrollback + visible screen
        // When scrolled up N lines, we want to show:
        // - Scrollback lines (from the end) + visible screen lines

        // Check if this row should come from scrollback or visible screen
        if (y < viewportY && scrollbackProvider) {
          // This row is from scrollback (upper part of viewport)
          // Get from end of scrollback buffer
          // Floor viewportY for array access (handles fractional values during smooth scroll)
          const scrollbackOffset = scrollbackLength - Math.floor(viewportY) + y;
          line = scrollbackProvider.getScrollbackLine(scrollbackOffset);
        } else {
          // This row is from visible screen (lower part of viewport)
          const screenRow = viewportY > 0 ? y - Math.floor(viewportY) : y;
          line = buffer.getLine(screenRow);
        }
      } else {
        // At bottom - fetch from visible screen
        line = buffer.getLine(y);
      }

      if (line) {
        this.renderLine(line, y, dims.cols);
      }
    }

    // Selection highlighting is now integrated into renderCellBackground/renderCellText
    // No separate overlay pass needed - this fixes z-order issues with complex glyphs

    // Link underlines are drawn during cell rendering (see renderCell)

    // Render cursor (only if we're at the bottom, not scrolled)
    if (viewportY === 0 && cursor.visible && this.cursorVisible) {
      this.renderCursor(cursor.x, cursor.y);
    }

    // Render scrollbar if scrolled or scrollback exists (with opacity for fade effect)
    if (scrollbackProvider && scrollbarOpacity > 0) {
      this.renderScrollbar(viewportY, scrollbackLength, dims.rows, scrollbarOpacity);
    }

    // Update last cursor position
    this.lastCursorPosition = { x: cursor.x, y: cursor.y };

    // ALWAYS clear dirty flags after rendering, regardless of forceAll.
    // This is critical - if we don't clear after a full redraw, the dirty
    // state persists and the next frame might not detect new changes properly.
    buffer.clearDirty();
  }

  /**
   * Render a single line using two-pass approach:
   * 1. First pass: Draw all cell backgrounds
   * 2. Second pass: Draw all cell text and decorations
   *
   * This two-pass approach is necessary for proper rendering of complex scripts
   * like Devanagari where diacritics (like vowel sign ि) can extend LEFT of the
   * base character into the previous cell's visual area. If we draw backgrounds
   * and text in a single pass (cell by cell), the background of cell N would
   * cover any left-extending portions of graphemes from cell N-1.
   */
  private renderLine(line: GhosttyCell[], y: number, cols: number): void {
    const lineY = y * this.metrics.height;
    const lineWidth = cols * this.metrics.width;

    // Clear line background then fill with theme color.
    // We clear just the cell area - glyph overflow is handled by also
    // redrawing adjacent rows (see render() method).
    // clearRect is needed because fillRect composites rather than replaces,
    // so transparent/translucent backgrounds wouldn't clear previous content.
    this.ctx.clearRect(0, lineY, lineWidth, this.metrics.height);
    this.ctx.fillStyle = this.theme.background;
    this.ctx.fillRect(0, lineY, lineWidth, this.metrics.height);

    // PASS 1: Draw all cell backgrounds first
    // This ensures all backgrounds are painted before any text, allowing text
    // to "bleed" across cell boundaries without being covered by adjacent backgrounds
    for (let x = 0; x < line.length; x++) {
      const cell = line[x];
      if (cell.width === 0) continue; // Skip spacer cells for wide characters
      this.renderCellBackground(cell, x, y);
    }

    // PASS 2: Draw all cell text and decorations
    // Now text can safely extend beyond cell boundaries (for complex scripts)
    for (let x = 0; x < line.length; x++) {
      const cell = line[x];
      if (cell.width === 0) continue; // Skip spacer cells for wide characters
      this.renderCellText(cell, x, y);
    }
  }

  /**
   * Render a cell's background only (Pass 1 of two-pass rendering)
   * Selection highlighting is integrated here to avoid z-order issues with
   * complex glyphs (like Devanagari) that extend outside their cell bounds.
   */
  private renderCellBackground(cell: GhosttyCell, x: number, y: number): void {
    const cellX = x * this.metrics.width;
    const cellY = y * this.metrics.height;
    const cellWidth = this.metrics.width * cell.width;

    // Check if this cell is selected
    const isSelected = this.isInSelection(x, y);

    if (isSelected) {
      // Draw selection background (solid color, not overlay)
      this.ctx.fillStyle = this.theme.selectionBackground;
      this.ctx.fillRect(cellX, cellY, cellWidth, this.metrics.height);
      return; // Selection background replaces cell background
    }

    // Extract background color and handle inverse
    let bg_r = cell.bg_r,
      bg_g = cell.bg_g,
      bg_b = cell.bg_b;

    if (cell.flags & CellFlags.INVERSE) {
      // When inverted, background becomes foreground
      bg_r = cell.fg_r;
      bg_g = cell.fg_g;
      bg_b = cell.fg_b;
    } else if (isCovering(cell.codepoint)) {
      // Ghostty fills the background of covering glyphs (U+2588 FULL BLOCK)
      // with the foreground color, so they always paint a solid block even if
      // the glyph does not quite fill the cell.
      bg_r = cell.fg_r;
      bg_g = cell.fg_g;
      bg_b = cell.fg_b;
    }

    // Cells without an explicit background are transparent in Ghostty: the
    // window background (already painted) shows through. The WASM resolves
    // default cells to the configured background color, so compare against it.
    if (bg_r === this.defaultBg.r && bg_g === this.defaultBg.g && bg_b === this.defaultBg.b) {
      return;
    }

    this.ctx.fillStyle = this.rgbToCSS(bg_r, bg_g, bg_b);
    this.ctx.fillRect(cellX, cellY, cellWidth, this.metrics.height);
  }

  /**
   * Render a cell's text and decorations (Pass 2 of two-pass rendering)
   * Selection foreground color is applied here to match the selection background.
   */
  private renderCellText(cell: GhosttyCell, x: number, y: number, colorOverride?: string): void {
    const cellX = x * this.metrics.width;
    const cellY = y * this.metrics.height;
    const cellWidth = this.metrics.width * cell.width;

    // Skip rendering if invisible
    if (cell.flags & CellFlags.INVISIBLE) {
      return;
    }

    // Check if this cell is selected
    const isSelected = this.isInSelection(x, y);

    // Set text style
    let fontStyle = '';
    if (cell.flags & CellFlags.ITALIC) fontStyle += 'italic ';
    if (cell.flags & CellFlags.BOLD) fontStyle += 'bold ';
    this.ctx.font = `${fontStyle}${this.fontSize}px ${this.fontFamily}`;

    // Set text color - use override, selection foreground, or normal color
    if (colorOverride) {
      this.ctx.fillStyle = colorOverride;
    } else if (isSelected) {
      this.ctx.fillStyle = this.theme.selectionForeground;
    } else {
      // Extract colors and handle inverse
      let fg_r = cell.fg_r,
        fg_g = cell.fg_g,
        fg_b = cell.fg_b;

      if (cell.flags & CellFlags.INVERSE) {
        // When inverted, foreground becomes background
        fg_r = cell.bg_r;
        fg_g = cell.bg_g;
        fg_b = cell.bg_b;
      }

      this.ctx.fillStyle = this.rgbToCSS(fg_r, fg_g, fg_b);
    }

    // Apply faint effect
    if (cell.flags & CellFlags.FAINT) {
      this.ctx.globalAlpha = 0.5;
    }

    // Draw text
    const textX = cellX;
    const textY = cellY + this.metrics.baseline;

    // Get the character to render - use grapheme lookup for complex scripts
    const codepoint = cell.codepoint || 32;
    let char: string;
    if (cell.grapheme_len > 0 && this.currentBuffer?.getGraphemeString) {
      // Cell has additional codepoints - get full grapheme cluster
      char = this.currentBuffer.getGraphemeString(y, x);
    } else {
      // Simple cell - single codepoint
      char = String.fromCodePoint(codepoint); // Default to space if null
    }

    // Box drawing and block elements are drawn as sprites (like Ghostty does)
    // so they line up with the cell grid instead of the font's line height.
    let drewSprite = false;
    if (this.sprites && cell.grapheme_len === 0) {
      const spriteMetrics = {
        cellWidth: this.metrics.width * cell.width,
        cellHeight: this.metrics.height,
        boxThickness: this.metrics.underlineThickness,
        devicePixelRatio: this.devicePixelRatio,
      };
      drewSprite =
        drawBoxDrawing(this.ctx, codepoint, textX, cellY, spriteMetrics) ||
        drawBlockElement(this.ctx, codepoint, textX, cellY, spriteMetrics);
    }

    if (!drewSprite) {
      this.ctx.fillText(char, textX, textY);
    }

    // Draw underline (position/thickness follow the font metrics, like Ghostty)
    if (cell.flags & CellFlags.UNDERLINE) {
      this.ctx.fillRect(
        cellX,
        cellY + this.metrics.underlinePosition,
        cellWidth,
        this.metrics.underlineThickness
      );
    }

    // Draw strikethrough
    if (cell.flags & CellFlags.STRIKETHROUGH) {
      this.ctx.fillRect(
        cellX,
        cellY + this.metrics.strikethroughPosition,
        cellWidth,
        this.metrics.strikethroughThickness
      );
    }

    // Draw hyperlink underline (for OSC8 hyperlinks)
    if (cell.hyperlink_id > 0) {
      const isHovered = cell.hyperlink_id === this.hoveredHyperlinkId;

      // Only show underline when hovered (cleaner look)
      if (isHovered) {
        this.ctx.strokeStyle = '#4A90E2'; // Blue underline on hover
        this.ctx.lineWidth = this.metrics.underlineThickness;
        this.ctx.beginPath();
        this.ctx.moveTo(cellX, cellY + this.metrics.underlinePosition);
        this.ctx.lineTo(cellX + cellWidth, cellY + this.metrics.underlinePosition);
        this.ctx.stroke();
      }
    }

    // Draw regex link underline (for plain text URLs)
    if (this.hoveredLinkRange) {
      const range = this.hoveredLinkRange;
      // Check if this cell is within the hovered link range
      const isInRange =
        (y === range.startY && x >= range.startX && (y < range.endY || x <= range.endX)) ||
        (y > range.startY && y < range.endY) ||
        (y === range.endY && x <= range.endX && (y > range.startY || x >= range.startX));

      if (isInRange) {
        this.ctx.strokeStyle = '#4A90E2'; // Blue underline on hover
        this.ctx.lineWidth = this.metrics.underlineThickness;
        this.ctx.beginPath();
        this.ctx.moveTo(cellX, cellY + this.metrics.underlinePosition);
        this.ctx.lineTo(cellX + cellWidth, cellY + this.metrics.underlinePosition);
        this.ctx.stroke();
      }
    }

    // Reset alpha (faint applies to decorations too, like in Ghostty)
    if (cell.flags & CellFlags.FAINT) {
      this.ctx.globalAlpha = 1.0;
    }
  }

  /**
   * Render cursor
   *
   * Geometry mirrors Ghostty's cursor sprites:
   * - block: fills the whole cell, text redrawn in the cursor-text color
   * - bar: `cursorThickness` wide, centered on the left edge of the cell
   * - underline: `cursorThickness` tall, sitting at the underline position
   */
  private renderCursor(x: number, y: number): void {
    const cursorX = x * this.metrics.width;
    const cursorY = y * this.metrics.height;

    this.ctx.fillStyle = this.theme.cursor;
    const previousAlpha = this.ctx.globalAlpha;
    if (this.cursorOpacity < 1) {
      this.ctx.globalAlpha = previousAlpha * this.cursorOpacity;
    }

    switch (this.cursorStyle) {
      case 'block':
        // Full cell block
        this.ctx.fillRect(cursorX, cursorY, this.metrics.width, this.metrics.cursorHeight);
        // Re-draw character under cursor with cursorAccent color
        {
          const line = this.currentBuffer?.getLine(y);
          if (line?.[x]) {
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.rect(cursorX, cursorY, this.metrics.width, this.metrics.cursorHeight);
            this.ctx.clip();
            this.renderCellText(line[x], x, y, this.theme.cursorAccent);
            this.ctx.restore();
          }
        }
        break;

      case 'underline':
        // Underline at the font's underline position
        this.ctx.fillRect(
          cursorX,
          cursorY + this.metrics.underlinePosition,
          this.metrics.width,
          this.metrics.cursorThickness
        );
        break;

      case 'bar':
        // Vertical bar, shifted half its thickness to the left so it sits
        // between characters rather than on top of one.
        this.ctx.fillRect(
          cursorX - Math.floor((this.metrics.cursorThickness + 1) / 2),
          cursorY,
          this.metrics.cursorThickness,
          this.metrics.cursorHeight
        );
        break;
    }

    this.ctx.globalAlpha = previousAlpha;
  }

  // ==========================================================================
  // Cursor Blinking
  // ==========================================================================

  private startCursorBlink(): void {
    // xterm.js uses ~530ms blink interval
    this.cursorBlinkInterval = window.setInterval(() => {
      this.cursorVisible = !this.cursorVisible;
      // Note: Render loop should redraw cursor line automatically
    }, 530);
  }

  private stopCursorBlink(): void {
    if (this.cursorBlinkInterval !== undefined) {
      clearInterval(this.cursorBlinkInterval);
      this.cursorBlinkInterval = undefined;
    }
    this.cursorVisible = true;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Update theme colors
   */
  public setTheme(theme: ITheme): void {
    this.theme = { ...GHOSTTY_DEFAULT_THEME, ...theme };
    this.palette = this.buildPalette();
    this.defaultBg = parseHexColor(this.theme.background) ?? { r: 0, g: 0, b: 0 };
  }

  /** Build the 16-color ANSI palette from the current theme. */
  private buildPalette(): string[] {
    return [
      this.theme.black,
      this.theme.red,
      this.theme.green,
      this.theme.yellow,
      this.theme.blue,
      this.theme.magenta,
      this.theme.cyan,
      this.theme.white,
      this.theme.brightBlack,
      this.theme.brightRed,
      this.theme.brightGreen,
      this.theme.brightYellow,
      this.theme.brightBlue,
      this.theme.brightMagenta,
      this.theme.brightCyan,
      this.theme.brightWhite,
    ];
  }

  /**
   * Update font size
   */
  public setFontSize(size: number): void {
    this.fontSize = size;
    this.metrics = this.measureFont();
  }

  /**
   * Update font family
   */
  public setFontFamily(family: string): void {
    this.fontFamily = family;
    this.resolveFontFamily();
    this.metrics = this.measureFont();
  }

  /**
   * Update metric adjustments (Ghostty's `adjust-*` options)
   */
  public setAdjustments(adjustments: MetricModifiers): void {
    this.adjustments = adjustments ?? {};
    this.metrics = this.measureFont();
  }

  /**
   * Update explicit metric overrides (applied after measurement)
   */
  public setMetricsOverride(metrics: Partial<FontMetrics>): void {
    this.metricsOverride = metrics ?? {};
    this.metrics = this.measureFont();
  }

  /**
   * Update the font-table metrics used to compute the grid
   */
  public setFontMetrics(fontMetrics?: FaceMetrics): void {
    this.fontMetrics = fontMetrics;
    this.metrics = this.measureFont();
  }

  /**
   * Update cursor opacity (Ghostty's `cursor-opacity`)
   */
  public setCursorOpacity(opacity: number): void {
    this.cursorOpacity = Math.min(1, Math.max(0, opacity));
  }

  /**
   * Update cursor style
   */
  public setCursorStyle(style: 'block' | 'underline' | 'bar'): void {
    this.cursorStyle = style;
  }

  /**
   * Enable/disable cursor blinking
   */
  public setCursorBlink(enabled: boolean): void {
    if (enabled && !this.cursorBlink) {
      this.cursorBlink = true;
      this.startCursorBlink();
    } else if (!enabled && this.cursorBlink) {
      this.cursorBlink = false;
      this.stopCursorBlink();
    }
  }

  /**
   * Get current font metrics
   */

  /**
   * Render scrollbar (Phase 2)
   * Shows scroll position and allows click/drag interaction
   * @param opacity Opacity level (0-1) for fade in/out effect
   */
  private renderScrollbar(
    viewportY: number,
    scrollbackLength: number,
    visibleRows: number,
    opacity: number = 1
  ): void {
    const ctx = this.ctx;
    const canvasHeight = this.canvasCssHeight || this.canvas.height / this.devicePixelRatio;
    const canvasWidth = this.canvasCssWidth || this.canvas.width / this.devicePixelRatio;

    const layout = computeScrollbarLayout(
      canvasWidth,
      canvasHeight,
      viewportY,
      scrollbackLength,
      visibleRows
    );

    // Always clear the scrollbar area first (fixes ghosting when fading out)
    ctx.clearRect(layout.x - 2, 0, layout.width + SCROLLBAR_MARGIN + 2, canvasHeight);
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(layout.x - 2, 0, layout.width + SCROLLBAR_MARGIN + 2, canvasHeight);

    // Don't draw scrollbar if fully transparent or no scrollback
    if (opacity <= 0 || scrollbackLength === 0) return;

    // Just a faint rounded thumb: no track, so an idle terminal stays clean
    const thumbOpacity =
      (viewportY > 0 ? SCROLLBAR_THUMB_OPACITY_SCROLLED : SCROLLBAR_THUMB_OPACITY_IDLE) * opacity;
    ctx.fillStyle = `rgba(255, 255, 255, ${thumbOpacity})`;

    const radius = layout.width / 2;
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(layout.x, layout.thumbY, layout.width, layout.thumbHeight, radius);
      ctx.fill();
    } else {
      ctx.fillRect(layout.x, layout.thumbY, layout.width, layout.thumbHeight);
    }
  }
  public getMetrics(): FontMetrics {
    return { ...this.metrics };
  }

  /**
   * Get canvas element (needed by SelectionManager)
   */
  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * Set selection manager (for rendering selection)
   */
  public setSelectionManager(manager: SelectionManager): void {
    this.selectionManager = manager;
  }

  /**
   * Check if a cell at (x, y) is within the current selection.
   * Uses cached selection coordinates for performance.
   */
  private isInSelection(x: number, y: number): boolean {
    const sel = this.currentSelectionCoords;
    if (!sel) return false;

    const { startCol, startRow, endCol, endRow } = sel;

    // Single line selection
    if (startRow === endRow) {
      return y === startRow && x >= startCol && x <= endCol;
    }

    // Multi-line selection
    if (y === startRow) {
      // First line: from startCol to end of line
      return x >= startCol;
    } else if (y === endRow) {
      // Last line: from start of line to endCol
      return x <= endCol;
    } else if (y > startRow && y < endRow) {
      // Middle lines: entire line is selected
      return true;
    }

    return false;
  }

  /**
   * Set the currently hovered hyperlink ID for rendering underlines
   */
  public setHoveredHyperlinkId(hyperlinkId: number): void {
    this.hoveredHyperlinkId = hyperlinkId;
  }

  /**
   * Set the currently hovered link range for rendering underlines (for regex-detected URLs)
   * Pass null to clear the hover state
   */
  public setHoveredLinkRange(
    range: {
      startX: number;
      startY: number;
      endX: number;
      endY: number;
    } | null
  ): void {
    this.hoveredLinkRange = range;
  }

  /**
   * Get character cell width (for coordinate conversion)
   */
  public get charWidth(): number {
    return this.metrics.width;
  }

  /**
   * Get character cell height (for coordinate conversion)
   */
  public get charHeight(): number {
    return this.metrics.height;
  }

  /**
   * Clear entire canvas
   */
  public clear(): void {
    // The context is scaled, so work in CSS pixels.
    const width = this.canvasCssWidth || this.canvas.width / this.devicePixelRatio;
    const height = this.canvasCssHeight || this.canvas.height / this.devicePixelRatio;
    // clearRect first because fillRect composites rather than replaces,
    // so transparent/translucent backgrounds wouldn't clear previous content.
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = this.theme.background;
    this.ctx.fillRect(0, 0, width, height);
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    this.stopCursorBlink();
  }
}
