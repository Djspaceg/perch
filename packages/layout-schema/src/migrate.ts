/**
 * Versioning, with no best-effort path.
 *
 * `schemaVersion` is mandatory and checked on load. A layout one version behind is migrated
 * forward and the result reported. A layout from the future is **rejected, naming its version** —
 * this build cannot know what a field it has never heard of means, and guessing is how authored
 * work gets destroyed. Which is also why an unknown field is an error rather than a shrug: the
 * two rules are the same rule, applied at the document and at the field.
 *
 * ## Why this exists with only one version
 *
 * Retrofitting migration at the moment it is first needed means the first migration ever written
 * runs for the first time on somebody's real file, through machinery that has never carried a
 * document end to end. So the machinery is here now, and it is built as a **table of data plus a
 * runner** rather than as a chain of hard-coded `if (v === 1)` branches. The table being data is
 * what makes the runner testable while it is empty: the tests inject synthetic tables with two
 * and three versions and a `targetVersion` to match, and exercise chaining, ordering, an
 * unreachable old version, a future version, a step that throws, and the no-op at the target. The
 * production table is `LAYOUT_MIGRATIONS`, and it is `[]`.
 *
 * ## Adding a version
 *
 * In one change: append a `LayoutMigration` from the old version to the new one, bump
 * `LAYOUT_SCHEMA_VERSION`, and update the field checks. Never in two — a `LAYOUT_SCHEMA_VERSION`
 * with no migration into it strands every file written by the previous build.
 */

import { asRecord, describeValue, readField } from './checks.js';
import { createIssueCollector, type IssueCollector, type LayoutIssue } from './issues.js';
import { LAYOUT_SCHEMA_VERSION, parseJson, validateLayout, type Layout } from './layout.js';
import type { ValidateLayoutOptions } from './options.js';

/**
 * One step forward, by exactly one version.
 *
 * Single-step rather than "from any version to current" because a chain of small steps is the only
 * shape where version N+2 costs one new function instead of one per predecessor, and where each
 * step can be read and tested against the one document shape it was written for.
 */
export interface LayoutMigration {
  /** The version this step reads. */
  readonly from: number;
  /** Always `from + 1`. A step that skipped a version would leave that version unreachable. */
  readonly to: number;
  /** What changed, in one line. Reported to the human whose file was migrated. */
  readonly description: string;
  /**
   * Rewrite the document. JSON in, JSON out.
   *
   * Must be pure: it is handed a private copy, and it must not mutate even that — the runner
   * relies on the value it returns, not on edits to what it was given. It need not set
   * `schemaVersion`; the runner sets it, so a step cannot forget to.
   */
  readonly migrate: (document: Readonly<Record<string, unknown>>) => Record<string, unknown>;
}

/** One step that ran, for the report a consumer shows the human. */
export interface LayoutMigrationStep {
  readonly from: number;
  readonly to: number;
  readonly description: string;
}

/**
 * Every migration this build knows, in ascending order, contiguous, ending at
 * `LAYOUT_SCHEMA_VERSION`.
 *
 * Empty: version 1 is the first version, so there is nothing behind it. The runner is not empty.
 */
export const LAYOUT_MIGRATIONS: readonly LayoutMigration[] = Object.freeze([]);

/** Options for the migration runner. */
export interface MigrateLayoutOptions {
  /** Defaults to `LAYOUT_MIGRATIONS`. */
  readonly migrations?: readonly LayoutMigration[];
  /** Defaults to `LAYOUT_SCHEMA_VERSION`. See `ValidateLayoutOptions.targetVersion`. */
  readonly targetVersion?: number;
}

/** A migration outcome: the document at the target version, or every reason it could not get there. */
export type MigrateLayoutResult =
  | {
      readonly ok: true;
      /** The document at `toVersion`. A fresh object; the caller's is untouched. */
      readonly document: Record<string, unknown>;
      /** The version the document arrived at. */
      readonly fromVersion: number;
      /** Always the target version. */
      readonly toVersion: number;
      /** The steps that ran, in order. Empty when the document was already at the target. */
      readonly steps: readonly LayoutMigrationStep[];
    }
  | { readonly ok: false; readonly issues: readonly LayoutIssue[] };

/** A load outcome: a validated layout plus what had to happen to it, or every reason it is not one. */
export type LoadLayoutResult =
  | {
      readonly ok: true;
      readonly layout: Layout;
      /** The version the file on disk declared, which may be behind `layout.schemaVersion`. */
      readonly fromVersion: number;
      /** The steps that ran. Empty when the file was already current. */
      readonly migrations: readonly LayoutMigrationStep[];
    }
  | { readonly ok: false; readonly issues: readonly LayoutIssue[] };

/** Everything `loadLayout` needs: the validator's options plus the migration table. */
export type LoadLayoutOptions = ValidateLayoutOptions & MigrateLayoutOptions;

/**
 * The oldest version a table can carry forward to `targetVersion`.
 *
 * The target itself when the table is empty: a document at the current version needs no migration,
 * and every older one is unreachable.
 */
export function earliestMigratableVersion(
  migrations: readonly LayoutMigration[],
  targetVersion: number = LAYOUT_SCHEMA_VERSION,
): number {
  return migrations[0]?.from ?? targetVersion;
}

/**
 * Check a migration table, throwing on a malformed one.
 *
 * Throws rather than reporting an issue, because a bad table is programmer input: it is the same on
 * every run, no layout file is at fault, and reporting it as a validation failure would blame the
 * author of a file that is fine. `RangeError` for a numbering mistake, `TypeError` for a shape one,
 * matching how `sensor-contract` splits the two.
 *
 * Contiguity is required in both directions. The table must start where it starts and step by one
 * to `targetVersion` with no gaps, which is what lets the runner slice it by arithmetic and what
 * guarantees that every version from the earliest onwards can actually reach the target.
 */
export function assertLayoutMigrationTable(
  migrations: readonly LayoutMigration[],
  targetVersion: number = LAYOUT_SCHEMA_VERSION,
): void {
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    throw new RangeError(`targetVersion must be an integer of at least 1, got ${targetVersion}`);
  }

  let expectedFrom: number | null = null;

  for (const [index, step] of migrations.entries()) {
    if (typeof step.migrate !== 'function') {
      throw new TypeError(`migration table entry ${index} must have a migrate function`);
    }
    if (step.description.length === 0) {
      throw new TypeError(`migration table entry ${index} must have a non-empty description`);
    }
    if (!Number.isInteger(step.from) || step.from < 1) {
      throw new RangeError(
        `migration table entry ${index} must migrate from an integer version of at least 1, got ${step.from}`,
      );
    }
    if (step.to !== step.from + 1) {
      throw new RangeError(
        `migration table entry ${index} must step forward exactly one version: ${step.from} -> ${step.from + 1}, got ${step.from} -> ${step.to}`,
      );
    }
    if (expectedFrom !== null && step.from !== expectedFrom) {
      throw new RangeError(
        `migration table entry ${index} leaves a gap: expected it to migrate from ${expectedFrom}, got ${step.from}`,
      );
    }
    expectedFrom = step.to;
  }

  if (expectedFrom !== null && expectedFrom !== targetVersion) {
    throw new RangeError(
      `migration table ends at version ${expectedFrom} but the target version is ${targetVersion}; a table that does not reach the target cannot carry any document to it`,
    );
  }
}

/**
 * Carry a document forward to the target version, or say precisely why it cannot be.
 *
 * Runs before validation, and has to: an older document does not satisfy the current field checks —
 * that is what a version *is* — so validating first would reject every migratable file. It
 * therefore checks only what it needs to route: that the document is an object and that
 * `schemaVersion` is a plausible version number.
 */
export function migrateLayoutDocument(
  document: unknown,
  options: MigrateLayoutOptions = {},
): MigrateLayoutResult {
  const targetVersion = options.targetVersion ?? LAYOUT_SCHEMA_VERSION;
  const migrations = options.migrations ?? LAYOUT_MIGRATIONS;
  assertLayoutMigrationTable(migrations, targetVersion);

  const collect = createIssueCollector();

  const record = asRecord(document);
  if (record === null) {
    collect.add('not-an-object', '', `expected a layout object, got ${describeValue(document)}`);
    return { ok: false, issues: collect.issues };
  }

  const fromVersion = readDocumentVersion(record, collect);
  if (fromVersion === null) return { ok: false, issues: collect.issues };

  if (fromVersion > targetVersion) {
    collect.add(
      'unsupported-future-version',
      'schemaVersion',
      `layout schemaVersion ${fromVersion} is newer than this build's ${targetVersion}; it is rejected rather than read best-effort, because a field this build has never heard of cannot be interpreted and dropping it would destroy authored work`,
    );
    return { ok: false, issues: collect.issues };
  }

  if (fromVersion === targetVersion) {
    return { ok: true, document: { ...record }, fromVersion, toVersion: targetVersion, steps: [] };
  }

  const earliest = earliestMigratableVersion(migrations, targetVersion);
  if (fromVersion < earliest) {
    collect.add(
      'unsupported-past-version',
      'schemaVersion',
      `layout schemaVersion ${fromVersion} is older than the oldest version this build can migrate forward (${earliest}); open it with a build that still knows version ${fromVersion}`,
    );
    return { ok: false, issues: collect.issues };
  }

  // A private copy, so a step can neither see nor corrupt the caller's object. The round trip
  // doubles as the JSON-safety check hard rule 1 demands: anything that does not survive it is not
  // part of this contract, and finding out here beats finding out when the file is written back.
  const cloned = cloneJson(record, collect);
  if (cloned === null) return { ok: false, issues: collect.issues };

  let current = cloned;
  const steps: LayoutMigrationStep[] = [];

  for (const step of migrations.slice(fromVersion - earliest)) {
    let next: Record<string, unknown>;
    try {
      next = step.migrate(current);
    } catch (error) {
      collect.add(
        'migration-failed',
        '',
        `migration ${step.from} -> ${step.to} (${step.description}) threw: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { ok: false, issues: collect.issues };
    }

    const nextRecord = asRecord(next);
    if (nextRecord === null) {
      collect.add(
        'migration-failed',
        '',
        `migration ${step.from} -> ${step.to} (${step.description}) returned ${describeValue(next)} instead of a layout object`,
      );
      return { ok: false, issues: collect.issues };
    }

    // `schemaVersion` is stamped by the runner, never by the step. A step that had to remember it
    // would eventually forget, and the symptom would be a document that migrates forever.
    current = { ...nextRecord, schemaVersion: step.to };
    steps.push({ from: step.from, to: step.to, description: step.description });
  }

  return { ok: true, document: current, fromVersion, toVersion: targetVersion, steps };
}

/**
 * Migrate then validate: the path a layout takes off disk.
 *
 * The runtime's and the editor's entry point. `validateLayout` on its own is the right call only
 * when the document is already known to be at the current version — a GUI's in-memory state about
 * to be saved.
 */
export function loadLayout(document: unknown, options: LoadLayoutOptions): LoadLayoutResult {
  const migrated = migrateLayoutDocument(document, options);
  if (!migrated.ok) return migrated;

  const validated = validateLayout(migrated.document, options);
  if (!validated.ok) return validated;

  return {
    ok: true,
    layout: validated.layout,
    fromVersion: migrated.fromVersion,
    migrations: migrated.steps,
  };
}

/** `loadLayout` for the text of a layout file, with a JSON syntax error reported as an issue. */
export function loadLayoutJson(text: string, options: LoadLayoutOptions): LoadLayoutResult {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;

  return loadLayout(parsed.value, options);
}

/**
 * The migration report, as a line per step.
 *
 * "migrated and the result reported" is a requirement, not a nicety: an author whose file was
 * rewritten under them is owed the list of what changed, and a consumer that has the steps but no
 * way to print them tends not to print them.
 */
export function formatMigrationReport(steps: readonly LayoutMigrationStep[]): string {
  if (steps.length === 0) return 'no migration needed';

  return steps.map((step) => `  ${step.from} -> ${step.to}: ${step.description}`).join('\n');
}

/**
 * `schemaVersion` as a version number, or `null` having reported why it is not one.
 *
 * Deliberately separate from the validator's own version check: this one runs *before* migration
 * and only has to decide which version's rules apply, so it accepts any plausible version rather
 * than demanding the current one.
 */
function readDocumentVersion(
  record: Readonly<Record<string, unknown>>,
  collect: IssueCollector,
): number | null {
  const value = readField(record, 'schemaVersion');
  if (value === undefined) {
    collect.add(
      'missing-schema-version',
      'schemaVersion',
      'missing required field "schemaVersion"; it is mandatory and checked on load, because a document whose version is unknown cannot be read under any version\'s rules',
    );
    return null;
  }
  if (typeof value !== 'number') {
    collect.add(
      'wrong-type',
      'schemaVersion',
      `expected a version number, got ${describeValue(value)}`,
    );
    return null;
  }
  if (!Number.isInteger(value)) {
    collect.add('not-an-integer', 'schemaVersion', `expected a whole version number, got ${value}`);
    return null;
  }
  if (value < 1) {
    collect.add(
      'out-of-range',
      'schemaVersion',
      `expected a version of at least 1, got ${value}; version 1 is the first layout schema there has ever been`,
    );
    return null;
  }

  return value;
}

/** Deep-copy a JSON document, reporting anything in it that is not JSON-safe. */
function cloneJson(
  record: Readonly<Record<string, unknown>>,
  collect: IssueCollector,
): Record<string, unknown> | null {
  let copy: unknown;
  try {
    copy = JSON.parse(JSON.stringify(record)) as unknown;
  } catch (error) {
    collect.add(
      'invalid-json',
      '',
      `document is not JSON-safe, so it cannot be migrated: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }

  const cloned = asRecord(copy);
  if (cloned === null) {
    collect.add('not-an-object', '', 'document did not survive a JSON round trip as an object');
    return null;
  }

  return { ...cloned };
}
