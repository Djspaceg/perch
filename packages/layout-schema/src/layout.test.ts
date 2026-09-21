/**
 * The document-level contract: what a layout is, and how precisely it says no.
 *
 * Element-level rules live in `element.test.ts`; the versioning policy's migration half lives in
 * `migrate.test.ts`. What is here is the whole document — its four fields, its `target`, its
 * unknown-field rule, and the three entry points (`validateLayout`, `assertLayout`, `isLayout`).
 */

import { describe, expect, it } from 'vitest';
import {
  assertLayout,
  isLayout,
  LAYOUT_MAX_DIMENSION,
  LAYOUT_MAX_FRAME_RATE,
  LAYOUT_SCHEMA_VERSION,
  LayoutValidationError,
  parseLayoutJson,
  validateLayout,
  type ValidateLayoutOptions,
} from '@perch/layout-schema';
import {
  codesOf,
  hostile,
  issueAt,
  issuesOf,
  layoutOf,
  layoutWith,
  layoutWithElements,
  TEST_WIDGETS,
  validLayoutDocument,
  without,
} from './layout-fixture.test-support.js';

const options: ValidateLayoutOptions = { widgets: TEST_WIDGETS };

describe('validateLayout, positively', () => {
  it('accepts the fixture and returns it unchanged', () => {
    const layout = layoutOf(validateLayout(validLayoutDocument(), options));

    expect(layout).toEqual(validLayoutDocument());
    expect(layout.elements).toHaveLength(4);
  });

  it('returns a rebuilt layout with exactly the schema fields and no extras', () => {
    const layout = layoutOf(validateLayout(validLayoutDocument(), options));

    expect(Object.keys(layout)).toEqual(['schemaVersion', 'target', 'theme', 'elements']);
    expect(Object.keys(layout.target)).toEqual(['width', 'height', 'frameRate']);
  });

  it('survives a JSON round trip unchanged, per hard rule 1', () => {
    const layout = layoutOf(validateLayout(validLayoutDocument(), options));
    const roundTripped: unknown = JSON.parse(JSON.stringify(layout));

    expect(roundTripped).toEqual(layout);
    expect(isLayout(roundTripped, options)).toBe(true);
  });

  it('accepts an empty theme and an empty element list', () => {
    const layout = layoutOf(validateLayout(layoutWith({ theme: {}, elements: [] }), options));

    expect(layout.theme).toEqual({});
    expect(layout.elements).toEqual([]);
  });

  it('accepts a fractional frame rate, because 29.97 is a real capture rate', () => {
    const layout = layoutOf(
      validateLayout(
        layoutWith({ target: { width: 1920, height: 400, frameRate: 29.97 } }),
        options,
      ),
    );

    expect(layout.target.frameRate).toBeCloseTo(29.97);
  });

  it('preserves element order, because paint order is array order', () => {
    const layout = layoutOf(validateLayout(validLayoutDocument(), options));

    expect(layout.elements.map((element) => element.kind)).toEqual([
      'media',
      'text',
      'widget',
      'widget',
    ]);
  });
});

describe('validateLayout: schemaVersion is mandatory and has no best-effort path', () => {
  it('rejects a document with no schemaVersion, naming the field', () => {
    const issue = issueAt(
      validateLayout(without(validLayoutDocument(), 'schemaVersion'), options),
      'schemaVersion',
    );

    expect(issue.code).toBe('missing-schema-version');
    expect(issue.message).toMatch(/schemaVersion/);
  });

  it('rejects a version from the future, naming both versions', () => {
    const issue = issueAt(
      validateLayout(layoutWith({ schemaVersion: 7 }), options),
      'schemaVersion',
    );

    expect(issue.code).toBe('unsupported-future-version');
    expect(issue.message).toContain('7');
    expect(issue.message).toContain(String(LAYOUT_SCHEMA_VERSION));
  });

  it('rejects a version behind the target, pointing at loadLayout rather than guessing', () => {
    const issue = issueAt(
      validateLayout(validLayoutDocument(), { ...options, targetVersion: 2 }),
      'schemaVersion',
    );

    expect(issue.code).toBe('unsupported-past-version');
    expect(issue.message).toMatch(/loadLayout/);
  });

  it.each([
    ['a fractional version', 1.5, 'not-an-integer'],
    ['version zero', 0, 'out-of-range'],
    ['a stringified version', '1', 'wrong-type'],
    ['a null version', null, 'wrong-type'],
  ])('rejects %s', (_why, schemaVersion, code) => {
    expect(
      issueAt(validateLayout(layoutWith({ schemaVersion }), options), 'schemaVersion').code,
    ).toBe(code);
  });

  it('checks the same fields whatever the target version, so the seam changes nothing else', () => {
    const layout = layoutOf(
      validateLayout(layoutWith({ schemaVersion: 4 }), { ...options, targetVersion: 4 }),
    );

    expect(layout.schemaVersion).toBe(4);
    expect(layout.elements).toHaveLength(4);
  });
});

describe('validateLayout: an unknown field is an error, not a shrug', () => {
  it('rejects an unknown top-level field and prints the fields that do exist', () => {
    const issue = issueAt(validateLayout(layoutWith({ flavour: 'neon' }), options), 'flavour');

    expect(issue.code).toBe('unknown-field');
    expect(issue.message).toContain('"flavour"');
    expect(issue.message).toContain('"schemaVersion"');
    expect(issue.message).toContain('"elements"');
  });

  it('rejects an unknown field inside target', () => {
    expect(
      issueAt(
        validateLayout(
          layoutWith({ target: { width: 1920, height: 400, frameRate: 30, dpi: 96 } }),
          options,
        ),
        'target.dpi',
      ).code,
    ).toBe('unknown-field');
  });

  it('treats an inherited field as absent rather than as configuration', () => {
    const document = Object.assign(hostile<Record<string, unknown>>(Object.create({ theme: {} })), {
      schemaVersion: 1,
      target: { width: 1920, height: 400, frameRate: 30 },
      elements: [],
    });

    expect(issueAt(validateLayout(document, options), 'theme').code).toBe('missing-field');
  });
});

describe('validateLayout: the document itself', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['a string', '{}'],
    ['a number', 1],
  ])('rejects %s as not an object', (_why, candidate) => {
    expect(codesOf(validateLayout(candidate, options))).toEqual(['not-an-object']);
  });
});

describe('validateLayout: target, which is what a mismatched output refuses against', () => {
  it('rejects a missing target', () => {
    expect(
      issueAt(validateLayout(without(validLayoutDocument(), 'target'), options), 'target').code,
    ).toBe('missing-field');
  });

  it.each([
    ['a string target', '1920x400'],
    ['an array target', [1920, 400]],
    ['a null target', null],
  ])('rejects %s', (_why, target) => {
    expect(issueAt(validateLayout(layoutWith({ target }), options), 'target').code).toBe(
      'not-an-object',
    );
  });

  it.each([
    ['a missing width', { height: 400, frameRate: 30 }, 'target.width', 'missing-field'],
    ['a zero width', { width: 0, height: 400, frameRate: 30 }, 'target.width', 'out-of-range'],
    [
      'a fractional width',
      { width: 1920.5, height: 400, frameRate: 30 },
      'target.width',
      'not-an-integer',
    ],
    [
      'a stringified width',
      { width: '1920', height: 400, frameRate: 30 },
      'target.width',
      'wrong-type',
    ],
    [
      'a negative height',
      { width: 1920, height: -400, frameRate: 30 },
      'target.height',
      'out-of-range',
    ],
    [
      'a zero frame rate',
      { width: 1920, height: 400, frameRate: 0 },
      'target.frameRate',
      'out-of-range',
    ],
    ['a missing frame rate', { width: 1920, height: 400 }, 'target.frameRate', 'missing-field'],
  ])('rejects %s', (_why, target, path, code) => {
    expect(issueAt(validateLayout(layoutWith({ target }), options), path).code).toBe(code);
  });

  it('rejects a canvas wider than any hardware can render, naming the ceiling', () => {
    const issue = issueAt(
      validateLayout(
        layoutWith({ target: { width: LAYOUT_MAX_DIMENSION + 1, height: 400, frameRate: 30 } }),
        options,
      ),
      'target.width',
    );

    expect(issue.code).toBe('out-of-range');
    expect(issue.message).toContain(String(LAYOUT_MAX_DIMENSION));
  });

  it('rejects a frame rate that is really a frame interval in milliseconds', () => {
    const issue = issueAt(
      validateLayout(
        layoutWith({ target: { width: 1920, height: 400, frameRate: LAYOUT_MAX_FRAME_RATE + 1 } }),
        options,
      ),
      'target.frameRate',
    );

    expect(issue.code).toBe('out-of-range');
    expect(issue.message).toMatch(/milliseconds/);
  });

  it('rejects a non-finite dimension a GUI computed, which JSON would silently turn into null', () => {
    expect(
      issueAt(
        validateLayout(
          layoutWith({ target: { width: Number.POSITIVE_INFINITY, height: 400, frameRate: 30 } }),
          options,
        ),
        'target.width',
      ).code,
    ).toBe('out-of-range');
  });
});

describe('validateLayout: theme and elements are required, not inferred from absence', () => {
  it('rejects a missing theme and says to write {}', () => {
    const issue = issueAt(
      validateLayout(without(validLayoutDocument(), 'theme'), options),
      'theme',
    );

    expect(issue.code).toBe('missing-field');
    expect(issue.message).toContain('{}');
  });

  it('rejects a missing elements and says to write []', () => {
    const issue = issueAt(
      validateLayout(without(validLayoutDocument(), 'elements'), options),
      'elements',
    );

    expect(issue.code).toBe('missing-field');
    expect(issue.message).toContain('[]');
  });

  it.each([
    ['an object', {}],
    ['a string', 'none'],
    ['a number', 0],
  ])('rejects %s where elements must be an array', (_why, elements) => {
    expect(issueAt(validateLayout(layoutWith({ elements }), options), 'elements').code).toBe(
      'wrong-type',
    );
  });
});

describe('validateLayout: issues are collected, not thrown at the first problem', () => {
  it('reports every problem in one pass', () => {
    const codes = codesOf(
      validateLayout(
        {
          schemaVersion: 1,
          target: { width: 0, height: 400, frameRate: 30 },
          theme: { fg: '#fff' },
          elements: [],
          extra: true,
        },
        options,
      ),
    );

    expect(codes).toContain('unknown-field');
    expect(codes).toContain('out-of-range');
    expect(codes).toContain('malformed-theme-token');
    expect(codes.length).toBeGreaterThanOrEqual(3);
  });

  it('visits every element rather than stopping at the first bad one', () => {
    const issues = issuesOf(
      validateLayout(
        layoutWithElements([
          { kind: 'text', text: '', rect: { x: 0, y: 0, w: 10, h: 10 } },
          { kind: 'text', text: 'ok', rect: { x: 0, y: 0, w: 10, h: 10 } },
          { kind: 'text', text: 'also broken', rect: { x: 0, y: 0, w: 0, h: 10 } },
        ]),
        options,
      ),
    );

    expect(issues.map((issue) => issue.elementIndex)).toEqual([0, 2]);
  });

  it('carries an element index on element issues and none on document issues', () => {
    const issues = issuesOf(
      validateLayout(
        layoutWith({
          flavour: 'neon',
          elements: [{ kind: 'text', text: '', rect: { x: 0, y: 0, w: 10, h: 10 } }],
        }),
        options,
      ),
    );

    for (const issue of issues) {
      if (issue.elementIndex === undefined) {
        expect(issue.path.startsWith('elements[')).toBe(false);
      } else {
        expect(issue.path.startsWith(`elements[${issue.elementIndex}]`)).toBe(true);
      }
    }

    expect(issues.some((issue) => issue.elementIndex === undefined)).toBe(true);
    expect(issues.some((issue) => issue.elementIndex === 0)).toBe(true);
  });

  it('names a field and a location in every message', () => {
    for (const issue of issuesOf(validateLayout({ schemaVersion: 1 }, options))) {
      expect(issue.message.length).toBeGreaterThan(0);
      expect(issue.path.length).toBeGreaterThan(0);
    }
  });
});

describe('assertLayout and isLayout', () => {
  it('returns the layout when it is one', () => {
    expect(assertLayout(validLayoutDocument(), options).target.width).toBe(1920);
  });

  it('throws LayoutValidationError carrying every issue, with the report as the message', () => {
    let thrown: unknown;
    try {
      assertLayout(layoutWith({ flavour: 'neon', theme: { fg: 'x' } }), options);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LayoutValidationError);
    if (!(thrown instanceof LayoutValidationError))
      throw new Error('expected a LayoutValidationError');

    expect(thrown.issues).toHaveLength(2);
    expect(thrown.message).toContain('flavour');
    expect(thrown.message).toContain('unknown-field');
  });

  it('answers yes or no without the reasons', () => {
    expect(isLayout(validLayoutDocument(), options)).toBe(true);
    expect(isLayout(layoutWith({ flavour: 'neon' }), options)).toBe(false);
  });
});

describe('parseLayoutJson', () => {
  it('parses and validates in one step', () => {
    const layout = layoutOf(parseLayoutJson(JSON.stringify(validLayoutDocument()), options));

    expect(layout.target.height).toBe(400);
  });

  it('reports a syntax error as an issue rather than throwing, so there is one error channel', () => {
    const issue = issueAt(parseLayoutJson('{ "schemaVersion": 1,', options), '');

    expect(issue.code).toBe('invalid-json');
  });

  it('rejects well-formed JSON that is not a layout', () => {
    expect(codesOf(parseLayoutJson('[]', options))).toEqual(['not-an-object']);
  });
});
