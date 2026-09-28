/**
 * Terminal scrollbar geometry and styling.
 *
 * Shared by the renderer (which draws it) and the terminal (which hit-tests
 * clicks and drags on it), so the two can never disagree about where the
 * scrollbar is.
 *
 * The scrollbar is deliberately understated: no track, a thin rounded thumb,
 * and a low opacity. It is only drawn while it is fading in/out around a
 * scroll (see `Terminal.showScrollbar`).
 */

/** Distance from the right edge of the canvas to the scrollbar, in CSS pixels. */
export const SCROLLBAR_MARGIN = 4;

/** Scrollbar width in CSS pixels. */
export const SCROLLBAR_WIDTH = 6;

/** Vertical padding between the canvas edges and the scrollbar track. */
export const SCROLLBAR_PADDING = 4;

/** Minimum thumb height in CSS pixels, so it stays grabbable. */
export const SCROLLBAR_MIN_THUMB_HEIGHT = 24;

/** Thumb opacity while the viewport is scrolled up. */
export const SCROLLBAR_THUMB_OPACITY_SCROLLED = 0.25;

/** Thumb opacity when the viewport is at the bottom (just a hint). */
export const SCROLLBAR_THUMB_OPACITY_IDLE = 0.12;

export interface ScrollbarLayout {
  /** Left edge of the scrollbar in CSS pixels */
  x: number;
  /** Scrollbar width in CSS pixels */
  width: number;
  /** Top of the track in CSS pixels */
  trackTop: number;
  /** Height of the track in CSS pixels */
  trackHeight: number;
  /** Top of the thumb in CSS pixels */
  thumbY: number;
  /** Height of the thumb in CSS pixels */
  thumbHeight: number;
}

/**
 * Compute the scrollbar layout for a canvas of the given size.
 *
 * `viewportY` is 0 at the bottom and `scrollbackLength` at the top, matching
 * `Terminal.viewportY`.
 */
export function computeScrollbarLayout(
  canvasWidth: number,
  canvasHeight: number,
  viewportY: number,
  scrollbackLength: number,
  visibleRows: number
): ScrollbarLayout {
  const width = SCROLLBAR_WIDTH;
  const x = canvasWidth - width - SCROLLBAR_MARGIN;
  const trackTop = SCROLLBAR_PADDING;
  const trackHeight = Math.max(0, canvasHeight - SCROLLBAR_PADDING * 2);

  const totalLines = scrollbackLength + visibleRows;
  const thumbHeight =
    totalLines > 0
      ? Math.min(
          trackHeight,
          Math.max(SCROLLBAR_MIN_THUMB_HEIGHT, (visibleRows / totalLines) * trackHeight)
        )
      : trackHeight;

  // 0 = at the bottom, scrollbackLength = at the top
  const scrollPosition = scrollbackLength > 0 ? viewportY / scrollbackLength : 0;
  const thumbY = trackTop + (trackHeight - thumbHeight) * (1 - scrollPosition);

  return { x, width, trackTop, trackHeight, thumbY, thumbHeight };
}

/** True when the given canvas-relative point is on the scrollbar. */
export function isOnScrollbar(layout: ScrollbarLayout, mouseX: number, mouseY: number): boolean {
  // Widen the hit area a little to the left so it is easier to grab
  const hitPadding = 3;
  return (
    mouseX >= layout.x - hitPadding &&
    mouseX <= layout.x + layout.width &&
    mouseY >= layout.trackTop &&
    mouseY <= layout.trackTop + layout.trackHeight
  );
}
