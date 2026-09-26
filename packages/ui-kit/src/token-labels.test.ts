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
import { CANVAS_RESOLVED_TOKENS, CANVAS_TOKEN_DEFAULTS } from './layout-canvas.js';
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

/** An `#rrggbbaa` or `#rgba` literal: what an alpha-capable colour control can drive. */
const HEX_ALPHA = /^#([0-9a-fA-F]{4}|[0-9a-fA-F]{8})$/;

/** The tokens read by each element's own box, rather than by the canvas or a widget. */
const BOX_TOKENS = new Set<string>(['--perch-box-bg', '--perch-box-radius', '--perch-box-padding']);

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
      // The box tokens are read by each element's own box rather than by a widget inside it, and an
      // element pane can set them: a third level, neither the canvas nor a widget.
      expect(PERCH_TOKEN_LABELS[name].scope, name).toBe(BOX_TOKENS.has(name) ? 'box' : 'widget');
    }
  });

  it('marks exactly the element-box tokens as box-scoped, in the appearance group', () => {
    const boxScoped = PERCH_KNOWN_TOKENS.filter((name) => PERCH_TOKEN_LABELS[name].scope === 'box');

    expect(new Set(boxScoped)).toEqual(BOX_TOKENS);
    for (const name of boxScoped) expect(PERCH_TOKEN_LABELS[name].group, name).toBe('appearance');
  });

  it('groups by what a token is about, in the order an author meets the groups', () => {
    expect(TOKEN_GROUPS.map((group) => [group.group, group.title])).toEqual([
      ['appearance', 'Appearance'],
      ['placement', 'Placement'],
      ['typography', 'Typography'],
      ['colour', 'Colour'],
    ]);
    expect(PERCH_TOKEN_LABELS['--perch-fg'].group).toBe('colour');
    expect(PERCH_TOKEN_LABELS['--perch-text-transform'].group).toBe('typography');
    expect(PERCH_TOKEN_LABELS['--perch-text-align'].group).toBe('typography');
    expect(PERCH_TOKEN_LABELS['--perch-canvas-bg'].group).toBe('appearance');
    expect(PERCH_TOKEN_LABELS['--perch-media-opacity'].group).toBe('appearance');
  });

  it('marks the rarely tuned tokens advanced, and keeps them in the group they belong to', () => {
    const advanced = PERCH_KNOWN_TOKENS.filter(
      (name) => PERCH_TOKEN_LABELS[name].advanced === true,
    );

    expect([...advanced].sort()).toEqual(
      [
        '--perch-alert',
        '--perch-chart-area-opacity',
        '--perch-chart-axis-size',
        '--perch-faint',
        '--perch-media-opacity',
        '--perch-stale',
        '--perch-text-line-height',
        '--perch-text-tracking',
        '--perch-value-size-max',
        '--perch-value-size-min',
        '--perch-warn',
      ].sort(),
    );
    // Nothing a placement grid draws is hidden: the grid is one control, and half of it cannot fold.
    for (const name of advanced) expect(PERCH_TOKEN_LABELS[name].group, name).not.toBe('placement');
  });

  it('pairs each placement with its other axis, both ways, in the placement group', () => {
    const placed = PERCH_KNOWN_TOKENS.filter(
      (name) => PERCH_TOKEN_LABELS[name].placement !== undefined,
    );

    expect([...placed].sort()).toEqual(
      [
        '--perch-readout-anchor',
        '--perch-readout-justify',
        '--perch-text-anchor',
        '--perch-text-justify',
      ].sort(),
    );
    for (const name of placed) {
      const entry = PERCH_TOKEN_LABELS[name];
      const pair = entry.placement?.pair;
      expect(entry.group, name).toBe('placement');
      expect(pair, name).toBeDefined();
      if (pair === undefined) continue;
      const other = PERCH_TOKEN_LABELS[pair];
      expect(other.placement?.pair, name).toBe(name);
      expect(other.placement?.axis, name).not.toBe(entry.placement?.axis);
      expect(other.kinds, name).toEqual(entry.kinds);
    }
    for (const name of PERCH_KNOWN_TOKENS) {
      if (PERCH_TOKEN_LABELS[name].group === 'placement') {
        expect(PERCH_TOKEN_LABELS[name].placement, name).toBeDefined();
      }
    }
  });

  it('gives the box background an alpha channel and nothing else one', () => {
    for (const name of PERCH_KNOWN_TOKENS) {
      expect(PERCH_TOKEN_LABELS[name].alpha === true, name).toBe(name === '--perch-box-bg');
    }
  });

  it('bounds every pixel slider, and puts its default inside the bounds', () => {
    for (const name of PERCH_KNOWN_TOKENS) {
      const entry = PERCH_TOKEN_LABELS[name];
      if (entry.control !== 'pixels') {
        // A range is a pixel control's, or a unitless number's that has one (an opacity, a weight).
        if (entry.control !== 'number') expect(entry.range, name).toBeUndefined();
        continue;
      }

      const range = entry.range;
      expect(range, name).toBeDefined();
      const value = Number(knownTokenDefault(name));
      expect(Number.isInteger(value), name).toBe(true);
      expect(value, name).toBeGreaterThanOrEqual(range?.min ?? Infinity);
      expect(value, name).toBeLessThanOrEqual(range?.max ?? -Infinity);
    }
    expect(PERCH_TOKEN_LABELS['--perch-box-radius'].range).toEqual({ min: 0, max: 64 });
    expect(PERCH_TOKEN_LABELS['--perch-box-padding'].range).toEqual({ min: 0, max: 48 });
  });

  it('marks the tokens the canvas reads as a box shorthand, and only those', () => {
    for (const name of PERCH_KNOWN_TOKENS) {
      const shorthand = PERCH_TOKEN_LABELS[name].shorthand;
      expect(shorthand !== undefined, name).toBe(
        (CANVAS_RESOLVED_TOKENS as readonly string[]).includes(name),
      );
    }
    expect(PERCH_TOKEN_LABELS['--perch-box-radius'].shorthand).toBe('corners');
    expect(PERCH_TOKEN_LABELS['--perch-box-padding'].shorthand).toBe('sides');
  });

  it('says which element kinds read an alignment, so a kind it means nothing to is not offered it', () => {
    expect(PERCH_TOKEN_LABELS['--perch-readout-justify'].kinds).toEqual(['widget']);
    expect(PERCH_TOKEN_LABELS['--perch-readout-anchor'].kinds).toEqual(['widget']);
    expect(PERCH_TOKEN_LABELS['--perch-text-justify'].kinds).toEqual(['text']);
    expect(PERCH_TOKEN_LABELS['--perch-text-anchor'].kinds).toEqual(['text']);
    // No alignment is offered to a chart at all: its plot fills the box by arithmetic.
    for (const name of PERCH_KNOWN_TOKENS) {
      expect(PERCH_TOKEN_LABELS[name].kinds ?? [], name).not.toContain('chart');
    }
  });

  it('names every option of a closed vocabulary that carries option labels', () => {
    for (const name of PERCH_KNOWN_TOKENS) {
      const entry = PERCH_TOKEN_LABELS[name];
      if (entry.optionLabels === undefined) continue;

      expect(Object.keys(entry.optionLabels).sort(), name).toEqual(
        [...(entry.options ?? [])].sort(),
      );
    }
    expect(PERCH_TOKEN_LABELS['--perch-readout-justify'].optionLabels).toEqual({
      start: 'left',
      center: 'centre',
      end: 'right',
    });
  });

  it('gives each token a control that can hold the default this package ships', () => {
    for (const name of PERCH_KNOWN_TOKENS) {
      const entry = PERCH_TOKEN_LABELS[name];
      const value = knownTokenDefault(name);

      expect(value, name).toBeDefined();
      const declared = value ?? '';

      switch (entry.control) {
        case 'colour':
          expect(declared, name).toMatch(entry.alpha === true ? HEX_ALPHA : HEX);
          break;
        case 'pixels':
          expect(declared, name).toMatch(/^\d+$/);
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

describe('the numeric metadata', () => {
  it('bounds an opacity from 0 to 1 and a weight from 100 to 900, defaults inside', () => {
    for (const name of ['--perch-media-opacity', '--perch-chart-area-opacity'] as const) {
      expect(PERCH_TOKEN_LABELS[name].range, name).toEqual({ min: 0, max: 1 });
    }
    for (const name of ['--perch-value-weight', '--perch-text-weight'] as const) {
      expect(PERCH_TOKEN_LABELS[name].range, name).toEqual({ min: 100, max: 900 });
      expect(PERCH_TOKEN_LABELS[name].step, name).toBe(100);
    }
    for (const name of PERCH_KNOWN_TOKENS) {
      const entry = PERCH_TOKEN_LABELS[name];
      if (entry.control !== 'number' || entry.range === undefined) continue;
      const value = Number(knownTokenDefault(name));
      expect(value, name).toBeGreaterThanOrEqual(entry.range.min);
      expect(value, name).toBeLessThanOrEqual(entry.range.max);
    }
  });

  it('gives a step only to a numeric control, and a positive one', () => {
    for (const name of PERCH_KNOWN_TOKENS) {
      const entry = PERCH_TOKEN_LABELS[name];
      if (entry.step === undefined) continue;
      expect(['number', 'pixels', 'length'], name).toContain(entry.control);
      expect(entry.step, name).toBeGreaterThan(0);
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
