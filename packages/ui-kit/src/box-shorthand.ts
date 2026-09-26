/**
 * The box shorthand: what `--perch-box-padding` and `--perch-box-radius` hold.
 *
 * One to four unitless numbers, separated by whitespace, meaning what CSS's own `padding` and
 * `border-radius` shorthands mean by them: `8` is every side, `8 16` is vertical then horizontal,
 * `8 16 4` is top, horizontal, bottom, and `8 16 4 2` is top right bottom left. For a radius the four
 * are corners, top-left top-right bottom-right bottom-left, and the expansion is the same by position.
 *
 * ## Why one token holding a shorthand, not four longhand tokens
 *
 * A theme and an element each set a token, and the element's value replaces the theme's. With one
 * token that stays true of the whole box: an element's `4` replaces a theme's `10 20` outright, exactly
 * as it did when the token held one number. Four longhand tokens beside a shorthand one would inherit
 * per side instead, so an element's "all 4" would lose to a theme's "top 12", and which side won would
 * depend on which spelling each level happened to use.
 *
 * ## Why the canvas, not a `calc()`, turns it into pixels
 *
 * A one-number token could be multiplied into px by the sheet. A list cannot: `calc(8 16 * 1px)` is
 * invalid. So `LayoutCanvas` reads the token with `parseBoxToken`, the same way it always resolved
 * padding for the chart's arithmetic, and writes a native `padding` or `border-radius` declaration on
 * the box. The sheet and the chart therefore see one resolution, not two.
 */

/** Four values in CSS order: top right bottom left, or top-left top-right bottom-right bottom-left. */
export type BoxQuad = readonly [number, number, number, number];

/** Each of a padding's four values, by position. */
export const BOX_SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** Each of a radius's four values, by position. */
export const BOX_CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;

/**
 * One to four values, expanded to four as CSS expands them, or `undefined` for none or more than four.
 *
 * The missing value is always copied from the one opposite it: the fourth from the second, the third
 * from the first, the second from the first.
 */
export function expandBoxShorthand(values: readonly number[]): BoxQuad | undefined {
  const [top, right = top, bottom = top, left = right] = values;
  if (values.length > 4 || top === undefined || right === undefined) return undefined;
  if (bottom === undefined || left === undefined) return undefined;

  return [top, right, bottom, left];
}

/** The fewest values that expand back to `quad`: the spelling CSS itself would serialise. */
export function shortestBoxShorthand(quad: BoxQuad): readonly number[] {
  const [a, b, c, d] = quad;
  if (d !== b) return [a, b, c, d];
  if (c !== a) return [a, b, c];
  if (b !== a) return [a, b];

  return [a];
}

/**
 * A CSS `<number>`, which is all a part may be. Deliberately not `Number()`, which also accepts `0x10`,
 * `Infinity` and the empty string: values CSS rejects, so a box would get no padding while a chart
 * sized with `Number()` would be sized for some.
 */
const CSS_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * A token value as four numbers, or `undefined` where CSS would reject the declaration.
 *
 * CSS rejects a negative padding or radius, a unit the token does not carry, and a fifth value, and
 * with any of them the whole declaration goes. So does this: one bad part is no padding at all, which
 * is what the box would have painted when the sheet multiplied the token into px.
 */
export function parseBoxToken(raw: string): BoxQuad | undefined {
  const parts = raw.trim().split(/\s+/);
  if (!parts.every((part) => CSS_NUMBER.test(part))) return undefined;
  const values = parts.map(Number);
  if (values.some((value) => value < 0)) return undefined;

  return expandBoxShorthand(values);
}

/** `quad` as a token value: the shortest shorthand, unitless. */
export function formatBoxToken(quad: BoxQuad): string {
  return shortestBoxShorthand(quad).join(' ');
}

/** `quad` as a native `padding` or `border-radius` value: the shortest shorthand, in px. */
export function boxQuadCss(quad: BoxQuad): string {
  return shortestBoxShorthand(quad)
    .map((value) => `${String(value)}px`)
    .join(' ');
}
