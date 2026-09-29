/**
 * The static catalogue and the resolution rule (docs/backgrounds.md).
 */

import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_CATEGORIES,
  HOSTED_SIZES,
  backgroundIds,
  backgroundLabel,
  categoryOf,
  isCatalogued,
  pickHostedSize,
  sizeName,
} from '@perch/backgrounds';

describe('the catalogue', () => {
  it('is the six categories trcc-linux knows, with their counts', () => {
    expect(BACKGROUND_CATEGORIES.map((c) => [c.prefix, c.name, c.count])).toEqual([
      ['a', 'Gallery', 82],
      ['b', 'Tech', 25],
      ['c', 'HUD', 72],
      ['d', 'Light', 55],
      ['e', 'Nature', 54],
      ['y', 'Aesthetic', 10],
    ]);
  });

  it('numbers each category from 001', () => {
    const tech = BACKGROUND_CATEGORIES[1];
    expect(tech).toBeDefined();
    if (tech === undefined) return;
    const ids = backgroundIds(tech);
    expect(ids).toHaveLength(25);
    expect(ids[0]).toBe('b001');
    expect(ids.at(-1)).toBe('b025');
  });

  it('labels an id as its category and number', () => {
    expect(backgroundLabel('a042')).toBe('Gallery 42');
    expect(backgroundLabel('y010')).toBe('Aesthetic 10');
    expect(backgroundLabel('a083')).toBeUndefined();
  });

  it('knows which ids exist', () => {
    expect(isCatalogued('a082')).toBe(true);
    expect(isCatalogued('a083')).toBe(false);
    expect(isCatalogued('f001')).toBe(false);
    expect(isCatalogued('a000')).toBe(false);
    expect(categoryOf('c072')?.name).toBe('HUD');
  });
});

describe('HOSTED_SIZES', () => {
  it('is the 28 probed sizes, with no duplicate', () => {
    expect(HOSTED_SIZES).toHaveLength(28);
    expect(new Set(HOSTED_SIZES.map(sizeName)).size).toBe(28);
    expect(HOSTED_SIZES.map(sizeName)).toContain('1920x462');
  });
});

describe('pickHostedSize', () => {
  const pick = (width: number, height: number): string =>
    sizeName(pickHostedSize({ width, height }));

  it.each([
    [1920, 400, '1920x440'],
    [400, 1920, '440x1920'],
    [480, 480, '480x480'],
    [1920, 462, '1920x462'],
    [1920, 441, '1920x462'],
    [720, 1280, '720x1600'],
    [320, 240, '320x240'],
    // Least area is aspect-blind: 176x320 (56320) covers 100x100 in less area than 240x240 (57600),
    // and wins its area tie with 320x176 by list order.
    [100, 100, '176x320'],
  ])('covers %ix%i with the smallest size at least as large on both axes: %s', (w, h, want) => {
    expect(pick(w, h)).toBe(want);
  });

  it.each([
    // Nothing is 2560 wide. 1600x720: |ln 0.625| + 0 = 0.47; 1920x462: 0.29 + 0.44 = 0.73.
    [2560, 720, '1600x720'],
    // Nothing is taller than 1920 in portrait.
    [440, 2400, '440x1920'],
    // Nothing at all this size: 1920x462 (0.69 + 0.87) loses to 1600x720 (0.88 + 0.42).
    [3840, 1100, '1600x720'],
  ])('falls back to the closest in size when nothing covers %ix%i: %s', (w, h, want) => {
    expect(pick(w, h)).toBe(want);
  });

  it('breaks a tie in closeness by the smaller area', () => {
    // 200x200: neither covers it. Each is 2 ln 2 away; 100x100 has the smaller area.
    const sizes = [
      { width: 400, height: 100 },
      { width: 100, height: 100 },
    ];
    expect(sizeName(pickHostedSize({ width: 200, height: 200 }, sizes))).toBe('100x100');
  });
});
