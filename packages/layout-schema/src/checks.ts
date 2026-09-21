/**
 * The primitive field readers every validator in this package is built from.
 *
 * Each one does three things and no more: locate the field, reject it with a precise issue if
 * it is not the JSON type the schema requires, and return either the narrowed value or `null`
 * so the caller can keep walking and collect the rest of the document's problems. `null` means
 * "already reported"; no caller ever needs to add an issue of its own for a failure here.
 *
 * Everything arriving at this package is `unknown` — a file off disk, a fetch body, an object a
 * GUI built. None of it is trusted, and none of these readers cast their way past that.
 */

import { fieldPath, type IssueCollector } from './issues.js';

/**
 * Narrow a candidate to a plain JSON object, or `null`.
 *
 * Arrays are excluded: `typeof [] === 'object'`, and an array where an object belongs is a
 * different mistake with a different fix, so it must not narrow. `null` likewise.
 */
export function asRecord(candidate: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return null;
  }

  return candidate as Readonly<Record<string, unknown>>;
}

/**
 * Narrow a candidate to a JSON array of unknowns, or `null`.
 *
 * The one place `Array.isArray` is called on an `unknown`, because its guard narrows to `any[]`
 * and `any` is not allowed to escape into the validators. Narrowed to `readonly unknown[]` here,
 * once, so every element read downstream is an `unknown` the caller has to check.
 */
export function asArray(candidate: unknown): readonly unknown[] | null {
  return Array.isArray(candidate) ? (candidate as readonly unknown[]) : null;
}

/**
 * Read an own property, treating an inherited one as absent.
 *
 * `Object.hasOwn` rather than a bare index read because a bare read of `{}` for a field named
 * like an `Object.prototype` member would return the inherited function instead of `undefined`.
 * No field in this schema is spelled that way today, and this is the check that keeps that true
 * when one is added.
 */
export function readField(record: Readonly<Record<string, unknown>>, field: string): unknown {
  return Object.hasOwn(record, field) ? record[field] : undefined;
}

/**
 * Whether a string contains a C0 control character or DEL.
 *
 * A code-point scan rather than a regex character class, because a regex spelling a control
 * character literally is itself a lint error — the rule exists because the class is invisible in
 * source, and the reason it is banned is the reason this function is clearer.
 *
 * Every string field in this format rejects these: a topic, a media path and a theme token are all
 * identities, and an embedded control character is a second invisible spelling of one.
 */
export function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && (code < 0x20 || code === 0x7f)) return true;
  }

  return false;
}

/**
 * A short description of a value, for the tail of a rejection message.
 *
 * Names the type and, for primitives, the value — `expected a number, got a string ("100px")`
 * is actionable where `expected a number` is a guessing game. Strings are truncated because an
 * author can paste a whole SVG into a field and an error message is not the place to print it.
 */
export function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array (length ${value.length})`;

  switch (typeof value) {
    case 'undefined':
      return 'nothing';
    case 'string':
      return `a string (${JSON.stringify(truncate(value))})`;
    case 'number':
      return `the number ${value}`;
    case 'boolean':
      return `the boolean ${value}`;
    case 'object':
      return 'an object';
    default:
      return `a ${typeof value}`;
  }
}

const MAX_DESCRIBED_LENGTH = 40;

function truncate(value: string): string {
  return value.length <= MAX_DESCRIBED_LENGTH ? value : `${value.slice(0, MAX_DESCRIBED_LENGTH)}…`;
}

/**
 * Report every own key that this schema version does not define.
 *
 * The keystone of the versioning policy: an unknown field is an error, not a shrug. A layout
 * carrying a field from a newer build, or a misspelled one, is a layout whose author believes
 * something is configured that is not — and the only honest response is to refuse it and say
 * which key. The allowed list is printed because the overwhelmingly common cause is a typo, and
 * seeing the real name next to the wrong one ends the investigation.
 */
export function rejectUnknownFields(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  path: string,
  collect: IssueCollector,
  elementIndex?: number,
): void {
  for (const key of Object.keys(record)) {
    if (allowed.includes(key)) continue;

    collect.add(
      'unknown-field',
      fieldPath(path, key),
      `unknown field ${JSON.stringify(key)}; this schema version defines ${allowed.map((name) => JSON.stringify(name)).join(', ')}`,
      elementIndex,
    );
  }
}

/** A field that must be present and an object. */
export function requireRecord(
  record: Readonly<Record<string, unknown>>,
  path: string,
  field: string,
  collect: IssueCollector,
  elementIndex?: number,
): Readonly<Record<string, unknown>> | null {
  const where = fieldPath(path, field);
  const value = readField(record, field);
  if (value === undefined) {
    collect.add(
      'missing-field',
      where,
      `missing required field ${JSON.stringify(field)}`,
      elementIndex,
    );
    return null;
  }

  const nested = asRecord(value);
  if (nested === null) {
    collect.add(
      'not-an-object',
      where,
      `expected an object, got ${describeValue(value)}`,
      elementIndex,
    );
    return null;
  }

  return nested;
}

/** A field that must be present and a finite number. Non-finite is rejected, never coerced. */
export function requireFiniteNumber(
  record: Readonly<Record<string, unknown>>,
  path: string,
  field: string,
  collect: IssueCollector,
  elementIndex?: number,
): number | null {
  const where = fieldPath(path, field);
  const value = readField(record, field);
  if (value === undefined) {
    collect.add(
      'missing-field',
      where,
      `missing required field ${JSON.stringify(field)}`,
      elementIndex,
    );
    return null;
  }
  if (typeof value !== 'number') {
    collect.add(
      'wrong-type',
      where,
      `expected a number, got ${describeValue(value)}`,
      elementIndex,
    );
    return null;
  }
  // `NaN` and `±Infinity` are unreachable through `JSON.parse`, but a GUI that computed a
  // width by dividing by zero reaches this package directly, and `JSON.stringify` would turn
  // the result into `null` on the way back out. Rejected here so the bug surfaces where it was
  // made rather than as a missing field in a saved file.
  if (!Number.isFinite(value)) {
    collect.add('out-of-range', where, `expected a finite number, got ${value}`, elementIndex);
    return null;
  }

  return value;
}

/** A field that must be a whole number of pixels, in some closed interval. */
export function requireInteger(
  record: Readonly<Record<string, unknown>>,
  path: string,
  field: string,
  bounds: { readonly min?: number; readonly max?: number },
  collect: IssueCollector,
  elementIndex?: number,
): number | null {
  const value = requireFiniteNumber(record, path, field, collect, elementIndex);
  if (value === null) return null;

  const where = fieldPath(path, field);
  if (!Number.isInteger(value)) {
    collect.add(
      'not-an-integer',
      where,
      `expected a whole number of pixels, got ${value}`,
      elementIndex,
    );
    return null;
  }

  const { min, max } = bounds;
  if (min !== undefined && value < min) {
    collect.add('out-of-range', where, `expected at least ${min}, got ${value}`, elementIndex);
    return null;
  }
  if (max !== undefined && value > max) {
    collect.add('out-of-range', where, `expected at most ${max}, got ${value}`, elementIndex);
    return null;
  }

  return value;
}

/** A field that must be present and a non-empty string. */
export function requireNonEmptyString(
  record: Readonly<Record<string, unknown>>,
  path: string,
  field: string,
  collect: IssueCollector,
  elementIndex?: number,
): string | null {
  const where = fieldPath(path, field);
  const value = readField(record, field);
  if (value === undefined) {
    collect.add(
      'missing-field',
      where,
      `missing required field ${JSON.stringify(field)}`,
      elementIndex,
    );
    return null;
  }
  if (typeof value !== 'string') {
    collect.add(
      'wrong-type',
      where,
      `expected a string, got ${describeValue(value)}`,
      elementIndex,
    );
    return null;
  }
  if (value.length === 0) {
    collect.add('empty-string', where, `expected a non-empty string`, elementIndex);
    return null;
  }

  return value;
}

/**
 * An optional field that must be one of a closed set of string literals when present.
 *
 * Returns `undefined` both for "absent" and for "present but rejected". The caller omits the
 * key either way, which is correct: a rejected layout is never returned to anyone, so the only
 * thing the distinction could change is a message that has already been recorded.
 */
export function optionalLiteral<T extends string>(
  record: Readonly<Record<string, unknown>>,
  path: string,
  field: string,
  allowed: readonly T[],
  collect: IssueCollector,
  elementIndex?: number,
): T | undefined {
  const value = readField(record, field);
  if (value === undefined) return undefined;

  const where = fieldPath(path, field);
  if (typeof value !== 'string') {
    collect.add(
      'wrong-type',
      where,
      `expected a string, got ${describeValue(value)}`,
      elementIndex,
    );
    return undefined;
  }
  if (!(allowed as readonly string[]).includes(value)) {
    collect.add(
      'wrong-type',
      where,
      `expected one of ${allowed.map((name) => JSON.stringify(name)).join(', ')}, got ${JSON.stringify(value)}`,
      elementIndex,
    );
    return undefined;
  }

  return value as T;
}
