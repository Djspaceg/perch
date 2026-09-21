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
   * The scale itself is `clamp(min, 14cqw, max)` against the widget's own inline size — see
   * `READOUT_STYLES` for the measurement behind the `14cqw`. A theme moves the ends of the ramp;
   * it does not get to make the size depend on the reading.
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

  /** How strongly a media element paints. A background usually wants to sit under the numbers. */
  '--perch-media-opacity': '1',
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
