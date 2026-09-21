/**
 * The layout format itself, and the validator that decides whether a file is one.
 *
 * The editor writes this, the runtime reads it, and **both validate it** — this is the only thing
 * standing between a typo and a blank rectangle on a panel. So validation is total: every field
 * is checked, every unknown field is an error, and the returned layout is rebuilt from the
 * checked values rather than handed back as the caller's object narrowed. Rebuilding costs
 * nothing at these sizes and buys a guarantee the narrowing cannot: what comes out is exactly the
 * contract, with no extra keys, no inherited properties, and nothing that will not survive
 * `JSON.parse(JSON.stringify(x))` unchanged.
 */

import {
  asArray,
  asRecord,
  describeValue,
  readField,
  rejectUnknownFields,
  requireFiniteNumber,
  requireInteger,
  requireRecord,
} from './checks.js';
import { validateElement, type LayoutElement } from './element.js';
import {
  createIssueCollector,
  fieldPath,
  LayoutValidationError,
  type IssueCollector,
  type LayoutIssue,
} from './issues.js';
import {
  isTopicShaped,
  type LayoutValidationContext,
  type ValidateLayoutOptions,
} from './options.js';
import { validateTokenMap, type ThemeTokens } from './theme.js';

/**
 * The schema version this build writes and reads natively.
 *
 * Bumped in the same change that adds the migration carrying the previous version forward, never
 * separately — a version with no migration into it is a version that can strand files.
 */
export const LAYOUT_SCHEMA_VERSION = 2;

/**
 * Largest canvas dimension accepted, in pixels.
 *
 * 16384 is the maximum 2D canvas and texture dimension on mainstream hardware, so a layout above
 * it cannot be rendered by any output this project has — better to refuse it here, where the
 * message names the field, than at a silently-blank canvas.
 */
export const LAYOUT_MAX_DIMENSION = 16384;

/**
 * Highest `frameRate` accepted.
 *
 * `frameRate` is a capture ceiling, not a promise, but it still has to be a plausible one: a value
 * above 240 is almost always a unit mistake — a frame *interval* in milliseconds written into a
 * field that wants hertz. Rejecting it names the field instead of producing a capture loop that
 * spins.
 */
export const LAYOUT_MAX_FRAME_RATE = 240;

/**
 * What the layout needs from whatever renders it.
 *
 * Hard rule 3: a layout must be able to declare what it needs, so a target that cannot honour it
 * refuses cleanly and loudly rather than rendering wrong and being discovered on the panel.
 */
export interface LayoutTarget {
  /** Canvas width in pixels. The canvas is fixed at this size and scaled to fit, never reflowed. */
  width: number;
  height: number;
  /** Capture ceiling in hertz, not a promise. A target that cannot reach it says so. */
  frameRate: number;
}

/** A dashboard. */
export interface Layout {
  /** Mandatory and checked on load. There is no best-effort path. */
  schemaVersion: number;
  target: LayoutTarget;
  /** CSS custom property tokens, applied to the whole canvas. */
  theme: ThemeTokens;
  /** Paint order is array order: later elements paint over earlier ones. */
  elements: LayoutElement[];
}

const LAYOUT_FIELDS = ['schemaVersion', 'target', 'theme', 'elements'] as const;
const TARGET_FIELDS = ['width', 'height', 'frameRate'] as const;

/** A validation outcome. Either a layout, or every reason it is not one. */
export type ValidateLayoutResult =
  | { readonly ok: true; readonly layout: Layout }
  | { readonly ok: false; readonly issues: readonly LayoutIssue[] };

/**
 * Validate a candidate **at the current schema version**.
 *
 * This is the editor's pre-save check and the runtime's pre-render check. It does not migrate: a
 * `schemaVersion` other than `LAYOUT_SCHEMA_VERSION` is rejected here, naming both versions. Use
 * `loadLayout` for a document off disk, which migrates first and then calls this.
 */
export function validateLayout(
  candidate: unknown,
  options: ValidateLayoutOptions,
): ValidateLayoutResult {
  const collect = createIssueCollector();

  const record = asRecord(candidate);
  if (record === null) {
    collect.add('not-an-object', '', `expected a layout object, got ${describeValue(candidate)}`);
    return { ok: false, issues: collect.issues };
  }

  rejectUnknownFields(record, LAYOUT_FIELDS, '', collect);

  const targetVersion = options.targetVersion ?? LAYOUT_SCHEMA_VERSION;
  const schemaVersion = validateSchemaVersion(record, targetVersion, collect);
  const target = validateTarget(record, collect);
  const theme = validateTheme(record, collect);

  const context: LayoutValidationContext = {
    widgets: options.widgets,
    isTopic: options.isTopic ?? isTopicShaped,
    canvas: target,
  };
  const elements = validateElements(record, context, collect);

  if (collect.issues.length > 0) return { ok: false, issues: collect.issues };
  if (schemaVersion === null || target === null || theme === null || elements === null) {
    return { ok: false, issues: collect.issues };
  }

  return { ok: true, layout: { schemaVersion, target, theme, elements } };
}

/** Whether `candidate` is a valid layout at the current version. Discards the reasons. */
export function isLayout(candidate: unknown, options: ValidateLayoutOptions): candidate is Layout {
  return validateLayout(candidate, options).ok;
}

/**
 * Validate, or throw `LayoutValidationError` carrying every issue.
 *
 * For the runtime, which has nowhere to render a list of problems: a throw whose message is the
 * whole report beats a blank panel and `Error: invalid layout`.
 */
export function assertLayout(candidate: unknown, options: ValidateLayoutOptions): Layout {
  const result = validateLayout(candidate, options);
  if (!result.ok) throw new LayoutValidationError(result.issues);

  return result.layout;
}

/**
 * Parse layout JSON text and validate it at the current version.
 *
 * A syntax error arrives as an `invalid-json` issue rather than a thrown `SyntaxError`, so a
 * caller reading a file has one error channel instead of two.
 */
export function parseLayoutJson(
  text: string,
  options: ValidateLayoutOptions,
): ValidateLayoutResult {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;

  return validateLayout(parsed.value, options);
}

/** JSON text to an untrusted value, with a parse failure reported as an issue. */
export function parseJson(
  text: string,
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly issues: readonly LayoutIssue[] } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    const collect = createIssueCollector();
    collect.add(
      'invalid-json',
      '',
      `not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false, issues: collect.issues };
  }
}

function validateSchemaVersion(
  record: Readonly<Record<string, unknown>>,
  targetVersion: number,
  collect: IssueCollector,
): number | null {
  const value = readField(record, 'schemaVersion');
  if (value === undefined) {
    collect.add(
      'missing-schema-version',
      'schemaVersion',
      `missing required field "schemaVersion"; it is mandatory and checked on load, because a layout whose version is unknown cannot be read safely at all`,
    );
    return null;
  }

  const version = requireInteger(record, '', 'schemaVersion', { min: 1 }, collect);
  if (version === null) return null;

  if (version !== targetVersion) {
    collect.add(
      version > targetVersion ? 'unsupported-future-version' : 'unsupported-past-version',
      'schemaVersion',
      version > targetVersion
        ? `layout schemaVersion ${version} is newer than this build's ${targetVersion}; upgrade perch to read it`
        : `layout schemaVersion ${version} is older than this build's ${targetVersion}; load it with loadLayout, which migrates it forward`,
    );
    return null;
  }

  return version;
}

function validateTarget(
  record: Readonly<Record<string, unknown>>,
  collect: IssueCollector,
): LayoutTarget | null {
  const target = requireRecord(record, '', 'target', collect);
  if (target === null) return null;

  const before = collect.issues.length;
  rejectUnknownFields(target, TARGET_FIELDS, 'target', collect);

  const width = requireInteger(
    target,
    'target',
    'width',
    { min: 1, max: LAYOUT_MAX_DIMENSION },
    collect,
  );
  const height = requireInteger(
    target,
    'target',
    'height',
    { min: 1, max: LAYOUT_MAX_DIMENSION },
    collect,
  );
  const frameRate = validateFrameRate(target, collect);

  if (collect.issues.length !== before) return null;
  if (width === null || height === null || frameRate === null) return null;

  return { width, height, frameRate };
}

/**
 * `frameRate` is the one number in `target` that is not a pixel count, and so the one that may be
 * fractional: 29.97 and 23.976 are real capture rates.
 */
function validateFrameRate(
  target: Readonly<Record<string, unknown>>,
  collect: IssueCollector,
): number | null {
  const frameRate = requireFiniteNumber(target, 'target', 'frameRate', collect);
  if (frameRate === null) return null;

  const where = fieldPath('target', 'frameRate');
  if (frameRate <= 0) {
    collect.add('out-of-range', where, `expected a frame rate above 0 Hz, got ${frameRate}`);
    return null;
  }
  if (frameRate > LAYOUT_MAX_FRAME_RATE) {
    collect.add(
      'out-of-range',
      where,
      `expected a frame rate of at most ${LAYOUT_MAX_FRAME_RATE} Hz, got ${frameRate}; a larger value is usually a frame interval in milliseconds written into a field that wants hertz`,
    );
    return null;
  }

  return frameRate;
}

function validateTheme(
  record: Readonly<Record<string, unknown>>,
  collect: IssueCollector,
): ThemeTokens | null {
  const value = readField(record, 'theme');
  if (value === undefined) {
    collect.add(
      'missing-field',
      'theme',
      'missing required field "theme"; write {} for a layout that themes nothing, so that "no tokens" is stated rather than inferred from an absent field',
    );
    return null;
  }

  return validateTokenMap(value, 'theme', 'theme', collect);
}

function validateElements(
  record: Readonly<Record<string, unknown>>,
  context: LayoutValidationContext,
  collect: IssueCollector,
): LayoutElement[] | null {
  const value = readField(record, 'elements');
  if (value === undefined) {
    collect.add(
      'missing-field',
      'elements',
      'missing required field "elements"; write [] for an empty canvas',
    );
    return null;
  }

  const items = asArray(value);
  if (items === null) {
    collect.add(
      'wrong-type',
      'elements',
      `expected an array of elements in paint order, got ${describeValue(value)}`,
    );
    return null;
  }

  const elements: LayoutElement[] = [];
  let ok = true;

  // Every element is visited even after one fails, because an author fixing a file wants the whole
  // list of problems, not the first one repeated once per save.
  for (const [index, item] of items.entries()) {
    const element = validateElement(item, index, context, collect);
    if (element === null) {
      ok = false;
      continue;
    }
    elements.push(element);
  }

  return ok ? elements : null;
}
