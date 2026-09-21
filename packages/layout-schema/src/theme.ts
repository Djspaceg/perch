/**
 * Theme tokens, and the per-element `style` overrides that share their rules.
 *
 * The SPEC types `theme` as `Record<string, string>` and annotates it "CSS custom property
 * tokens". It types `style` only as `Style` and never defines it. The choice made here is that
 * **`Style` is the same thing scoped to one element**: a map of CSS custom properties that
 * override the theme's for that element and nothing else. See DECISIONS.md.
 *
 * Two alternatives were rejected. A closed set of presentational fields (`color`, `fontSize`, …)
 * would put a styling vocabulary in this package that `ui-kit` would then have to match exactly,
 * and unknown fields are an error here, so every new widget property would be a schema version.
 * An open `Record<string, string>` of arbitrary CSS declarations would make a layout able to
 * inject anything into the page. Custom properties are the one shape that composes with the
 * theme by construction, needs no vocabulary, and stays inert until a widget's own CSS reads it.
 *
 * The value rules below are stricter than CSS requires, and each closes a specific hole:
 *
 * - No `;` or `{}`: a token is written into a declaration, and those characters end it. One of
 *   them turns a colour token into arbitrary extra CSS.
 * - No `<` or `>`: a token that can open a tag can escape a `<style>` element in a generated
 *   bundle.
 * - No backslash: CSS escapes are a second spelling of every character, and a token is a literal
 *   value. Two spellings of one colour is the theme-token version of two spellings of one topic.
 * - No `url(`: hard rule 2 says media is referenced by an element, never embedded and never
 *   fetched from a token. A background smuggled in through the theme is media the bundle build
 *   does not know to copy, so it renders in the editor and is missing on the panel.
 */

import { describeValue, hasControlCharacter } from './checks.js';
import { keyPath, type IssueCollector } from './issues.js';

/**
 * A map of CSS custom properties. The `theme` field of a layout, and the `style` field of any
 * element, are the same type at different scopes.
 */
export type ThemeTokens = Record<string, string>;

/** `Style` is `ThemeTokens` scoped to one element. Named separately because the SPEC names it. */
export type Style = ThemeTokens;

/** A CSS custom property name: two hyphens, then the conservative identifier subset. */
const TOKEN_NAME = /^--[A-Za-z0-9_-]+$/;
const TOKEN_NAME_MAX_LENGTH = 64;

/** Characters a token value may not contain, each for the reason given in the module comment. */
const FORBIDDEN_IN_VALUE = /[;{}<>\\]/;
const TOKEN_VALUE_MAX_LENGTH = 256;

/**
 * Validate a token map in place, reporting each bad key or value separately.
 *
 * An empty map is valid: a layout that themes nothing and a brand-new element with no overrides
 * are both legitimate, and `theme: {}` says "I inherit the defaults" explicitly.
 */
export function validateTokenMap(
  value: unknown,
  path: string,
  what: string,
  collect: IssueCollector,
  elementIndex?: number,
): ThemeTokens | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    collect.add(
      'not-an-object',
      path,
      `expected ${what} to be an object of CSS custom properties, got ${describeValue(value)}`,
      elementIndex,
    );
    return null;
  }

  const record = value as Readonly<Record<string, unknown>>;
  const tokens: ThemeTokens = {};
  let ok = true;

  for (const key of Object.keys(record)) {
    const where = keyPath(path, key);

    if (!TOKEN_NAME.test(key) || key.length > TOKEN_NAME_MAX_LENGTH) {
      collect.add(
        'malformed-theme-token',
        where,
        `${what} key must be a CSS custom property — two hyphens then letters, digits, "-" or "_", at most ${TOKEN_NAME_MAX_LENGTH} characters — got ${JSON.stringify(key)}`,
        elementIndex,
      );
      ok = false;
      continue;
    }

    const tokenValue = record[key];
    if (typeof tokenValue !== 'string') {
      collect.add(
        'wrong-type',
        where,
        `expected a string token value, got ${describeValue(tokenValue)}`,
        elementIndex,
      );
      ok = false;
      continue;
    }
    if (tokenValue.length === 0) {
      collect.add(
        'empty-string',
        where,
        'expected a non-empty token value; remove the key instead of setting it empty',
        elementIndex,
      );
      ok = false;
      continue;
    }
    if (tokenValue.length > TOKEN_VALUE_MAX_LENGTH) {
      collect.add(
        'malformed-theme-token',
        where,
        `token value must be at most ${TOKEN_VALUE_MAX_LENGTH} characters, got ${tokenValue.length}`,
        elementIndex,
      );
      ok = false;
      continue;
    }
    if (FORBIDDEN_IN_VALUE.test(tokenValue) || hasControlCharacter(tokenValue)) {
      collect.add(
        'malformed-theme-token',
        where,
        `token value may not contain ";", "{", "}", "<", ">", a backslash or a control character, because it is written into a CSS declaration — got ${JSON.stringify(tokenValue)}`,
        elementIndex,
      );
      ok = false;
      continue;
    }
    if (/url\s*\(/i.test(tokenValue)) {
      collect.add(
        'embedded-media',
        where,
        'token value may not reference media with url(); use a media element, so the bundle build copies the asset',
        elementIndex,
      );
      ok = false;
      continue;
    }

    tokens[key] = tokenValue;
  }

  return ok ? tokens : null;
}
