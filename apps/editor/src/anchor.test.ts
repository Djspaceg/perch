import { describe, expect, it } from 'vitest';
import { TOP_LEFT, anchoredPosition, anchorWords, placeAt, resizeAbout } from './anchor.js';

const RECT = { x: 100, y: 50, w: 41, h: 20 };

describe('the resize anchor', () => {
  it('is the top-left corner by default, so the numbers are the rect’s own', () => {
    expect(anchoredPosition(RECT, TOP_LEFT)).toEqual({ x: 100, y: 50 });
    expect(anchorWords(TOP_LEFT)).toBe('top left');
  });

  it('shows the anchor point’s coordinates, whole even for an odd size', () => {
    expect(anchoredPosition(RECT, { across: 'center', down: 'center' })).toEqual({ x: 120, y: 60 });
    expect(anchoredPosition(RECT, { across: 'end', down: 'end' })).toEqual({ x: 141, y: 70 });
    expect(anchorWords({ across: 'end', down: 'center' })).toBe('middle right');
  });

  it('moves the box so the anchor point lands on the number typed', () => {
    expect(placeAt(RECT, { across: 'end', down: 'start' }, 'x', 200)).toEqual({ ...RECT, x: 159 });
    expect(placeAt(RECT, { across: 'start', down: 'center' }, 'y', 80)).toEqual({ ...RECT, y: 70 });
  });

  it('resizes about the anchor, which stays where it was', () => {
    const centre = { across: 'center', down: 'center' } as const;
    const resized = resizeAbout(RECT, centre, 'w', 60);
    expect(resized).toEqual({ ...RECT, x: 90, w: 60 });
    expect(anchoredPosition(resized, centre).x).toBe(anchoredPosition(RECT, centre).x);
    expect(resizeAbout(RECT, { across: 'end', down: 'end' }, 'h', 30)).toEqual({
      ...RECT,
      y: 40,
      h: 30,
    });
    expect(resizeAbout(RECT, TOP_LEFT, 'w', 10)).toEqual({ ...RECT, w: 10 });
  });

  it('leaves the position alone for a size that is not a number, for the validator to name', () => {
    const resized = resizeAbout(RECT, { across: 'end', down: 'end' }, 'w', Number.NaN);
    expect(resized.x).toBe(100);
    expect(resized.w).toBeNaN();
  });
});
