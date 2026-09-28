/**
 * Ghostty-parity font metrics.
 *
 * This mirrors Ghostty's `src/font/Metrics.zig` so the web renderer produces the
 * same grid as the native app: same cell width/height, same baseline, same
 * underline/strikethrough geometry, and the same `adjust-*` modifiers.
 *
 * Key differences from naive canvas measurement:
 *
 * 1. Cell width is the maximum advance of *all* printable ASCII, rounded
 *    (Ghostty uses `@round`, not `Math.ceil`).
 * 2. Cell height comes from the font's ascent/descent/line gap (i.e. the
 *    font's line height), not from the bounding box of a single glyph. Using
 *    `'M'`'s bounding box makes rows far too short and breaks TUI layouts.
 * 3. The baseline is computed by centering the face inside the pixel-rounded
 *    cell, measured from the *bottom* of the cell.
 * 4. Underline/strikethrough positions are derived from the font metrics
 *    (x-height) using Ghostty's fallback heuristics.
 * 5. Everything is measured at device-pixel resolution and rounded there,
 *    because Ghostty's metrics are integer device pixels.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * A metric modifier. Values represent a *delta*: `20%` means "20% larger",
 * `2` means "2 pixels larger" (never "set to 20%").
 */
export interface MetricModifier {
  kind: 'absolute' | 'percent';
  /** absolute: pixel delta. percent: multiplier (1.2 for `20%`). */
  value: number;
}

export type MetricModifierInput = MetricModifier | string | number | null | undefined;

/**
 * Metric adjustments, matching Ghostty's `adjust-*` configuration options.
 */
export interface MetricModifiers {
  cellWidth?: MetricModifierInput;
  cellHeight?: MetricModifierInput;
  fontBaseline?: MetricModifierInput;
  underlinePosition?: MetricModifierInput;
  underlineThickness?: MetricModifierInput;
  strikethroughPosition?: MetricModifierInput;
  strikethroughThickness?: MetricModifierInput;
  overlinePosition?: MetricModifierInput;
  overlineThickness?: MetricModifierInput;
  cursorHeight?: MetricModifierInput;
  cursorThickness?: MetricModifierInput;
}

/**
 * Font metrics in CSS pixels. `width`, `height` and `baseline` keep their
 * historical names for compatibility with the previous renderer.
 */
export interface FontMetrics {
  /** Character cell width */
  width: number;
  /** Character cell height */
  height: number;
  /** Distance from the top of the cell to the text baseline */
  baseline: number;
  /** Distance from the top of the cell to the top of the underline stroke */
  underlinePosition: number;
  /** Underline stroke thickness (>= 1) */
  underlineThickness: number;
  /** Distance from the top of the cell to the top of the strikethrough stroke */
  strikethroughPosition: number;
  /** Strikethrough stroke thickness (>= 1) */
  strikethroughThickness: number;
  /** Distance from the top of the cell to the top of the overline stroke */
  overlinePosition: number;
  /** Overline stroke thickness (>= 1) */
  overlineThickness: number;
  /** Cursor height (defaults to the cell height) */
  cursorHeight: number;
  /** Cursor stroke thickness for bar/underline cursors (>= 1) */
  cursorThickness: number;
  /** Cap height, measured from the baseline (used for icon sizing) */
  capHeight: number;
  /** x-height, measured from the baseline */
  exHeight: number;
  /** Unrounded face width, in CSS pixels */
  faceWidth: number;
  /** Unrounded face height (ascent + descent + line gap), in CSS pixels */
  faceHeight: number;
  /** Offset from the bottom of the cell to the bottom of the face's bounding box */
  faceY: number;
}

/**
 * Font metrics read from a font's own tables, in font units.
 *
 * Browsers derive `fontBoundingBox*` and `line-height: normal` from the
 * platform font backend, which can differ between browsers and operating
 * systems. Supplying these values (see `scripts/build-font-metrics.py`) makes
 * the terminal grid identical everywhere, because the numbers then come from
 * the font file rather than from the browser.
 *
 * The fields mirror the tables Ghostty reads in
 * `src/font/face/freetype.zig`: hhea/OS-2 for vertical metrics, `post` for the
 * underline, OS-2 for the strikethrough and cap/x heights.
 */
export interface FaceMetrics {
  /** Font family these metrics belong to; they are only used when it resolves */
  family?: string;
  unitsPerEm: number;
  /** Ascender, positive, in font units */
  ascent: number;
  /** Descender, negative, in font units */
  descent: number;
  /** Line gap, in font units */
  lineGap: number;
  /** Cell advance width (widest printable ASCII), in font units */
  advanceWidth: number;
  /** `post.underlinePosition`: relative to the baseline, negative is below */
  underlinePosition?: number;
  /** `post.underlineThickness` */
  underlineThickness?: number;
  /** `OS/2.yStrikeoutPosition`: relative to the baseline, positive is above */
  strikethroughPosition?: number;
  /** `OS/2.yStrikeoutSize` */
  strikethroughThickness?: number;
  /** `OS/2.sCapHeight` */
  capHeight?: number;
  /** `OS/2.sxHeight` */
  exHeight?: number;
}

export interface MeasureFontMetricsOptions {
  fontSize: number;
  fontFamily: string;
  devicePixelRatio?: number;
  /** Canvas 2D context used for text measurement (a scratch one is created if omitted) */
  context?: CanvasRenderingContext2D;
  /** Metric adjustments to apply after measuring */
  adjustments?: MetricModifiers;
  /**
   * Metrics read from the font's tables. When provided, nothing is measured
   * with the canvas: the grid is computed from these values alone.
   */
  face?: FaceMetrics;
}

// ============================================================================
// Modifier Parsing / Application
// ============================================================================

/**
 * Parse a metric modifier the way Ghostty does: a trailing `%` means percent,
 * anything else is an absolute pixel delta.
 */
export function parseMetricModifier(input: MetricModifierInput): MetricModifier | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'object') return input;

  if (typeof input === 'number') {
    return Number.isFinite(input) ? { kind: 'absolute', value: input } : null;
  }

  const trimmed = input.trim();
  if (trimmed === '') return null;

  if (trimmed.endsWith('%')) {
    const pct = Number.parseFloat(trimmed.slice(0, -1));
    if (!Number.isFinite(pct)) return null;
    return { kind: 'percent', value: 1 + pct / 100 };
  }

  const abs = Number.parseFloat(trimmed);
  if (!Number.isFinite(abs)) return null;
  return { kind: 'absolute', value: Math.trunc(abs) };
}

function applyModifier(value: number, mod: MetricModifierInput): number {
  const parsed = parseMetricModifier(mod);
  if (!parsed) return value;
  return parsed.kind === 'absolute' ? value + parsed.value : value * parsed.value;
}

/** Ghostty clamps these metrics to a minimum of 1 to avoid divide-by-zero. */
const MINIMUMS: Partial<Record<keyof FontMetrics, number>> = {
  width: 1,
  height: 1,
  underlineThickness: 1,
  strikethroughThickness: 1,
  overlineThickness: 1,
  cursorThickness: 1,
  cursorHeight: 1,
  faceWidth: 1,
  faceHeight: 1,
};

/**
 * Apply Ghostty's `adjust-*` modifiers to a set of metrics.
 *
 * This follows Ghostty's implementation closely: changing the cell height
 * re-centers the face inside the cell (splitting the difference between the
 * top and bottom edges) and shifts the decoration positions that are measured
 * from the top of the cell.
 */
export function applyMetricModifiers(metrics: FontMetrics, mods: MetricModifiers): FontMetrics {
  const result: FontMetrics = { ...metrics };

  // --- Cell width / height -------------------------------------------------
  const cellHeightMod = parseMetricModifier(mods.cellHeight);
  if (cellHeightMod) {
    const original = result.height;
    const next = Math.max(applyModifier(original, cellHeightMod), 1);

    if (next !== original) {
      result.height = next;

      const diff = next - original;
      const halfDiff = diff / 2;

      // If the diff is odd, give the extra pixel to the edge that needs it
      // most, based on where the face currently sits relative to center.
      const positionWithRespectToCenter = result.faceY - (original - result.faceHeight) / 2;

      let diffTop: number;
      let diffBottom: number;
      if (positionWithRespectToCenter > 0) {
        diffTop = Math.ceil(halfDiff);
        diffBottom = Math.floor(halfDiff);
      } else {
        diffTop = Math.floor(halfDiff);
        diffBottom = Math.ceil(halfDiff);
      }

      // cell baseline and faceY are measured from the bottom of the cell
      result.baseline += diffBottom;
      result.faceY += diffBottom;

      // these are measured from the top of the cell
      result.underlinePosition += diffTop;
      result.strikethroughPosition += diffTop;
      result.overlinePosition += diffTop;
    }
  }

  const cellWidthMod = parseMetricModifier(mods.cellWidth);
  if (cellWidthMod) {
    result.width = Math.max(applyModifier(result.width, cellWidthMod), 1);
  }

  // --- Everything else -----------------------------------------------------
  const simple: Array<[keyof FontMetrics, MetricModifierInput]> = [
    ['underlinePosition', mods.underlinePosition],
    ['underlineThickness', mods.underlineThickness],
    ['strikethroughPosition', mods.strikethroughPosition],
    ['strikethroughThickness', mods.strikethroughThickness],
    ['overlinePosition', mods.overlinePosition],
    ['overlineThickness', mods.overlineThickness],
    ['cursorHeight', mods.cursorHeight],
    ['cursorThickness', mods.cursorThickness],
  ];

  for (const [key, mod] of simple) {
    if (mod === null || mod === undefined) continue;
    result[key] = applyModifier(result[key], mod);
  }

  // `adjust-font-baseline` is a distance from the bottom of the cell:
  // increasing it moves the baseline UP.
  const baselineMod = parseMetricModifier(mods.fontBaseline);
  if (baselineMod) {
    const fromBottom = result.height - result.baseline;
    const nextFromBottom = applyModifier(fromBottom, baselineMod);
    result.baseline = result.height - nextFromBottom;
  }

  // Clamp to minimums
  for (const key of Object.keys(MINIMUMS) as Array<keyof FontMetrics>) {
    const min = MINIMUMS[key];
    if (min !== undefined && result[key] < min) result[key] = min;
  }

  return result;
}

// ============================================================================
// Measurement
// ============================================================================

/** ASCII printable range measured to find the widest cell, same as Ghostty. */
const ASCII_START = 32;
const ASCII_END = 126;

/**
 * Vertical metrics are measured at a multiple of the real font size and then
 * scaled back down. Chrome rounds `fontBoundingBoxAscent/Descent` (and
 * `line-height: normal`) to whole pixels, which is up to half a pixel of error
 * per metric; at 64x that error is 1/64th of a pixel, which is enough to
 * reproduce Ghostty's baseline placement exactly.
 *
 * The advance width is measured at the real size instead, because that is the
 * size the browser will actually draw with.
 */
const VERTICAL_MEASURE_SCALE = 64;

function createScratchContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

/**
 * Measure the line height the browser uses for `line-height: normal`, which is
 * the font's ascent + descent + line gap. This is the closest browser
 * equivalent to the `hhea`/OS-2 metrics Ghostty reads from the font tables.
 */
function measureNormalLineHeight(fontFamily: string, px: number): number | null {
  if (typeof document === 'undefined' || !document.body) return null;

  try {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute',
      'visibility:hidden',
      'pointer-events:none',
      'white-space:pre',
      'line-height:normal',
      `font-size:${px}px`,
      `font-family:${fontFamily}`,
    ].join(';');
    el.textContent = 'M';
    document.body.appendChild(el);
    const height = el.getBoundingClientRect().height;
    el.remove();
    return height > 0 ? height : null;
  } catch {
    return null;
  }
}

interface VerticalMetrics {
  ascent: number;
  descent: number;
  lineHeight: number;
  exHeight: number;
  capHeight: number;
}

/**
 * Measure ascent/descent/line height/x-height/cap-height in device pixels,
 * using an oversized font to sidestep the browser's integer rounding.
 */
function measureVerticalMetrics(
  ctx: CanvasRenderingContext2D,
  fontFamily: string,
  px: number
): VerticalMetrics {
  const scaledPx = px * VERTICAL_MEASURE_SCALE;
  ctx.font = `${scaledPx}px ${fontFamily}`;

  const m = ctx.measureText('M');
  const ascent = (m.fontBoundingBoxAscent || scaledPx * 0.8) / VERTICAL_MEASURE_SCALE;
  const descent = (m.fontBoundingBoxDescent || scaledPx * 0.2) / VERTICAL_MEASURE_SCALE;

  const normalLineHeight = measureNormalLineHeight(fontFamily, scaledPx);
  const lineHeight =
    normalLineHeight !== null ? normalLineHeight / VERTICAL_MEASURE_SCALE : ascent + descent;

  // x-height and cap height, used for decoration and icon sizing. Ghostty
  // falls back to measuring the `x` and `H` glyphs the same way.
  const x = ctx.measureText('x');
  const h = ctx.measureText('H');
  const exHeight = (x.actualBoundingBoxAscent || scaledPx * 0.5) / VERTICAL_MEASURE_SCALE;
  const capHeight = (h.actualBoundingBoxAscent || scaledPx * 0.7) / VERTICAL_MEASURE_SCALE;

  return { ascent, descent, lineHeight, exHeight, capHeight };
}

/**
 * Measure font metrics using the same algorithm as Ghostty.
 *
 * With `options.face` the numbers come from the font's own tables and nothing
 * is measured with the canvas, which makes the resulting grid identical across
 * browsers and platforms.
 */
export function measureFontMetrics(options: MeasureFontMetricsOptions): FontMetrics {
  const { fontSize, fontFamily } = options;
  const dpr =
    options.devicePixelRatio && options.devicePixelRatio > 0 ? options.devicePixelRatio : 1;
  const ctx = options.face ? null : (options.context ?? createScratchContext());

  // Ghostty computes metrics in device pixels and rounds there, so we measure
  // at device-pixel size and scale back down at the end.
  const px = fontSize * dpr;

  let advance = px * 0.6;
  let vertical: VerticalMetrics = {
    ascent: px * 0.8,
    descent: px * 0.2,
    lineHeight: px,
    exHeight: px * 0.5,
    capHeight: px * 0.7,
  };
  // Decoration geometry from the font's `post`/OS-2 tables, when known.
  let faceUnderline: { position: number; thickness: number } | null = null;
  let faceStrikethrough: { position: number; thickness: number } | null = null;

  if (options.face) {
    const face = options.face;
    const scale = px / face.unitsPerEm;

    advance = face.advanceWidth * scale;
    // `descent` is negative in font units; the rest of this function works
    // with its magnitude, like the canvas API reports it.
    const descent = -face.descent * scale;
    const lineGap = face.lineGap * scale;
    vertical = {
      ascent: face.ascent * scale,
      descent,
      lineHeight: face.ascent * scale + descent + lineGap,
      exHeight: face.exHeight !== undefined ? face.exHeight * scale : px * 0.5,
      capHeight: face.capHeight !== undefined ? face.capHeight * scale : px * 0.7,
    };

    if (face.underlineThickness !== undefined && face.underlineThickness > 0) {
      faceUnderline = {
        position: (face.underlinePosition ?? 0) * scale,
        thickness: face.underlineThickness * scale,
      };
    }
    if (face.strikethroughThickness !== undefined && face.strikethroughThickness > 0) {
      faceStrikethrough = {
        position: (face.strikethroughPosition ?? 0) * scale,
        thickness: face.strikethroughThickness * scale,
      };
    }
  } else if (ctx) {
    // Cell width: widest printable ASCII glyph, measured at the real size.
    ctx.font = `${px}px ${fontFamily}`;
    let maxAdvance = 0;
    for (let code = ASCII_START; code <= ASCII_END; code++) {
      const w = ctx.measureText(String.fromCharCode(code)).width;
      if (w > maxAdvance) maxAdvance = w;
    }
    if (maxAdvance <= 0) maxAdvance = ctx.measureText('M').width;
    if (maxAdvance > 0) advance = maxAdvance;

    vertical = measureVerticalMetrics(ctx, fontFamily, px);
  }

  const { ascent, descent, lineHeight, exHeight, capHeight } = vertical;

  // Line gap: what the browser adds on top of ascent+descent. Ghostty reads
  // the font's own line gap (hhea / OS-2); the browser's `line-height: normal`
  // is the closest measurable equivalent without parsing the font binary.
  const lineGap = Math.max(0, lineHeight - (ascent + descent));

  const faceWidth = advance;
  const faceHeight = ascent + descent + lineGap;

  const cellWidthPx = Math.round(faceWidth);
  const cellHeightPx = Math.round(faceHeight);

  // The baseline is computed by centering the face vertically inside the
  // pixel-rounded cell. `cellBaseline` is measured from the BOTTOM of the cell.
  const halfLineGap = lineGap / 2;
  const faceBaseline = halfLineGap + descent;
  const cellBaseline = Math.round(faceBaseline - (cellHeightPx - faceHeight) / 2);

  const baselineFromTop = cellHeightPx - cellBaseline;
  const faceY = cellBaseline - faceBaseline;

  // Decoration geometry. With the font's `post`/OS-2 tables we use the exact
  // positions; otherwise we fall back to Ghostty's heuristics: the underline
  // sits one thickness below the baseline with a thickness of 15% of the
  // x-height, and the strikethrough is centered on the x-height.
  //
  // Font-unit positions are relative to the baseline with +Y up, while the
  // renderer works from the top of the cell, hence the subtraction.
  const underlineThicknessPx = faceUnderline
    ? Math.max(1, Math.ceil(faceUnderline.thickness))
    : Math.max(1, Math.ceil(0.15 * exHeight));
  const underlinePositionPx = faceUnderline
    ? Math.round(baselineFromTop - faceUnderline.position)
    : Math.round(baselineFromTop + underlineThicknessPx);
  const strikethroughThicknessPx = faceStrikethrough
    ? Math.max(1, Math.ceil(faceStrikethrough.thickness))
    : underlineThicknessPx;
  const strikethroughPositionPx = faceStrikethrough
    ? Math.round(baselineFromTop - faceStrikethrough.position)
    : Math.round(baselineFromTop - (exHeight + strikethroughThicknessPx) * 0.5);

  const metrics: FontMetrics = {
    width: cellWidthPx,
    height: cellHeightPx,
    baseline: baselineFromTop,
    underlinePosition: underlinePositionPx,
    underlineThickness: underlineThicknessPx,
    strikethroughPosition: strikethroughPositionPx,
    strikethroughThickness: strikethroughThicknessPx,
    overlinePosition: 0,
    overlineThickness: underlineThicknessPx,
    cursorHeight: cellHeightPx,
    cursorThickness: 1,
    capHeight,
    exHeight,
    faceWidth,
    faceHeight,
    faceY,
  };

  // Adjustments are applied in device pixels (Ghostty's `adjust-*` values are
  // pixel deltas on the rendered grid), then everything is converted to CSS
  // pixels for the canvas.
  const adjusted = options.adjustments
    ? applyMetricModifiers(metrics, options.adjustments)
    : metrics;

  return scaleMetrics(adjusted, 1 / dpr);
}

/** Divide every metric by `factor` (device pixels -> CSS pixels). */
function scaleMetrics(metrics: FontMetrics, factor: number): FontMetrics {
  const scaled = {} as FontMetrics;
  for (const key of Object.keys(metrics) as Array<keyof FontMetrics>) {
    scaled[key] = metrics[key] * factor;
  }
  return scaled;
}

/**
 * Check whether a font family renders with a uniform advance width.
 *
 * A terminal grid needs a monospace font: if the browser falls back to a
 * proportional font (which is what happens when a configured family is not
 * installed), every glyph is drawn inside a cell sized for the widest
 * character, which looks like the text is full of gaps.
 *
 * Returns `null` when the font cannot be measured (no canvas available).
 */
export function isMonospaceFont(
  fontFamily: string,
  px: number,
  context?: CanvasRenderingContext2D
): boolean | null {
  const ctx = context ?? createScratchContext();
  if (!ctx) return null;

  ctx.font = `${px}px ${fontFamily}`;
  const narrow = ctx.measureText('iiiiiiiiii').width;
  const wide = ctx.measureText('MMMMMMMMMM').width;
  const max = Math.max(narrow, wide);
  if (max <= 0) return null;

  // Allow a tiny tolerance for hinting/rounding differences.
  return Math.abs(narrow - wide) / max < 0.02;
}

/**
 * Check whether a font family actually resolves, by comparing its rendered
 * width against the width of a family that cannot exist.
 *
 * Returns `null` when the font cannot be measured (no canvas available).
 */
export function isFontAvailable(
  fontFamily: string,
  px: number,
  context?: CanvasRenderingContext2D
): boolean | null {
  const ctx = context ?? createScratchContext();
  if (!ctx) return null;

  const sample = 'mmmmmmmmmmlliWWWWWWWWWW0123456789';
  ctx.font = `${px}px "__crafter_missing_font__"`;
  const missing = ctx.measureText(sample).width;
  ctx.font = `${px}px ${fontFamily}`;
  const actual = ctx.measureText(sample).width;
  if (missing <= 0 && actual <= 0) return null;

  return Math.abs(actual - missing) > 0.01;
}

/**
 * Return the first family in a CSS font stack that actually resolves, or
 * `null` when none can be measured.
 */
export function firstAvailableFontFamily(
  fontStack: string,
  px: number,
  context?: CanvasRenderingContext2D
): string | null {
  const ctx = context ?? createScratchContext();
  if (!ctx) return null;

  for (const entry of splitFontStack(fontStack)) {
    if (isFontAvailable(entry, px, ctx) === true) return entry;
  }
  return null;
}

/** Split a CSS font stack, keeping quoted family names intact. */
export function splitFontStack(fontStack: string): string[] {
  const families: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (const ch of fontStack) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ',') {
      if (current.trim()) families.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) families.push(current.trim());

  return families;
}

/**
 * Fallback metrics used when no canvas is available (e.g. SSR or tests).
 */ export function fallbackFontMetrics(fontSize: number): FontMetrics {
  const width = Math.max(1, Math.round(fontSize * 0.6));
  const height = Math.max(1, Math.round(fontSize * 1.2));
  return {
    width,
    height,
    baseline: height - Math.round(fontSize * 0.25),
    underlinePosition: height - 2,
    underlineThickness: 1,
    strikethroughPosition: Math.round(height / 2),
    strikethroughThickness: 1,
    overlinePosition: 0,
    overlineThickness: 1,
    cursorHeight: height,
    cursorThickness: 1,
    capHeight: fontSize * 0.7,
    exHeight: fontSize * 0.5,
    faceWidth: width,
    faceHeight: height,
    faceY: 0,
  };
}
