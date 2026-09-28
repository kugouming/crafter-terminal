/**
 * Guards the config that the demo ships (demo/ghostty.config).
 *
 * The demo's appearance is supposed to be pinned by the repository rather than
 * by whatever happens to be installed, so this checks that the bundled config
 * still parses and still produces a complete, monospace terminal setup.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGhosttyConfig, toTerminalOptions } from '../lib/ghostty-config';
import { type FaceMetrics, measureFontMetrics } from '../lib/metrics';

const configPath = join(import.meta.dir, 'ghostty.config');
const config = parseGhosttyConfig(readFileSync(configPath, 'utf8'));
const { options, theme } = toTerminalOptions(config);

const fontMetricsPath = join(import.meta.dir, 'fonts', 'MapleMono-metrics.json');
const fontMetrics = JSON.parse(readFileSync(fontMetricsPath, 'utf8')) as FaceMetrics;

describe('demo/ghostty.config', () => {
  test('pins a monospace font and size', () => {
    expect(config.fontFamily[0]).toBe('Maple Mono');
    expect(options.fontSize).toBe(14);
    // The bundled font is bundled as a webfont; the stack must still end in a
    // monospace fallback in case it fails to load.
    expect(options.fontFamily).toContain('Maple Mono');
    expect(options.fontFamily).toContain('monospace');
  });

  test('inlines a complete theme so no local theme files are needed', () => {
    // The demo keeps its original dark grey background, with the Catppuccin
    // Mocha palette on top
    expect(theme.background).toBe('#1e1e1e');
    expect(theme.foreground).toBe('#cdd6f4');
    expect(theme.cursor).toBe('#f5e0dc');
    expect(theme.selectionBackground).toBe('#585b70');
    // All 16 ANSI colors come from the file, not from Ghostty's defaults
    expect(Object.keys(config.palette).length).toBe(16);
    expect(theme.black).toBe('#45475a');
    expect(theme.brightWhite).toBe('#bac2de');
  });

  test('pins cursor and window padding', () => {
    expect(options.cursorStyle).toBe('bar');
    expect(options.cursorBlink).toBe(true);
    expect(config.windowPaddingX?.topLeft).toBe(10);
    expect(config.windowPaddingY?.topLeft).toBe(8);
  });

  test('pins the cell height adjustment', () => {
    expect(config.adjustments.cellHeight).toBe('2');
  });
});

describe('demo/fonts/MapleMono-metrics.json', () => {
  test('is the bundled font and looks like font tables, not browser output', () => {
    expect(fontMetrics.family).toBe('Maple Mono');
    expect(fontMetrics.source).toBe('MapleMono-Regular.woff2');
    expect(fontMetrics.unitsPerEm).toBe(1000);
    // A monospace advance of exactly 0.6em is what makes the grid predictable
    expect(fontMetrics.advanceWidth / fontMetrics.unitsPerEm).toBeCloseTo(0.6, 6);
    expect(fontMetrics.descent).toBeLessThan(0);
  });

  test('produces the expected grid for the bundled config', () => {
    // 14px, adjust-cell-height 2
    const dpr1 = measureFontMetrics({
      fontSize: options.fontSize!,
      fontFamily: 'Maple Mono',
      devicePixelRatio: 1,
      face: fontMetrics,
      adjustments: config.adjustments,
    });
    expect(dpr1.width).toBe(8);
    expect(dpr1.height).toBe(20);

    // Metrics are rounded in device pixels, so a 2x display gets a half-pixel
    // wider cell - exactly like the native app
    const dpr2 = measureFontMetrics({
      fontSize: options.fontSize!,
      fontFamily: 'Maple Mono',
      devicePixelRatio: 2,
      face: fontMetrics,
      adjustments: config.adjustments,
    });
    expect(dpr2.width).toBe(8.5);
    expect(dpr2.height).toBe(19.5);
  });
});
