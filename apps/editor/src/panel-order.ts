/**
 * The order of a group's panels: the default the code lists them in, bent by an order the author
 * dragged them into and the editor remembered (`settings.panels.order`, by group).
 *
 * The remembered order names more panels than are ever on screen at once — a media element shows
 * Content, Transform and Appearance, a readout four more — so it is applied to whatever is shown,
 * and a move among what is shown is merged back into it without losing where the others were.
 * A panel the remembered order has never heard of (one added in a later build) keeps its place
 * after the panel it follows by default. Pure, so the arithmetic is tested on its own.
 */

/** `shown`, in the remembered order: what it names in that order, the rest after their default predecessor. */
export function applyOrder(
  shown: readonly string[],
  stored: readonly string[] | undefined,
): string[] {
  if (stored === undefined || stored.length === 0) return [...shown];
  const placed = stored.filter((key) => shown.includes(key));
  for (const [at, key] of shown.entries()) {
    if (placed.includes(key)) continue;
    const before = shown
      .slice(0, at)
      .reverse()
      .find((other) => placed.includes(other));
    placed.splice(before === undefined ? 0 : placed.indexOf(before) + 1, 0, key);
  }

  return placed;
}

/**
 * The remembered order after the shown panels were put in `shown` order: `shown`, with every panel
 * it does not include kept after the one it followed before.
 */
export function mergeOrder(
  stored: readonly string[] | undefined,
  shown: readonly string[],
): string[] {
  const merged = [...shown];
  const previous = stored ?? [];
  for (const [at, key] of previous.entries()) {
    if (merged.includes(key)) continue;
    const before = previous
      .slice(0, at)
      .reverse()
      .find((other) => merged.includes(other));
    merged.splice(before === undefined ? 0 : merged.indexOf(before) + 1, 0, key);
  }

  return merged;
}

/** `keys` with the one at `from` moved to index `to`. */
export function moveKey(keys: readonly string[], from: number, to: number): string[] {
  const next = [...keys];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);

  return next;
}

/**
 * Where the panel at `from` lands when dropped in gap `gap` (0 above the first, `count` below the
 * last), or `null` for a gap either side of itself, which is where it already is.
 */
export function panelDropTarget(from: number, gap: number, count: number): number | null {
  if (gap === from || gap === from + 1 || gap < 0 || gap > count) return null;

  return gap > from ? gap - 1 : gap;
}
