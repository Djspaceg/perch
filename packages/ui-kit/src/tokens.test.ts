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
import { LINE_CHART_STYLES } from './line-chart.js';
import { MEDIA_FRAME_STYLES } from './media-frame.js';
import { READOUT_STYLES } from './readout.js';
import { TEXT_BLOCK_STYLES } from './text-block.js';
import { PERCH_TOKENS, PERCH_TOKEN_DEFAULTS, token, type PerchToken } from './tokens.js';

/** Every sheet this package ships, so a new one is covered by being added here. */
const SHEETS: Readonly<Record<string, string>> = {
  READOUT_STYLES,
  TEXT_BLOCK_STYLES,
  MEDIA_FRAME_STYLES,
  LINE_CHART_STYLES,
};

const ALL_SHEETS = Object.values(SHEETS).join('\n');

/** Every custom-property reference in a sheet, as `[name, fallback]`. */
function references(sheet: string): { name: string; fallback: string | undefined }[] {
  return [...sheet.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^)]*))?\)/g)].map((match) => ({
    name: match[1] ?? '',
    fallback: match[2],
  }));
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
  it('is read in full: every declared token is referenced by some sheet', () => {
    const referenced = new Set(references(ALL_SHEETS).map((reference) => reference.name));

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
