/**
 * The box shorthand: one to four unitless numbers in a padding or radius token, read in CSS order.
 *
 * Two claims. The four-value expansion and the shortest spelling are exactly CSS's, so what an author
 * types is what `padding` and `border-radius` would mean by it. And a one-number token reads as it
 * always did, which is what keeps every existing layout rendering as before.
 */

import { describe, expect, it } from 'vitest';
import {
  boxQuadCss,
  expandBoxShorthand,
  formatBoxToken,
  parseBoxToken,
  shortestBoxShorthand,
  type BoxQuad,
} from './box-shorthand.js';

describe('expandBoxShorthand', () => {
  it('expands one to four values the way CSS padding does: top right bottom left', () => {
    expect(expandBoxShorthand([8])).toEqual([8, 8, 8, 8]);
    expect(expandBoxShorthand([8, 16])).toEqual([8, 16, 8, 16]);
    expect(expandBoxShorthand([8, 16, 4])).toEqual([8, 16, 4, 16]);
    expect(expandBoxShorthand([8, 16, 4, 2])).toEqual([8, 16, 4, 2]);
  });

  it('refuses no values and more than four', () => {
    expect(expandBoxShorthand([])).toBeUndefined();
    expect(expandBoxShorthand([1, 2, 3, 4, 5])).toBeUndefined();
  });
});

describe('shortestBoxShorthand', () => {
  it('writes the fewest values that expand back to the same four', () => {
    expect(shortestBoxShorthand([8, 8, 8, 8])).toEqual([8]);
    expect(shortestBoxShorthand([8, 16, 8, 16])).toEqual([8, 16]);
    expect(shortestBoxShorthand([8, 16, 4, 16])).toEqual([8, 16, 4]);
    expect(shortestBoxShorthand([8, 16, 4, 2])).toEqual([8, 16, 4, 2]);
    // Left differs from right: all four, even though top equals bottom.
    expect(shortestBoxShorthand([8, 16, 8, 2])).toEqual([8, 16, 8, 2]);
  });

  it('round-trips every shape', () => {
    const quads: BoxQuad[] = [
      [0, 0, 0, 0],
      [1, 2, 1, 2],
      [1, 2, 3, 2],
      [1, 2, 3, 4],
      [4, 4, 4, 1],
      [5, 5, 1, 5],
    ];
    for (const quad of quads) {
      expect(expandBoxShorthand(shortestBoxShorthand(quad)), quad.join(' ')).toEqual(quad);
    }
  });
});

describe('parseBoxToken', () => {
  it('reads a one-number token exactly as the single-value token was always read', () => {
    expect(parseBoxToken('12')).toEqual([12, 12, 12, 12]);
    expect(parseBoxToken(' 0 ')).toEqual([0, 0, 0, 0]);
    expect(parseBoxToken('2.5')).toEqual([2.5, 2.5, 2.5, 2.5]);
  });

  it('reads two to four whitespace-separated numbers in CSS order', () => {
    expect(parseBoxToken('8 16')).toEqual([8, 16, 8, 16]);
    expect(parseBoxToken('8  16\t4')).toEqual([8, 16, 4, 16]);
    expect(parseBoxToken('8 16 4 2')).toEqual([8, 16, 4, 2]);
  });

  it('refuses what CSS would refuse in padding or border-radius, so the box and the chart agree', () => {
    for (const value of [
      '',
      'abc',
      '12px',
      '0x10',
      'Infinity',
      '8 16 4 2 1',
      '8,16',
      '-8',
      '8 -1',
      '4 / 2',
    ]) {
      expect(parseBoxToken(value), JSON.stringify(value)).toBeUndefined();
    }
  });
});

describe('formatBoxToken and boxQuadCss', () => {
  it('store the shortest unitless shorthand', () => {
    expect(formatBoxToken([8, 8, 8, 8])).toBe('8');
    expect(formatBoxToken([8, 16, 4, 16])).toBe('8 16 4');
  });

  it('write the shortest shorthand in px for a native declaration', () => {
    expect(boxQuadCss([8, 8, 8, 8])).toBe('8px');
    expect(boxQuadCss([8, 16, 8, 16])).toBe('8px 16px');
    expect(boxQuadCss([8, 16, 4, 2])).toBe('8px 16px 4px 2px');
  });
});
