/**
 * The link model behind the box diagram: which side follows which, as CSS shorthand has it.
 *
 * Bottom follows top. Right and left are a pair: with neither set both follow top, and once either
 * is set the other follows it, as CSS's two- and three-value forms copy one to the other. Corners run
 * the same way by position: bottom-right follows top-left, and top-right and bottom-left are the pair.
 * The first position is always set. `undefined` in a link array means set.
 */

import { describe, expect, it } from 'vitest';
import { linksOf, relink, setPosition, type Linked } from './box-links.js';

const none = new Set<number>();
const links = (next: Linked): readonly (number | undefined)[] => linksOf(next.quad, next.unlinked);

describe('linksOf', () => {
  it('reads a one-number value as every side following top', () => {
    expect(linksOf([8, 8, 8, 8], none)).toEqual([undefined, 0, 0, 0]);
  });

  it('reads 8 16 as right set, left following right, bottom following top', () => {
    expect(linksOf([8, 16, 8, 16], none)).toEqual([undefined, undefined, 0, 1]);
  });

  it('reads 8 16 4 as right and bottom set, left following right', () => {
    expect(linksOf([8, 16, 4, 16], none)).toEqual([undefined, undefined, undefined, 1]);
  });

  it('reads four different values as four set', () => {
    expect(linksOf([8, 16, 4, 2], none)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('reads a pair the author set from the left as right following left', () => {
    expect(linksOf([8, 4, 8, 4], new Set([3]))).toEqual([undefined, 3, 0, undefined]);
  });

  it('keeps a side the author unlinked unlinked, even while it equals top', () => {
    expect(linksOf([8, 8, 8, 8], new Set([1]))).toEqual([undefined, undefined, 0, 1]);
    expect(linksOf([8, 8, 8, 8], new Set([2]))).toEqual([undefined, 0, undefined, 0]);
  });
});

describe('setPosition', () => {
  it('moves every side that follows top with top', () => {
    expect(setPosition([8, 8, 8, 8], none, 0, 12).quad).toEqual([12, 12, 12, 12]);
    // Right is set, left follows right: only bottom moves with top.
    expect(setPosition([8, 16, 8, 16], none, 0, 12).quad).toEqual([12, 16, 12, 16]);
  });

  it('setting right takes left with it', () => {
    const next = setPosition([8, 8, 8, 8], none, 1, 16);

    expect(next.quad).toEqual([8, 16, 8, 16]);
    expect(links(next)).toEqual([undefined, undefined, 0, 1]);
  });

  it('setting left alone takes right with it, not top: CSS has no left without right', () => {
    const next = setPosition([8, 8, 8, 8], none, 3, 2);

    expect(next.quad).toEqual([8, 2, 8, 2]);
    expect(links(next)).toEqual([undefined, 3, 0, undefined]);
  });

  it('setting the other of a pair once one is set gives four values', () => {
    const next = setPosition([8, 16, 8, 16], none, 3, 2);

    expect(next.quad).toEqual([8, 16, 8, 2]);
    expect(links(next)).toEqual([undefined, undefined, 0, undefined]);
  });

  it('setting bottom leaves the pair alone', () => {
    expect(setPosition([8, 16, 8, 16], none, 2, 4).quad).toEqual([8, 16, 4, 16]);
  });
});

describe('relink', () => {
  it('relinks the one set side of a pair: both follow top again', () => {
    const next = relink([8, 16, 8, 16], none, 1);

    expect(next.quad).toEqual([8, 8, 8, 8]);
    expect(links(next)).toEqual([undefined, 0, 0, 0]);
  });

  it('relinks one of two set sides to the other, which stays set', () => {
    const right = relink([8, 16, 8, 2], none, 1);
    expect(right.quad).toEqual([8, 2, 8, 2]);
    expect(links(right)).toEqual([undefined, 3, 0, undefined]);

    const left = relink([8, 16, 8, 2], none, 3);
    expect(left.quad).toEqual([8, 16, 8, 16]);
    expect(links(left)).toEqual([undefined, undefined, 0, 1]);
  });

  it('relinks bottom to top', () => {
    expect(relink([8, 16, 4, 16], none, 2).quad).toEqual([8, 16, 8, 16]);
  });

  it('never unlinks or clears the first position', () => {
    expect(relink([8, 16, 8, 16], none, 0).quad).toEqual([8, 16, 8, 16]);
  });
});
