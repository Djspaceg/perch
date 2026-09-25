/**
 * Where a popover goes.
 *
 * Under its anchor, left edges aligned, when it fits; over it when it does not; and pinned inside
 * the viewport when it fits neither — which is the ordinary case at the 1920x400 panel ratio, where a
 * picker under a swatch halfway down a 400px window has nowhere to go but up. Always on screen
 * horizontally too: the inspector is the rightmost column, so a popover aligned to a swatch's left
 * edge would otherwise run off the right.
 */

/** A client rect's edges. */
export interface AnchorEdges {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** A width and a height. */
export interface Extent {
  readonly width: number;
  readonly height: number;
}

/** The popover's top-left corner, in viewport pixels, for `position: fixed`. */
export function placePopover(
  anchor: AnchorEdges,
  size: Extent,
  viewport: Extent,
  gap = 4,
): { readonly top: number; readonly left: number } {
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  let top: number;
  if (below + size.height <= viewport.height - gap) top = below;
  else if (above >= gap) top = above;
  else top = Math.max(gap, viewport.height - size.height - gap);

  const left = Math.min(Math.max(gap, anchor.left), viewport.width - size.width - gap);

  return { top, left };
}
