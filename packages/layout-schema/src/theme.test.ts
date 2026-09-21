/**
 * Theme tokens and per-element style overrides, which share one set of rules.
 */

import { describe, expect, it } from 'vitest';
import { validateLayout, type ValidateLayoutOptions } from '@perch/layout-schema';
import {
  codesOf,
  issueAt,
  layoutOf,
  layoutWith,
  layoutWithElements,
  TEST_WIDGETS,
} from './layout-fixture.test-support.js';

const options: ValidateLayoutOptions = { widgets: TEST_WIDGETS };

const withTheme = (theme: unknown): ReturnType<typeof validateLayout> =>
  validateLayout(layoutWith({ theme }), options);

const withStyle = (style: unknown): ReturnType<typeof validateLayout> =>
  validateLayout(
    layoutWithElements([{ kind: 'text', text: 'CPU', rect: { x: 0, y: 0, w: 100, h: 40 }, style }]),
    options,
  );

describe('theme tokens', () => {
  it('accepts an empty map, which states "I inherit the defaults"', () => {
    expect(layoutOf(withTheme({})).theme).toEqual({});
  });

  it.each([
    ['a hex colour', '#e6edf3'],
    ['a functional colour', 'rgb(13, 17, 23)'],
    ['a modern colour space', 'oklch(0.72 0.15 210)'],
    ['a length', '24px'],
    ['a font stack', 'JetBrains Mono, ui-monospace, monospace'],
    ['a number', '0.75'],
  ])('accepts %s as a value', (_why, value) => {
    expect(layoutOf(withTheme({ '--perch-x': value })).theme).toEqual({ '--perch-x': value });
  });

  it.each([
    ['no leading hyphens', 'fg'],
    ['one leading hyphen', '-fg'],
    ['nothing after the hyphens', '--'],
    ['a space', '--perch fg'],
    ['a colon', '--perch:fg'],
    ['a dot', '--perch.fg'],
  ])('rejects a key with %s', (_why, key) => {
    const issue = issueAt(withTheme({ [key]: '#fff' }), `theme[${JSON.stringify(key)}]`);

    expect(issue.code).toBe('malformed-theme-token');
    expect(issue.message).toMatch(/custom property/);
  });

  it('rejects a key longer than the ceiling', () => {
    const key = `--${'a'.repeat(63)}`;

    expect(issueAt(withTheme({ [key]: '#fff' }), `theme[${JSON.stringify(key)}]`).code).toBe(
      'malformed-theme-token',
    );
  });

  it.each([
    ['a number', 24, 'wrong-type'],
    ['null', null, 'wrong-type'],
    ['an object', {}, 'wrong-type'],
    ['an empty string', '', 'empty-string'],
  ])('rejects %s as a value', (_why, value, code) => {
    expect(issueAt(withTheme({ '--perch-x': value }), 'theme["--perch-x"]').code).toBe(code);
  });

  it.each([
    ['a semicolon, which ends the declaration', '#fff; position: fixed'],
    ['a brace, which opens a rule', '#fff } body {'],
    ['an angle bracket, which can escape a style element', '#fff</style><script>'],
    ['a backslash, which is a second spelling of every character', '\\0023 fff'],
    ['a control character', 'red\u0007'],
  ])('rejects a value containing %s', (_why, value) => {
    expect(issueAt(withTheme({ '--perch-x': value }), 'theme["--perch-x"]').code).toBe(
      'malformed-theme-token',
    );
  });

  it('rejects a value longer than the ceiling', () => {
    expect(issueAt(withTheme({ '--perch-x': 'a'.repeat(257) }), 'theme["--perch-x"]').code).toBe(
      'malformed-theme-token',
    );
  });

  it.each([
    ['url()', 'url(backdrop.png)'],
    ['URL with a space', 'URL (backdrop.png)'],
    ['a data URL behind url()', 'url(data:image/png,iVBOR)'],
  ])('rejects media smuggled in through a token with %s', (_why, value) => {
    const issue = issueAt(withTheme({ '--perch-bg': value }), 'theme["--perch-bg"]');

    expect(issue.code).toBe('embedded-media');
    expect(issue.message).toMatch(/media element/);
  });

  it('reports a url() value carrying a semicolon as malformed, which it also is', () => {
    // Both rules reject it and the character rule runs first. Pinned rather than left to chance,
    // because the two codes drive different editor affordances.
    expect(
      issueAt(
        withTheme({ '--perch-bg': "url('data:image/png;base64,iVBOR')" }),
        'theme["--perch-bg"]',
      ).code,
    ).toBe('malformed-theme-token');
  });

  it.each([
    ['a string', '#fff'],
    ['an array', []],
    ['null', null],
  ])('rejects %s where a token map belongs', (_why, theme) => {
    expect(issueAt(withTheme(theme), 'theme').code).toBe('not-an-object');
  });

  it('reports every bad token rather than the first', () => {
    const result = withTheme({ fg: '#fff', '--perch-x': 3, '--perch-y': 'url(x.png)' });

    expect(codesOf(result)).toEqual(['malformed-theme-token', 'wrong-type', 'embedded-media']);
  });
});

describe('element style overrides follow the same rules at an element path', () => {
  it('accepts a style map', () => {
    expect(layoutOf(withStyle({ '--perch-fg': '#8b949e' })).elements).toHaveLength(1);
  });

  it('accepts an empty style map, which is a brand-new element with no overrides', () => {
    expect(layoutOf(withStyle({})).elements).toHaveLength(1);
  });

  it('rejects a bad key, at the element path and with the element index', () => {
    const issue = issueAt(withStyle({ colour: 'red' }), 'elements[0].style["colour"]');

    expect(issue.code).toBe('malformed-theme-token');
    expect(issue.elementIndex).toBe(0);
  });

  it('rejects url() in a style value', () => {
    expect(
      issueAt(withStyle({ '--perch-bg': 'url(x.png)' }), 'elements[0].style["--perch-bg"]').code,
    ).toBe('embedded-media');
  });

  it('rejects a non-object style', () => {
    expect(issueAt(withStyle('#fff'), 'elements[0].style').code).toBe('not-an-object');
  });

  it('rejects the element rather than accepting it with the style dropped', () => {
    expect(
      validateLayout(
        layoutWithElements([
          { kind: 'text', text: 'x', rect: { x: 0, y: 0, w: 1, h: 1 }, style: { bad: 'x' } },
        ]),
        options,
      ).ok,
    ).toBe(false);
  });
});
