/**
 * The failure vocabulary: the codes a consumer branches on, and the report a human reads.
 */

import { describe, expect, it } from 'vitest';
import {
  formatLayoutIssues,
  LAYOUT_ISSUE_CODES,
  LayoutValidationError,
  validateLayout,
  type LayoutIssue,
  type ValidateLayoutOptions,
} from '@perch/layout-schema';
import { issuesOf, layoutWith, TEST_WIDGETS } from './layout-fixture.test-support.js';

const options: ValidateLayoutOptions = { widgets: TEST_WIDGETS };

const issue = (overrides: Partial<LayoutIssue> = {}): LayoutIssue => ({
  code: 'wrong-type',
  path: 'target.width',
  message: 'expected a number, got a string ("1920")',
  ...overrides,
});

describe('LAYOUT_ISSUE_CODES', () => {
  it('is a closed set with no duplicates', () => {
    expect(new Set(LAYOUT_ISSUE_CODES).size).toBe(LAYOUT_ISSUE_CODES.length);
    expect(LAYOUT_ISSUE_CODES.length).toBeGreaterThan(0);
  });

  it('spells every code in kebab-case, so a consumer can switch on them without surprises', () => {
    for (const code of LAYOUT_ISSUE_CODES) {
      expect(code).toMatch(/^[a-z]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('carries only codes the validators actually produce', () => {
    const produced = new Set(
      issuesOf(validateLayout(layoutWith({ flavour: 'neon' }), options)).map((found) => found.code),
    );

    for (const code of produced) {
      expect(LAYOUT_ISSUE_CODES).toContain(code);
    }
  });
});

describe('formatLayoutIssues', () => {
  it('says so rather than printing nothing when there are none', () => {
    expect(formatLayoutIssues([])).toBe('  (no issues)');
  });

  it('prints path, message and code on one indented line', () => {
    expect(formatLayoutIssues([issue()])).toBe(
      '  target.width: expected a number, got a string ("1920") [wrong-type]',
    );
  });

  it('names the document rather than printing an empty path', () => {
    expect(formatLayoutIssues([issue({ path: '' })])).toContain('<document>');
  });

  it('keeps issues in the order they were collected, which is document order', () => {
    const lines = formatLayoutIssues([
      issue({ path: 'schemaVersion' }),
      issue({ path: 'elements[2].rect.w' }),
    ]).split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('schemaVersion');
    expect(lines[1]).toContain('elements[2].rect.w');
  });
});

describe('LayoutValidationError', () => {
  it('is an Error with its own name and every issue attached', () => {
    const issues = [issue(), issue({ path: 'theme["fg"]', code: 'malformed-theme-token' })];
    const error = new LayoutValidationError(issues);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('LayoutValidationError');
    expect(error.issues).toEqual(issues);
  });

  it('puts the whole report in the message, for a caller with nowhere to render a list', () => {
    const message = new LayoutValidationError([issue(), issue({ path: 'theme' })]).message;

    expect(message).toContain('invalid layout (2 issues)');
    expect(message).toContain('target.width');
    expect(message).toContain('theme');
  });

  it('counts one issue in the singular', () => {
    expect(new LayoutValidationError([issue()]).message).toContain('(1 issue)');
  });

  it('takes a caller-supplied summary', () => {
    expect(new LayoutValidationError([issue()], 'cannot render layout').message).toContain(
      'cannot render layout',
    );
  });
});
