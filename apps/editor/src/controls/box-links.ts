/**
 * Which side of a box follows which: the link model behind `BoxDiagram`.
 *
 * It is CSS shorthand's own inheritance, read as links. Bottom copies top. Right and left are a
 * pair: `padding: 8` gives both of them top's value, and `padding: 8 16` or `8 16 4` gives both the
 * one value written for them. So with neither set, both follow top; once either is set, the other
 * follows it; only four values set them apart. Corners are the same by position: bottom-right copies
 * top-left, and top-right with bottom-left are the pair (`border-radius: 6 12` is 6 12 6 12). The
 * first position (top, top-left) is always set.
 *
 * A link array holds, for each position, the position it follows, or `undefined` where it is set.
 *
 * ## What is stored, and what is only remembered
 *
 * The token stores four numbers as the shortest shorthand (`box-shorthand.ts`). It does not store
 * links: a side reads as linked when it equals what it would follow, which is exactly what CSS draws
 * either way, and an equal pair reads as right set with left following, the order CSS writes it in.
 * What cannot be read back is which one of an equal pair the author set, or a side the author
 * unlinked and left equal. Those are kept in `unlinked` while the field lives, so a side does not snap
 * back to a link the moment it matches, and a pair set from the left keeps its link on the right.
 */

import type { BoxQuad } from '@perch/ui-kit';

/** The first position: always set. */
const FIRST = 0;
/** The position that follows the first alone: bottom, or bottom-right. */
const OPPOSITE = 2;
/** The pair: right and left, or top-right and bottom-left. */
const PAIR: readonly [1, 3] = [1, 3];

/** A value and link state after an edit. */
export interface Linked {
  readonly quad: BoxQuad;
  readonly unlinked: ReadonlySet<number>;
}

/** What each position follows: another position's index, or `undefined` where it is set. */
export type Links = readonly (number | undefined)[];

/** The other half of the pair, for a position in it. */
function partnerOf(index: number): number | undefined {
  return index === PAIR[0] ? PAIR[1] : index === PAIR[1] ? PAIR[0] : undefined;
}

/** What each position follows, read from its value and the sides the author unlinked. */
export function linksOf(quad: BoxQuad, unlinked: ReadonlySet<number>): Links {
  const [a, b] = PAIR;
  const out: (number | undefined)[] = [undefined, undefined, undefined, undefined];
  if (!unlinked.has(OPPOSITE) && quad[OPPOSITE] === quad[FIRST]) out[OPPOSITE] = FIRST;

  const aSet = unlinked.has(a);
  const bSet = unlinked.has(b);
  if (!aSet && !bSet && quad[a] === quad[FIRST] && quad[b] === quad[FIRST]) {
    out[a] = FIRST;
    out[b] = FIRST;
  } else if (quad[a] === quad[b] && !(aSet && bSet)) {
    // One half set, the other following it. Which half is the author's, where they said; else the
    // first, as CSS writes a pair.
    if (bSet) out[a] = b;
    else out[b] = a;
  }

  return out;
}

/** Every linked position takes the value it follows. Top's followers first, then the pair's. */
function resolve(values: readonly number[], links: Links): BoxQuad {
  const out = [...values];
  for (const index of [OPPOSITE, ...PAIR]) {
    if (links[index] === FIRST) out[index] = out[FIRST] ?? 0;
  }
  for (const index of PAIR) {
    const source = links[index];
    if (source !== undefined && source !== FIRST) out[index] = out[source] ?? 0;
  }

  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0, out[3] ?? 0];
}

/** Position `index` given its own number. Its pair partner, if it was following, now follows it. */
export function setPosition(
  quad: BoxQuad,
  unlinked: ReadonlySet<number>,
  index: number,
  value: number,
): Linked {
  const links = [...linksOf(quad, unlinked)];
  links[index] = undefined;
  const partner = partnerOf(index);
  if (partner !== undefined && links[partner] !== undefined) links[partner] = index;
  const values = [...quad];
  values[index] = value;
  const next = new Set(unlinked);
  if (index !== FIRST) next.add(index);
  if (partner !== undefined && links[partner] !== undefined) next.delete(partner);

  return { quad: resolve(values, links), unlinked: next };
}

/**
 * What position `index` would follow if relinked: the pair partner where it is set, else the first.
 * `undefined` for the first position, which cannot be relinked.
 */
export function relinkTarget(
  quad: BoxQuad,
  unlinked: ReadonlySet<number>,
  index: number,
): number | undefined {
  if (index === FIRST) return undefined;
  const partner = partnerOf(index);
  if (partner === undefined) return FIRST;

  return linksOf(quad, unlinked)[partner] === undefined ? partner : FIRST;
}

/**
 * Position `index` cleared back to a link. In a pair whose other half is set, it follows that half;
 * where the other half was following it, both go back to the first. The first position cannot be.
 */
export function relink(quad: BoxQuad, unlinked: ReadonlySet<number>, index: number): Linked {
  const target = relinkTarget(quad, unlinked, index);
  if (target === undefined) return { quad, unlinked };
  const links = [...linksOf(quad, unlinked)];
  const next = new Set(unlinked);
  next.delete(index);
  links[index] = target;

  const partner = partnerOf(index);
  if (partner !== undefined) {
    if (target === partner) {
      // The partner is now the pair's one set half: say so, so an equal pair reads that way round.
      next.add(partner);
    } else {
      links[partner] = FIRST;
      next.delete(partner);
    }
  }

  return { quad: resolve(quad, links), unlinked: next };
}
