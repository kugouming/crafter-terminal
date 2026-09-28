/**
 * Tests for Ghostty-parity font metrics
 */

import { describe, expect, test } from 'bun:test';
import {
  type FaceMetrics,
  type FontMetrics,
  applyMetricModifiers,
  firstAvailableFontFamily,
  isFontAvailable,
  isMonospaceFont,
  measureFontMetrics,
  parseMetricModifier,
  splitFontStack,
} from './metrics';

/** Metrics of the demo's bundled Maple Mono, straight from its tables. */
const MAPLE_MONO: FaceMetrics = {
  family: 'Maple Mono',
  unitsPerEm: 1000,
  ascent: 1020,
  descent: -300,
  lineGap: 0,
  advanceWidth: 600,
  underlinePosition: -155,
  underlineThickness: 50,
  strikethroughPosition: 320,
  strikethroughThickness: 50,
  capHeight: 730,
  exHeight: 550,
};

/**
 * Minimal stand-in for a canvas context that reports Menlo-like metrics
 * (unitsPerEm 2048, advance 1233, ascent 1901, descent 483, x-height 1120).
 */
function menloContext(): CanvasRenderingContext2D {
  let size = 13;
  const ctx = {
    set font(value: string) {
      size = Number.parseFloat(value);
    },
    get font() {
      return `${size}px Menlo`;
    },
    measureText(text: string) {
      const advance = 0.60205078125 * size;
      return {
        width: advance * text.length,
        fontBoundingBoxAscent: 0.92822265625 * size,
        fontBoundingBoxDescent: 0.23583984375 * size,
        actualBoundingBoxAscent: 0.546875 * size,
        actualBoundingBoxDescent: 0,
      };
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

describe('parseMetricModifier', () => {
  test('parses absolute pixel deltas', () => {
    expect(parseMetricModifier('2')).toEqual({ kind: 'absolute', value: 2 });
    expect(parseMetricModifier(-3)).toEqual({ kind: 'absolute', value: -3 });
  });

  test('parses percentages as multipliers', () => {
    expect(parseMetricModifier('20%')).toEqual({ kind: 'percent', value: 1.2 });
    expect(parseMetricModifier('-20%')).toEqual({ kind: 'percent', value: 0.8 });
    expect(parseMetricModifier('0%')).toEqual({ kind: 'percent', value: 1 });
  });

  test('returns null for empty or invalid values', () => {
    expect(parseMetricModifier(null)).toBeNull();
    expect(parseMetricModifier(undefined)).toBeNull();
    expect(parseMetricModifier('')).toBeNull();
    expect(parseMetricModifier('abc')).toBeNull();
  });
});

describe('isMonospaceFont', () => {
  function stubContext(widths: Record<string, number>): CanvasRenderingContext2D {
    return {
      font: '',
      measureText(text: string) {
        return { width: (widths[text[0]] ?? 8) * text.length };
      },
    } as unknown as CanvasRenderingContext2D;
  }

  test('detects a uniform advance width', () => {
    const ctx = stubContext({ i: 8, M: 8 });
    expect(isMonospaceFont('Menlo', 14, ctx)).toBe(true);
  });

  test('detects a proportional font', () => {
    // A fallback to a proportional font is what makes text look full of gaps
    const ctx = stubContext({ i: 4, M: 13 });
    expect(isMonospaceFont('"Missing Font"', 14, ctx)).toBe(false);
  });

  test('returns null when nothing can be measured', () => {
    const ctx = stubContext({ i: 0, M: 0 });
    expect(isMonospaceFont('Menlo', 14, ctx)).toBeNull();
  });
});

describe('measureFontMetrics with pinned font-table metrics', () => {
  test('computes the grid from the font tables at DPR 1', () => {
    const metrics = measureFontMetrics({
      fontSize: 14,
      fontFamily: 'Maple Mono',
      devicePixelRatio: 1,
      face: MAPLE_MONO,
    });

    // 0.6em advance, 1.32em line height
    expect(metrics.width).toBe(8);
    expect(metrics.height).toBe(18);
    expect(metrics.baseline).toBe(14);
  });

  test('computes the grid from the font tables at DPR 2', () => {
    const metrics = measureFontMetrics({
      fontSize: 14,
      fontFamily: 'Maple Mono',
      devicePixelRatio: 2,
      face: MAPLE_MONO,
    });

    // Rounding happens in device pixels: 17x37 device px
    expect(metrics.width).toBe(8.5);
    expect(metrics.height).toBe(18.5);
    expect(metrics.baseline).toBe(14.5);
  });

  test('uses the font post/OS-2 tables for decorations', () => {
    const metrics = measureFontMetrics({
      fontSize: 14,
      fontFamily: 'Maple Mono',
      devicePixelRatio: 1,
      face: MAPLE_MONO,
    });

    // post.underlinePosition = -155 (below baseline), thickness 50 -> 0.7px -> 1px
    expect(metrics.underlineThickness).toBe(1);
    expect(metrics.underlinePosition).toBe(16);
    // OS/2 yStrikeoutPosition = 320 above the baseline, size 50
    expect(metrics.strikethroughThickness).toBe(1);
    expect(metrics.strikethroughPosition).toBe(10);
    expect(metrics.exHeight).toBeCloseTo(7.7, 5);
    expect(metrics.capHeight).toBeCloseTo(10.22, 5);
  });

  test('applies adjustments on top of the pinned metrics', () => {
    const metrics = measureFontMetrics({
      fontSize: 14,
      fontFamily: 'Maple Mono',
      devicePixelRatio: 1,
      face: MAPLE_MONO,
      adjustments: { cellHeight: 2 },
    });

    // The demo's config: 18 + 2 = 20 device px, baseline shifted by half
    expect(metrics.height).toBe(20);
    expect(metrics.baseline).toBe(15);
    expect(metrics.underlinePosition).toBe(17);
  });

  test('ignores the canvas entirely when face metrics are given', () => {
    // A context that would produce nonsense; it must not be consulted
    const ctx = {
      font: '',
      measureText: () => ({ width: 999, fontBoundingBoxAscent: 999, fontBoundingBoxDescent: 999 }),
    } as unknown as CanvasRenderingContext2D;

    const metrics = measureFontMetrics({
      fontSize: 14,
      fontFamily: 'Maple Mono',
      devicePixelRatio: 1,
      face: MAPLE_MONO,
      context: ctx,
    });

    expect(metrics.width).toBe(8);
    expect(metrics.height).toBe(18);
  });
});

describe('font stack helpers', () => {
  test('splitFontStack keeps quoted names and strips quotes', () => {
    expect(splitFontStack('"Maple Mono NF CN", Menlo, ui-monospace, monospace')).toEqual([
      'Maple Mono NF CN',
      'Menlo',
      'ui-monospace',
      'monospace',
    ]);
  });

  /**
   * Stub context: families in `installed` render at a distinct width, anything
   * else falls back to the same width as a family that cannot exist.
   */
  function fontContext(installed: string[]): CanvasRenderingContext2D {
    return {
      font: '',
      measureText(text: string) {
        const family = this.font.replace(/^[\d.]+px /, '');
        return { width: text.length * (installed.includes(family) ? 12 : 8) };
      },
    } as unknown as CanvasRenderingContext2D;
  }

  test('isFontAvailable detects missing families', () => {
    const ctx = fontContext(['Menlo']);
    expect(isFontAvailable('Menlo', 14, ctx)).toBe(true);
    expect(isFontAvailable('"Some Font That Is Not Installed"', 14, ctx)).toBe(false);
  });

  test('firstAvailableFontFamily walks the stack in order', () => {
    const ctx = fontContext(['Maple Mono', 'Menlo']);
    expect(firstAvailableFontFamily('"Maple Mono NF CN", "Maple Mono", Menlo', 14, ctx)).toBe(
      'Maple Mono'
    );
    expect(firstAvailableFontFamily('"Nope", Menlo', 14, ctx)).toBe('Menlo');
  });
});

describe('measureFontMetrics', () => {
  test('matches Ghostty cell metrics at 13px, DPR 1', () => {
    const metrics = measureFontMetrics({
      fontSize: 13,
      fontFamily: 'Menlo',
      devicePixelRatio: 1,
      context: menloContext(),
    });

    // Ghostty: cell_width = round(1233/2048*13) = 8
    //          cell_height = round((1901+483)/2048*13) = 15
    //          baseline (from top) = 12
    expect(metrics.width).toBe(8);
    expect(metrics.height).toBe(15);
    expect(metrics.baseline).toBe(12);
  });

  test('matches Ghostty cell metrics at 13px, DPR 2', () => {
    const metrics = measureFontMetrics({
      fontSize: 13,
      fontFamily: 'Menlo',
      devicePixelRatio: 2,
      context: menloContext(),
    });

    // Rounding happens in device pixels, so the CSS cell is 8 x 15 exactly.
    expect(metrics.width).toBe(8);
    expect(metrics.height).toBe(15);
    expect(metrics.baseline).toBe(12);
  });

  test('derives decoration geometry from the x-height', () => {
    const metrics = measureFontMetrics({
      fontSize: 13,
      fontFamily: 'Menlo',
      devicePixelRatio: 1,
      context: menloContext(),
    });

    // Ghostty's fallback: thickness = ceil(0.15 * x-height), underline one
    // thickness below the baseline, strikethrough centered on the x-height.
    expect(metrics.underlineThickness).toBe(2);
    expect(metrics.underlinePosition).toBe(14);
    expect(metrics.strikethroughThickness).toBe(2);
    expect(metrics.strikethroughPosition).toBe(7);
  });

  test('cell height follows the font line height, not a glyph bounding box', () => {
    const metrics = measureFontMetrics({
      fontSize: 14,
      fontFamily: 'Menlo',
      devicePixelRatio: 2,
      context: menloContext(),
    });

    // Menlo's line height is ~1.164em; the old renderer used the 'M' glyph
    // bounding box (~0.73em) plus 2px, which made rows far too short.
    expect(metrics.height).toBe(16.5);
    expect(metrics.width).toBe(8.5);
  });

  test('applies adjustments in device pixels, like Ghostty', () => {
    const metrics = measureFontMetrics({
      fontSize: 13,
      fontFamily: 'Menlo',
      devicePixelRatio: 1,
      context: menloContext(),
      adjustments: { cellHeight: '2' },
    });

    // Cell height grows by 2px and the extra space is split top/bottom, so the
    // baseline moves down by 1px and decorations follow the top half.
    expect(metrics.height).toBe(17);
    expect(metrics.baseline).toBe(13);
    expect(metrics.underlinePosition).toBe(15);
  });

  test('adjustments are device pixels, so DPR 2 gets half the CSS delta', () => {
    const metrics = measureFontMetrics({
      fontSize: 13,
      fontFamily: 'Menlo',
      devicePixelRatio: 2,
      context: menloContext(),
      adjustments: { cellHeight: 2 },
    });

    // +2 device pixels = +1 CSS pixel
    expect(metrics.height).toBe(16);
    expect(metrics.baseline).toBe(12.5);
  });
});

describe('applyMetricModifiers', () => {
  const base: FontMetrics = {
    width: 8,
    height: 15,
    baseline: 12,
    underlinePosition: 14,
    underlineThickness: 2,
    strikethroughPosition: 7,
    strikethroughThickness: 2,
    overlinePosition: 0,
    overlineThickness: 2,
    cursorHeight: 15,
    cursorThickness: 1,
    capHeight: 9.5,
    exHeight: 7.1,
    faceWidth: 7.83,
    faceHeight: 15.13,
    faceY: 0.07,
  };

  test('an even cell height delta splits evenly', () => {
    const result = applyMetricModifiers(base, { cellHeight: 2 });
    expect(result.height).toBe(17);
    expect(result.baseline).toBe(13);
    expect(result.underlinePosition).toBe(15);
    expect(result.strikethroughPosition).toBe(8);
  });

  test('an odd cell height delta gives the extra pixel to one edge', () => {
    const result = applyMetricModifiers(base, { cellHeight: 1 });
    expect(result.height).toBe(16);
    // faceY (0.07) sits above the center, so Ghostty adds the extra pixel to
    // the top: the baseline (measured from the bottom) stays put while the
    // decorations move down with the new top edge.
    expect(result.baseline).toBe(12);
    expect(result.underlinePosition).toBe(15);
  });

  test('supports percentage adjustments', () => {
    const result = applyMetricModifiers(base, { cellHeight: '20%' });
    expect(result.height).toBe(18);
    expect(result.underlineThickness).toBe(2);
  });

  test('clamps thickness to a minimum of 1', () => {
    const result = applyMetricModifiers(base, { underlineThickness: -10 });
    expect(result.underlineThickness).toBe(1);
  });

  test('font baseline adjustment moves the baseline up', () => {
    const result = applyMetricModifiers(base, { fontBaseline: 2 });
    expect(result.baseline).toBe(10);
    expect(result.height).toBe(15);
  });

  test('cursor thickness and height can be adjusted independently', () => {
    const result = applyMetricModifiers(base, { cursorThickness: 1, cursorHeight: -3 });
    expect(result.cursorThickness).toBe(2);
    expect(result.cursorHeight).toBe(12);
  });
});
