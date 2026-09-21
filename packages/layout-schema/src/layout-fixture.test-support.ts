/**
 * Test scaffolding: one valid layout, and the registry it is valid against.
 *
 * Every negative test in this package is "the valid layout, with one thing broken". Building it
 * from a single fixture is what makes those tests readable — the diff between the fixture and the
 * case *is* the thing under test — and it also means a change to the format breaks the fixture
 * once rather than breaking eighty literals.
 *
 * Not part of the built package: see the `exclude` in `tsconfig.json`.
 */

import type { LayoutIssue, LayoutIssueCode } from './issues.js';
import type { Layout } from './layout.js';
import { createWidgetRegistry, type WidgetRegistry } from './registry.js';

/**
 * The widget table the tests validate against.
 *
 * Deliberately *not* `ui-kit`'s real one, and not imported from anywhere: the point of the registry
 * being injected is that this package never learns a real widget vocabulary. These three are the
 * three shapes that matter to the validator — one that draws a scale, one that does not, and a
 * second scale-drawer so "requires a range" is not a single-case rule.
 */
export const TEST_WIDGETS: WidgetRegistry = createWidgetRegistry({
  readout: { drawsScale: false },
  gauge: { drawsScale: true },
  sparkline: { drawsScale: true },
});

/** A JSON-safe deep copy, so a test can mutate a fixture without affecting the next test. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * A valid layout at the current schema version: the 1920x400 panel `ARCHITECTURE.md` names, with
 * one element of each kind.
 *
 * "Each kind" is load-bearing, not decorative: it is what puts every element kind through the
 * document-level tests — the JSON round trip, the rebuilt-with-exactly-these-keys check, and paint
 * order — rather than only through its own file. A fifth kind belongs here on the day it is added.
 *
 * Returned from a function rather than exported as a constant so no test can leave a mutation
 * behind for another.
 */
export function validLayoutDocument(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    target: { width: 1920, height: 400, frameRate: 30 },
    theme: {
      '--perch-fg': '#e6edf3',
      '--perch-bg': 'rgb(13, 17, 23)',
      '--perch-accent': 'oklch(0.72 0.15 210)',
    },
    elements: [
      {
        kind: 'media',
        src: 'desk-1920x400.assets/backdrop.png',
        rect: { x: 0, y: 0, w: 1920, h: 400 },
        fit: 'cover',
      },
      {
        kind: 'text',
        text: 'CPU',
        rect: { x: 48, y: 32, w: 200, h: 40 },
        style: { '--perch-fg': '#8b949e' },
      },
      {
        kind: 'widget',
        widget: 'readout',
        topic: 'sensors/cpu/0/temperature/0',
        rect: { x: 48, y: 80, w: 240, h: 120 },
      },
      {
        kind: 'widget',
        widget: 'gauge',
        topic: 'sensors/gpu/0/temperature/0',
        rect: { x: 320, y: 80, w: 240, h: 240 },
        range: [0, 100],
        style: { '--perch-accent': '#f85149' },
      },
      {
        kind: 'chart',
        widget: 'sparkline',
        topic: 'sensors/cpu/0/load/0',
        rect: { x: 640, y: 80, w: 480, h: 200 },
        windowMs: 300_000,
        range: [0, 100],
        gap: 'break',
      },
    ],
  };
}

/**
 * The same dashboard as a version 1 build would have written it: no chart, `schemaVersion: 1`.
 *
 * The other half of the version boundary. Every "old document into new reader" test starts here,
 * and it is written out rather than derived from `validLayoutDocument()` because the thing under
 * test is what the *old format* looked like — deriving it would let a change to the current fixture
 * quietly redefine the history being migrated from.
 */
export function v1LayoutDocument(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    target: { width: 1920, height: 400, frameRate: 30 },
    theme: { '--perch-fg': '#e6edf3' },
    elements: [
      {
        kind: 'text',
        text: 'CPU',
        rect: { x: 48, y: 32, w: 200, h: 40 },
      },
      {
        kind: 'widget',
        widget: 'gauge',
        topic: 'sensors/gpu/0/temperature/0',
        rect: { x: 320, y: 80, w: 240, h: 240 },
        range: [0, 100],
      },
    ],
  };
}

/** The valid layout with one top-level field replaced. */
export function layoutWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...validLayoutDocument(), ...overrides };
}

/** The valid layout whose `elements` is exactly the given list. */
export function layoutWithElements(elements: readonly unknown[]): Record<string, unknown> {
  return { ...validLayoutDocument(), elements: [...elements] };
}

/** A copy of `record` with one field removed, for the "missing required field" cases. */
export function without(record: Record<string, unknown>, field: string): Record<string, unknown> {
  const copy = { ...record };
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- removing an arbitrary named field is the whole point: it is how a test spells "this field is absent" without one deconstruction per field.
  delete copy[field];

  return copy;
}

/**
 * Hand a deliberately wrong value to an API whose parameter is typed.
 *
 * The one cast in this package's tests, in one place with one reason: several runtime checks exist
 * precisely for input the types forbid — a registry entry with a non-boolean `drawsScale`, a
 * migration step that returns a string — and a check that cannot be reached from a test is a check
 * nobody knows fires. Validators taking `unknown` need none of this and use none of it.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- a return-position-only type parameter is exactly the intent: the caller names the type it is lying about, so the lie is written at the call site and nowhere else.
export function hostile<T>(value: unknown): T {
  return value as T;
}

/** Either arm of every result type in this package: `ok`, or `ok: false` plus the reasons. */
interface Failure {
  readonly ok: false;
  readonly issues: readonly LayoutIssue[];
}
type AnyResult = { readonly ok: true } | Failure;

/** The issues of a result that must have failed, or a failure naming what happened instead. */
export function issuesOf(result: AnyResult): readonly LayoutIssue[] {
  if (result.ok) throw new Error('expected validation to fail, but it returned ok');

  return result.issues;
}

/** Just the codes, for the common `expect(codesOf(result)).toEqual([...])`. */
export function codesOf(result: AnyResult): readonly LayoutIssueCode[] {
  return issuesOf(result).map((issue) => issue.code);
}

/**
 * The single issue at `path`, or a failure listing every issue there was instead.
 *
 * Returns the issue rather than `undefined`, so a test asserting on a message needs neither a
 * non-null assertion nor a two-step "is it there / what does it say".
 */
export function issueAt(result: AnyResult, path: string): LayoutIssue {
  const issues = issuesOf(result);
  const found = issues.filter((issue) => issue.path === path);
  const [only] = found;
  if (found.length !== 1 || only === undefined) {
    const listed = issues.map((issue) => `  ${issue.path}: [${issue.code}] ${issue.message}`);
    throw new Error(
      `expected exactly one issue at ${JSON.stringify(path)}, found ${found.length} of:\n${listed.join('\n')}`,
    );
  }

  return only;
}

/** The layout of a result that must have succeeded, or a failure printing why it did not. */
export function layoutOf(result: { readonly ok: true; readonly layout: Layout } | Failure): Layout {
  if (!result.ok) {
    const listed = result.issues.map(
      (issue) => `  ${issue.path}: [${issue.code}] ${issue.message}`,
    );
    throw new Error(
      `expected a valid layout, got ${result.issues.length} issues:\n${listed.join('\n')}`,
    );
  }

  return result.layout;
}
