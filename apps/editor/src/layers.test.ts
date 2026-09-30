/**
 * Paint order as layers: the list row of an element, where a command sends it, and where a drop in a
 * gap of the list lands it.
 */

import { describe, expect, it } from 'vitest';
import { autoscrollStep, dropTarget, gapAt, layerTarget, listRow } from './layers.js';

describe('listRow', () => {
  it('puts the last element on the top row, and is its own inverse', () => {
    expect([0, 1, 2, 3].map((index) => listRow(index, 4))).toEqual([3, 2, 1, 0]);
    expect(listRow(listRow(1, 4), 4)).toBe(1);
  });
});

describe('layerTarget', () => {
  it('moves one layer, or to either end, and says null where it is already as far as it goes', () => {
    expect(layerTarget('bringForward', 1, 4)).toBe(2);
    expect(layerTarget('sendBackward', 1, 4)).toBe(0);
    expect(layerTarget('bringToFront', 1, 4)).toBe(3);
    expect(layerTarget('sendToBack', 1, 4)).toBe(0);
    expect(layerTarget('bringForward', 3, 4)).toBeNull();
    expect(layerTarget('bringToFront', 3, 4)).toBeNull();
    expect(layerTarget('sendBackward', 0, 4)).toBeNull();
    expect(layerTarget('sendToBack', 0, 4)).toBeNull();
    expect(layerTarget('bringForward', -1, 4)).toBeNull();
  });
});

describe('gapAt', () => {
  const rows = [0, 1, 2].map((row) => ({ top: row * 20, bottom: row * 20 + 20 }));

  it('counts the rows whose middle is above the pointer', () => {
    expect(gapAt(-5, rows)).toBe(0);
    expect(gapAt(9, rows)).toBe(0);
    expect(gapAt(11, rows)).toBe(1);
    expect(gapAt(59, rows)).toBe(3);
  });
});

describe('dropTarget', () => {
  // Four elements; list rows top to bottom are elements 3, 2, 1, 0.
  it('turns a gap of the list into an index in elements', () => {
    expect(dropTarget(0, 0, 4)).toBe(3);
    expect(dropTarget(0, 1, 4)).toBe(2);
    expect(dropTarget(3, 4, 4)).toBe(0);
    expect(dropTarget(3, 2, 4)).toBe(2);
  });

  it('is null either side of the row it came from, and outside the list', () => {
    expect(dropTarget(1, 2, 4)).toBeNull();
    expect(dropTarget(1, 3, 4)).toBeNull();
    expect(dropTarget(1, 5, 4)).toBeNull();
  });
});

describe('autoscrollStep', () => {
  it('scrolls up near the top and down near the bottom, faster nearer the edge', () => {
    expect(autoscrollStep(200, 0, 400)).toBe(0);
    expect(autoscrollStep(2, 0, 400)).toBeLessThan(autoscrollStep(20, 0, 400));
    expect(autoscrollStep(20, 0, 400)).toBeLessThan(0);
    expect(autoscrollStep(398, 0, 400)).toBeGreaterThan(autoscrollStep(380, 0, 400));
    expect(autoscrollStep(380, 0, 400)).toBeGreaterThan(0);
  });
});
