/**
 * What each token *means*, in words a person who is not holding this file can read.
 *
 * `tokens.ts` declares the widget vocabulary and `layout-canvas.tsx` the canvas' own two; between them
 * they are the 36 custom properties a layout's `theme` can set to any effect. Neither says
 * `--perch-faint` is "the colour of a placeholder" anywhere a program can reach — the sentence exists,
 * but as a doc comment, which is to say as something only a reader of this package ever sees.
 *
 * This is that sentence, as data. It exists because an editor has to put *something* beside a colour
 * picker, and the alternatives were both worse than a table here:
 *
 * - **Labels in the editor.** The editor would then own names for a vocabulary it does not own. A
 *   token added here would arrive in the editor's pane as `--perch-whatever` with no label, and the
 *   way that gets noticed is an author asking what a row means.
 * - **Labels in the layout file.** That is a `layout-schema` field, which is to say a format change,
 *   a migration, and a per-layout copy of a name that is the same in every layout. It is also the
 *   wrong owner: the label for `--perch-chart-grid` is a fact about this package's chart, not about
 *   any one dashboard.
 *
 * ## Why the control kind is here too
 *
 * Roughly a third of the vocabulary is colour; the rest is font stacks, sizes in `rem`, numeric
 * weights, opacities, and four genuinely enumerated values. A pane that offered a colour picker for
 * the colours and a text box for everything else would be a pane where over half the theme is typed
 * blind. Which control fits a token is decided by what the token *is*, and what it is is knowledge
 * this package has: `--perch-text-transform` takes a `text-transform` value, and the set of those is
 * closed here, not in the editor.
 *
 * So each entry carries the control kind, and for a closed vocabulary its options. The invariant that
 * keeps this honest is in `token-labels.test.ts`: every declared control must be able to hold the
 * default this package ships for that token. A colour control on `--perch-font` fails the build.
 *
 * ## What this does not do
 *
 * It does not constrain what a layout may set. `layout-schema`'s `validateTokenMap` accepts any
 * well-formed custom property with a well-formed value, deliberately, so a layout may carry a name
 * this table has never heard of — `tokenLabel` answers `undefined` for those, and a consumer is
 * expected to say "no label" rather than to invent one or to hide the row.
 */

import type { ElementKind } from '@perch/layout-schema';
import { CANVAS_TOKEN_DEFAULTS, type CanvasToken } from './layout-canvas.js';
import { PERCH_TOKEN_DEFAULTS, type PerchToken } from './tokens.js';

/** Every token this package declares a default for: the widget vocabulary, plus the canvas' own. */
export type KnownToken = PerchToken | CanvasToken;

/**
 * The kind of control a token's values want.
 *
 * Six, not one per token and not one for all: `colour` is a hex literal a picker can drive, `length`
 * is a number with a unit, `number` is unitless (a weight, an opacity, a line height), `pixels` is a
 * unitless whole count of layout pixels with a bounded `range` (a slider and a number, paired),
 * `choice` is a vocabulary closed in CSS itself, and `text` is everything that is legitimately open — a
 * font stack, and `letter-spacing`, which is a length *or* the keyword `normal`.
 */
export type TokenControl = 'colour' | 'length' | 'number' | 'pixels' | 'choice' | 'text';

/**
 * Which section of an inspector a token belongs in: what the token is ABOUT, from an author's side.
 *
 * `appearance` is the surface itself (a box's background, corners and inset, the canvas fills, the
 * opacities); `placement` is where content sits inside its box; `typography` is the type; `colour` is
 * the colour of what is drawn. Every token is in exactly one.
 */
export type TokenGroup = 'appearance' | 'placement' | 'typography' | 'colour';

/**
 * Where a token is read, and therefore which surface can usefully set it.
 *
 * `box` is the element's own box — `.perch-element`, one per entity — which an element's `style` sets
 * directly and a layout's `theme` sets for every styled entity at once, by inheritance.
 */
export type TokenScope = 'canvas' | 'box' | 'widget';

/** One token, described for a person. */
export interface TokenLabel {
  /** The name a consumer sees instead of the custom property. */
  readonly label: string;
  /** One line on what changing it does. */
  readonly description: string;
  readonly control: TokenControl;
  readonly group: TokenGroup;
  /**
   * `canvas` for a token the canvas element reads, `widget` for one a widget reads.
   *
   * The distinction matters to an *element*-level style map: setting `--perch-canvas-bg` on one
   * element's box changes nothing, because the canvas reads it a level up.
   */
  readonly scope: TokenScope;
  /** For `choice`: the whole vocabulary, in the order a pane should offer it. */
  readonly options?: readonly string[];
  /**
   * For `choice`: what to call each option, where the CSS spelling is not what a person would say.
   * `flex-start` is how the value is written; `left` is what it does.
   */
  readonly optionLabels?: Readonly<Record<string, string>>;
  /** For `length`: the units worth offering. The token's own default unit is always among them. */
  readonly units?: readonly string[];
  /**
   * For `pixels`, required: the slider's bounds, in layout pixels. For `number`, where the value has a
   * natural span (an opacity, a font weight). A typed value may go past them.
   */
  readonly range?: { readonly min: number; readonly max: number };
  /** For a numeric control: how far one nudge moves the value, where one unit is not the answer. */
  readonly step?: number;
  /**
   * A token an author tunes rarely: an inspector folds it behind an "Advanced" disclosure inside its
   * group, rather than moving it to a group it is not about.
   */
  readonly advanced?: true;
  /**
   * For a placement token: which axis it is, and the token for the other axis. The two are one
   * control — a grid where each cell sets both — so the pairing is data, not a naming convention.
   */
  readonly placement?: { readonly axis: 'across' | 'down'; readonly pair: KnownToken };
  /** For `colour`: whether the value carries an alpha pair (`#rrggbbaa`). */
  readonly alpha?: true;
  /**
   * For `pixels`: the value is a one-to-four-value CSS shorthand (`box-shorthand.ts`), of a box's four
   * sides (padding) or its four corners (radius). Absent means one number.
   */
  readonly shorthand?: 'sides' | 'corners';
  /**
   * The element kinds whose rendering reads this token, for a token only some kinds read.
   *
   * Absent means every styled kind. Present only where offering the token to the other kinds would be
   * a control that does nothing — placement, which a readout and a text element each read under their
   * own name and a chart does not read at all, because its plot fills its box by arithmetic.
   */
  readonly kinds?: readonly ElementKind[];
}

/** Placement across, for a readout: the `start | center | end` spelling, said as a direction. */
const ACROSS: Readonly<Record<string, string>> = Object.freeze({
  start: 'left',
  center: 'centre',
  end: 'right',
});

/** Placement down, for a readout. */
const DOWN: Readonly<Record<string, string>> = Object.freeze({
  start: 'top',
  center: 'middle',
  end: 'bottom',
});

/** The units a length control offers. `rem` first: every default in this package is written in it. */
const LENGTH_UNITS: readonly string[] = Object.freeze(['rem', 'px', 'em', '%']);

/**
 * The sections, in the order a pane should show them.
 *
 * The author's order, not the storage order: first how an entity looks (its surface), then where its
 * content sits, then its type, then its colours. An inspector stamps one folding section per group,
 * with the `advanced` tokens of each behind a foldout inside it.
 */
export const TOKEN_GROUPS: readonly { readonly group: TokenGroup; readonly title: string }[] =
  Object.freeze([
    { group: 'appearance', title: 'Appearance' },
    { group: 'placement', title: 'Placement' },
    { group: 'typography', title: 'Typography' },
    { group: 'colour', title: 'Colour' },
  ]);

/**
 * Every token, described.
 *
 * Written out rather than derived, because a label is not computable from a token name — that is the
 * point of having it. The order is the order `tokens.ts` declares them in, then the canvas' two, so a
 * reader can hold the two files side by side.
 */
export const PERCH_TOKEN_LABELS: Readonly<Record<KnownToken, TokenLabel>> = Object.freeze({
  '--perch-font': {
    label: 'Font family',
    description: 'The font stack every widget uses. A CSS font list, first available wins.',
    control: 'text',
    group: 'typography',
    scope: 'widget',
  },

  '--perch-fg': {
    label: 'Reading colour',
    description: 'The big number in a readout, when it is current and worth believing.',
    control: 'colour',
    group: 'colour',
    scope: 'widget',
  },
  '--perch-dim': {
    label: 'Unit and label colour',
    description: 'The unit beside a reading and the caption under it. Present, but subordinate.',
    control: 'colour',
    group: 'colour',
    scope: 'widget',
  },
  '--perch-faint': {
    label: 'Placeholder colour',
    description: 'A reading that has not arrived yet, and the "waiting" note. Recedes.',
    control: 'colour',
    group: 'colour',
    scope: 'widget',
    advanced: true,
  },
  '--perch-stale': {
    label: 'Stale reading colour',
    description: 'A value too old to believe, and the stale note beside it.',
    control: 'colour',
    group: 'colour',
    scope: 'widget',
    advanced: true,
  },
  '--perch-warn': {
    label: 'Warning colour',
    description: 'A sensor that is present and reporting nothing. Notice it; do not act.',
    control: 'colour',
    group: 'colour',
    scope: 'widget',
    advanced: true,
  },
  '--perch-alert': {
    label: 'Alert colour',
    description: 'Something is wrong upstream of the dashboard.',
    control: 'colour',
    group: 'colour',
    scope: 'widget',
    advanced: true,
  },

  '--perch-value-weight': {
    label: 'Reading weight',
    description: 'How heavy the big number is. 400 is regular, 700 bold.',
    control: 'number',
    group: 'typography',
    scope: 'widget',
    range: Object.freeze({ min: 100, max: 900 }),
    step: 100,
  },
  '--perch-value-size-min': {
    label: 'Reading size, floor',
    description:
      'The smallest the big number goes. It scales with the widget between floor and cap.',
    control: 'length',
    group: 'typography',
    scope: 'widget',
    units: LENGTH_UNITS,
    advanced: true,
  },
  '--perch-value-size-max': {
    label: 'Reading size, cap',
    description: 'The largest the big number goes, however wide the widget is.',
    control: 'length',
    group: 'typography',
    scope: 'widget',
    units: LENGTH_UNITS,
    advanced: true,
  },
  '--perch-unit-size': {
    label: 'Unit size',
    description: 'The unit printed after a reading.',
    control: 'length',
    group: 'typography',
    scope: 'widget',
    units: LENGTH_UNITS,
  },
  '--perch-label-size': {
    label: 'Readout caption size',
    description: 'The caption under a reading.',
    control: 'length',
    group: 'typography',
    scope: 'widget',
    units: LENGTH_UNITS,
  },

  '--perch-text-size': {
    label: 'Text size',
    description: 'The size of a text element: a title, a caption, a note.',
    control: 'length',
    group: 'typography',
    scope: 'widget',
    units: LENGTH_UNITS,
  },
  '--perch-text-weight': {
    label: 'Text weight',
    description: 'How heavy a text element is. 400 is regular, 700 bold.',
    control: 'number',
    group: 'typography',
    scope: 'widget',
    range: Object.freeze({ min: 100, max: 900 }),
    step: 100,
  },
  '--perch-text-color': {
    label: 'Text colour',
    description: 'The colour of a text element.',
    control: 'colour',
    group: 'colour',
    scope: 'widget',
  },
  '--perch-text-tracking': {
    label: 'Text letter spacing',
    description: 'normal, or a length like 0.08em. Wide tracking suits small uppercase captions.',
    control: 'text',
    group: 'typography',
    scope: 'widget',
    advanced: true,
  },
  '--perch-text-transform': {
    label: 'Text capitalisation',
    description: 'Whether a text element is printed as written, or cased by the renderer.',
    control: 'choice',
    group: 'typography',
    scope: 'widget',
    options: Object.freeze(['none', 'uppercase', 'lowercase', 'capitalize']),
  },
  '--perch-text-line-height': {
    label: 'Text line height',
    description:
      'Line spacing, as a multiple of the text size. Only visible on more than one line.',
    control: 'number',
    group: 'typography',
    scope: 'widget',
    step: 0.05,
    advanced: true,
  },
  '--perch-text-justify': {
    label: 'Text placement, across',
    description: 'Where the text sits horizontally inside its own rectangle.',
    control: 'choice',
    group: 'placement',
    scope: 'widget',
    options: Object.freeze(['flex-start', 'center', 'flex-end', 'space-between']),
    optionLabels: Object.freeze({
      'flex-start': 'left',
      center: 'centre',
      'flex-end': 'right',
      'space-between': 'spread',
    }),
    kinds: Object.freeze(['text'] as const),
    placement: Object.freeze({ axis: 'across', pair: '--perch-text-anchor' } as const),
  },
  '--perch-text-anchor': {
    label: 'Text placement, down',
    description: 'Where the text sits vertically inside its own rectangle.',
    control: 'choice',
    group: 'placement',
    scope: 'widget',
    options: Object.freeze(['flex-start', 'center', 'flex-end', 'stretch']),
    optionLabels: Object.freeze({
      'flex-start': 'top',
      center: 'middle',
      'flex-end': 'bottom',
      stretch: 'fill',
    }),
    kinds: Object.freeze(['text'] as const),
    placement: Object.freeze({ axis: 'down', pair: '--perch-text-justify' } as const),
  },
  '--perch-text-align': {
    label: 'Text line alignment',
    description: 'Which edge lines break towards, for text carrying more than one line.',
    control: 'choice',
    group: 'typography',
    scope: 'widget',
    options: Object.freeze(['left', 'center', 'right', 'justify']),
  },

  '--perch-readout-justify': {
    label: 'Readout placement, across',
    description: 'Where the number, unit and caption sit horizontally inside the readout box.',
    control: 'choice',
    group: 'placement',
    scope: 'widget',
    options: Object.freeze(['start', 'center', 'end']),
    optionLabels: ACROSS,
    kinds: Object.freeze(['widget'] as const),
    placement: Object.freeze({ axis: 'across', pair: '--perch-readout-anchor' } as const),
  },
  '--perch-readout-anchor': {
    label: 'Readout placement, down',
    description: 'Where the number, unit and caption sit vertically inside the readout box.',
    control: 'choice',
    group: 'placement',
    scope: 'widget',
    options: Object.freeze(['start', 'center', 'end']),
    optionLabels: DOWN,
    kinds: Object.freeze(['widget'] as const),
    placement: Object.freeze({ axis: 'down', pair: '--perch-readout-justify' } as const),
  },

  '--perch-media-opacity': {
    label: 'Image opacity',
    description: 'How strongly an image paints. 0 is invisible, 1 is solid.',
    control: 'number',
    group: 'appearance',
    scope: 'widget',
    range: Object.freeze({ min: 0, max: 1 }),
    step: 0.05,
    advanced: true,
  },

  '--perch-chart-series': {
    label: 'Chart line colour',
    description: 'The plotted line and the wash under it. The one colour on a chart carrying data.',
    control: 'colour',
    group: 'colour',
    scope: 'widget',
  },
  '--perch-chart-area-opacity': {
    label: 'Chart fill opacity',
    description: 'How solid the wash under the line is. A wash, never a block.',
    control: 'number',
    group: 'appearance',
    scope: 'widget',
    range: Object.freeze({ min: 0, max: 1 }),
    step: 0.05,
    advanced: true,
  },
  '--perch-chart-grid': {
    label: 'Chart gridline colour',
    description: 'The gridlines. Chrome: they must lose every contest with the line.',
    control: 'colour',
    group: 'colour',
    scope: 'widget',
  },
  '--perch-chart-surface': {
    label: 'Chart surface colour',
    description:
      'What the chart is drawn on. Set it to match whatever is actually behind the chart.',
    control: 'colour',
    group: 'colour',
    scope: 'widget',
  },
  '--perch-chart-value-size': {
    label: 'Chart reading size',
    description: 'The newest reading, printed in the chart header.',
    control: 'length',
    group: 'typography',
    scope: 'widget',
    units: LENGTH_UNITS,
  },
  '--perch-chart-label-size': {
    label: 'Chart caption size',
    description: 'The chart caption.',
    control: 'length',
    group: 'typography',
    scope: 'widget',
    units: LENGTH_UNITS,
  },
  '--perch-chart-axis-size': {
    label: 'Chart axis size',
    description: 'The chart footer: the window it covers and the scale it is drawn against.',
    control: 'length',
    group: 'typography',
    scope: 'widget',
    units: LENGTH_UNITS,
    advanced: true,
  },

  '--perch-box-bg': {
    label: 'Background',
    description:
      'Behind this entity, filling its rectangle. The last hex pair is opacity: 00 clear, ff solid.',
    control: 'colour',
    group: 'appearance',
    scope: 'box',
    alpha: true,
  },
  '--perch-box-radius': {
    label: 'Corner radius',
    description:
      'How round the rectangle’s corners are, in layout pixels: one value, or up to four from the top-left corner clockwise. Scales with the panel.',
    control: 'pixels',
    group: 'appearance',
    scope: 'box',
    range: Object.freeze({ min: 0, max: 64 }),
    shorthand: 'corners',
  },
  '--perch-box-padding': {
    label: 'Padding',
    description:
      'Space inside the rectangle’s edge, in layout pixels: one value, or up to four as in CSS, top right bottom left. The rectangle keeps its size; the content shrinks.',
    control: 'pixels',
    group: 'appearance',
    scope: 'box',
    range: Object.freeze({ min: 0, max: 48 }),
    shorthand: 'sides',
  },

  '--perch-canvas-bg': {
    label: 'Canvas background',
    description: 'Behind every element: the dashboard’s own background colour.',
    control: 'colour',
    group: 'appearance',
    scope: 'canvas',
  },
  '--perch-letterbox-bg': {
    label: 'Letterbox background',
    description: 'The bars outside the canvas when the screen is not the layout’s shape.',
    control: 'colour',
    group: 'appearance',
    scope: 'canvas',
  },
});

/** Every known token, in the order the table declares them. */
export const PERCH_KNOWN_TOKENS: readonly KnownToken[] = Object.freeze(
  Object.keys(PERCH_TOKEN_LABELS) as KnownToken[],
);

/**
 * The value a token has when no layout sets it, for any known token.
 *
 * The two defaults records joined, and joined *here* rather than in either of them: they stay apart
 * because they are read at different levels (see `CANVAS_TOKEN_DEFAULTS`), and a consumer that wants
 * to say "this is the default, and the layout is not overriding it" needs one lookup rather than two
 * and a guess about which record a name is in.
 */
export const PERCH_KNOWN_TOKEN_DEFAULTS: Readonly<Record<KnownToken, string>> = Object.freeze({
  ...PERCH_TOKEN_DEFAULTS,
  ...CANVAS_TOKEN_DEFAULTS,
});

/** Whether `name` is a token this package declares. Narrows, so a lookup needs no cast. */
export function isKnownToken(name: string): name is KnownToken {
  return Object.prototype.hasOwnProperty.call(PERCH_TOKEN_LABELS, name);
}

/**
 * How to describe `name` to a person, or `undefined` if this package has never heard of it.
 *
 * `undefined` is a real answer and a caller is expected to render it as one: a layout may set any
 * well-formed custom property, and a row that hid an unknown name would hide part of the document.
 */
export function tokenLabel(name: string): TokenLabel | undefined {
  return isKnownToken(name) ? PERCH_TOKEN_LABELS[name] : undefined;
}

/** The declared default for `name`, or `undefined` for a name this package does not declare. */
export function knownTokenDefault(name: string): string | undefined {
  return isKnownToken(name) ? PERCH_KNOWN_TOKEN_DEFAULTS[name] : undefined;
}
