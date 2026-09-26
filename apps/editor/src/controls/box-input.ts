/**
 * What a padding or radius field accepts, and the words it refuses the rest with.
 *
 * Looser than the token it writes, in the ways a person pastes: `px` on each value (CSS copied from a
 * stylesheet) and commas between them (Figma's own spelling). Stricter in the ways the canvas needs:
 * whole layout pixels, none negative, one to four of them. Every refusal names the mistake, because
 * the field keeps what was typed and writes nothing until it reads, and a red box with no reason is a
 * field an author cannot get out of.
 */

import { BOX_CORNERS, BOX_SIDES, expandBoxShorthand, type BoxQuad } from '@perch/ui-kit';
import { clampValue, type NumericBounds } from './scrub.js';

/** Four sides of a padding, or four corners of a radius. */
export type BoxKind = 'sides' | 'corners';

export type BoxInput =
  { readonly ok: true; readonly quad: BoxQuad } | { readonly ok: false; readonly message: string };

/** The four positions, as a person says them, in CSS order. */
export function boxPositions(kind: BoxKind): readonly string[] {
  return kind === 'sides' ? BOX_SIDES : BOX_CORNERS;
}

/** A value of one part: whole, unsigned, with an optional `px`. */
const WHOLE_PX = /^(\d+)(?:px)?$/i;

/** One part, or the reason it is not one. */
export function parseBoxPart(part: string, kind: BoxKind): number | string {
  const match = WHOLE_PX.exec(part);
  if (match !== null) return Number(match[1]);
  if (part.startsWith('-'))
    return `a ${kind === 'sides' ? 'padding' : 'radius'} cannot be negative`;
  if (/^\d*\.\d+(?:px)?$|^\d+\.(?:px)?$/i.test(part)) return 'whole layout pixels only, like 8';
  if (/^[\d.]+[a-z%]+$/i.test(part)) {
    return `"${part}" is in another unit; use layout pixels, with or without px`;
  }

  return `"${part}" is not a number`;
}

/** Typed text as four values, or the one message that says what is wrong with it. */
export function parseBoxInput(text: string, kind: BoxKind): BoxInput {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, message: 'type 1 to 4 numbers, like 8 or 8 16' };
  if (kind === 'corners' && trimmed.includes('/')) {
    return { ok: false, message: 'elliptical corners (a / b) are not supported' };
  }

  const parts = trimmed.split(/[\s,]+/).filter((part) => part !== '');
  if (parts.length > 4) {
    return { ok: false, message: `at most 4 values: ${boxPositions(kind).join(' ')}` };
  }
  const values: number[] = [];
  for (const part of parts) {
    const value = parseBoxPart(part, kind);
    if (typeof value === 'string') return { ok: false, message: value };
    values.push(value);
  }
  const quad = expandBoxShorthand(values);

  return quad === undefined
    ? { ok: false, message: 'type 1 to 4 numbers, like 8 or 8 16' }
    : { ok: true, quad };
}

/**
 * Every side moved by `delta`, each held at the floor, and at the ceiling unless it was already past
 * it: a typed value may exceed a range (see `scrub.ts`), and nudging must not quietly pull it back.
 */
export function shiftQuad(quad: BoxQuad, delta: number, bounds: NumericBounds): BoxQuad {
  const move = (side: number): number =>
    clampValue(side + delta, {
      min: bounds.min,
      max: bounds.max === undefined ? undefined : Math.max(bounds.max, side),
    });

  return [move(quad[0]), move(quad[1]), move(quad[2]), move(quad[3])];
}
