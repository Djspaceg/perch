/**
 * Every property the inspector shows, as data.
 *
 * A property is a label, a description, a control spec, a way to read its value as text and a way
 * to write it back as a `LayoutUpdate`. The panes never write markup per property: they map these
 * descriptors onto the primitives in `controls/` through `property-view.tsx`. So adding a property
 * is adding one descriptor here, and adding a token is adding one entry to `ui-kit`'s
 * `token-labels.ts` — zero markup either way.
 *
 * Two sources, one shape:
 *
 * - **Tokens** get their spec from their `ui-kit` label (`tokenSpec`): the control kind, the range,
 *   the step, the units, the options. The label is the stamping table.
 * - **Everything else** — the rect, the binding, the chart window, the canvas target — is declared
 *   below, per element kind, because it is the layout format's and not a token.
 */

import {
  CHART_GAPS,
  CHART_MAX_WINDOW_MS,
  CHART_MIN_WINDOW_MS,
  DEFAULT_CHART_GAP,
  MEDIA_FITS,
  type Layout,
  type LayoutElement,
} from '@perch/layout-schema';
import { assertNever, type TokenLabel } from '@perch/ui-kit';
import type { BoxKind } from './controls/index.js';
import {
  numberFromInput,
  numberToInput,
  setElementFit,
  setElementGap,
  setElementRangeBound,
  setElementRectField,
  setElementSrc,
  setElementText,
  setElementTopic,
  setElementWidget,
  setElementWindowMs,
  setTargetField,
  type LayoutUpdate,
  type RectField,
} from './layout-edits.js';

/** The id of the widget-name suggestion list. */
export const WIDGET_LIST_ID = 'perch-editor-widgets';

/** Which primitive a value is edited with, and what that primitive needs to know. */
export type ControlSpec =
  | {
      readonly kind: 'number';
      readonly unit?: string;
      readonly unitText?: string;
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
      readonly bar?: boolean;
    }
  | { readonly kind: 'length'; readonly units: readonly string[] }
  /** A padding or radius: a box diagram of linked sides or corners (`BoxDiagram`). */
  | {
      readonly kind: 'box';
      readonly box: BoxKind;
      readonly min: number;
      readonly max: number;
    }
  | { readonly kind: 'colour'; readonly alpha: boolean }
  /** A sensor topic: the text of it, and the sensor picker (`sensor-picker.tsx`) beside it. */
  | { readonly kind: 'topic' }
  | {
      readonly kind: 'segmented';
      readonly options: readonly { readonly value: string; readonly label: string }[];
      /** Shown when the value is unset, saying what happens instead: `unset · break`. */
      readonly unsetText?: string;
    }
  | {
      readonly kind: 'select';
      readonly options: readonly { readonly value: string; readonly label: string }[];
    }
  | {
      readonly kind: 'text';
      readonly numeric?: true;
      readonly list?: string;
      /** Prose rather than a token: a textarea that grows a few rows with what it holds. */
      readonly multiline?: true;
    };

/** A box token the box field can show: one to four whole, unitless numbers. */
const STORED_SHORTHAND = /^\d+(?:\s+\d+){0,3}$/;

/** Few enough options to lay out as segments in a row. */
const MAX_SEGMENTS = 4;

/** A `#rgb`/`#rrggbb` literal, or with alpha where the token takes it: what the picker can drive. */
export function isHexColor(value: string, alpha = false): boolean {
  const pattern = alpha
    ? /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
    : /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  return pattern.test(value.trim());
}

/** A number with a unit, split — `['1.25', 'rem']` — or `undefined` for anything else. */
export function splitLength(value: string): readonly [string, string] | undefined {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]+)$/.exec(value.trim());

  return match === null ? undefined : [match[1] ?? '', match[2] ?? ''];
}

/** How far a nudge moves a length in `unit`: a pixel or a percent is whole, an `rem` is not. */
export function lengthStep(unit: string): number {
  return unit === 'rem' || unit === 'em' ? 0.05 : 1;
}

/** A value's name for a person, for a closed vocabulary: `start` is `left`. */
export function optionLabel(entry: TokenLabel, value: string): string {
  return entry.optionLabels?.[value] ?? value;
}

/**
 * The control a token's label asks for, for the value it holds now.
 *
 * Falls back to a text box for a value the typed control cannot represent — `clamp(...)` in a size,
 * `rgb()` in a colour — because a control that cannot show the current value hides the very problem
 * the validator is reporting. `validateTokenMap` accepts any well-formed value, so these are legal.
 */
export function tokenSpec(entry: TokenLabel, value: string): ControlSpec {
  const trimmed = value.trim();

  switch (entry.control) {
    case 'colour': {
      const alpha = entry.alpha === true;
      return isHexColor(trimmed, alpha) ? { kind: 'colour', alpha } : { kind: 'text' };
    }
    case 'pixels':
      if (entry.shorthand !== undefined) {
        return STORED_SHORTHAND.test(trimmed) && entry.range !== undefined
          ? { kind: 'box', box: entry.shorthand, min: entry.range.min, max: entry.range.max }
          : { kind: 'text', numeric: true };
      }
      return /^\d+$/.test(trimmed) && entry.range !== undefined
        ? {
            kind: 'number',
            unit: 'px',
            unitText: 'layout px',
            min: entry.range.min,
            max: entry.range.max,
            step: 1,
            bar: true,
          }
        : { kind: 'text', numeric: true };
    case 'number': {
      if (trimmed === '' || !Number.isFinite(Number(trimmed)))
        return { kind: 'text', numeric: true };
      return {
        kind: 'number',
        ...(entry.range === undefined
          ? {}
          : { min: entry.range.min, max: entry.range.max, bar: true }),
        ...(entry.step === undefined ? {} : { step: entry.step }),
      };
    }
    case 'length':
      return splitLength(trimmed) === undefined
        ? { kind: 'text' }
        : { kind: 'length', units: entry.units ?? [] };
    case 'choice': {
      const options = entry.options ?? [];
      if (!options.includes(trimmed)) return { kind: 'text' };
      const labelled = options.map((option) => ({
        value: option,
        label: optionLabel(entry, option),
      }));
      return options.length <= MAX_SEGMENTS
        ? { kind: 'segmented', options: labelled }
        : { kind: 'select', options: labelled };
    }
    case 'text':
      return { kind: 'text' };
    default:
      return assertNever(entry.control, 'token control');
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Non-token properties                                                                             */
/* ------------------------------------------------------------------------------------------------ */

/** One value, one control. `write` is handed the element's index; the target ignores it. */
export interface ScalarProperty<Subject> {
  readonly kind: 'scalar';
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly spec: ControlSpec;
  readonly get: (subject: Subject) => string;
  readonly write: (text: string, index: number) => LayoutUpdate;
}

/** Several numbers under one label, in one row: a VectorField. */
export interface VectorProperty<Subject> {
  readonly kind: 'vector';
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly unit?: string;
  readonly fields: readonly {
    readonly key: string;
    readonly label: string;
    readonly ariaLabel?: string;
    readonly axis?: 'x' | 'y' | 'w' | 'h';
    readonly min?: number;
    readonly get: (subject: Subject) => string;
    readonly write: (text: string, index: number) => LayoutUpdate;
  }[];
}

export type Property<Subject> = ScalarProperty<Subject> | VectorProperty<Subject>;

/** A titled group of properties: one folding Section. */
export interface PropertySection<Subject> {
  readonly id: 'transform' | 'content';
  readonly title: string;
  readonly properties: readonly Property<Subject>[];
}

/** One rect component, as a vector field. */
function rectField(key: RectField, min?: number): VectorProperty<LayoutElement>['fields'][number] {
  return {
    key,
    label: key,
    axis: key,
    ...(min === undefined ? {} : { min }),
    get: (element) => numberToInput(element.rect[key]),
    write: (text, index) => setElementRectField(index, key, numberFromInput(text)),
  };
}

const POSITION: VectorProperty<LayoutElement> = {
  kind: 'vector',
  id: 'position',
  label: 'position',
  description: 'Where the top-left corner sits on the canvas, in layout pixels.',
  unit: 'px',
  fields: [rectField('x'), rectField('y')],
};

const SIZE: VectorProperty<LayoutElement> = {
  kind: 'vector',
  id: 'size',
  label: 'size',
  description: 'The rectangle’s width and height, in layout pixels. At least 1.',
  unit: 'px',
  fields: [rectField('w', 1), rectField('h', 1)],
};

const WIDGET: ScalarProperty<LayoutElement> = {
  kind: 'scalar',
  id: 'widget',
  label: 'widget',
  description: 'Which registered widget draws this entity.',
  spec: { kind: 'text', list: WIDGET_LIST_ID },
  get: (element) => (element.kind === 'widget' || element.kind === 'chart' ? element.widget : ''),
  write: (text, index) => setElementWidget(index, text),
};

const TOPIC: ScalarProperty<LayoutElement> = {
  kind: 'scalar',
  id: 'topic',
  label: 'topic',
  description: 'The sensor topic this entity reads.',
  spec: { kind: 'topic' },
  get: (element) => (element.kind === 'widget' || element.kind === 'chart' ? element.topic : ''),
  write: (text, index) => setElementTopic(index, text),
};

const TEXT: ScalarProperty<LayoutElement> = {
  kind: 'scalar',
  id: 'text',
  label: 'text',
  description: 'What the text element says.',
  // A textarea: this is prose an author writes, often a sentence or two, and a one-line input showed
  // a sliver of it. The other free-text fields (src, topic, widget) are identifiers and stay one line.
  spec: { kind: 'text', multiline: true },
  get: (element) => (element.kind === 'text' ? element.text : ''),
  write: (text, index) => setElementText(index, text),
};

const SRC: ScalarProperty<LayoutElement> = {
  kind: 'scalar',
  id: 'src',
  label: 'src',
  description: 'The image file, relative to the layout.',
  spec: { kind: 'text' },
  get: (element) => (element.kind === 'media' ? element.src : ''),
  write: (text, index) => setElementSrc(index, text),
};

const FIT: ScalarProperty<LayoutElement> = {
  kind: 'scalar',
  id: 'fit',
  label: 'fit',
  description: 'How the image fills its rectangle.',
  spec: {
    kind: 'segmented',
    options: MEDIA_FITS.map((fit) => ({ value: fit, label: fit })),
    unsetText: 'unset · the canvas decides',
  },
  get: (element) => (element.kind === 'media' ? (element.fit ?? '') : ''),
  write: (text, index) => {
    // Narrowed by a lookup rather than a cast: a value no option carries is not a thing to write.
    const fit = MEDIA_FITS.find((option) => option === text);
    return fit === undefined ? (layout) => layout : setElementFit(index, fit);
  },
};

const WINDOW_MS: ScalarProperty<LayoutElement> = {
  kind: 'scalar',
  id: 'windowMs',
  label: 'windowMs',
  description: `How much history the chart shows, ${CHART_MIN_WINDOW_MS}-${CHART_MAX_WINDOW_MS} ms.`,
  spec: {
    kind: 'number',
    unit: 'ms',
    min: CHART_MIN_WINDOW_MS,
    max: CHART_MAX_WINDOW_MS,
    step: 1000,
    bar: true,
  },
  get: (element) => (element.kind === 'chart' ? numberToInput(element.windowMs) : ''),
  write: (text, index) => setElementWindowMs(index, numberFromInput(text)),
};

const GAP: ScalarProperty<LayoutElement> = {
  kind: 'scalar',
  id: 'gap',
  label: 'gap',
  description: 'What the line does across a stretch with no readings.',
  spec: {
    kind: 'segmented',
    options: CHART_GAPS.map((gap) => ({ value: gap, label: gap })),
    unsetText: `unset · ${DEFAULT_CHART_GAP}`,
  },
  get: (element) => (element.kind === 'chart' ? (element.gap ?? '') : ''),
  write: (text, index) => {
    const gap = CHART_GAPS.find((option) => option === text);
    return gap === undefined ? (layout) => layout : setElementGap(index, gap);
  },
};

/** The y-scale's two ends. Only on an element that already has one: see `inspector.tsx`. */
const RANGE: VectorProperty<LayoutElement> = {
  kind: 'vector',
  id: 'range',
  label: 'range',
  description: 'The bottom and top of the scale the widget is drawn against.',
  fields: (['min', 'max'] as const).map((bound, position) => ({
    key: bound,
    label: bound,
    ariaLabel: `range ${bound}`,
    get: (element: LayoutElement) =>
      (element.kind === 'widget' || element.kind === 'chart') && element.range !== undefined
        ? numberToInput(element.range[position] ?? Number.NaN)
        : '',
    write: (text: string, index: number) =>
      setElementRangeBound(index, bound, numberFromInput(text)),
  })),
};

/**
 * An element's own sections: the Content its kind carries, then Transform for every kind.
 *
 * Content leads because it holds what the element *is* — for a reading or a chart, the sensor it
 * reads — and choosing that is the first thing an author does with a new element.
 */
export function entitySections(element: LayoutElement): readonly PropertySection<LayoutElement>[] {
  const transform: PropertySection<LayoutElement> = {
    id: 'transform',
    title: 'Transform',
    properties: [POSITION, SIZE],
  };
  const withRange = (
    properties: readonly Property<LayoutElement>[],
  ): readonly Property<LayoutElement>[] =>
    (element.kind === 'widget' || element.kind === 'chart') && element.range !== undefined
      ? [...properties, RANGE]
      : properties;

  let content: readonly Property<LayoutElement>[];
  switch (element.kind) {
    case 'text':
      content = [TEXT];
      break;
    case 'media':
      content = [SRC, FIT];
      break;
    case 'widget':
      content = withRange([WIDGET, TOPIC]);
      break;
    case 'chart':
      content = withRange([WIDGET, TOPIC, WINDOW_MS, GAP]);
      break;
    default:
      return assertNever(element, 'layout element');
  }

  return [{ id: 'content', title: 'Content', properties: content }, transform];
}

type Target = Layout['target'];

const TARGET_SIZE: VectorProperty<Target> = {
  kind: 'vector',
  // Not `size`: the selected entity's rect has a `size` row on the same page.
  id: 'canvas',
  label: 'size',
  description: 'The canvas this layout is authored for, in layout pixels.',
  unit: 'px',
  fields: (['width', 'height'] as const).map((field) => ({
    key: field,
    // The full word, not `w`: the rect's own `w` is a different field, and the two must not share
    // an accessible name on one page.
    label: field,
    axis: field === 'width' ? ('w' as const) : ('h' as const),
    min: 1,
    get: (target: Target) => numberToInput(target[field]),
    write: (text: string) => setTargetField(field, numberFromInput(text)),
  })),
};

const FRAME_RATE: ScalarProperty<Target> = {
  kind: 'scalar',
  id: 'frameRate',
  label: 'frameRate',
  description: 'How often the panel repaints, per second.',
  spec: { kind: 'number', unit: 'fps', min: 1, step: 1 },
  get: (target) => numberToInput(target.frameRate),
  write: (text) => setTargetField('frameRate', numberFromInput(text)),
};

/** The canvas target's properties. */
export function targetProperties(): readonly Property<Target>[] {
  return [TARGET_SIZE, FRAME_RATE];
}
