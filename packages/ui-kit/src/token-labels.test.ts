/**
 * The labels table, checked against the vocabulary it claims to describe.
 *
 * `tokens.test.ts` guards the tokens themselves — a `var()` with no fallback, a token nothing reads.
 * This file guards the *second* record that has to agree with them, and the failures it prevents are
 * the ones a labels table invites:
 *
 * 1. **A token with no label.** The editor's consumer-facing pane is driven by this table, so a token
 *    missing from it is a token an author cannot see at all — a silently smaller theme.
 * 2. **A label for a token that does not exist.** A row offering `--perch-shadow` would let an author
 *    write an override no widget reads, and the way they find out is a panel that ignored them.
 * 3. **A control that cannot hold the token's own default.** A colour picker on `--perch-font`, or a
 *    closed select whose options omit the value this package ships. The table declares a control per
 *    token, and the declared default is the one value every control must be able to represent — if it
 *    cannot show that, it cannot show what the author is about to change.
 */

import { describe, expect, it } from 'vitest';
import { CANVAS_TOKEN_DEFAULTS } from './layout-canvas.js';
import { PERCH_TOKEN_DEFAULTS } from './tokens.js';
import {
  PERCH_KNOWN_TOKENS,
  PERCH_TOKEN_LABELS,
  TOKEN_GROUPS,
  knownTokenDefault,
  tokenLabel,
  type KnownToken,
} from './token-labels.js';

/** Every token a layout's `theme` can meaningfully set: the widget vocabulary and the canvas' own. */
const DECLARED: readonly string[] = [
  ...Object.keys(PERCH_TOKEN_DEFAULTS),
  ...Object.keys(CANVAS_TOKEN_DEFAULTS),
];

/** A `#rgb` or `#rrggbb` literal: what a hex colour control can drive. */
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** A number with a CSS length unit, which is all the length control claims to parse. */
const LENGTH = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]+)$/;

describe('the labels table', () => {
  it('labels every declared token and invents none', () => {
    expect([...PERCH_KNOWN_TOKENS].sort()).toEqual([...DECLARED].sort());
    expect(Object.keys(PERCH_TOKEN_LABELS).sort()).toEqual([...DECLARED].sort());
  });

  it('gives each token a readable name that is not the token name again', () => {
    const seen = new Set<string>();

    for (const name of PERCH_KNOWN_TOKENS) {
      const entry = PERCH_TOKEN_LABELS[name];

      expect(entry.label, name).not.toBe('');
      // A label that spells the custom property is a label that has not been written yet: the whole
      // point of the table is that the pane has something to say other than `--perch-chart-axis-size`.
      expect(entry.label, name).not.toContain('--');
      expect(seen.has(entry.label), `duplicate label ${entry.label}`).toBe(false);
      seen.add(entry.label);

      expect(entry.description, name).not.toBe('');
    }
  });

  it('places every token in a declared group, and leaves no group empty', () => {
    const groups = new Set(TOKEN_GROUPS.map((group) => group.group));
    const used = new Set(PERCH_KNOWN_TOKENS.map((name) => PERCH_TOKEN_LABELS[name].group));

    for (const name of PERCH_KNOWN_TOKENS) {
      expect(groups, name).toContain(PERCH_TOKEN_LABELS[name].group);
    }
    for (const group of groups) {
      expect(used, `no token in group ${group}`).toContain(group);
    }
  });

  it('says where each token is read, so an element pane can leave out what an element cannot change', () => {
    for (const name of Object.keys(CANVAS_TOKEN_DEFAULTS) as KnownToken[]) {
      expect(PERCH_TOKEN_LABELS[name].scope, name).toBe('canvas');
    }
    for (const name of Object.keys(PERCH_TOKEN_DEFAULTS) as KnownToken[]) {
      expect(PERCH_TOKEN_LABELS[name].scope, name).toBe('widget');
    }
  });

  it('gives each token a control that can hold the default this package ships', () => {
    for (const name of PERCH_KNOWN_TOKENS) {
      const entry = PERCH_TOKEN_LABELS[name];
      const value = knownTokenDefault(name);

      expect(value, name).toBeDefined();
      const declared = value ?? '';

      switch (entry.control) {
        case 'colour':
          expect(declared, name).toMatch(HEX);
          break;
        case 'length':
          expect(declared, name).toMatch(LENGTH);
          break;
        case 'number':
          expect(Number.isFinite(Number(declared)), `${name}: ${declared}`).toBe(true);
          break;
        case 'choice':
          expect(entry.options ?? [], name).toContain(declared);
          break;
        case 'text':
          expect(declared, name).not.toBe('');
          break;
        default:
          throw new Error(`${name}: unhandled control ${String(entry.control)}`);
      }
    }
  });

  it('gives a closed control a closed vocabulary, and an open one none', () => {
    for (const name of PERCH_KNOWN_TOKENS) {
      const entry = PERCH_TOKEN_LABELS[name];

      if (entry.control === 'choice') {
        const options = entry.options ?? [];
        expect(options.length, name).toBeGreaterThan(1);
        expect(new Set(options).size, `duplicate option in ${name}`).toBe(options.length);
      } else {
        expect(entry.options, name).toBeUndefined();
      }
    }
  });

  it('offers a length control the unit its own default is written in', () => {
    for (const name of PERCH_KNOWN_TOKENS) {
      const entry = PERCH_TOKEN_LABELS[name];
      if (entry.control !== 'length') continue;

      const unit = LENGTH.exec(knownTokenDefault(name) ?? '')?.[2] ?? '';
      expect(entry.units ?? [], name).toContain(unit);
    }
  });
});

describe('tokenLabel', () => {
  it('answers for a token this package declares', () => {
    expect(tokenLabel('--perch-fg')).toBe(PERCH_TOKEN_LABELS['--perch-fg']);
    expect(tokenLabel('--perch-canvas-bg')).toBe(PERCH_TOKEN_LABELS['--perch-canvas-bg']);
  });

  it('answers nothing for a name it does not know, rather than guessing one', () => {
    // A layout may set any well-formed custom property — `validateTokenMap` permits it — so the
    // caller needs "no label" as an answer it can render, not an exception and not a fabricated name.
    expect(tokenLabel('--brand-hue')).toBeUndefined();
    expect(tokenLabel('--perch-fg ')).toBeUndefined();
    expect(knownTokenDefault('--brand-hue')).toBeUndefined();
  });
});
