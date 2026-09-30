/**
 * Alpha as a percentage, for the popover's opacity field.
 *
 * The document holds `#rrggbbaa`; a person asks for "50%". These two functions are the whole bridge,
 * and 50% has to land on `80`, the pair every other tool writes for half.
 */

import { describe, expect, it } from 'vitest';
import {
  alphaPercent,
  expandHex,
  formatColour,
  normaliseTyped,
  parseColour,
  withAlphaPercent,
} from './colour.js';

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
    expect(withAlphaPercent('#1a2b3c00', 100)).toBe('#1a2b3c');
  });

  it('expands a short colour first, and clamps the percentage', () => {
    expect(withAlphaPercent('#abc', 50)).toBe('#aabbcc80');
    expect(withAlphaPercent('#1a2b3c', 140)).toBe('#1a2b3c');
    expect(withAlphaPercent('#1a2b3c', -5)).toBe('#1a2b3c00');
  });
});

describe('parseColour', () => {
  it.each([
    ['#abc', { r: 170, g: 187, b: 204, a: 1 }],
    ['#abc8', { r: 170, g: 187, b: 204, a: 136 / 255 }],
    ['#1A2B3C', { r: 26, g: 43, b: 60, a: 1 }],
    ['#1a2b3c80', { r: 26, g: 43, b: 60, a: 128 / 255 }],
    [' rgb(26, 43, 60) ', { r: 26, g: 43, b: 60, a: 1 }],
    ['rgba(26, 43, 60, 0.5)', { r: 26, g: 43, b: 60, a: 0.5 }],
    ['rgb(26 43 60 / 50%)', { r: 26, g: 43, b: 60, a: 0.5 }],
    ['RGB(100%, 0%, 50%)', { r: 255, g: 0, b: 128, a: 1 }],
    ['rgba(300, -4, 60, 2)', { r: 255, g: 0, b: 60, a: 1 }],
    ['hsl(120, 100%, 50%)', { r: 0, g: 255, b: 0, a: 1 }],
    ['hsla(240, 100%, 50%, 0.25)', { r: 0, g: 0, b: 255, a: 0.25 }],
    ['hsl(0.5turn 100% 25% / 0.5)', { r: 0, g: 128, b: 128, a: 0.5 }],
    ['hsl(210deg 50% 40%)', { r: 51, g: 102, b: 153, a: 1 }],
    ['transparent', { r: 0, g: 0, b: 0, a: 0 }],
  ])('reads %s', (text, colour) => {
    expect(parseColour(text)).toEqual(colour);
  });

  it.each([
    ['#abcde'],
    ['#ggg'],
    ['rgb(1, 2)'],
    ['rgb(1, 2, 3, 4, 5)'],
    ['rgb(1, 2, 3'],
    ['hsl(1, 2, 3, 4, 5)'],
    ['red'],
    ['var(--perch-fg)'],
    [''],
  ])('refuses %s', (text) => {
    expect(parseColour(text)).toBeUndefined();
  });
});

describe('formatColour', () => {
  it('writes six digits for a solid colour and eight for a translucent one, lower case', () => {
    expect(formatColour({ r: 26, g: 43, b: 60, a: 1 })).toBe('#1a2b3c');
    expect(formatColour({ r: 26, g: 43, b: 60, a: 0.5 })).toBe('#1a2b3c80');
    expect(formatColour({ r: 255, g: 255, b: 255, a: 0 })).toBe('#ffffff00');
    // An alpha that rounds to ff is solid, so it has no pair.
    expect(formatColour({ r: 0, g: 0, b: 0, a: 0.999 })).toBe('#000000');
  });

  it('round-trips every hex spelling through parseColour, to its shortest faithful form', () => {
    for (const [text, shortest] of [
      ['#1a2b3c', '#1a2b3c'],
      ['#1A2B3C80', '#1a2b3c80'],
      ['#1a2b3cff', '#1a2b3c'],
      ['#abc', '#aabbcc'],
      ['#abc8', '#aabbcc88'],
      ['#00000000', '#00000000'],
    ] as const) {
      const colour = parseColour(text);
      expect(colour, text).toBeDefined();
      if (colour === undefined) continue;
      expect(formatColour(colour), text).toBe(shortest);
      expect(parseColour(formatColour(colour)), text).toEqual(colour);
    }
  });
});

describe('normaliseTyped', () => {
  it('writes a finished functional colour as hex, alpha included', () => {
    expect(normaliseTyped('rgba(26, 43, 60, 0.5)')).toBe('#1a2b3c80');
    expect(normaliseTyped('rgb(26 43 60)')).toBe('#1a2b3c');
    expect(normaliseTyped('hsla(240, 100%, 50%, 0.25)')).toBe('#0000ff40');
    expect(normaliseTyped('transparent')).toBe('#00000000');
  });

  it('drops an opaque alpha pair, which says nothing', () => {
    expect(normaliseTyped('#1A2B3CFF')).toBe('#1a2b3c');
  });

  it('leaves what is still being typed, and every shorter hex, as it was typed', () => {
    for (const text of [
      'rgb(26, 4',
      '#1a2',
      '#abc',
      '#abcd',
      '#1a2b3c',
      '#1a2b3c8',
      'hsl(',
      'var(--x)',
    ]) {
      expect(normaliseTyped(text), text).toBe(text);
    }
  });
});

describe('alpha through any spelling', () => {
  it('reads and sets the alpha of a functional colour, writing hex', () => {
    expect(alphaPercent('rgba(0, 0, 0, 0.5)')).toBe(50);
    expect(alphaPercent('hsl(0 0% 0% / 25%)')).toBe(25);
    expect(withAlphaPercent('rgb(26, 43, 60)', 50)).toBe('#1a2b3c80');
  });

  it('writes a colour set back to 100% as six digits, the shortest faithful form', () => {
    expect(withAlphaPercent('#1a2b3c80', 100)).toBe('#1a2b3c');
  });
});
