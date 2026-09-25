/**
 * Where a popover goes: under its anchor when it fits, over it when it does not, and always on
 * screen. The 1920x400 panel ratio is the case that decides this — a 200px picker under a swatch
 * halfway down a 400px window has nowhere to go but up.
 */

import { describe, expect, it } from 'vitest';
import { placePopover } from './popover.js';

const VIEWPORT = { width: 1920, height: 400 };
const SIZE = { width: 220, height: 180 };

describe('placePopover', () => {
  it('opens below the anchor, left edges aligned, when there is room', () => {
    const anchor = { top: 40, bottom: 60, left: 1600, right: 1620 };

    expect(placePopover(anchor, SIZE, VIEWPORT)).toEqual({ top: 64, left: 1600 });
  });

  it('opens above the anchor when below would run off the bottom', () => {
    const anchor = { top: 300, bottom: 320, left: 1600, right: 1620 };

    expect(placePopover(anchor, SIZE, VIEWPORT)).toEqual({ top: 116, left: 1600 });
  });

  it('pins to the viewport when it fits neither above nor below', () => {
    const anchor = { top: 150, bottom: 170, left: 1600, right: 1620 };

    // 300px tall: 174 + 300 runs off the bottom, and 150 - 304 runs off the top.
    expect(placePopover(anchor, { width: 220, height: 300 }, VIEWPORT)).toEqual({
      top: 96,
      left: 1600,
    });
  });

  it('never runs off the right or left edge', () => {
    expect(
      placePopover({ top: 40, bottom: 60, left: 1860, right: 1880 }, SIZE, VIEWPORT).left,
    ).toBe(1920 - 220 - 4);
    expect(placePopover({ top: 40, bottom: 60, left: -30, right: -10 }, SIZE, VIEWPORT).left).toBe(
      4,
    );
  });
});
