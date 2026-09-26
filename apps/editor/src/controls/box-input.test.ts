/**
 * What an author may type into a padding or radius field, and what is refused with which words.
 */

import { describe, expect, it } from 'vitest';
import { parseBoxInput, shiftQuad } from './box-input.js';

describe('parseBoxInput', () => {
  it('reads CSS shorthand: all, vertical horizontal, top horizontal bottom, top right bottom left', () => {
    expect(parseBoxInput('8', 'sides')).toEqual({ ok: true, quad: [8, 8, 8, 8] });
    expect(parseBoxInput('8 16', 'sides')).toEqual({ ok: true, quad: [8, 16, 8, 16] });
    expect(parseBoxInput('8 16 4', 'sides')).toEqual({ ok: true, quad: [8, 16, 4, 16] });
    expect(parseBoxInput('8 16 4 2', 'sides')).toEqual({ ok: true, quad: [8, 16, 4, 2] });
  });

  it('takes pasted CSS, with px, and Figma-style commas', () => {
    expect(parseBoxInput('  8px 16px ', 'sides')).toEqual({ ok: true, quad: [8, 16, 8, 16] });
    expect(parseBoxInput('1, 2, 3, 4', 'corners')).toEqual({ ok: true, quad: [1, 2, 3, 4] });
  });

  it('refuses each kind of mistake with words that say what to do', () => {
    const refused = (text: string, kind: 'sides' | 'corners' = 'sides'): string => {
      const result = parseBoxInput(text, kind);
      if (result.ok) throw new Error(`accepted ${text}`);
      return result.message;
    };

    expect(refused('')).toMatch(/1 to 4 numbers/);
    expect(refused('1 2 3 4 5')).toMatch(/at most 4 values: top right bottom left/);
    expect(refused('1 2 3 4 5', 'corners')).toMatch(
      /at most 4 values: top-left top-right bottom-right bottom-left/,
    );
    expect(refused('8 -2')).toMatch(/cannot be negative/);
    expect(refused('1.5')).toMatch(/whole layout pixels/);
    expect(refused('2em')).toMatch(/"2em".*px/);
    expect(refused('8 / 4', 'corners')).toMatch(/elliptical/);
    expect(refused('abc')).toMatch(/"abc" is not a number/);
  });
});

describe('shiftQuad', () => {
  it('moves every side by the same amount, keeping their differences', () => {
    expect(shiftQuad([8, 16, 4, 2], 2, { min: 0, max: 48 })).toEqual([10, 18, 6, 4]);
  });

  it('stops each side at the floor rather than going negative', () => {
    expect(shiftQuad([8, 16, 4, 2], -5, { min: 0, max: 48 })).toEqual([3, 11, 0, 0]);
  });

  it('stops at the ceiling, but never pulls down a side already typed past it', () => {
    expect(shiftQuad([40, 60, 40, 60], 10, { min: 0, max: 48 })).toEqual([48, 60, 48, 60]);
  });
});
