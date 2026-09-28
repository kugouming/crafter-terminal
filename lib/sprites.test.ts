/**
 * Tests for box-drawing / block-element sprites
 */

import { describe, expect, test } from 'bun:test';
import { drawBlockElement, drawBoxDrawing, hasSprite } from './sprites';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
}

/** Minimal canvas stub that records fillRect calls. */
function recorder() {
  const rects: Rect[] = [];
  const ctx = {
    globalAlpha: 1,
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, alpha: this.globalAlpha });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects };
}

// 10x20 CSS px cells at DPR 2 -> 20x40 device px, 2px box thickness
const metrics = {
  cellWidth: 10,
  cellHeight: 20,
  boxThickness: 1,
  devicePixelRatio: 2,
};

describe('hasSprite', () => {
  test('covers box drawing and block elements', () => {
    expect(hasSprite(0x2500)).toBe(true); // ─
    expect(hasSprite(0x253c)).toBe(true); // ┼
    expect(hasSprite(0x2588)).toBe(true); // █
    expect(hasSprite(0x2591)).toBe(true); // ░
    expect(hasSprite(0x41)).toBe(false); // 'A'
    expect(hasSprite(0x2504)).toBe(false); // ┄ (dashes are not ported)
  });
});

describe('drawBoxDrawing', () => {
  test('horizontal line spans the cell, centered vertically', () => {
    const { ctx, rects } = recorder();
    expect(drawBoxDrawing(ctx, 0x2500, 100, 200, metrics)).toBe(true);
    // drawn as two half-width strokes that meet in the middle
    expect(rects.length).toBe(2);
    for (const rect of rects) {
      expect(rect.y).toBe(209.5); // (40 - 2) / 2 device px from the top
      expect(rect.h).toBe(1);
      expect(rect.alpha).toBe(1);
    }
    const minX = Math.min(...rects.map((r) => r.x));
    const maxX = Math.max(...rects.map((r) => r.x + r.w));
    expect(minX).toBe(100);
    expect(maxX).toBe(110);
  });

  test('vertical line spans the cell, centered horizontally', () => {
    const { ctx, rects } = recorder();
    expect(drawBoxDrawing(ctx, 0x2502, 100, 200, metrics)).toBe(true);
    expect(rects.length).toBe(2);
    for (const rect of rects) {
      expect(rect.x).toBe(104.5); // (20 - 2) / 2 device px from the left
      expect(rect.w).toBe(1);
    }
    const minY = Math.min(...rects.map((r) => r.y));
    const maxY = Math.max(...rects.map((r) => r.y + r.h));
    expect(minY).toBe(200);
    expect(maxY).toBe(220);
  });

  test('cross draws four strokes that meet in the middle', () => {
    const { ctx, rects } = recorder();
    expect(drawBoxDrawing(ctx, 0x253c, 0, 0, metrics)).toBe(true);
    expect(rects.length).toBe(4);

    // Every stroke covers the center of the cell
    const coversCenter = (r: Rect) => r.x <= 5 && r.x + r.w >= 5 && r.y <= 10 && r.y + r.h >= 10;
    expect(rects.every(coversCenter)).toBe(true);
  });

  test('corner only draws two strokes', () => {
    const { ctx, rects } = recorder();
    expect(drawBoxDrawing(ctx, 0x250c, 0, 0, metrics)).toBe(true);
    expect(rects.length).toBe(2);
  });

  test('heavy lines are twice as thick as light ones', () => {
    const light = recorder();
    drawBoxDrawing(light.ctx, 0x2500, 0, 0, metrics);
    const heavy = recorder();
    drawBoxDrawing(heavy.ctx, 0x2501, 0, 0, metrics);
    expect(heavy.rects[0].h).toBe(light.rects[0].h * 2);
  });

  test('double lines draw parallel strokes with a gap', () => {
    const { ctx, rects } = recorder();
    expect(drawBoxDrawing(ctx, 0x2550, 0, 0, metrics)).toBe(true);
    const ys = [...new Set(rects.map((r) => r.y))].sort((a, b) => a - b);
    expect(ys.length).toBe(2);
    expect(ys[1] - ys[0]).toBe(2); // one stroke thickness apart
  });

  test('returns false for unsupported codepoints', () => {
    const { ctx, rects } = recorder();
    expect(drawBoxDrawing(ctx, 0x2504, 0, 0, metrics)).toBe(false);
    expect(rects.length).toBe(0);
  });
});

describe('drawBlockElement', () => {
  test('full block fills the cell', () => {
    const { ctx, rects } = recorder();
    expect(drawBlockElement(ctx, 0x2588, 100, 200, metrics)).toBe(true);
    expect(rects[0]).toEqual({ x: 100, y: 200, w: 10, h: 20, alpha: 1 });
  });

  test('half blocks fill half the cell', () => {
    const lower = recorder();
    drawBlockElement(lower.ctx, 0x2584, 0, 0, metrics);
    expect(lower.rects[0]).toEqual({ x: 0, y: 10, w: 10, h: 10, alpha: 1 });

    const left = recorder();
    drawBlockElement(left.ctx, 0x258c, 0, 0, metrics);
    expect(left.rects[0]).toEqual({ x: 0, y: 0, w: 5, h: 20, alpha: 1 });
  });

  test('shade blocks use alpha, like Ghostty', () => {
    const light = recorder();
    drawBlockElement(light.ctx, 0x2591, 0, 0, metrics);
    expect(light.rects[0].alpha).toBeCloseTo(0x40 / 255, 5);

    const dark = recorder();
    drawBlockElement(dark.ctx, 0x2593, 0, 0, metrics);
    expect(dark.rects[0].alpha).toBeCloseTo(0xc0 / 255, 5);
  });

  test('quadrants fill the right quarter', () => {
    const { ctx, rects } = recorder();
    expect(drawBlockElement(ctx, 0x2598, 0, 0, metrics)).toBe(true); // upper left
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 5, h: 10, alpha: 1 });
  });

  test('returns false for unsupported codepoints', () => {
    const { ctx } = recorder();
    expect(drawBlockElement(ctx, 0x2500, 0, 0, metrics)).toBe(false);
  });
});
