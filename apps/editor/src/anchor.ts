/**
 * The resize anchor, as Affinity's Transform panel has it: the point of an element's box that its
 * Placement fields are about.
 *
 * x and y show where the anchor point is, and typing them moves the box so the point lands there;
 * w and h resize the box about the point, which stays where it was. The document is untouched by
 * the choice: a rect is always stored as its top-left x and y and its w and h, so the anchor is an
 * editor setting (`settings.anchor`, one for every element), and the top-left default shows exactly
 * the numbers the file holds.
 *
 * Rect components are integers (`layout-schema`'s geometry), so the centre of an odd size is the
 * pixel just left of (or above) the middle: `floor(size / 2)`. Every value written stays whole.
 * Pure, so the arithmetic is tested on its own.
 */

import type { Rect } from '@perch/layout-schema';

/** Where on one axis: the start edge, the middle, or the end edge. */
export type AnchorEdge = 'start' | 'center' | 'end';

export interface Anchor {
  readonly across: AnchorEdge;
  readonly down: AnchorEdge;
}

export const ANCHOR_EDGES: readonly AnchorEdge[] = Object.freeze(['start', 'center', 'end']);

export const TOP_LEFT: Anchor = Object.freeze({ across: 'start', down: 'start' });

/** How far into a box of `size` the anchor edge is. */
export function anchorOffset(edge: AnchorEdge, size: number): number {
  return edge === 'start' ? 0 : edge === 'center' ? Math.floor(size / 2) : size;
}

/** An edge's word on each axis. */
export const ACROSS_WORDS: Readonly<Record<AnchorEdge, string>> = Object.freeze({
  start: 'left',
  center: 'centre',
  end: 'right',
});
export const DOWN_WORDS: Readonly<Record<AnchorEdge, string>> = Object.freeze({
  start: 'top',
  center: 'middle',
  end: 'bottom',
});

/** The anchor in words, as its grid cell is named: `top left`, `middle centre`. */
export function anchorWords(anchor: Anchor): string {
  return `${DOWN_WORDS[anchor.down]} ${ACROSS_WORDS[anchor.across]}`;
}

/** Where the anchor point of `rect` is. */
export function anchoredPosition(rect: Rect, anchor: Anchor): { x: number; y: number } {
  return {
    x: rect.x + anchorOffset(anchor.across, rect.w),
    y: rect.y + anchorOffset(anchor.down, rect.h),
  };
}

/** `rect` moved so its anchor point is at `value` on `axis`. */
export function placeAt(rect: Rect, anchor: Anchor, axis: 'x' | 'y', value: number): Rect {
  return axis === 'x'
    ? { ...rect, x: value - anchorOffset(anchor.across, rect.w) }
    : { ...rect, y: value - anchorOffset(anchor.down, rect.h) };
}

/**
 * `rect` with `field` set to `value`, moved so its anchor point stays where it was. A size that is
 * not a number moves nothing: the validator names the size, and only the size.
 */
export function resizeAbout(rect: Rect, anchor: Anchor, field: 'w' | 'h', value: number): Rect {
  if (!Number.isFinite(value)) return { ...rect, [field]: value };
  if (field === 'w') {
    const point = rect.x + anchorOffset(anchor.across, rect.w);
    return { ...rect, w: value, x: point - anchorOffset(anchor.across, value) };
  }
  const point = rect.y + anchorOffset(anchor.down, rect.h);

  return { ...rect, h: value, y: point - anchorOffset(anchor.down, value) };
}
