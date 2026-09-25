/**
 * The arithmetic behind every numeric field: nudge by key, scrub by drag, clamp, and the fill bar.
 *
 * Pure, so the rules are pinned here rather than inferred from pointer events in jsdom: one arrow
 * press is one step, Shift is ten, a drag moves one step per `PIXELS_PER_STEP` pixels, a bounded
 * field never leaves its bounds by nudging or scrubbing, and a value written as `1.25` keeps two
 * decimals instead of drifting into `1.2600000000000002`.
 */

import { describe, expect, it } from 'vitest';
import {
  COARSE_FACTOR,
  PIXELS_PER_STEP,
  clampValue,
  fillFraction,
  nudgeValue,
  scrubValue,
  stepFor,
} from './scrub.js';

describe('stepFor', () => {
  it('is the precision the value is written at', () => {
    expect(stepFor('12')).toBe(1);
    expect(stepFor('0.8')).toBe(0.1);
    expect(stepFor('1.25')).toBe(0.01);
    expect(stepFor('-3')).toBe(1);
  });

  it('falls back to a whole step for anything that is not a number', () => {
    expect(stepFor('')).toBe(1);
    expect(stepFor('abc')).toBe(1);
  });
});

describe('clampValue', () => {
  it('holds a value inside whichever bounds exist', () => {
    expect(clampValue(-4, { min: 0 })).toBe(0);
    expect(clampValue(70, { min: 0, max: 64 })).toBe(64);
    expect(clampValue(12, { min: 0, max: 64 })).toBe(12);
    expect(clampValue(-500, {})).toBe(-500);
  });
});

describe('nudgeValue', () => {
  it('moves one step per press, and Shift moves ten', () => {
    expect(nudgeValue(34, 1, false, 1, {})).toBe(35);
    expect(nudgeValue(34, -1, false, 1, {})).toBe(33);
    expect(nudgeValue(34, 1, true, 1, {})).toBe(34 + COARSE_FACTOR);
    expect(nudgeValue(34, -1, true, 1, {})).toBe(24);
  });

  it('stops at a bound instead of passing it', () => {
    expect(nudgeValue(60, 1, true, 1, { min: 0, max: 64 })).toBe(64);
    expect(nudgeValue(3, -1, true, 1, { min: 0, max: 64 })).toBe(0);
    expect(nudgeValue(1, -1, false, 1, { min: 1 })).toBe(1);
  });

  it('keeps the precision of a fractional step', () => {
    expect(nudgeValue(1.25, 1, false, 0.01, {})).toBe(1.26);
    expect(nudgeValue(0.3, 1, false, 0.1, {})).toBe(0.4);
    expect(nudgeValue(0.3, 1, true, 0.1, {})).toBe(1.3);
  });

  it('starts an empty field from its floor, or zero', () => {
    expect(nudgeValue(Number.NaN, 1, false, 1, { min: 1 })).toBe(2);
    expect(nudgeValue(Number.NaN, 1, false, 1, {})).toBe(1);
  });
});

describe('scrubValue', () => {
  it('moves one step per PIXELS_PER_STEP pixels of drag, either way', () => {
    expect(scrubValue(34, 10 * PIXELS_PER_STEP, false, 1, {})).toBe(44);
    expect(scrubValue(34, -10 * PIXELS_PER_STEP, false, 1, {})).toBe(24);
  });

  it('ignores a partial step, so a hand that is nearly still does not change the value', () => {
    expect(scrubValue(34, PIXELS_PER_STEP - 1, false, 1, {})).toBe(34);
    expect(scrubValue(34, -(PIXELS_PER_STEP - 1), false, 1, {})).toBe(34);
  });

  it('moves ten steps per step of drag with Shift', () => {
    expect(scrubValue(34, 2 * PIXELS_PER_STEP, true, 1, {})).toBe(54);
  });

  it('clamps to the bounds however far the drag goes', () => {
    expect(scrubValue(12, 1000, false, 1, { min: 0, max: 48 })).toBe(48);
    expect(scrubValue(12, -1000, false, 1, { min: 0, max: 48 })).toBe(0);
  });

  it('keeps the precision of a fractional step', () => {
    expect(scrubValue(1.25, 3 * PIXELS_PER_STEP, false, 0.01, {})).toBe(1.28);
  });

  it('starts an empty field from its floor, or zero', () => {
    expect(scrubValue(Number.NaN, 4 * PIXELS_PER_STEP, false, 1, { min: 0 })).toBe(4);
  });
});

describe('fillFraction', () => {
  it('is where the value sits in its range, from 0 to 1', () => {
    expect(fillFraction(0, 0, 64)).toBe(0);
    expect(fillFraction(16, 0, 64)).toBe(0.25);
    expect(fillFraction(64, 0, 64)).toBe(1);
  });

  it('is full past the end and empty before the start or for a non-number', () => {
    expect(fillFraction(90, 0, 64)).toBe(1);
    expect(fillFraction(-3, 0, 64)).toBe(0);
    expect(fillFraction(Number.NaN, 0, 64)).toBe(0);
  });
});
