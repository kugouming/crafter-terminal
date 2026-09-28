/**
 * Sprite rendering for box drawing and block elements.
 *
 * Ghostty does not use the font's glyphs for these characters: it draws them
 * itself (`src/font/sprite/draw/*.zig`) so that lines always meet at cell
 * boundaries and blocks always fill their cell exactly. Font glyphs for these
 * ranges are designed for the font's own line height, which is why box-drawing
 * borders show gaps in most web terminals whenever the cell height differs
 * from the font's default line height.
 *
 * This module ports that geometry to canvas. Coordinates are computed in
 * device pixels (with Ghostty's integer arithmetic) and converted back to CSS
 * pixels when drawing, so the result lines up with the pixel grid.
 */

export interface SpriteMetrics {
  /** Cell width in CSS pixels */
  cellWidth: number;
  /** Cell height in CSS pixels */
  cellHeight: number;
  /** Box/underline stroke thickness in CSS pixels */
  boxThickness: number;
  /** Device pixel ratio the metrics were measured at */
  devicePixelRatio: number;
}

type Style = 'none' | 'light' | 'heavy' | 'double';

interface Lines {
  up: Style;
  right: Style;
  down: Style;
  left: Style;
}

/** U+2500..U+257F, from Ghostty's `sprite/draw/box.zig` table. */
const BOX_LINES: Record<number, Lines> = Object.fromEntries([
  [0x2500, { up: 'none', right: 'light', down: 'none', left: 'light' }],
  [0x2501, { up: 'none', right: 'heavy', down: 'none', left: 'heavy' }],
  [0x2502, { up: 'light', right: 'none', down: 'light', left: 'none' }],
  [0x2503, { up: 'heavy', right: 'none', down: 'heavy', left: 'none' }],
  [0x250c, { up: 'none', right: 'light', down: 'light', left: 'none' }],
  [0x250d, { up: 'none', right: 'heavy', down: 'light', left: 'none' }],
  [0x250e, { up: 'none', right: 'light', down: 'heavy', left: 'none' }],
  [0x250f, { up: 'none', right: 'heavy', down: 'heavy', left: 'none' }],
  [0x2510, { up: 'none', right: 'none', down: 'light', left: 'light' }],
  [0x2511, { up: 'none', right: 'none', down: 'light', left: 'heavy' }],
  [0x2512, { up: 'none', right: 'none', down: 'heavy', left: 'light' }],
  [0x2513, { up: 'none', right: 'none', down: 'heavy', left: 'heavy' }],
  [0x2514, { up: 'light', right: 'light', down: 'none', left: 'none' }],
  [0x2515, { up: 'light', right: 'heavy', down: 'none', left: 'none' }],
  [0x2516, { up: 'heavy', right: 'light', down: 'none', left: 'none' }],
  [0x2517, { up: 'heavy', right: 'heavy', down: 'none', left: 'none' }],
  [0x2518, { up: 'light', right: 'none', down: 'none', left: 'light' }],
  [0x2519, { up: 'light', right: 'none', down: 'none', left: 'heavy' }],
  [0x251a, { up: 'heavy', right: 'none', down: 'none', left: 'light' }],
  [0x251b, { up: 'heavy', right: 'none', down: 'none', left: 'heavy' }],
  [0x251c, { up: 'light', right: 'light', down: 'light', left: 'none' }],
  [0x251d, { up: 'light', right: 'heavy', down: 'light', left: 'none' }],
  [0x251e, { up: 'heavy', right: 'light', down: 'light', left: 'none' }],
  [0x251f, { up: 'light', right: 'light', down: 'heavy', left: 'none' }],
  [0x2520, { up: 'heavy', right: 'light', down: 'heavy', left: 'none' }],
  [0x2521, { up: 'heavy', right: 'heavy', down: 'light', left: 'none' }],
  [0x2522, { up: 'light', right: 'heavy', down: 'heavy', left: 'none' }],
  [0x2523, { up: 'heavy', right: 'heavy', down: 'heavy', left: 'none' }],
  [0x2524, { up: 'light', right: 'none', down: 'light', left: 'light' }],
  [0x2525, { up: 'light', right: 'none', down: 'light', left: 'heavy' }],
  [0x2526, { up: 'heavy', right: 'none', down: 'light', left: 'light' }],
  [0x2527, { up: 'light', right: 'none', down: 'heavy', left: 'light' }],
  [0x2528, { up: 'heavy', right: 'none', down: 'heavy', left: 'light' }],
  [0x2529, { up: 'heavy', right: 'none', down: 'light', left: 'heavy' }],
  [0x252a, { up: 'light', right: 'none', down: 'heavy', left: 'heavy' }],
  [0x252b, { up: 'heavy', right: 'none', down: 'heavy', left: 'heavy' }],
  [0x252c, { up: 'none', right: 'light', down: 'light', left: 'light' }],
  [0x252d, { up: 'none', right: 'light', down: 'light', left: 'heavy' }],
  [0x252e, { up: 'none', right: 'heavy', down: 'light', left: 'light' }],
  [0x252f, { up: 'none', right: 'heavy', down: 'light', left: 'heavy' }],
  [0x2530, { up: 'none', right: 'light', down: 'heavy', left: 'light' }],
  [0x2531, { up: 'none', right: 'light', down: 'heavy', left: 'heavy' }],
  [0x2532, { up: 'none', right: 'heavy', down: 'heavy', left: 'light' }],
  [0x2533, { up: 'none', right: 'heavy', down: 'heavy', left: 'heavy' }],
  [0x2534, { up: 'light', right: 'light', down: 'none', left: 'light' }],
  [0x2535, { up: 'light', right: 'light', down: 'none', left: 'heavy' }],
  [0x2536, { up: 'light', right: 'heavy', down: 'none', left: 'light' }],
  [0x2537, { up: 'light', right: 'heavy', down: 'none', left: 'heavy' }],
  [0x2538, { up: 'heavy', right: 'light', down: 'none', left: 'light' }],
  [0x2539, { up: 'heavy', right: 'light', down: 'none', left: 'heavy' }],
  [0x253a, { up: 'heavy', right: 'heavy', down: 'none', left: 'light' }],
  [0x253b, { up: 'heavy', right: 'heavy', down: 'none', left: 'heavy' }],
  [0x253c, { up: 'light', right: 'light', down: 'light', left: 'light' }],
  [0x253d, { up: 'light', right: 'light', down: 'light', left: 'heavy' }],
  [0x253e, { up: 'light', right: 'heavy', down: 'light', left: 'light' }],
  [0x253f, { up: 'light', right: 'heavy', down: 'light', left: 'heavy' }],
  [0x2540, { up: 'heavy', right: 'light', down: 'light', left: 'light' }],
  [0x2541, { up: 'light', right: 'light', down: 'heavy', left: 'light' }],
  [0x2542, { up: 'heavy', right: 'light', down: 'heavy', left: 'light' }],
  [0x2543, { up: 'heavy', right: 'light', down: 'light', left: 'heavy' }],
  [0x2544, { up: 'heavy', right: 'heavy', down: 'light', left: 'light' }],
  [0x2545, { up: 'light', right: 'light', down: 'heavy', left: 'heavy' }],
  [0x2546, { up: 'light', right: 'heavy', down: 'heavy', left: 'light' }],
  [0x2547, { up: 'heavy', right: 'heavy', down: 'light', left: 'heavy' }],
  [0x2548, { up: 'light', right: 'heavy', down: 'heavy', left: 'heavy' }],
  [0x2549, { up: 'heavy', right: 'light', down: 'heavy', left: 'heavy' }],
  [0x254a, { up: 'heavy', right: 'heavy', down: 'heavy', left: 'light' }],
  [0x254b, { up: 'heavy', right: 'heavy', down: 'heavy', left: 'heavy' }],
  [0x2550, { up: 'none', right: 'double', down: 'none', left: 'double' }],
  [0x2551, { up: 'double', right: 'none', down: 'double', left: 'none' }],
  [0x2552, { up: 'none', right: 'double', down: 'light', left: 'none' }],
  [0x2553, { up: 'none', right: 'light', down: 'double', left: 'none' }],
  [0x2554, { up: 'none', right: 'double', down: 'double', left: 'none' }],
  [0x2555, { up: 'none', right: 'none', down: 'light', left: 'double' }],
  [0x2556, { up: 'none', right: 'none', down: 'double', left: 'light' }],
  [0x2557, { up: 'none', right: 'none', down: 'double', left: 'double' }],
  [0x2558, { up: 'light', right: 'double', down: 'none', left: 'none' }],
  [0x2559, { up: 'double', right: 'light', down: 'none', left: 'none' }],
  [0x255a, { up: 'double', right: 'double', down: 'none', left: 'none' }],
  [0x255b, { up: 'light', right: 'none', down: 'none', left: 'double' }],
  [0x255c, { up: 'double', right: 'none', down: 'none', left: 'light' }],
  [0x255d, { up: 'double', right: 'none', down: 'none', left: 'double' }],
  [0x255e, { up: 'light', right: 'double', down: 'light', left: 'none' }],
  [0x255f, { up: 'double', right: 'light', down: 'double', left: 'none' }],
  [0x2560, { up: 'double', right: 'double', down: 'double', left: 'none' }],
  [0x2561, { up: 'light', right: 'none', down: 'light', left: 'double' }],
  [0x2562, { up: 'double', right: 'none', down: 'double', left: 'light' }],
  [0x2563, { up: 'double', right: 'none', down: 'double', left: 'double' }],
  [0x2564, { up: 'none', right: 'double', down: 'light', left: 'double' }],
  [0x2565, { up: 'none', right: 'light', down: 'double', left: 'light' }],
  [0x2566, { up: 'none', right: 'double', down: 'double', left: 'double' }],
  [0x2567, { up: 'light', right: 'double', down: 'none', left: 'double' }],
  [0x2568, { up: 'double', right: 'light', down: 'none', left: 'light' }],
  [0x2569, { up: 'double', right: 'double', down: 'none', left: 'double' }],
  [0x256a, { up: 'light', right: 'double', down: 'light', left: 'double' }],
  [0x256b, { up: 'double', right: 'light', down: 'double', left: 'light' }],
  [0x256c, { up: 'double', right: 'double', down: 'double', left: 'double' }],
  [0x2574, { up: 'none', right: 'none', down: 'none', left: 'light' }],
  [0x2575, { up: 'light', right: 'none', down: 'none', left: 'none' }],
  [0x2576, { up: 'none', right: 'light', down: 'none', left: 'none' }],
  [0x2577, { up: 'none', right: 'none', down: 'light', left: 'none' }],
  [0x2578, { up: 'none', right: 'none', down: 'none', left: 'heavy' }],
  [0x2579, { up: 'heavy', right: 'none', down: 'none', left: 'none' }],
  [0x257a, { up: 'none', right: 'heavy', down: 'none', left: 'none' }],
  [0x257b, { up: 'none', right: 'none', down: 'heavy', left: 'none' }],
  [0x257c, { up: 'none', right: 'heavy', down: 'none', left: 'light' }],
  [0x257d, { up: 'light', right: 'none', down: 'heavy', left: 'none' }],
  [0x257e, { up: 'none', right: 'light', down: 'none', left: 'heavy' }],
  [0x257f, { up: 'heavy', right: 'none', down: 'light', left: 'none' }],
] as Array<[number, Lines]>);

/** Block element fractions: [alignment, width, height] (U+2580..U+259F). */
type BlockSpec =
  | { kind: 'block'; align: 'upper' | 'lower' | 'left' | 'right'; w: number; h: number }
  | { kind: 'shade'; alpha: number }
  | { kind: 'quad'; tl: boolean; tr: boolean; bl: boolean; br: boolean };

const BLOCKS: Record<number, BlockSpec> = Object.fromEntries([
  [0x2580, { kind: 'block', align: 'upper', w: 1, h: 0.5 }],
  [0x2581, { kind: 'block', align: 'lower', w: 1, h: 0.125 }],
  [0x2582, { kind: 'block', align: 'lower', w: 1, h: 0.25 }],
  [0x2583, { kind: 'block', align: 'lower', w: 1, h: 0.375 }],
  [0x2584, { kind: 'block', align: 'lower', w: 1, h: 0.5 }],
  [0x2585, { kind: 'block', align: 'lower', w: 1, h: 0.625 }],
  [0x2586, { kind: 'block', align: 'lower', w: 1, h: 0.75 }],
  [0x2587, { kind: 'block', align: 'lower', w: 1, h: 0.875 }],
  [0x2588, { kind: 'shade', alpha: 1 }],
  [0x2589, { kind: 'block', align: 'left', w: 0.875, h: 1 }],
  [0x258a, { kind: 'block', align: 'left', w: 0.75, h: 1 }],
  [0x258b, { kind: 'block', align: 'left', w: 0.625, h: 1 }],
  [0x258c, { kind: 'block', align: 'left', w: 0.5, h: 1 }],
  [0x258d, { kind: 'block', align: 'left', w: 0.375, h: 1 }],
  [0x258e, { kind: 'block', align: 'left', w: 0.25, h: 1 }],
  [0x258f, { kind: 'block', align: 'left', w: 0.125, h: 1 }],
  [0x2590, { kind: 'block', align: 'right', w: 0.5, h: 1 }],
  [0x2591, { kind: 'shade', alpha: 0x40 / 255 }],
  [0x2592, { kind: 'shade', alpha: 0x80 / 255 }],
  [0x2593, { kind: 'shade', alpha: 0xc0 / 255 }],
  [0x2594, { kind: 'block', align: 'upper', w: 1, h: 0.125 }],
  [0x2595, { kind: 'block', align: 'right', w: 0.125, h: 1 }],
  [0x2596, { kind: 'quad', tl: false, tr: false, bl: true, br: false }],
  [0x2597, { kind: 'quad', tl: false, tr: false, bl: false, br: true }],
  [0x2598, { kind: 'quad', tl: true, tr: false, bl: false, br: false }],
  [0x2599, { kind: 'quad', tl: true, tr: false, bl: true, br: true }],
  [0x259a, { kind: 'quad', tl: true, tr: false, bl: false, br: true }],
  [0x259b, { kind: 'quad', tl: true, tr: true, bl: true, br: false }],
  [0x259c, { kind: 'quad', tl: true, tr: true, bl: false, br: true }],
  [0x259d, { kind: 'quad', tl: false, tr: true, bl: false, br: false }],
  [0x259e, { kind: 'quad', tl: false, tr: true, bl: true, br: false }],
  [0x259f, { kind: 'quad', tl: false, tr: true, bl: true, br: true }],
] as Array<[number, BlockSpec]>);

export function hasSprite(codepoint: number): boolean {
  return codepoint in BOX_LINES || codepoint in BLOCKS;
}

// ============================================================================
// Drawing
// ============================================================================

interface DeviceMetrics {
  cellWidth: number;
  cellHeight: number;
  boxThickness: number;
}

/** Fill a rectangle given in device pixels, relative to the cell origin. */
function box(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  dpr: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): void {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  if (w <= 0 || h <= 0) return;
  ctx.fillRect(originX + x / dpr, originY + y / dpr, w / dpr, h / dpr);
}

/**
 * Draw a box-drawing character, ported from Ghostty's `linesChar`.
 * Returns false when the codepoint is not handled here.
 */
export function drawBoxDrawing(
  ctx: CanvasRenderingContext2D,
  codepoint: number,
  originX: number,
  originY: number,
  m: SpriteMetrics
): boolean {
  const lines = BOX_LINES[codepoint];
  if (!lines) return false;

  const dpr = m.devicePixelRatio;
  const dm: DeviceMetrics = {
    cellWidth: Math.round(m.cellWidth * dpr),
    cellHeight: Math.round(m.cellHeight * dpr),
    boxThickness: Math.max(1, Math.round(m.boxThickness * dpr)),
  };

  const lightPx = dm.boxThickness;
  const heavyPx = dm.boxThickness * 2;
  const sub = (a: number, b: number) => Math.max(0, a - b);

  // Horizontal stroke extents (measured from the top of the cell)
  const hLightTop = Math.floor(sub(dm.cellHeight, lightPx) / 2);
  const hLightBottom = hLightTop + lightPx;
  const hHeavyTop = Math.floor(sub(dm.cellHeight, heavyPx) / 2);
  const hHeavyBottom = hHeavyTop + heavyPx;
  const hDoubleTop = sub(hLightTop, lightPx);
  const hDoubleBottom = hLightBottom + lightPx;

  // Vertical stroke extents (measured from the left of the cell)
  const vLightLeft = Math.floor(sub(dm.cellWidth, lightPx) / 2);
  const vLightRight = vLightLeft + lightPx;
  const vHeavyLeft = Math.floor(sub(dm.cellWidth, heavyPx) / 2);
  const vHeavyRight = vHeavyLeft + heavyPx;
  const vDoubleLeft = sub(vLightLeft, lightPx);
  const vDoubleRight = vLightRight + lightPx;

  // How far the "up" line reaches down, and the "down" line reaches up
  const upBottom =
    lines.left === 'heavy' || lines.right === 'heavy'
      ? hHeavyBottom
      : lines.left !== lines.right || lines.down === lines.up
        ? lines.left === 'double' || lines.right === 'double'
          ? hDoubleBottom
          : hLightBottom
        : lines.left === 'none' && lines.right === 'none'
          ? hLightBottom
          : hLightTop;

  const downTop =
    lines.left === 'heavy' || lines.right === 'heavy'
      ? hHeavyTop
      : lines.left !== lines.right || lines.up === lines.down
        ? lines.left === 'double' || lines.right === 'double'
          ? hDoubleTop
          : hLightTop
        : lines.left === 'none' && lines.right === 'none'
          ? hLightTop
          : hLightBottom;

  const leftRight =
    lines.up === 'heavy' || lines.down === 'heavy'
      ? vHeavyRight
      : lines.up !== lines.down || lines.left === lines.right
        ? lines.up === 'double' || lines.down === 'double'
          ? vDoubleRight
          : vLightRight
        : lines.up === 'none' && lines.down === 'none'
          ? vLightRight
          : vLightLeft;

  const rightLeft =
    lines.up === 'heavy' || lines.down === 'heavy'
      ? vHeavyLeft
      : lines.up !== lines.down || lines.right === lines.left
        ? lines.up === 'double' || lines.down === 'double'
          ? vDoubleLeft
          : vLightLeft
        : lines.up === 'none' && lines.down === 'none'
          ? vLightLeft
          : vLightRight;

  const b = (x0: number, y0: number, x1: number, y1: number) =>
    box(ctx, originX, originY, dpr, x0, y0, x1, y1);

  switch (lines.up) {
    case 'none':
      break;
    case 'light':
      b(vLightLeft, 0, vLightRight, upBottom);
      break;
    case 'heavy':
      b(vHeavyLeft, 0, vHeavyRight, upBottom);
      break;
    case 'double': {
      const leftBottom = lines.left === 'double' ? hLightTop : upBottom;
      const rightBottom = lines.right === 'double' ? hLightTop : upBottom;
      b(vDoubleLeft, 0, vLightLeft, leftBottom);
      b(vLightRight, 0, vDoubleRight, rightBottom);
      break;
    }
  }

  switch (lines.right) {
    case 'none':
      break;
    case 'light':
      b(rightLeft, hLightTop, dm.cellWidth, hLightBottom);
      break;
    case 'heavy':
      b(rightLeft, hHeavyTop, dm.cellWidth, hHeavyBottom);
      break;
    case 'double': {
      const upTop = lines.up === 'double' ? vLightRight : rightLeft;
      const downTop = lines.down === 'double' ? vLightRight : rightLeft;
      b(upTop, hDoubleTop, dm.cellWidth, hLightTop);
      b(downTop, hLightBottom, dm.cellWidth, hDoubleBottom);
      break;
    }
  }

  switch (lines.down) {
    case 'none':
      break;
    case 'light':
      b(vLightLeft, downTop, vLightRight, dm.cellHeight);
      break;
    case 'heavy':
      b(vHeavyLeft, downTop, vHeavyRight, dm.cellHeight);
      break;
    case 'double': {
      const leftTop = lines.left === 'double' ? hLightBottom : downTop;
      const rightTop = lines.right === 'double' ? hLightBottom : downTop;
      b(vDoubleLeft, leftTop, vLightLeft, dm.cellHeight);
      b(vLightRight, rightTop, vDoubleRight, dm.cellHeight);
      break;
    }
  }

  switch (lines.left) {
    case 'none':
      break;
    case 'light':
      b(0, hLightTop, leftRight, hLightBottom);
      break;
    case 'heavy':
      b(0, hHeavyTop, leftRight, hHeavyBottom);
      break;
    case 'double': {
      const upLeft = lines.up === 'double' ? vLightLeft : leftRight;
      const downLeft = lines.down === 'double' ? vLightLeft : leftRight;
      b(0, hDoubleTop, upLeft, hLightTop);
      b(0, hLightBottom, downLeft, hDoubleBottom);
      break;
    }
  }

  return true;
}

/**
 * Draw a block element (U+2580..U+259F), ported from Ghostty's
 * `sprite/draw/block.zig`. Returns false when the codepoint isn't handled.
 */
export function drawBlockElement(
  ctx: CanvasRenderingContext2D,
  codepoint: number,
  originX: number,
  originY: number,
  m: SpriteMetrics
): boolean {
  const spec = BLOCKS[codepoint];
  if (!spec) return false;

  const dpr = m.devicePixelRatio;
  const cellWidth = Math.round(m.cellWidth * dpr);
  const cellHeight = Math.round(m.cellHeight * dpr);

  if (spec.kind === 'shade') {
    const previousAlpha = ctx.globalAlpha;
    ctx.globalAlpha = previousAlpha * spec.alpha;
    ctx.fillRect(originX, originY, cellWidth / dpr, cellHeight / dpr);
    ctx.globalAlpha = previousAlpha;
    return true;
  }

  if (spec.kind === 'block') {
    const w = Math.round(cellWidth * spec.w);
    const h = Math.round(cellHeight * spec.h);
    const x = spec.align === 'right' ? cellWidth - w : spec.align === 'left' ? 0 : 0;
    const y = spec.align === 'lower' ? cellHeight - h : 0;
    ctx.fillRect(originX + x / dpr, originY + y / dpr, w / dpr, h / dpr);
    return true;
  }

  // Quadrants
  const halfW = Math.floor(cellWidth / 2);
  const halfH = Math.floor(cellHeight / 2);
  const rects: Array<[number, number, number, number]> = [];
  if (spec.tl) rects.push([0, 0, halfW, halfH]);
  if (spec.tr) rects.push([halfW, 0, cellWidth - halfW, halfH]);
  if (spec.bl) rects.push([0, halfH, halfW, cellHeight - halfH]);
  if (spec.br) rects.push([halfW, halfH, cellWidth - halfW, cellHeight - halfH]);

  for (const [x, y, w, h] of rects) {
    ctx.fillRect(originX + x / dpr, originY + y / dpr, w / dpr, h / dpr);
  }
  return true;
}
