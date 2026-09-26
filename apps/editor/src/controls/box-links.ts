/**
 * Which side of a box follows which: the link model behind `BoxDiagram`.
 *
 * It is CSS shorthand's own inheritance, read as links. In `padding: 8 16`, bottom is not written
 * because it copies top, and left because it copies right; in `border-radius: 6 6 0`, bottom-left
 * copies top-right. So a side is **linked** to the position it would copy, and **set** when it has its
 * own number. The first position (top, top-left) is always set.
 *
 * ## What is stored, and what is only remembered
 *
 * The token stores four numbers as the shortest shorthand (`box-shorthand.ts`). It does not store
 * links. A side reads as linked when it equals the position it copies, which is exactly what CSS
 * would draw either way. The one thing that cannot be read back is a side the author unlinked and
 * left equal to its source. That is kept in `unlinked` for as long as the field lives, so an unlinked
 * side does not snap back to a link the moment it matches.
 */

import type { BoxQuad } from '@perch/ui-kit';

/** For each position, the position it copies when linked; the first copies nothing. */
export const LINK_SOURCE: readonly (0 | 1 | undefined)[] = Object.freeze([undefined, 0, 0, 1]);

/** A side's value and link state after an edit. */
export interface Linked {
  readonly quad: BoxQuad;
  readonly unlinked: ReadonlySet<number>;
}

/** Whether each position is linked. The first never is. */
export function linksOf(quad: BoxQuad, unlinked: ReadonlySet<number>): readonly boolean[] {
  return quad.map((value, index) => {
    const source = LINK_SOURCE[index];
    return source !== undefined && !unlinked.has(index) && value === quad[source];
  });
}

/** Every linked position takes its source's value, in order, so a chain (left from right) resolves. */
function resolve(values: readonly number[], linked: readonly boolean[]): BoxQuad {
  const out = [...values];
  for (let index = 1; index < out.length; index += 1) {
    const source = LINK_SOURCE[index];
    if (linked[index] === true && source !== undefined) out[index] = out[source] ?? 0;
  }

  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0, out[3] ?? 0];
}

/** Position `index` given its own number: it is set from now on, and what follows it follows. */
export function setPosition(
  quad: BoxQuad,
  unlinked: ReadonlySet<number>,
  index: number,
  value: number,
): Linked {
  const linked = [...linksOf(quad, unlinked)];
  linked[index] = false;
  const values = [...quad];
  values[index] = value;
  const next = new Set(unlinked);
  if (index > 0) next.add(index);

  return { quad: resolve(values, linked), unlinked: next };
}

/** Position `index` cleared back to a link. The first position cannot be. */
export function relink(quad: BoxQuad, unlinked: ReadonlySet<number>, index: number): Linked {
  if (LINK_SOURCE[index] === undefined) return { quad, unlinked };
  const linked = [...linksOf(quad, unlinked)];
  linked[index] = true;
  const next = new Set(unlinked);
  next.delete(index);

  return { quad: resolve(quad, linked), unlinked: next };
}
