/**
 * The theme vocabulary: every CSS custom property a widget in this package reads.
 *
 * A layout's `theme` and an element's `style` are maps of CSS custom properties — that is all
 * `layout-schema` says about them, deliberately, because a closed set of presentational fields
 * there would have to be matched exactly by this package and every new widget property would
 * become a schema version. The consequence is that the *vocabulary* has to live somewhere, and
 * this is it: `layout-schema` checks that a token is a well-formed custom property, and this file
 * says which ones mean something.
 *
 * ## Why the defaults are data rather than written into the sheets
 *
 * A token is only useful if a widget reads it, and a widget may only read it with a fallback —
 * `var(--perch-fg)` with nothing behind it renders as *nothing* when a layout sets no theme, which
 * on a panel is indistinguishable from a broken binding. So every reference is
 * `var(--name, default)`, and writing that by hand in a template string is how the default in the
 * sheet drifts from the default in the documentation.
 *
 * `token()` is therefore the only way this package references a token, and `PERCH_TOKEN_DEFAULTS`
 * is the only place a default is written. A token that is not in the record is a compile error at
 * the call site rather than a `var()` that quietly resolves to nothing.
 *
 * ## What is not here
 *
 * No colour is *derived* from another — no `color-mix`, no relative colour. A layout that sets
 * `--perch-fg` and expects the label to follow would be relying on a relationship this package
 * had decided for it, and the first layout that wanted a different relationship would have to
 * fight it. Each token stands alone and a theme sets the ones it cares about.
 */

/**
 * Every token, with the value used when a layout does not set it.
 *
 * The defaults are the widget colours this package shipped before tokens existed, unchanged, so
 * a layout with `theme: {}` renders exactly as the hard-coded page did.
 */
export const PERCH_TOKEN_DEFAULTS = {
  /** Font stack for every widget. */
  '--perch-font': 'ui-sans-serif, system-ui, sans-serif',

  /** The colour of a number worth believing. */
  '--perch-fg': '#f2f4f8',
  /** Units and labels: present, subordinate to the number. */
  '--perch-dim': '#9aa4b2',
  /** A placeholder, and the `waiting` note. Recedes rather than alarms. */
  '--perch-faint': '#6b7480',
  /** A value too old to believe. */
  '--perch-stale': '#8a7470',
  /** A sensor that is present and reporting nothing: notice, do not act. */
  '--perch-warn': '#c8b06b',
  /** Something is wrong upstream. */
  '--perch-alert': '#d08770',

  /** Weight of the big number. */
  '--perch-value-weight': '650',
  /**
   * Floor and cap of the value's type scale.
   *
   * Between them the size is the largest at which the printed reading and its unit fit the
   * widget's own inline size — see `READOUT_STYLES` for the arithmetic. A theme moves the ends of
   * the ramp; the measurement between them is not a token.
   */
  '--perch-value-size-min': '1.5rem',
  '--perch-value-size-max': '3rem',
  '--perch-unit-size': '1.25rem',
  '--perch-label-size': '1rem',

  /** A text element's type. */
  '--perch-text-size': '1rem',
  '--perch-text-weight': '500',
  '--perch-text-color': '#9aa4b2',
  '--perch-text-tracking': 'normal',
  '--perch-text-transform': 'none',
  '--perch-text-line-height': '1.3',
  /** Horizontal placement of the text inside its rect: a `justify-content` value. */
  '--perch-text-justify': 'flex-start',
  /** Vertical placement of the text inside its rect: an `align-items` value. */
  '--perch-text-anchor': 'center',
  /** Which edge lines break towards, for a text element carrying more than one line. */
  '--perch-text-align': 'left',

  /**
   * Where a readout's content sits across its box: a `justify-content` *and* a `text-align` value.
   *
   * `start | center | end` rather than the `flex-start` family the text element uses, because this
   * one value is written into both properties — the row of number and unit is a flex row, the caption
   * and note are text runs — and `start`/`center`/`end` are the only spellings both accept. The
   * default is where every readout sat before this token existed.
   */
  '--perch-readout-justify': 'start',
  /** Where a readout's column sits down its box: a `justify-content` value on that column. */
  '--perch-readout-anchor': 'start',

  /** How strongly a media element paints. A background usually wants to sit under the numbers. */
  '--perch-media-opacity': '1',

  /**
   * The element box: what every styled entity's own rectangle paints, read by `ELEMENT_BOX_STYLES`
   * in `layout-canvas.tsx` rather than by any widget.
   *
   * `--perch-box-*`, in the `--perch-<where>-<what>` idiom `--perch-canvas-bg` set: `box` is the
   * `.perch-element` box, the one level every kind shares, as distinct from the canvas above it and
   * the widget inside it. A widget prefix would say a readout reads these; none does.
   *
   * The background is a hex literal with an alpha pair, and its default is the fully transparent one
   * — `#00000000` rather than `transparent`, so the default is a value the colour control can hold.
   * Radius and padding are **unitless counts of layout pixels**, one to four of them in CSS shorthand
   * order (`8`, `8 16`, `8 16 4`, `8 16 4 2`; corners top-left first), which the canvas turns into a
   * native `padding` or `border-radius` — see `box-shorthand.ts`. Unitless on purpose: the canvas has
   * to compute a chart's content box in JavaScript from the same value CSS applies, and a number is the
   * one spelling both can read identically — `12px` or `1rem` would be a value CSS understood and the
   * chart's arithmetic did not. One CSS pixel on the canvas is one layout pixel, because the canvas is
   * scaled as a whole, so these scale with the panel exactly as the rects do.
   */
  '--perch-box-bg': '#00000000',
  '--perch-box-radius': '0',
  '--perch-box-padding': '0',

  /**
   * The series line and its wash. The one colour on a chart that carries data.
   *
   * Chosen by running the `dataviz` skill's validator against the canvas background rather than by
   * eye: `#4c9ad8` passes the OKLCH lightness band and chroma floor for a dark surface and clears
   * 3:1 contrast against it. It is also 16.8 ΔE from `--perch-stale` under normal vision and 15.0
   * under deuteranopia, which is what lets a stale series be recognised as the same line in a
   * different state rather than mistaken for a second series.
   */
  '--perch-chart-series': '#4c9ad8',
  /**
   * The wash under the line, as an opacity on the series colour.
   *
   * A wash, never a saturated block: the fill is there to give the line a body that reads from across
   * a room, and anything heavier competes with the line for the reader's attention.
   */
  '--perch-chart-area-opacity': '0.12',
  /**
   * Gridlines. One step off the surface, and no more.
   *
   * The grid is chrome. It exists to let a reader place a value against the scale and must lose every
   * contest with the series — which is why the panel's answer to a thin line is a half-integer
   * placement rather than a brighter grey.
   */
  '--perch-chart-grid': '#252c36',
  /**
   * What the chart is drawn *on*, used for the 2px ring around the newest marker.
   *
   * A separate token from the canvas background, which is a canvas-level concern this package's
   * widgets cannot read. Its default is that background, so a chart on a plain canvas needs no theme;
   * a chart placed over a media element should set it to whatever is actually behind the marker.
   */
  '--perch-chart-surface': '#101318',
  /** The newest reading, printed in the chart's header. Smaller than a readout's: this is not a hero. */
  '--perch-chart-value-size': '1.5rem',
  /** The chart's caption. */
  '--perch-chart-label-size': '0.9375rem',
  /** The footer: the window it covers, and the scale it is drawn against. */
  '--perch-chart-axis-size': '0.8125rem',
} as const;

/** A token this package reads. */
export type PerchToken = keyof typeof PERCH_TOKEN_DEFAULTS;

/** Every token name, for a consumer that documents or enumerates them. */
export const PERCH_TOKENS: readonly PerchToken[] = Object.freeze(
  Object.keys(PERCH_TOKEN_DEFAULTS) as PerchToken[],
);

/**
 * A reference to `name`, carrying its declared default.
 *
 * The only way this package mentions a token. See the module comment for why a bare `var(--x)` is
 * a defect rather than a shorter spelling.
 */
export function token(name: PerchToken): string {
  return `var(${name}, ${PERCH_TOKEN_DEFAULTS[name]})`;
}
