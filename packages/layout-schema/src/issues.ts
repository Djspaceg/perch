/**
 * What a validation failure is.
 *
 * A layout that will not validate is not a layout, so the whole value of this package is
 * in how precisely it can say *no*. "invalid layout" is worthless: the author needs the
 * element index and the field name. Every issue therefore carries a machine-readable
 * `code`, a `path` locating the offending value inside the document, and a message that
 * names the value it rejected.
 *
 * Issues are **collected, not thrown**. The editor shows an author everything wrong with a
 * file in one pass; failing on the first problem would make fixing a layout a sequence of
 * save-and-retry rounds. Callers who want an exception use `assertLayout`.
 */

/**
 * The closed set of things that can be wrong with a layout.
 *
 * A closed union rather than free-text so a consumer can branch on a failure — the editor
 * offers "pick a widget" for `unknown-widget` and "set a range" for `missing-range` — without
 * pattern-matching on English.
 */
export const LAYOUT_ISSUE_CODES = [
  /** The document, or a field that must be an object, is not one. */
  'not-an-object',
  /** A required field is absent. */
  'missing-field',
  /**
   * A field nothing in this schema version defines. An error, never ignored: silently
   * dropping an unrecognised field is how authored work gets destroyed.
   */
  'unknown-field',
  /** Present, but the wrong JSON type. */
  'wrong-type',
  /** A number where the schema requires a whole number of pixels. */
  'not-an-integer',
  /** A number outside the range the field permits (non-finite, non-positive, reversed). */
  'out-of-range',
  /** A string that must carry content and does not. */
  'empty-string',
  /** `schemaVersion` is missing, which is never a recoverable guess. */
  'missing-schema-version',
  /** `schemaVersion` names a version newer than this build understands. */
  'unsupported-future-version',
  /** `schemaVersion` names a version older than the oldest this build can migrate forward. */
  'unsupported-past-version',
  /** A migration step threw. The document is left untouched and unloaded. */
  'migration-failed',
  /** The text was not JSON at all. */
  'invalid-json',
  /** `kind` is not one of the element kinds. */
  'unknown-element-kind',
  /** A widget name that is not spelled like a widget name. */
  'malformed-widget-name',
  /** A widget name the injected registry does not know. */
  'unknown-widget',
  /** A widget that draws a scale, with no authored `range`. */
  'missing-range',
  /** A `range` that cannot describe a scale. */
  'invalid-range',
  /** A topic string that cannot be a single unambiguous sensor binding. */
  'malformed-topic',
  /** A theme or style token that is not a usable CSS custom property. */
  'malformed-theme-token',
  /** A media `src` that is not a relative path beside the layout file. */
  'malformed-media-path',
  /** Media embedded in the layout instead of referenced by path. */
  'embedded-media',
  /** A rect that cannot paint a pixel on this layout's canvas. */
  'off-canvas',
] as const;

export type LayoutIssueCode = (typeof LAYOUT_ISSUE_CODES)[number];

/** One reason a layout was rejected, located precisely enough to act on. */
export interface LayoutIssue {
  readonly code: LayoutIssueCode;
  /**
   * Where the problem is, in dotted-and-bracketed notation rooted at the document:
   * `schemaVersion`, `target.frameRate`, `elements[3].rect.w`, `theme["--fg"]`. The empty
   * string means the document itself.
   */
  readonly path: string;
  /** What is wrong, naming the offending value. Written for an author, not a log scraper. */
  readonly message: string;
  /**
   * Which element the issue is in, when it is in one.
   *
   * Redundant with `path`, and deliberately so: an editor jumping the selection to the bad
   * element should not have to parse a path string to find the index.
   */
  readonly elementIndex?: number;
}

/**
 * Thrown by `assertLayout`, carrying every issue rather than only the first.
 *
 * The runtime validates before rendering and has nowhere to show a list, so its failure mode
 * is a throw whose message is the whole report — a blank panel with a full explanation in the
 * log beats a blank panel and `Error: invalid layout`.
 */
export class LayoutValidationError extends Error {
  readonly issues: readonly LayoutIssue[];

  constructor(issues: readonly LayoutIssue[], summary = 'invalid layout') {
    super(
      `${summary} (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n${formatLayoutIssues(issues)}`,
    );
    this.name = 'LayoutValidationError';
    this.issues = issues;
  }
}

/**
 * Render issues as one indented line each, `path: message [code]`.
 *
 * Path first because that is what an author scans for, and the code last in brackets so a
 * line stays readable while still naming the branch a consumer would switch on.
 */
export function formatLayoutIssues(issues: readonly LayoutIssue[]): string {
  if (issues.length === 0) return '  (no issues)';

  return issues
    .map(
      (issue) =>
        `  ${issue.path === '' ? '<document>' : issue.path}: ${issue.message} [${issue.code}]`,
    )
    .join('\n');
}

/** Append a field to a path. The root path is the empty string, so `x` rather than `.x`. */
export function fieldPath(parent: string, field: string): string {
  return parent === '' ? field : `${parent}.${field}`;
}

/** Append an array index to a path: `elements[3]`. */
export function indexPath(parent: string, index: number): string {
  return `${parent}[${index}]`;
}

/**
 * Append an arbitrary map key to a path: `theme["--fg"]`.
 *
 * Bracket-and-quote rather than dot because a theme key is author-supplied and contains
 * characters (`-`, and whatever a bad key contains) that dotted notation would render
 * ambiguously.
 */
export function keyPath(parent: string, key: string): string {
  return `${parent}[${JSON.stringify(key)}]`;
}

/**
 * Accumulates issues during one validation pass.
 *
 * A mutable collector rather than a returned-and-merged array because validation is a tree
 * walk and threading a growing array back up through every level buys nothing but noise.
 * Internal: the shape a caller sees is `LayoutIssue[]`.
 */
export interface IssueCollector {
  add(code: LayoutIssueCode, path: string, message: string, elementIndex?: number): void;
  readonly issues: readonly LayoutIssue[];
}

export function createIssueCollector(): IssueCollector {
  const issues: LayoutIssue[] = [];

  return {
    add(code, path, message, elementIndex) {
      // Spread-or-nothing rather than `elementIndex` unconditionally, because
      // `exactOptionalPropertyTypes` makes an explicit `undefined` a different value from an
      // absent key, and `{ elementIndex: undefined }` would survive a JSON round trip as a
      // key that is not there.
      issues.push({
        code,
        path,
        message,
        ...(elementIndex === undefined ? {} : { elementIndex }),
      });
    },
    get issues() {
      return issues;
    },
  };
}
