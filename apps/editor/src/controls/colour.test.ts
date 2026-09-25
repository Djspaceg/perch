/**
 * Alpha as a percentage, for the popover's opacity field.
 *
 * The document holds `#rrggbbaa`; a person asks for "50%". These two functions are the whole bridge,
 * and 50% has to land on `80`, the pair every other tool writes for half.
 */

import { describe, expect, it } from 'vitest';
import { alphaPercent, expandHex, withAlphaPercent } from './colour.js';

describe('expandHex', () => {
  it('spells a short colour out in full, and leaves a full one alone', () => {
    expect(expandHex('#abc')).toBe('#aabbcc');
    expect(expandHex('#abcd')).toBe('#aabbccdd');
    expect(expandHex('#1a2b3c')).toBe('#1a2b3c');
    expect(expandHex(' #1a2b3c80 ')).toBe('#1a2b3c80');
  });
});

describe('alphaPercent', () => {
  it('reads the alpha pair as a whole percentage', () => {
    expect(alphaPercent('#1a2b3c80')).toBe(50);
    expect(alphaPercent('#00000000')).toBe(0);
    expect(alphaPercent('#1a2b3cff')).toBe(100);
    expect(alphaPercent('#abc8')).toBe(53);
  });

  it('calls a colour with no alpha pair solid', () => {
    expect(alphaPercent('#1a2b3c')).toBe(100);
    expect(alphaPercent('#abc')).toBe(100);
  });
});

describe('withAlphaPercent', () => {
  it('writes the percentage as the alpha pair, 50% as 80', () => {
    expect(withAlphaPercent('#1a2b3c', 50)).toBe('#1a2b3c80');
    expect(withAlphaPercent('#1a2b3cff', 0)).toBe('#1a2b3c00');
    expect(withAlphaPercent('#1a2b3c00', 100)).toBe('#1a2b3cff');
  });

  it('expands a short colour first, and clamps the percentage', () => {
    expect(withAlphaPercent('#abc', 50)).toBe('#aabbcc80');
    expect(withAlphaPercent('#1a2b3c', 140)).toBe('#1a2b3cff');
    expect(withAlphaPercent('#1a2b3c', -5)).toBe('#1a2b3c00');
  });
});
