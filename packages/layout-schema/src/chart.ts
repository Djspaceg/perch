/**
 * What a time-series element needs beyond a widget: a time window, and a policy for gaps.
 *
 * A chart is the first element kind that has an opinion about *time*. Every other kind paints the
 * present — a readout shows the latest value, a gauge shows the latest value against an authored
 * scale — so the only axis they need is the one `range` already describes. A chart needs a second
 * one, and the second one cannot be derived from anything already in the format.
 *
 * ## Why the window is authored rather than inferred
 *
 * The inferable alternatives are all worse. "Everything the process has seen" makes the x-axis
 * depend on uptime, so the same layout reads differently five minutes and five hours after a
 * restart. "As much as fits at one sample per pixel" makes it depend on `rect.w`, so resizing an
 * element in the editor silently changes what period it covers. Both are the `range` mistake in
 * the time axis: a scale that moves on its own is a scale nobody can read. So the window is a
 * decision the author makes once, and it belongs in the layout.
 *
 * ## Why `windowMs` and not `window`
 *
 * The unit is in the name for the reason `target.frameRate` needs a validator that mentions
 * milliseconds: a bare duration field attracts the wrong unit, and a factor of 1000 in a time
 * axis is not visible in the output — the chart just draws a period nobody asked for. `Ms` also
 * matches `at` on a sensor reading, so a renderer compares `at >= now - windowMs` with no
 * conversion, and a conversion is where the factor of 1000 would have lived.
 *
 * Secondarily, `window` is a DOM global. `layout-schema` already renamed `Element` to
 * `LayoutElement` because `runtime` and `editor` are DOM packages (see `element.ts`); a field
 * whose obvious local variable shadows `window` in those same packages is the same trap one level
 * down.
 */

import { optionalLiteral, requireFiniteNumber } from './checks.js';
import { fieldPath, type IssueCollector } from './issues.js';

/**
 * Shortest time window accepted, in milliseconds.
 *
 * A second is the floor because below it a chart is not a trend. `target.frameRate` is capped at
 * 240 Hz, so one second is at most 240 samples and typically 30 — already fewer points than the
 * pixel width of any chart rect worth drawing. The value most likely to appear below this floor is
 * a duration written in seconds, which is exactly the mistake this bound turns into a message.
 */
export const CHART_MIN_WINDOW_MS = 1_000;

/**
 * Longest time window accepted, in milliseconds: 24 hours.
 *
 * Not a rendering limit but an honesty one. Nothing in this project buffers history — the agent
 * publishes readings as it takes them and `ui-kit` holds what has arrived — so a window longer
 * than a day can only ever be drawn for the fraction of it this process has been running. A
 * bound here means the layout is refused with the reason named, rather than painting a chart whose
 * empty left-hand nine tenths look like a dead sensor.
 */
export const CHART_MAX_WINDOW_MS = 86_400_000;

/**
 * What to draw where there is no data.
 *
 * Gaps are real and routine: the source buffers nothing, so a relay reconnect leaves a stretch of
 * time with no readings in it, plainly visible in the `at` timestamps either side.
 *
 * - `break` — lift the pen. The chart shows that nothing was measured.
 * - `span` — join the samples either side with a straight line.
 *
 * This is a field rather than a renderer default because the two are not the same picture and the
 * difference is a claim about the world. `span` draws a line through time where no measurement
 * existed, and a viewer reads a line as data; that is the same class of untruth as two units
 * sharing one y-axis, which is why this format refuses multi-series. Whether the untruth is
 * acceptable depends on what the panel is for, and only the author knows: a CPU-temperature trend
 * across a two-second reconnect wants the line unbroken, while on a panel watching for a sensor
 * dropping out the gap *is* the signal and spanning it hides the only thing being looked for.
 */
export const CHART_GAPS = ['break', 'span'] as const;
export type ChartGap = (typeof CHART_GAPS)[number];

/**
 * What a chart with no authored `gap` means.
 *
 * `break`, because it is the honest one. A default of `span` would mean every author who never
 * heard of this field ships the interpolated line, and a format whose silent default is the
 * lossier reading is a format that lies by omission.
 *
 * Exported as a constant rather than written into the renderer, so `runtime` and `editor` agree
 * on what an absent `gap` means without each holding its own copy of the answer. This is the same
 * drift the `MEDIA_FITS` export exists to prevent.
 */
export const DEFAULT_CHART_GAP: ChartGap = 'break';

/**
 * The authored time window in milliseconds, or `null` having reported why it is not one.
 *
 * Required, unlike `range`: `range` is conditional on the registry saying the widget draws a
 * scale, because a widget can legitimately draw no y-axis, but there is no such thing as a chart
 * that draws no x-axis. Reported as `missing-field` rather than a code of its own, for the same
 * reason `text` on a text element and `src` on a media element are — it is unconditionally
 * required by the element's `kind`, which is what `missing-field` already means. `missing-range`
 * is a separate code because *conditionally* required is a different thing an editor must handle
 * differently.
 *
 * Finite rather than integral: a fractional millisecond window is harmless, and
 * `not-an-integer` is documented as the code for a whole number of *pixels*.
 */
export function validateChartWindow(
  record: Readonly<Record<string, unknown>>,
  path: string,
  index: number,
  collect: IssueCollector,
): number | null {
  const windowMs = requireFiniteNumber(record, path, 'windowMs', collect, index);
  if (windowMs === null) return null;

  const where = fieldPath(path, 'windowMs');
  if (windowMs <= 0) {
    collect.add(
      'out-of-range',
      where,
      `expected a time window above 0 ms, got ${windowMs}; a chart whose window is zero or negative has no span of time to plot`,
      index,
    );
    return null;
  }
  if (windowMs < CHART_MIN_WINDOW_MS) {
    collect.add(
      'out-of-range',
      where,
      `expected a time window of at least ${CHART_MIN_WINDOW_MS} ms, got ${windowMs}; a window under a second holds too few samples to be a trend at any frame rate this format allows, and a value this small is usually a duration in seconds written into a field that wants milliseconds`,
      index,
    );
    return null;
  }
  if (windowMs > CHART_MAX_WINDOW_MS) {
    collect.add(
      'out-of-range',
      where,
      `expected a time window of at most ${CHART_MAX_WINDOW_MS} ms (24 hours), got ${windowMs}; nothing in this project buffers history, so a longer window can only be drawn for the part of it this process has been running`,
      index,
    );
    return null;
  }

  return windowMs;
}

/**
 * The gap policy, or `undefined` for both "absent" and "rejected".
 *
 * Same collapse as `style` and `fit`, safe for the same reason: a rejected value has already
 * recorded an issue, so the element is refused whichever this returns. An absent one means
 * `DEFAULT_CHART_GAP`, and the key is omitted rather than filled in — `fit` is left for the
 * renderer in exactly this way, and a validator that silently materialised a default would make
 * the saved file differ from the one the author wrote.
 */
export function validateOptionalChartGap(
  record: Readonly<Record<string, unknown>>,
  path: string,
  index: number,
  collect: IssueCollector,
): ChartGap | undefined {
  return optionalLiteral(record, path, 'gap', CHART_GAPS, collect, index);
}
