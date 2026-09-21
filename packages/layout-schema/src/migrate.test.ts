/**
 * The migration machinery, exercised while the production table is still empty.
 *
 * This is the answer to "how do you test a migration runner with one version". The table is data
 * and the target version is an option, so every case below builds a synthetic two- or three-version
 * history and runs the real runner over it: a single step, a chain, a document that joins the chain
 * halfway, a version too old to join it at all, a version from the future, a step that throws, a
 * step that returns something that is not a document, and a step that forgets to stamp the version.
 *
 * The one thing these tests cannot prove is that a *future real* migration transforms a document
 * correctly — nothing can, before it is written. What they do prove is that when it is written, the
 * machinery carrying it has already run every path it will take.
 */

import { describe, expect, it } from 'vitest';
import {
  assertLayoutMigrationTable,
  earliestMigratableVersion,
  formatMigrationReport,
  LAYOUT_MIGRATIONS,
  LAYOUT_SCHEMA_VERSION,
  loadLayout,
  loadLayoutJson,
  migrateLayoutDocument,
  validateLayout,
  type LayoutMigration,
  type LoadLayoutOptions,
  type MigrateLayoutResult,
} from '@perch/layout-schema';
import {
  clone,
  codesOf,
  hostile,
  issueAt,
  issuesOf,
  layoutWith,
  TEST_WIDGETS,
  v1LayoutDocument,
  validLayoutDocument,
  without,
} from './layout-fixture.test-support.js';

/**
 * A synthetic history: 1 -> 2 raises the frame rate, 2 -> 3 replaces the theme.
 *
 * Both produce documents the *current* field checks accept, which is what lets the composed
 * `loadLayout` path be tested end to end rather than only the runner in isolation.
 */
const RAISE_FRAME_RATE: LayoutMigration = {
  from: 1,
  to: 2,
  description: 'raise the capture ceiling to 60 Hz',
  migrate: (document) => ({ ...document, target: { width: 1920, height: 400, frameRate: 60 } }),
};

const RETHEME: LayoutMigration = {
  from: 2,
  to: 3,
  description: 'replace the theme with the dark tokens',
  migrate: (document) => ({ ...document, theme: { '--perch-bg': '#000000' } }),
};

/**
 * The current fixture stamped at version 1, for the tests that exercise the *runner*.
 *
 * Those tests care only that the document is one version behind the synthetic target; its content
 * is beside the point. Distinct from `v1LayoutDocument()`, which is what a version 1 build actually
 * wrote and is what the real boundary tests below use.
 */
const v1Document = (): Record<string, unknown> => layoutWith({ schemaVersion: 1 });

const migrated = (result: MigrateLayoutResult): Record<string, unknown> => {
  if (!result.ok) {
    throw new Error(`expected migration to succeed, got: ${codesOf(result).join(', ')}`);
  }

  return result.document;
};

const options: LoadLayoutOptions = { widgets: TEST_WIDGETS };

describe('the production table', () => {
  it('carries the step into the current version, and only that step', () => {
    expect(LAYOUT_SCHEMA_VERSION).toBe(2);
    expect(LAYOUT_MIGRATIONS.map((step) => `${step.from}->${step.to}`)).toEqual(['1->2']);
  });

  it('is frozen, so nothing appends to it at runtime', () => {
    expect(Object.isFrozen(LAYOUT_MIGRATIONS)).toBe(true);
  });

  it('is a valid table, which is the check that will catch a badly-numbered first migration', () => {
    expect(() => {
      assertLayoutMigrationTable(LAYOUT_MIGRATIONS);
    }).not.toThrow();
  });

  it('reports version 1 as the oldest loadable one, so no version 1 file is stranded', () => {
    expect(earliestMigratableVersion(LAYOUT_MIGRATIONS)).toBe(1);
    expect(earliestMigratableVersion([], 7)).toBe(7);
    expect(earliestMigratableVersion([RAISE_FRAME_RATE, RETHEME], 3)).toBe(1);
    expect(earliestMigratableVersion([RETHEME], 3)).toBe(2);
  });
});

describe('migrateLayoutDocument: a document already at the target', () => {
  it('runs no steps and reports none', () => {
    const result = migrateLayoutDocument(validLayoutDocument());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toEqual([]);
    expect(result.fromVersion).toBe(LAYOUT_SCHEMA_VERSION);
    expect(result.toVersion).toBe(LAYOUT_SCHEMA_VERSION);
  });

  it('still hands back a copy, so a caller cannot be surprised by a shared reference', () => {
    const document = validLayoutDocument();

    expect(migrated(migrateLayoutDocument(document))).not.toBe(document);
    expect(migrated(migrateLayoutDocument(document))).toEqual(document);
  });
});

describe('migrateLayoutDocument: carrying a document forward', () => {
  it('runs one step and stamps the new version', () => {
    const result = migrateLayoutDocument(v1Document(), {
      migrations: [RAISE_FRAME_RATE],
      targetVersion: 2,
    });

    expect(migrated(result)['schemaVersion']).toBe(2);
    expect(migrated(result)['target']).toEqual({ width: 1920, height: 400, frameRate: 60 });
    if (!result.ok) return;
    expect(result.steps).toEqual([
      { from: 1, to: 2, description: 'raise the capture ceiling to 60 Hz' },
    ]);
  });

  it('chains steps in order', () => {
    const result = migrateLayoutDocument(v1Document(), {
      migrations: [RAISE_FRAME_RATE, RETHEME],
      targetVersion: 3,
    });

    if (!result.ok) throw new Error('expected the chain to succeed');
    expect(result.steps.map((step) => `${step.from}->${step.to}`)).toEqual(['1->2', '2->3']);
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(3);
    expect(result.document['theme']).toEqual({ '--perch-bg': '#000000' });
    expect(result.document['target']).toEqual({ width: 1920, height: 400, frameRate: 60 });
  });

  it("joins the chain at the document's own version rather than replaying earlier steps", () => {
    const result = migrateLayoutDocument(layoutWith({ schemaVersion: 2 }), {
      migrations: [RAISE_FRAME_RATE, RETHEME],
      targetVersion: 3,
    });

    if (!result.ok) throw new Error('expected the partial chain to succeed');
    expect(result.steps.map((step) => step.from)).toEqual([2]);
    // 1 -> 2 did not run, so the fixture's own frame rate survives.
    expect(result.document['target']).toEqual({ width: 1920, height: 400, frameRate: 30 });
  });

  it("leaves the caller's document untouched even when a step mutates what it was handed", () => {
    const vandal: LayoutMigration = {
      from: 1,
      to: 2,
      description: 'mutate the input, which a step must not do',
      migrate: (document) => {
        hostile<Record<string, unknown>>(document)['theme'] = { '--wrecked': 'yes' };
        return { ...document };
      },
    };
    const document = v1Document();
    const before = clone(document);

    migrateLayoutDocument(document, { migrations: [vandal], targetVersion: 2 });

    expect(document).toEqual(before);
  });

  it('stamps the version itself, so a step that forgets cannot migrate forever', () => {
    const forgetful: LayoutMigration = {
      from: 1,
      to: 2,
      description: 'forget to set schemaVersion',
      migrate: (document) => ({ ...document }),
    };

    expect(
      migrated(migrateLayoutDocument(v1Document(), { migrations: [forgetful], targetVersion: 2 }))[
        'schemaVersion'
      ],
    ).toBe(2);
  });

  it('overrides a version a step set wrongly', () => {
    const liar: LayoutMigration = {
      from: 1,
      to: 2,
      description: 'claim a version it did not produce',
      migrate: (document) => ({ ...document, schemaVersion: 99 }),
    };

    expect(
      migrated(migrateLayoutDocument(v1Document(), { migrations: [liar], targetVersion: 2 }))[
        'schemaVersion'
      ],
    ).toBe(2);
  });
});

describe('migrateLayoutDocument: the versions it refuses', () => {
  it("rejects a version from the future, naming it and this build's", () => {
    const issue = issueAt(migrateLayoutDocument(layoutWith({ schemaVersion: 9 })), 'schemaVersion');

    expect(issue.code).toBe('unsupported-future-version');
    expect(issue.message).toContain('9');
    expect(issue.message).toContain(String(LAYOUT_SCHEMA_VERSION));
    expect(issue.message).toMatch(/destroy|never heard of/);
  });

  it('rejects a version older than the table can reach, naming the oldest it can', () => {
    const issue = issueAt(
      migrateLayoutDocument(v1Document(), { migrations: [RETHEME], targetVersion: 3 }),
      'schemaVersion',
    );

    expect(issue.code).toBe('unsupported-past-version');
    expect(issue.message).toContain('2');
  });

  it('rejects a document with no version at all', () => {
    const issue = issueAt(
      migrateLayoutDocument(without(validLayoutDocument(), 'schemaVersion')),
      'schemaVersion',
    );

    expect(issue.code).toBe('missing-schema-version');
    expect(issue.message).toMatch(/mandatory/);
  });

  it.each([
    ['a stringified version', '1', 'wrong-type'],
    ['a null version', null, 'wrong-type'],
    ['a fractional version', 1.5, 'not-an-integer'],
    ['version zero', 0, 'out-of-range'],
    ['a negative version', -1, 'out-of-range'],
  ])('rejects %s before it routes anywhere', (_why, schemaVersion, code) => {
    expect(
      issueAt(migrateLayoutDocument(layoutWith({ schemaVersion })), 'schemaVersion').code,
    ).toBe(code);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', '{}'],
  ])('rejects %s as not a document', (_why, document) => {
    expect(codesOf(migrateLayoutDocument(document))).toEqual(['not-an-object']);
  });
});

describe('migrateLayoutDocument: a step that misbehaves', () => {
  it('reports a step that throws, naming the step and the reason', () => {
    const thrower: LayoutMigration = {
      from: 1,
      to: 2,
      description: 'fail on purpose',
      migrate: () => {
        throw new Error('no idea what to do with this');
      },
    };

    const issue = issueAt(
      migrateLayoutDocument(v1Document(), { migrations: [thrower], targetVersion: 2 }),
      '',
    );

    expect(issue.code).toBe('migration-failed');
    expect(issue.message).toContain('1 -> 2');
    expect(issue.message).toContain('fail on purpose');
    expect(issue.message).toContain('no idea what to do with this');
  });

  it('reports a step that returns something that is not a document', () => {
    const wrong: LayoutMigration = {
      from: 1,
      to: 2,
      description: 'return a string',
      migrate: () => hostile<Record<string, unknown>>('not a layout'),
    };

    const issue = issueAt(
      migrateLayoutDocument(v1Document(), { migrations: [wrong], targetVersion: 2 }),
      '',
    );

    expect(issue.code).toBe('migration-failed');
    expect(issue.message).toMatch(/a string/);
  });

  it('stops at the failing step rather than running the rest of the chain', () => {
    let reached = false;
    const thrower: LayoutMigration = {
      from: 1,
      to: 2,
      description: 'fail first',
      migrate: () => {
        throw new Error('stop here');
      },
    };
    const watcher: LayoutMigration = {
      from: 2,
      to: 3,
      description: 'must not run',
      migrate: (document) => {
        reached = true;
        return { ...document };
      },
    };

    migrateLayoutDocument(v1Document(), {
      migrations: [thrower, watcher],
      targetVersion: 3,
    });

    expect(reached).toBe(false);
  });

  it('rejects a document that is not JSON-safe, per hard rule 1', () => {
    const document: Record<string, unknown> = v1Document();
    document['self'] = document;

    expect(
      codesOf(
        migrateLayoutDocument(document, { migrations: [RAISE_FRAME_RATE], targetVersion: 2 }),
      ),
    ).toEqual(['invalid-json']);
  });
});

describe('assertLayoutMigrationTable', () => {
  it('accepts a contiguous table that reaches the target', () => {
    expect(() => {
      assertLayoutMigrationTable([RAISE_FRAME_RATE, RETHEME], 3);
    }).not.toThrow();
  });

  it.each([
    ['a step of more than one version', [{ ...RAISE_FRAME_RATE, to: 3 }], 3],
    ['a gap in the chain', [RAISE_FRAME_RATE, { ...RETHEME, from: 4, to: 5 }], 5],
    ['a table that stops short of the target', [RAISE_FRAME_RATE], 3],
    ['a table that overshoots the target', [RAISE_FRAME_RATE, RETHEME], 2],
    ['a step from version zero', [{ ...RAISE_FRAME_RATE, from: 0, to: 1 }], 1],
    ['a step from a fractional version', [{ ...RAISE_FRAME_RATE, from: 1.5, to: 2.5 }], 2.5],
  ])('throws RangeError for %s', (_why, migrations, targetVersion) => {
    expect(() => {
      assertLayoutMigrationTable(migrations, targetVersion);
    }).toThrow(RangeError);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
  ])('throws RangeError for a %s target version', (_why, targetVersion) => {
    expect(() => {
      assertLayoutMigrationTable([], targetVersion);
    }).toThrow(RangeError);
  });

  it('throws TypeError for a step with no migrate function', () => {
    expect(() => {
      assertLayoutMigrationTable(
        [hostile<LayoutMigration>({ from: 1, to: 2, description: 'x' })],
        2,
      );
    }).toThrow(TypeError);
  });

  it('throws TypeError for a step with no description, because the report would say nothing', () => {
    expect(() => {
      assertLayoutMigrationTable([{ ...RAISE_FRAME_RATE, description: '' }], 2);
    }).toThrow(TypeError);
  });

  it('is enforced by the runner, not merely available to it', () => {
    expect(() =>
      migrateLayoutDocument(v1Document(), {
        migrations: [{ ...RAISE_FRAME_RATE, to: 4 }],
        targetVersion: 4,
      }),
    ).toThrow(RangeError);
  });
});

describe('loadLayout: migrate, then validate', () => {
  it('loads a current document with no migrations', () => {
    const result = loadLayout(validLayoutDocument(), options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fromVersion).toBe(LAYOUT_SCHEMA_VERSION);
    expect(result.migrations).toEqual([]);
    expect(result.layout.target.frameRate).toBe(30);
  });

  it('carries a document one version behind forward and reports what it did', () => {
    const result = loadLayout(v1Document(), {
      ...options,
      migrations: [RAISE_FRAME_RATE],
      targetVersion: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fromVersion).toBe(1);
    expect(result.layout.schemaVersion).toBe(2);
    expect(result.layout.target.frameRate).toBe(60);
    expect(result.migrations).toHaveLength(1);
    expect(formatMigrationReport(result.migrations)).toContain('raise the capture ceiling');
  });

  it('validates the migrated document, so a bad step is caught rather than loaded', () => {
    const breaker: LayoutMigration = {
      from: 1,
      to: 2,
      description: 'introduce a field nothing defines',
      migrate: (document) => ({ ...document, flavour: 'neon' }),
    };

    const issue = issueAt(
      loadLayout(v1Document(), { ...options, migrations: [breaker], targetVersion: 2 }),
      'flavour',
    );

    expect(issue.code).toBe('unknown-field');
  });

  it('refuses a future version before it validates anything', () => {
    expect(codesOf(loadLayout(layoutWith({ schemaVersion: 99 }), options))).toEqual([
      'unsupported-future-version',
    ]);
  });

  it('reports a validation failure in a current document unchanged', () => {
    expect(codesOf(loadLayout(layoutWith({ flavour: 'neon' }), options))).toEqual([
      'unknown-field',
    ]);
  });

  it('still requires the widget registry it was given, migration or not', () => {
    const issues = issuesOf(
      loadLayout(
        layoutWith({
          elements: [
            { kind: 'widget', widget: 'guage', topic: 'a/b', rect: { x: 0, y: 0, w: 1, h: 1 } },
          ],
        }),
        options,
      ),
    );

    expect(issues.map((issue) => issue.code)).toEqual(['unknown-widget']);
  });
});

describe('loadLayoutJson', () => {
  it('loads a layout from text', () => {
    const result = loadLayoutJson(JSON.stringify(validLayoutDocument()), options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.elements).toHaveLength(5);
  });

  it('reports a syntax error as an issue', () => {
    expect(codesOf(loadLayoutJson('{ nope', options))).toEqual(['invalid-json']);
  });

  it('migrates text through the same path as an object', () => {
    const result = loadLayoutJson(JSON.stringify(v1Document()), {
      ...options,
      migrations: [RAISE_FRAME_RATE],
      targetVersion: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.target.frameRate).toBe(60);
  });
});

/**
 * The version 1 / version 2 boundary, in both directions.
 *
 * This is the first real migration, and the first time the machinery carries a document written by
 * a previous format rather than a synthetic one. Both directions matter and they fail differently:
 * forwards, an old file must be carried and the carrying *reported*; backwards, a build that
 * predates the chart must refuse the whole document at its version rather than pick over fields it
 * does not recognise.
 */
describe('the version 1 to version 2 boundary: an old document in a new reader', () => {
  it('migrates a version 1 file forward and reports that it did', () => {
    const result = loadLayout(v1LayoutDocument(), options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fromVersion).toBe(1);
    expect(result.layout.schemaVersion).toBe(2);
    expect(result.migrations.map((step) => `${step.from}->${step.to}`)).toEqual(['1->2']);
    expect(formatMigrationReport(result.migrations)).toContain('chart');
  });

  it('changes nothing in the document but the version, because version 2 only adds', () => {
    const before = v1LayoutDocument();
    const result = migrateLayoutDocument(before);

    expect(migrated(result)).toEqual({ ...before, schemaVersion: 2 });
  });

  it('reports no migration for a document already at version 2', () => {
    const result = loadLayout(validLayoutDocument(), options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrations).toEqual([]);
    expect(formatMigrationReport(result.migrations)).toBe('no migration needed');
  });

  it('loads a version 1 file that is behind but still wrong, without hiding what is wrong', () => {
    // Migration is not a repair. A v1 file with a broken element migrates to v2 and is then
    // refused on its merits, with the element named rather than the version blamed.
    const broken = {
      ...v1LayoutDocument(),
      elements: [
        { kind: 'widget', widget: 'gauge', topic: 'a/b', rect: { x: 0, y: 0, w: 1, h: 1 } },
      ],
    };

    expect(codesOf(loadLayout(broken, options))).toEqual(['missing-range']);
  });
});

describe('the version 1 to version 2 boundary: a chart layout in an old reader', () => {
  /** A version 2 document with a chart in it — what a current editor writes. */
  const chartDocument = (): Record<string, unknown> =>
    layoutWith({
      elements: [
        {
          kind: 'chart',
          widget: 'sparkline',
          topic: 'sensors/cpu/0/load/0',
          rect: { x: 0, y: 0, w: 480, h: 200 },
          windowMs: 300_000,
          range: [0, 100],
        },
      ],
    });

  /**
   * A build that predates the chart: target version 1, and the empty table it shipped with.
   *
   * Both halves are needed, and finding that out is itself worth pinning. `targetVersion: 1` alone
   * throws `RangeError` from `assertLayoutMigrationTable`, because this build's table ends at 2 and
   * a table that overshoots its target is malformed. That is the right error — it is a programmer
   * mistake, not a bad file — but it means `targetVersion` on its own no longer describes an older
   * reader now that the table is non-empty.
   */
  const v1Reader: LoadLayoutOptions = { ...options, targetVersion: 1, migrations: [] };

  it('refuses it at the version, naming the version, before it looks at a single element', () => {
    // The refusal is one issue about `schemaVersion` — not a list of complaints about `windowMs`
    // and an unknown `kind`, which is what field-by-field refusal would have produced and would
    // have blamed the author for.
    const issues = issuesOf(loadLayout(chartDocument(), v1Reader));

    expect(issues.map((issue) => issue.code)).toEqual(['unsupported-future-version']);
    const [only] = issues;
    expect(only?.path).toBe('schemaVersion');
    expect(only?.message).toContain('2');
    expect(only?.message).toContain('1');
  });

  it('refuses it through validateLayout too, pointing at the version and not at the chart', () => {
    // `validateLayout` consults no table, so `targetVersion` alone is a v1 reader here.
    const issue = issueAt(
      validateLayout(chartDocument(), { ...options, targetVersion: 1 }),
      'schemaVersion',
    );

    expect(issue.code).toBe('unsupported-future-version');
    expect(issue.message).toMatch(/upgrade/);
  });

  it('throws rather than guessing when a reader is given a table that cannot reach its target', () => {
    // The mistake the comment on `v1Reader` describes, pinned so the next person meets it as a
    // message rather than as a puzzle. A bad table is programmer input, so it throws.
    expect(() => loadLayout(chartDocument(), { ...options, targetVersion: 1 })).toThrow(RangeError);
  });

  it('would have refused the chart fields as well, which is why the version gate is enough', () => {
    // The belt behind the braces. An old reader's `elements` allowed no `chart` kind and its widget
    // fields allowed no `windowMs`, and both are errors rather than ignored — so even a reader that
    // somehow got past `schemaVersion` could not silently drop what it did not understand. That
    // rule is what makes stamping version 2 a sufficient defence rather than a hopeful one.
    expect(
      codesOf(validateLayout(layoutWith({ elements: [{ kind: 'trend', topic: 'a/b' }] }), options)),
    ).toEqual(['unknown-element-kind']);
  });

  it('accepts a chart at version 2 with no migration, which is the other half of the same gate', () => {
    const result = loadLayout(chartDocument(), options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrations).toEqual([]);
    expect(result.layout.elements[0]?.kind).toBe('chart');
  });

  it('carries a hand-stamped version 1 document containing a chart forward rather than refusing it', () => {
    // Deliberate and worth pinning: migration runs *before* validation and must, because an old
    // document does not satisfy the current field checks — that is what a version is. So a document
    // claiming version 1 while containing version 2 content is migrated and then accepted. No v1
    // writer produced this, and nothing is misread: the chart means at v2 what it says. The
    // alternative, validating at the claimed version first, is the thing the machinery cannot do.
    const handEdited = { ...chartDocument(), schemaVersion: 1 };
    const result = loadLayout(handEdited, options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fromVersion).toBe(1);
    expect(result.layout.schemaVersion).toBe(2);
  });
});

describe('formatMigrationReport', () => {
  it('says so when nothing had to happen', () => {
    expect(formatMigrationReport([])).toBe('no migration needed');
  });

  it('gives one line per step, in order', () => {
    const report = formatMigrationReport([
      { from: 1, to: 2, description: 'first' },
      { from: 2, to: 3, description: 'second' },
    ]);

    expect(report.split('\n')).toEqual(['  1 -> 2: first', '  2 -> 3: second']);
  });
});
