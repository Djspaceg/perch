/**
 * Paint order as layers: where a layer command or a drop in the Elements list sends an element.
 *
 * `elements` is paint order — the first element is painted first, under everything, and the last on
 * top. The Elements list shows it the way a layers panel does, the topmost first: list row 0 is the
 * last element. These functions are the one place that turns between the two, so the list, the drag
 * and the four commands cannot disagree about which way is up. Pure, so they are tested on their own.
 */

/** The four layer commands, by what each does in paint order. */
export type LayerMove = 'bringForward' | 'sendBackward' | 'bringToFront' | 'sendToBack';

/** The row an element is drawn in, counting from the top of the list; its own inverse. */
export function listRow(index: number, count: number): number {
  return count - 1 - index;
}

/** Where `move` sends the element at `from`, or `null` where it is already as far as it goes. */
export function layerTarget(move: LayerMove, from: number, count: number): number | null {
  if (from < 0 || from >= count) return null;
  const to =
    move === 'bringForward'
      ? Math.min(count - 1, from + 1)
      : move === 'sendBackward'
        ? Math.max(0, from - 1)
        : move === 'bringToFront'
          ? count - 1
          : 0;

  return to === from ? null : to;
}

/**
 * The gap in the list a pointer is over: 0 above the first row, `rows.length` below the last, and in
 * between, how many rows have their middle above it.
 */
export function gapAt(clientY: number, rows: readonly { top: number; bottom: number }[]): number {
  return rows.filter((row) => (row.top + row.bottom) / 2 < clientY).length;
}

/**
 * Where the element at `from` ends up, as an index in `elements`, when it is dropped in list gap
 * `gap` — or `null` for a gap either side of its own row, which is where it already is.
 */
export function dropTarget(from: number, gap: number, count: number): number | null {
  const row = listRow(from, count);
  if (gap === row || gap === row + 1 || gap < 0 || gap > count) return null;
  const landed = gap > row ? gap - 1 : gap;

  return listRow(landed, count);
}

/** How near an edge of the scrolling sidebar, in pixels, a held row starts it scrolling. */
export const AUTOSCROLL_EDGE_PX = 28;

/**
 * How far to scroll the sidebar in one frame for a pointer at `clientY`: up (negative) near its top,
 * down near its bottom, faster the closer to the edge, and not at all in between.
 */
export function autoscrollStep(clientY: number, top: number, bottom: number): number {
  const into = (distance: number): number =>
    Math.ceil((AUTOSCROLL_EDGE_PX - Math.max(0, distance)) / 2);
  if (clientY < top + AUTOSCROLL_EDGE_PX) return -into(clientY - top);
  if (clientY > bottom - AUTOSCROLL_EDGE_PX) return into(bottom - clientY);

  return 0;
}
