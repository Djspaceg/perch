/**
 * The link model behind the box diagram: which side follows which, as CSS shorthand has it.
 *
 * Right and bottom follow top, left follows right; for corners, top-right and bottom-right follow
 * top-left and bottom-left follows top-right. The first position is always set.
 */

import { describe, expect, it } from 'vitest';
import { LINK_SOURCE, linksOf, relink, setPosition } from './box-links.js';

const none = new Set<number>();

describe('LINK_SOURCE', () => {
  it('is CSS shorthand inheritance: right and bottom from top, left from right', () => {
    expect(LINK_SOURCE).toEqual([undefined, 0, 0, 1]);
  });
});

describe('linksOf', () => {
  it('reads a one-number value as every side linked', () => {
    expect(linksOf([8, 8, 8, 8], none)).toEqual([false, true, true, true]);
  });

  it('reads each shorthand length as the sides it sets', () => {
    // 8 16: right set, bottom follows top, left follows right.
    expect(linksOf([8, 16, 8, 16], none)).toEqual([false, false, true, true]);
    // 8 16 4: right and bottom set.
    expect(linksOf([8, 16, 4, 16], none)).toEqual([false, false, false, true]);
    expect(linksOf([8, 16, 4, 2], none)).toEqual([false, false, false, false]);
  });

  it('lets left be set alone, with right and bottom still following top', () => {
    expect(linksOf([8, 8, 8, 4], none)).toEqual([false, true, true, false]);
  });

  it('keeps a side the author unlinked unlinked, even while it equals its source', () => {
    expect(linksOf([8, 8, 8, 8], new Set([1]))).toEqual([false, false, true, true]);
  });
});

describe('setPosition', () => {
  it('moves every linked side with top', () => {
    expect(setPosition([8, 8, 8, 8], none, 0, 12)).toEqual({
      quad: [12, 12, 12, 12],
      unlinked: new Set(),
    });
  });

  it('sets a side and unlinks it; a side linked to it follows', () => {
    expect(setPosition([8, 8, 8, 8], none, 1, 16)).toEqual({
      quad: [8, 16, 8, 16],
      unlinked: new Set([1]),
    });
  });

  it('setting left first leaves right and bottom on top', () => {
    const next = setPosition([8, 8, 8, 8], none, 3, 2);

    expect(next.quad).toEqual([8, 8, 8, 2]);
    expect(linksOf(next.quad, next.unlinked)).toEqual([false, true, true, false]);
  });
});

describe('relink', () => {
  it('clears a side back to its source, and what follows it follows along', () => {
    // Right set to 16, left linked to right: relinking right brings both back to top.
    expect(relink([8, 16, 8, 16], new Set([1]), 1)).toEqual({
      quad: [8, 8, 8, 8],
      unlinked: new Set(),
    });
  });

  it('leaves a side that was set on its own alone', () => {
    expect(relink([8, 16, 8, 2], new Set([1, 3]), 1)).toEqual({
      quad: [8, 8, 8, 2],
      unlinked: new Set([3]),
    });
  });

  it('never unlinks or clears the first position', () => {
    expect(relink([8, 16, 8, 16], none, 0).quad).toEqual([8, 16, 8, 16]);
  });
});
