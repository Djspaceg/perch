/**
 * The theme vocabulary, checked against the sheets that are supposed to read it.
 *
 * Two failures are being prevented, and neither is hypothetical:
 *
 * 1. **A `var()` with no fallback.** A layout with `theme: {}` is legal and common, so an
 *    unfallbacked reference renders as nothing — a blank rectangle on a panel, which reads as a
 *    broken binding rather than as a missing token.
 * 2. **A token nothing reads.** A documented token that no sheet mentions is a promise to an author
 *    that their theme will do something, and the way they find out it does not is by looking at a
 *    panel that ignored them.
 */

import { describe, expect, it } from 'vitest';
import {
  CANVAS_RESOLVED_TOKENS,
  ELEMENT_BOX_STYLES,
  LAYOUT_CANVAS_STYLES,
} from './layout-canvas.js';
import { LINE_CHART_STYLES } from './line-chart.js';
import { MEDIA_FRAME_STYLES } from './media-frame.js';
import { READOUT_GLYPH_PROPERTIES, READOUT_STYLES } from './readout.js';
import { TEXT_BLOCK_STYLES } from './text-block.js';
import { PERCH_TOKENS, PERCH_TOKEN_DEFAULTS, token, type PerchToken } from './tokens.js';
import { PERCH_KNOWN_TOKENS, PERCH_TOKEN_LABELS } from './token-labels.js';

/** Every sheet this package ships, so a new one is covered by being added here. */
const SHEETS: Readonly<Record<string, string>> = {
  READOUT_STYLES,
  TEXT_BLOCK_STYLES,
  MEDIA_FRAME_STYLES,
  LINE_CHART_STYLES,
  // The element box is a sheet too: it is where the box tokens are read, once per element.
  ELEMENT_BOX_STYLES,
};

const ALL_SHEETS = Object.values(SHEETS).join('\n');

/**
 * Properties a component writes on its own element for its own sheet. Not tokens: no layout sets
 * them, so they are neither declared nor held to a token's default.
 */
const COMPONENT_PROPERTIES: ReadonlySet<string> = new Set(READOUT_GLYPH_PROPERTIES);

/** Every token reference in a sheet, as `[name, fallback]`. */
function references(sheet: string): { name: string; fallback: string | undefined }[] {
  return [...sheet.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^)]*))?\)/g)]
    .map((match) => ({
      name: match[1] ?? '',
      fallback: match[2],
    }))
    .filter((reference) => !COMPONENT_PROPERTIES.has(reference.name));
}

describe('token()', () => {
  it('renders a reference carrying the declared default', () => {
    expect(token('--perch-fg')).toBe(`var(--perch-fg, ${PERCH_TOKEN_DEFAULTS['--perch-fg']})`);
  });

  it('enumerates exactly the declared tokens', () => {
    expect([...PERCH_TOKENS].sort()).toEqual(Object.keys(PERCH_TOKEN_DEFAULTS).sort());
  });

  it('names every token as a CSS custom property the layout format would accept', () => {
    for (const name of PERCH_TOKENS) {
      // `layout-schema`'s own rule for a theme key: two hyphens, then the conservative identifier
      // subset, at most 64 characters. A token this package invented outside that set could never
      // be set by a layout at all.
      expect(name).toMatch(/^--[A-Za-z0-9_-]+$/);
      expect(name.length).toBeLessThanOrEqual(64);
    }
  });

  it('gives every token a default that a layout could also have written', () => {
    for (const name of PERCH_TOKENS) {
      const value = PERCH_TOKEN_DEFAULTS[name];
      expect(value).not.toBe('');
      // The token-value rules from `layout-schema`: no character that could end the declaration it
      // is written into, and no `url()`, because media is referenced by an element and copied by
      // the bundle build. A default this package could not accept from an author would be a
      // vocabulary an author cannot fully use.
      expect(value).not.toMatch(/[;{}<>\\]/);
      expect(value).not.toMatch(/url\s*\(/i);
      expect(value.length).toBeLessThanOrEqual(256);
    }
  });
});

describe.each(Object.entries(SHEETS))('%s', (_name, sheet) => {
  it('reads only declared tokens', () => {
    const declared = new Set<string>(PERCH_TOKENS);

    for (const reference of references(sheet)) {
      expect(declared, `undeclared token ${reference.name}`).toContain(reference.name);
    }
  });

  it('carries each token default in the reference itself, so an unthemed layout still paints', () => {
    for (const reference of references(sheet)) {
      expect(reference.fallback, `no fallback for ${reference.name}`).toBe(
        PERCH_TOKEN_DEFAULTS[reference.name as PerchToken],
      );
    }
  });
});

describe('the vocabulary as a whole', () => {
  it('is read in full: every declared token is referenced by some sheet, or resolved by the canvas', () => {
    // Radius and padding take a one-to-four-value shorthand, which no `calc()` can turn into px, so
    // the canvas reads them and writes native declarations; see `CANVAS_RESOLVED_TOKENS`.
    const referenced = new Set<string>([
      ...references(ALL_SHEETS).map((reference) => reference.name),
      ...CANVAS_RESOLVED_TOKENS,
    ]);

    for (const name of PERCH_TOKENS) {
      expect(referenced, `declared but unread: ${name}`).toContain(name);
    }
  });

  it('leaves no literal hex colour in any sheet, so a theme can reach every colour', () => {
    // The whole point of the vocabulary. A hex left behind is a colour a layout cannot change, and
    // the way that surfaces is one widget staying dark inside a light theme.
    const hexOutsideFallbacks = ALL_SHEETS.replace(
      /var\(\s*--[A-Za-z0-9_-]+\s*,[^)]*\)/g,
      'var(--x)',
    );

    expect(hexOutsideFallbacks).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

/**
 * A colour token may hold any alpha (the editor's colour control writes `#rrggbbaa` for every one), so
 * every sheet must write it straight into a property that paints that alpha: never into a function
 * that would need the channels apart, and never into something JavaScript reads back.
 */
describe('a translucent colour token', () => {
  const COLOURS = new Set<string>(
    PERCH_KNOWN_TOKENS.filter((name) => PERCH_TOKEN_LABELS[name].control === 'colour'),
  );
  /** The properties that take any `<color>`, alpha and all, and paint it. */
  const PAINTS_ALPHA = new Set(['color', 'background', 'background-color', 'fill', 'stroke']);
  const everySheet = `${ALL_SHEETS}\n${LAYOUT_CANVAS_STYLES}`;

  it('is read somewhere, so the check below is not vacuous', () => {
    const read = [...everySheet.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)]
      .map((match) => match[1] ?? '')
      .filter((name) => COLOURS.has(name));

    expect(new Set(read).size).toBeGreaterThan(10);
  });

  it('is written only as the whole value of a property that paints its alpha', () => {
    for (const declaration of everySheet.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)) {
      const [, property = '', value = ''] = declaration;
      const colour = [...value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].find((match) =>
        COLOURS.has(match[1] ?? ''),
      );
      if (colour === undefined) continue;

      expect(PAINTS_ALPHA.has(property), `${property}: ${value}`).toBe(true);
      expect(value.trim().startsWith('var('), `${property}: ${value}`).toBe(true);
    }
  });
});
