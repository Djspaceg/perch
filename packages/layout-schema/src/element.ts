/**
 * The three kinds of thing a layout can paint, in paint order.
 *
 * `elements` is an array and its order *is* the z-order: later elements paint over earlier ones.
 * No groups and no nesting in v1 — adding them later is a schema version, adding them now is
 * speculative.
 *
 * The union is discriminated on `kind` rather than inferred from which fields are present,
 * because a text element with an `src` typo would otherwise be a media element with no source
 * when a text element is the obvious intent. Dispatch is a table keyed by `ElementKind`, so a
 * fourth member of `ELEMENT_KINDS` fails to compile until it has a validator.
 *
 * Every validator here follows one convention: it records issues as it goes, and it returns
 * `null` if *any* issue was recorded during its own run — including one from a helper it did not
 * check the return value of. That is why the issue count is snapshotted on entry. Without it, a
 * rejected optional field would have to be distinguishable from an absent one at every call
 * site, and the one time it was not would be an element that validated with its style silently
 * dropped.
 */

import {
  asArray,
  asRecord,
  describeValue,
  optionalLiteral,
  readField,
  rejectUnknownFields,
  requireNonEmptyString,
} from './checks.js';
import { validateRect, type Rect } from './geometry.js';
import { fieldPath, indexPath, type IssueCollector } from './issues.js';
import { MEDIA_FITS, validateMediaPath, type MediaFit } from './media.js';
import type { LayoutValidationContext } from './options.js';
import { isWidgetName } from './registry.js';
import { validateTokenMap, type Style } from './theme.js';

export const ELEMENT_KINDS = ['widget', 'text', 'media'] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

/**
 * The authored scale a widget draws, as `[min, max]`.
 *
 * A design decision, not a measurement. A sensor source reports only observed running extremes —
 * LibreHardwareMonitor's `Min`/`Max` are resettable at runtime — so a gauge fed from them
 * silently rescales as the day's peak moves and is unreadable. A CPU-temperature gauge reading
 * 0-100 is a choice the author makes once, and it belongs in the layout.
 */
export type Range = [number, number];

/** A widget bound to one sensor topic. */
export interface WidgetElement {
  kind: 'widget';
  /**
   * Which widget, by name. A plain string so this package need not know `ui-kit` exists;
   * validated against the registry the consumer injects, so a typo still fails loudly.
   */
  widget: string;
  /** The sensor topic this widget reads. Opaque here; checked by the injected topic validator. */
  topic: string;
  rect: Rect;
  style?: Style;
  /** Required when the widget draws a scale, per its registry entry. */
  range?: Range;
}

/** A literal string painted at a rect. */
export interface TextElement {
  kind: 'text';
  text: string;
  rect: Rect;
  style?: Style;
}

/** An image or video, referenced by a path relative to the layout file. */
export interface MediaElement {
  kind: 'media';
  src: string;
  rect: Rect;
  fit?: MediaFit;
}

/**
 * One paintable thing.
 *
 * Deliberately **not** exported as `Element`, which is what the SPEC's sketch calls it: `runtime`
 * and `editor` are DOM packages where `Element` is already a global type, and an import that
 * shadows it turns every DOM annotation in the importing file into a layout element. Same shape,
 * unambiguous name. See DECISIONS.md.
 */
export type LayoutElement = WidgetElement | TextElement | MediaElement;

const WIDGET_FIELDS = ['kind', 'widget', 'topic', 'rect', 'style', 'range'] as const;
const TEXT_FIELDS = ['kind', 'text', 'rect', 'style'] as const;
const MEDIA_FIELDS = ['kind', 'src', 'rect', 'fit'] as const;

type ElementValidator = (
  record: Readonly<Record<string, unknown>>,
  path: string,
  index: number,
  context: LayoutValidationContext,
  collect: IssueCollector,
) => LayoutElement | null;

/**
 * Kind to validator.
 *
 * `Record<ElementKind, …>` rather than a `switch`, so the exhaustiveness check is the table's own
 * type: a new member of `ELEMENT_KINDS` with no entry here is a compile error, with no `default`
 * branch to forget and no `assertNever` call to remember.
 */
const ELEMENT_VALIDATORS: Readonly<Record<ElementKind, ElementValidator>> = {
  widget: validateWidgetElement,
  text: validateTextElement,
  media: validateMediaElement,
};

export function isElementKind(value: string): value is ElementKind {
  return (ELEMENT_KINDS as readonly string[]).includes(value);
}

/** Validate one entry of `elements`, dispatching on its `kind`. */
export function validateElement(
  candidate: unknown,
  index: number,
  context: LayoutValidationContext,
  collect: IssueCollector,
): LayoutElement | null {
  const path = indexPath('elements', index);

  const record = asRecord(candidate);
  if (record === null) {
    collect.add(
      'not-an-object',
      path,
      `expected an element object, got ${describeValue(candidate)}`,
      index,
    );
    return null;
  }

  const kind = readField(record, 'kind');
  if (kind === undefined) {
    collect.add('missing-field', fieldPath(path, 'kind'), 'missing required field "kind"', index);
    return null;
  }
  if (typeof kind !== 'string' || !isElementKind(kind)) {
    collect.add(
      'unknown-element-kind',
      fieldPath(path, 'kind'),
      `expected one of ${ELEMENT_KINDS.map((name) => JSON.stringify(name)).join(', ')}, got ${describeValue(kind)}`,
      index,
    );
    return null;
  }

  return ELEMENT_VALIDATORS[kind](record, path, index, context, collect);
}

function validateWidgetElement(
  record: Readonly<Record<string, unknown>>,
  path: string,
  index: number,
  context: LayoutValidationContext,
  collect: IssueCollector,
): WidgetElement | null {
  const before = collect.issues.length;

  rejectUnknownFields(record, WIDGET_FIELDS, path, collect, index);
  const widget = validateWidgetIdentity(record, path, index, context, collect);
  const topic = validateTopic(record, path, index, context, collect);
  const rect = validateRect(record, path, context.canvas, collect, index);
  const style = validateOptionalStyle(record, path, index, collect);
  const range = validateOptionalRange(record, path, index, collect);

  // The range requirement is the registry's knowledge, not this package's, so it can only be
  // enforced for a widget the registry actually resolved. An unknown widget has already been
  // reported; adding "and it might also need a range" on top would be a guess.
  //
  // Presence is read from the record rather than from `range`, which is `undefined` both for
  // "absent" and for "authored but rejected". Told apart because they are different messages: an
  // author who wrote `[100, 0]` needs "min < max", and telling them they wrote no range at all
  // while it is on the screen in front of them is worse than saying nothing.
  const rangeAuthored = readField(record, 'range') !== undefined;
  if (widget !== null && !rangeAuthored && context.widgets.get(widget)?.drawsScale === true) {
    collect.add(
      'missing-range',
      fieldPath(path, 'range'),
      `widget ${JSON.stringify(widget)} draws a scale, so it requires an authored range [min, max]; a scale taken from a sensor's observed extremes silently rescales as the day's peak moves`,
      index,
    );
  }

  if (collect.issues.length !== before) return null;
  if (widget === null || topic === null || rect === null) return null;

  return {
    kind: 'widget',
    widget,
    topic,
    rect,
    ...(style === undefined ? {} : { style }),
    ...(range === undefined ? {} : { range }),
  };
}

function validateTextElement(
  record: Readonly<Record<string, unknown>>,
  path: string,
  index: number,
  context: LayoutValidationContext,
  collect: IssueCollector,
): TextElement | null {
  const before = collect.issues.length;

  rejectUnknownFields(record, TEXT_FIELDS, path, collect, index);
  // Empty text is rejected rather than allowed and ignored: it paints a blank rectangle, which on
  // a panel is indistinguishable from a broken binding. An element with nothing to say should be
  // deleted, and the editor validates before saving, so this is caught while it is still a GUI
  // state rather than after it has shipped to the wall.
  const text = requireNonEmptyString(record, path, 'text', collect, index);
  const rect = validateRect(record, path, context.canvas, collect, index);
  const style = validateOptionalStyle(record, path, index, collect);

  if (collect.issues.length !== before) return null;
  if (text === null || rect === null) return null;

  return { kind: 'text', text, rect, ...(style === undefined ? {} : { style }) };
}

function validateMediaElement(
  record: Readonly<Record<string, unknown>>,
  path: string,
  index: number,
  context: LayoutValidationContext,
  collect: IssueCollector,
): MediaElement | null {
  const before = collect.issues.length;

  rejectUnknownFields(record, MEDIA_FIELDS, path, collect, index);
  const raw = requireNonEmptyString(record, path, 'src', collect, index);
  const src = raw === null ? null : validateMediaPath(raw, fieldPath(path, 'src'), collect, index);
  const rect = validateRect(record, path, context.canvas, collect, index);
  const fit = optionalLiteral(record, path, 'fit', MEDIA_FITS, collect, index);

  if (collect.issues.length !== before) return null;
  if (src === null || rect === null) return null;

  return { kind: 'media', src, rect, ...(fit === undefined ? {} : { fit }) };
}

function validateWidgetIdentity(
  record: Readonly<Record<string, unknown>>,
  path: string,
  index: number,
  context: LayoutValidationContext,
  collect: IssueCollector,
): string | null {
  const widget = requireNonEmptyString(record, path, 'widget', collect, index);
  if (widget === null) return null;

  const where = fieldPath(path, 'widget');
  if (!isWidgetName(widget)) {
    collect.add(
      'malformed-widget-name',
      where,
      `widget name must be lower-case alphanumeric groups joined by single hyphens, got ${JSON.stringify(widget)}`,
      index,
    );
    return null;
  }
  if (!context.widgets.has(widget)) {
    const known = context.widgets.names;
    collect.add(
      'unknown-widget',
      where,
      `unknown widget ${JSON.stringify(widget)}; the injected registry knows ${known.length === 0 ? '(nothing)' : known.join(', ')}`,
      index,
    );
    return null;
  }

  return widget;
}

function validateTopic(
  record: Readonly<Record<string, unknown>>,
  path: string,
  index: number,
  context: LayoutValidationContext,
  collect: IssueCollector,
): string | null {
  const topic = requireNonEmptyString(record, path, 'topic', collect, index);
  if (topic === null) return null;

  if (!context.isTopic(topic)) {
    collect.add(
      'malformed-topic',
      fieldPath(path, 'topic'),
      `not a valid sensor topic: ${JSON.stringify(topic)}`,
      index,
    );
    return null;
  }

  return topic;
}

/**
 * The element's style overrides, or `undefined` for both "absent" and "rejected".
 *
 * Collapsing those two is safe only because the caller re-reads the issue count: an invalid style
 * has recorded an issue, so the element is rejected whether or not this returned a value.
 */
function validateOptionalStyle(
  record: Readonly<Record<string, unknown>>,
  path: string,
  index: number,
  collect: IssueCollector,
): Style | undefined {
  const value = readField(record, 'style');
  if (value === undefined) return undefined;

  return validateTokenMap(value, fieldPath(path, 'style'), 'style', collect, index) ?? undefined;
}

/** The authored scale, or `undefined` for both "absent" and "rejected". */
function validateOptionalRange(
  record: Readonly<Record<string, unknown>>,
  path: string,
  index: number,
  collect: IssueCollector,
): Range | undefined {
  const value = readField(record, 'range');
  if (value === undefined) return undefined;

  const where = fieldPath(path, 'range');
  const items = asArray(value);
  if (items === null) {
    collect.add('wrong-type', where, `expected [min, max], got ${describeValue(value)}`, index);
    return undefined;
  }
  if (items.length !== 2) {
    collect.add(
      'invalid-range',
      where,
      `expected exactly two numbers [min, max], got ${items.length}`,
      index,
    );
    return undefined;
  }

  const [min, max] = items;
  if (typeof min !== 'number' || !Number.isFinite(min)) {
    collect.add(
      'wrong-type',
      indexPath(where, 0),
      `expected a finite number for the scale minimum, got ${describeValue(min)}`,
      index,
    );
    return undefined;
  }
  if (typeof max !== 'number' || !Number.isFinite(max)) {
    collect.add(
      'wrong-type',
      indexPath(where, 1),
      `expected a finite number for the scale maximum, got ${describeValue(max)}`,
      index,
    );
    return undefined;
  }
  // `min === max` divides by zero the moment a value is mapped onto the scale. `min > max` is far
  // more often a transposition than a deliberately inverted gauge, and inverting a gauge is the
  // widget's rendering choice rather than a property of the range it is handed.
  if (min >= max) {
    collect.add('invalid-range', where, `expected min < max, got [${min}, ${max}]`, index);
    return undefined;
  }

  return [min, max];
}
