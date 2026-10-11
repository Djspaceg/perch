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
 * Where the element at `from` ends up, as an index in `elements`, when it is dropped in gap `gap` of
 * a list showing the elements `shown` (indices, top of the list first) — or `null` for a gap either
 * side of its own row, which is where it already is. The list may show only some elements (the
 * kind filter): a drop just under a row puts the element directly beneath that row's element in
 * paint order, and a drop above the first row directly above it, whatever is hidden between.
 */
export function dropTarget(from: number, gap: number, shown: readonly number[]): number | null {
  if (gap < 0 || gap > shown.length) return null;
  const at = shown.indexOf(from);
  if (at !== -1 && (gap === at || gap === at + 1)) return null;
  const above = gap === 0;
  const neighbour = above ? shown[0] : shown[gap - 1];
  if (neighbour === undefined) return null;
  // Directly above `neighbour` in paint order is just after it; directly beneath is just before it.
  const to = above
    ? from < neighbour
      ? neighbour
      : neighbour + 1
    : from < neighbour
      ? neighbour - 1
      : neighbour;

  return to === from ? null : to;
}

/** Every element of `count`, as the list shows them unfiltered: the topmost first. */
export function allRows(count: number): number[] {
  return Array.from({ length: count }, (_, row) => listRow(row, count));
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
