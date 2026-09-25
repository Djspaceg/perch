/**
 * The arithmetic of a numeric field: nudge by key, scrub by drag, clamp, and the fill bar.
 *
 * Kept apart from the component so the rules are plain functions with plain tests. The component in
 * `controls.tsx` only turns key presses and pointer deltas into calls to these.
 *
 * - **One step per arrow press, ten with Shift.** The step is what the caller says, or else the
 *   precision the value is written at (`stepFor`): `12` moves by 1, `1.25` by 0.01. Nudging a value
 *   written to two decimals by a whole unit would make the arrows useless on a `rem` size.
 * - **One step per `PIXELS_PER_STEP` pixels of drag**, ten with Shift, counted from where the drag
 *   began rather than accumulated per move, so a slow drag and a fast one land on the same value.
 * - **Bounds hold for nudging and scrubbing, not for typing.** A typed value may go past a token's
 *   range, because the range is a sensible span rather than a rule the format makes; but a hand on a
 *   drag should not be able to throw a corner radius to -40.
 */

/** Optional bounds. An absent side is unbounded. */
export interface NumericBounds {
  readonly min?: number | undefined;
  readonly max?: number | undefined;
}

/** What Shift multiplies a step by. */
export const COARSE_FACTOR = 10;

/** How many pixels of drag make one step. */
export const PIXELS_PER_STEP = 2;

/** How far a pointer must move before a press on a field becomes a scrub rather than a click. */
export const SCRUB_THRESHOLD_PX = 3;

/** The number of decimals in a step, so results can be rounded back to it. */
function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');

  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Round away float noise to the step's own precision: `1.2600000000000002` is `1.26`. */
function toPrecision(value: number, step: number): number {
  return Number(value.toFixed(decimalsOf(step)));
}

/** The step a value's own spelling implies: one unit of its last written decimal place. */
export function stepFor(text: string): number {
  const match = /^\s*-?\d*\.(\d+)\s*$/.exec(text);
  if (match === null) return 1;

  return Number((10 ** -(match[1]?.length ?? 0)).toFixed(match[1]?.length ?? 0));
}

/** A value held inside whichever bounds exist. */
export function clampValue(value: number, bounds: NumericBounds): number {
  let result = value;
  if (bounds.min !== undefined && result < bounds.min) result = bounds.min;
  if (bounds.max !== undefined && result > bounds.max) result = bounds.max;

  return result;
}

/** Where an empty field starts from: its floor, or zero. */
function startOf(value: number, bounds: NumericBounds): number {
  return Number.isFinite(value) ? value : (bounds.min ?? 0);
}

/** One arrow press. */
export function nudgeValue(
  value: number,
  direction: 1 | -1,
  coarse: boolean,
  step: number,
  bounds: NumericBounds,
): number {
  const next = startOf(value, bounds) + direction * step * (coarse ? COARSE_FACTOR : 1);

  return clampValue(toPrecision(next, step), bounds);
}

/** A drag of `deltaPx` pixels from where it began, from a value of `start` at that moment. */
export function scrubValue(
  start: number,
  deltaPx: number,
  coarse: boolean,
  step: number,
  bounds: NumericBounds,
): number {
  const steps = Math.trunc(deltaPx / PIXELS_PER_STEP);
  const next = startOf(start, bounds) + steps * step * (coarse ? COARSE_FACTOR : 1);

  return clampValue(toPrecision(next, step), bounds);
}

/** Where a value sits in its range, 0 to 1, for the fill bar. Full past the end, empty before it. */
export function fillFraction(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || max <= min) return 0;

  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}
