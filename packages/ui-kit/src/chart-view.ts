/**
 * What a chart draws, as numbers and strings — and nothing about how it is drawn.
 *
 * The `readout-view.ts` split, applied to a harder widget: one pure function turns a published
 * history snapshot into the exact path data, tick positions and label strings a chart paints, with no
 * DOM, no React, no clock and no source anywhere in it. That is what makes "same snapshot, same
 * pixels" — the rule the whole capture story rests on — a claim a plain assertion can check, and it
 * is why the interesting tests in this package are against this file rather than against the
 * component.
 *
 * ## The frame budget lives here
 *
 * Every output path *captures* the page, so a redraw has to finish inside the capture interval and
 * must not reflow the element. A chart redraws its whole series each tick, which makes it the first
 * widget in this package whose per-frame cost is a function of the *data* rather than of the layout.
 * Three decisions keep it bounded, and all three are in this file:
 *
 * 1. **The series is one path string, not a path per segment.** A hole in the data becomes an `M`
 *    subpath move inside the same `d`, so a series with one gap and a series with forty gaps are the
 *    same number of DOM nodes — one — and an update writes one attribute. A path-per-segment chart
 *    inserts and removes nodes as the data changes, which is exactly the mid-layout capture the
 *    readout's fixed skeleton exists to prevent.
 * 2. **The series is thinned to the pixel columns it can occupy.** `CHART_COLUMN_PX` is the sampling
 *    step; within a column only the extremes survive. A 24 h window at 4 Hz holds 345,600 readings
 *    and a 1920-wide chart has 1920 columns to draw them in, so the path is capped at two points per
 *    column whatever the ring holds. Path length therefore depends on the *rect*, which is constant
 *    across a capture, and never on the publish rate.
 * 3. **Coordinates are rounded, to a whole pixel or a half.** A 3px stroke is crisp when its centre
 *    is on an integer; a 1px gridline is crisp when its centre is on a half-integer. Rounding also
 *    makes the `d` string stable: an unrounded coordinate changes in its fifteenth decimal between
 *    two frames of identical data, which re-writes the attribute and re-rasterises the path for no
 *    visible reason.
 *
 * ## Truth decisions, and where they come from
 *
 * - **`gap`** is honoured exactly as `layout-schema` specifies it, and the default is read from
 *   `DEFAULT_CHART_GAP` rather than restated here — one absent `gap` cannot mean two things.
 *   `'break'` lifts the pen across a stretch with no measurement; `'span'` draws through it, which is
 *   available because an author may knowingly choose it and is never chosen here because it looks
 *   tidier.
 * - **A `null` reading breaks the line under `'break'` too.** The source reports `value: null` for a
 *   sensor that is present and measuring nothing — a fan header with no fan. There is no y
 *   coordinate for "nothing", so the stretch it occupies is a stretch with no measurement, which is
 *   the same thing `gap` is about. One rule, applied to both kinds of hole.
 * - **The y-scale is authored, never fitted.** `range` comes from the layout, and a reading outside
 *   it is clamped to the edge rather than rescaling the axis. A chart whose axis moved with its data
 *   would make every capture incomparable with the last one, which is the mistake `range` exists in
 *   the format to prevent.
 * - **Nothing is extrapolated to the right edge.** The line ends at the last reading. The distance
 *   between there and `endsAt` is empty on purpose: it is how long the publisher has been quiet, drawn
 *   to scale.
 */

import { SENSOR_METRIC_UNITS, type SensorMetric, type SensorReading } from '@perch/sensor-contract';
import { DEFAULT_CHART_GAP, type ChartGap, type Range } from '@perch/layout-schema';
import {
  DEFAULT_DECIMALS,
  READOUT_DECIMALS,
  READOUT_NO_READING_TEXT,
  READOUT_WAITING_TEXT,
  staleNote,
} from './readout-view.js';
import type { SensorHistorySnapshot } from './sensor-store.js';

/**
 * How many canvas pixels one sampling column is.
 *
 * One, because the chart's own coordinate system is canvas pixels and a column narrower than a pixel
 * cannot be resolved by anything that reads the output. A larger step would thin the series further
 * and visibly flatten it; a smaller one would emit points that land on the same pixel.
 *
 * This is the whole of the thinning policy, and it is a *rendering* decision on purpose: the ring
 * keeps every reading it was asked to keep, so widening a chart shows more detail without the store
 * having retained anything different.
 */
export const CHART_COLUMN_PX = 1;

/**
 * Stroke width of the series line, in canvas pixels.
 *
 * Three, not the two a screen chart would use. The output is captured onto a 1920x400 physical LCD:
 * a 2px line is legible on a laptop at arm's length and thins to a flicker on a wall at three metres,
 * and a 1px line leans on antialiasing the panel does not reward. Three is also odd-times-one, so the
 * stroke covers whole pixels when its centre sits on an integer — which is why every series
 * coordinate below is rounded to one.
 */
export const CHART_SERIES_STROKE_PX = 3;

/**
 * Stroke width of a gridline, in canvas pixels.
 *
 * One, and kept there. The grid is chrome and must stay recessive — thickening it is how a chart
 * starts reading as a table of boxes — so the panel's answer is *placement*, not weight: a gridline
 * is drawn on a half-integer so a 1px stroke lands on exactly one row of pixels instead of smearing
 * across two at half intensity. Solid, never dashed: dashing reads as "projection" or "threshold"
 * when it is only a grid.
 */
export const CHART_GRID_STROKE_PX = 1;

/** Radius of the marker on the newest reading, in canvas pixels. Eight across, the legible floor. */
export const CHART_MARKER_RADIUS_PX = 5;

/**
 * Padding inside the plot, in canvas pixels, so a reading at the top of its range is not half a
 * stroke off the edge.
 *
 * Exactly half the stroke plus the marker's own radius and ring: the newest reading can sit anywhere
 * in the range, and its marker must be whole wherever that is.
 */
export const CHART_PLOT_INSET_PX = CHART_MARKER_RADIUS_PX + 2;

/**
 * The three states a chart can be in, which are the three a *reader* must tell apart.
 *
 * `empty` and `stale` are not edge cases to be tidied away — they are the states a real dashboard
 * sits in most of the time, and an empty rectangle for either is the failure this union exists to
 * prevent.
 *
 * - `empty` — nothing in the window. A panel that has just booted, or a topic nobody publishes.
 * - `stale` — a series is there, and every bit of it is older than the store's stale threshold. The
 *   shape is still worth showing; what must not happen is showing it as though it were current.
 * - `series` — a series whose newest reading is fresh.
 */
export type ChartStateKind = 'empty' | 'stale' | 'series';

/** A horizontal gridline and the value it stands for. */
export interface ChartGridline {
  /** Centre of the 1px stroke, on a half-integer. */
  readonly y: number;
  /** The value, formatted at the metric's precision. */
  readonly label: string;
}

export interface ChartViewInput {
  /** The published series, straight from the store. Carries its own `endsAt`. */
  history: SensorHistorySnapshot;
  /**
   * The window the *element* declared, which may be shorter than the one the store retained.
   *
   * Two charts on one topic share a ring sized to the longer of them, so the shorter chart clips
   * here. Without this it would silently draw the other chart's window.
   */
  windowMs: number;
  /** The authored y-scale, `[low, high]`. Never fitted to the data. */
  range: Range;
  /** The element's box, in canvas pixels. */
  width: number;
  height: number;
  /** The metric, which is where the unit and the decimal count come from. */
  metric: SensorMetric;
  /** How long a silence is normal, from the store. A longer stretch than this is a hole. */
  staleAfterMs: number;
  /** What to do with a hole. `DEFAULT_CHART_GAP` when the element did not say. */
  gap?: ChartGap | undefined;
  /** Override the metric's decimal count. */
  decimals?: number | undefined;
}

/** Everything a chart draws, already reduced to path data and strings. */
export interface ChartViewModel {
  readonly state: ChartStateKind;
  /** The plot box inside the element, in canvas pixels. */
  readonly plot: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** The series, as one SVG `d`. `''` when there is nothing to draw. */
  readonly seriesPath: string;
  /** The same series closed to the baseline, as one SVG `d`. `''` when there is nothing to draw. */
  readonly areaPath: string;
  /** How many pen-down runs the series is drawn in. `1` unless a hole broke it. */
  readonly segmentCount: number;
  /** How many points the thinned series actually draws. Bounded by the plot's width in columns. */
  readonly pointCount: number;
  /** Where the newest drawable reading is, or `null` when there is none. */
  readonly marker: { readonly x: number; readonly y: number } | null;
  /** The newest reading, formatted — or a placeholder. Printed in the header, not on the line. */
  readonly value: string;
  /** The unit, or `''`. */
  readonly unit: string;
  /** The small line: `''` when the series is current. */
  readonly note: string;
  /**
   * What to write across the plot when there is no line in it, or `''`.
   *
   * Here rather than in the component because "a chart with no data must be legible" is a claim about
   * what the widget says, and a claim about what it says belongs where it can be asserted without a
   * DOM. The component renders the element unconditionally with this as its text, so the empty state
   * and the drawn state have the identical node count.
   */
  readonly placeholder: string;
  /** The window, worded for a human: `90 s`, `5 min`, `2 h`. */
  readonly spanLabel: string;
  /** Horizontal gridlines, top to bottom. Always the same count, so the skeleton is constant. */
  readonly gridlines: readonly ChartGridline[];
}

/**
 * How many horizontal gridlines a chart draws.
 *
 * Three — the two ends of the range and its midpoint — and **fixed**, which is the point. A tick
 * count chosen from the range would change the number of DOM nodes when a layout changed its scale,
 * and a count chosen from the *data* would change it mid-capture. Three is also the most a 200px-tall
 * strip can carry without the labels crowding each other.
 */
export const CHART_GRIDLINE_COUNT = 3;

/**
 * What a chart with nothing in its window says.
 *
 * Worded as a state, not an error: a panel that has just booted is *waiting*, and a chart that read
 * `no data` would have a reader looking for a fault that is not there. The wording matches the
 * readout's `waiting` note, because the two widgets are in the same state for the same reason.
 */
export const CHART_EMPTY_TEXT = 'waiting for readings';

/** What a chart says when it has readings and none of them carry a value. */
export const CHART_NO_VALUES_TEXT = 'no values in window';

/**
 * The whole chart, computed.
 *
 * Pure: every number it returns comes from the arguments, including the clock, which arrives inside
 * `history.endsAt`. Call it twice with the same input and it returns the same strings.
 */
export function chartView(input: ChartViewInput): ChartViewModel {
  const {
    history,
    windowMs,
    range,
    width,
    height,
    metric,
    staleAfterMs,
    gap = DEFAULT_CHART_GAP,
    decimals,
  } = input;

  const plot = plotBox(width, height);
  const places = decimals ?? READOUT_DECIMALS[metric] ?? DEFAULT_DECIMALS;
  const [low, high] = range;
  const spanLabel = formatSpan(windowMs);
  const gridlines = buildGridlines(plot, low, high, places);

  // The element's own window, not the ring's: `endsAt` is where the axis ends, so the axis begins
  // one declared window before it however much more the store happened to keep.
  const startsAt = history.endsAt - windowMs;
  const inWindow = history.samples.filter((sample) => sample.at >= startsAt);
  const newest = inWindow[inWindow.length - 1];

  if (newest === undefined) {
    return {
      state: 'empty',
      plot,
      seriesPath: '',
      areaPath: '',
      segmentCount: 0,
      pointCount: 0,
      marker: null,
      value: READOUT_WAITING_TEXT,
      unit: '',
      note: 'waiting',
      placeholder: CHART_EMPTY_TEXT,
      spanLabel,
      gridlines,
    };
  }

  const ageMs = Math.max(0, history.endsAt - newest.at);
  const isStale = ageMs > staleAfterMs;

  const segments = buildSegments(inWindow, gap, staleAfterMs);
  const thinned = segments.map((segment) => thinToColumns(segment, plot, history, windowMs, range));
  const drawable = thinned.filter((points) => points.length > 0);

  const marker = markerFor(drawable);

  return {
    state: isStale ? 'stale' : 'series',
    plot,
    seriesPath: seriesPathOf(drawable),
    areaPath: areaPathOf(drawable, plot),
    segmentCount: drawable.length,
    pointCount: drawable.reduce((sum, points) => sum + points.length, 0),
    marker,
    // The header prints the newest reading whatever state it is in, the way the readout does: a
    // held-but-old number is information, and its age is beside it.
    value: newest.value === null ? READOUT_NO_READING_TEXT : newest.value.toFixed(places),
    unit: newest.value === null ? '' : SENSOR_METRIC_UNITS[metric],
    note: isStale ? staleNote(ageMs) : '',
    // A series whose every point is a null has readings and no line. Saying so beats an empty plot
    // under a header that prints `n/a` and no explanation of the blank space.
    placeholder: drawable.length === 0 ? CHART_NO_VALUES_TEXT : '',
    spanLabel,
    gridlines,
  };
}

/**
 * The plot box: the element, inset.
 *
 * Integral on every edge, and computed from the element's box alone — never measured. A chart that
 * measured itself would need a `ResizeObserver`, which fires *after* layout, so frame one would be
 * drawn at the wrong size and the second frame would move it. The element is already exactly its
 * authored rect, so the arithmetic is enough.
 */
function plotBox(width: number, height: number): ChartViewModel['plot'] {
  const inset = CHART_PLOT_INSET_PX;
  return {
    x: inset,
    y: inset,
    // Never negative: a rect too small for its own inset gets a zero-area plot and draws no series,
    // rather than a path with inverted geometry.
    w: Math.max(0, Math.round(width) - inset * 2),
    h: Math.max(0, Math.round(height) - inset * 2),
  };
}

/**
 * The three gridlines and their labels.
 *
 * Half-integer `y`, so a 1px stroke lands on one row of pixels. Labels at the metric's own precision
 * rather than rounded to "clean numbers": a range of `[34, 92]` has no clean midpoint, and printing
 * `63` where the line is at `63.0` would put the label and the line at different values.
 */
function buildGridlines(
  plot: ChartViewModel['plot'],
  low: number,
  high: number,
  places: number,
): readonly ChartGridline[] {
  const lines: ChartGridline[] = [];

  for (let index = 0; index < CHART_GRIDLINE_COUNT; index += 1) {
    // `index / (count - 1)`: 0 at the top, 1 at the bottom, so the ends are exactly the range's ends.
    const fraction = index / (CHART_GRIDLINE_COUNT - 1);
    const value = high - (high - low) * fraction;
    lines.push({
      y: Math.round(plot.y + plot.h * fraction) + 0.5,
      label: value.toFixed(places),
    });
  }

  return Object.freeze(lines);
}

/**
 * Split the readings into pen-down runs.
 *
 * Two things end a run, and `gap: 'span'` suppresses both:
 *
 * - **A `null` reading**, which is a measurement that found no value. There is no y for it.
 * - **A silence longer than `staleAfterMs`**, which is the store's own definition of "longer than a
 *   publisher should go quiet" — borrowed rather than invented so a chart and the readout beside it
 *   never disagree about whether the same publisher stopped. This is the one number the chart
 *   contract does not supply; see DECISIONS.md.
 *
 * Under `'span'` the readings come back as a single run with the nulls dropped, which is exactly
 * "draw through the hole" — and is only ever reached because an author wrote `gap: 'span'`.
 */
function buildSegments(
  samples: readonly SensorReading[],
  gap: ChartGap,
  staleAfterMs: number,
): readonly (readonly SensorReading[])[] {
  const segments: SensorReading[][] = [];
  let current: SensorReading[] = [];
  let previousAt: number | undefined;

  const close = (): void => {
    if (current.length > 0) segments.push(current);
    current = [];
  };

  for (const sample of samples) {
    if (sample.value === null) {
      // The hole is real either way; `gap` only decides whether the pen lifts across it.
      if (gap === 'break') close();
      // `previousAt` deliberately advances: the silence is measured from the last *reading*, and a
      // null is a reading. It is the last reading with a *value* that the line resumes from.
      previousAt = sample.at;
      continue;
    }

    if (gap === 'break' && previousAt !== undefined && sample.at - previousAt > staleAfterMs) {
      close();
    }

    current.push(sample);
    previousAt = sample.at;
  }

  close();
  return segments;
}

/** A point on the plot, already rounded to whole canvas pixels. */
interface ChartPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Thin one run to at most two points per pixel column.
 *
 * Per column the run's **first extreme and then the other** survive — the minimum and the maximum, in
 * the order they occurred. Two points, not one: keeping a single representative (the mean, or the
 * first) erases a spike that a person watching a wall panel is specifically looking for, and keeping
 * the pair preserves the column's full vertical extent, so the drawn line covers exactly the ink the
 * unthinned line would have covered in that column.
 *
 * The cost is that within one column the two points are drawn at that column's x rather than at their
 * own — a horizontal smear of under a pixel, which is below what the output can resolve.
 *
 * Thinning happens *per run*, after `buildSegments`, so a column that straddles a hole cannot merge
 * readings from either side of it into one stroke.
 */
function thinToColumns(
  samples: readonly SensorReading[],
  plot: ChartViewModel['plot'],
  history: SensorHistorySnapshot,
  windowMs: number,
  range: Range,
): readonly ChartPoint[] {
  const points: ChartPoint[] = [];
  let column: number | undefined;
  /** The run of readings landing in `column`, as y pixels, reduced to its two extremes. */
  let first: ChartPoint | undefined;
  let low: ChartPoint | undefined;
  let high: ChartPoint | undefined;

  const flush = (): void => {
    if (first === undefined || low === undefined || high === undefined) return;
    if (low === high) {
      points.push(low);
    } else {
      // The extreme that occurred first leads, so the line enters and leaves the column the way the
      // data did.
      const leading = first.y <= low.y ? low : high;
      const trailing = leading === low ? high : low;
      points.push(leading, trailing);
    }
    first = undefined;
    low = undefined;
    high = undefined;
  };

  for (const sample of samples) {
    const value = sample.value;
    // Unreachable: `buildSegments` never puts a null in a run. Checked rather than asserted, because
    // a non-null assertion is the one spelling that would let a future change through silently.
    if (value === null) continue;

    const point = {
      x: projectX(sample.at, plot, history.endsAt, windowMs),
      y: projectY(value, plot, range),
    };
    const nextColumn = Math.round(point.x / CHART_COLUMN_PX);

    if (column !== nextColumn) {
      flush();
      column = nextColumn;
      first = point;
      low = point;
      high = point;
      continue;
    }

    // `low` is the smaller y, which is visually *higher*. The names track the coordinate, not the
    // reading, because that is what the path is built from.
    if (low !== undefined && point.y < low.y) low = point;
    if (high !== undefined && point.y > high.y) high = point;
  }

  flush();
  return points;
}

/**
 * A timestamp as an x pixel: the window's start at the left edge, `endsAt` at the right.
 *
 * Clamped to the plot, so a reading from the far side of a clock adjustment paints at an edge rather
 * than outside the element. Rounded to a whole pixel, which is where a 3px stroke is crisp.
 */
function projectX(
  at: number,
  plot: ChartViewModel['plot'],
  endsAt: number,
  windowMs: number,
): number {
  if (windowMs <= 0) return plot.x + plot.w;
  const fraction = 1 - (endsAt - at) / windowMs;
  return Math.round(plot.x + plot.w * clamp01(fraction));
}

/**
 * A value as a y pixel: the range's high at the top, its low at the bottom.
 *
 * Clamped, not rescaled. A reading above the authored range paints on the top edge and the chart
 * keeps the axis the layout declared — see the module comment for why a fitted axis is worse than a
 * clipped reading.
 *
 * An inverted range (`[100, 0]`) works without a special case: the fraction goes negative, `clamp01`
 * does not care which end is which, and the axis simply reads downwards — which is a legitimate thing
 * for an author to want and not this function's business to refuse.
 */
function projectY(value: number, plot: ChartViewModel['plot'], range: Range): number {
  const [low, high] = range;
  const span = high - low;
  // A zero-span range has no scale; the midline is the only honest place for every reading.
  if (span === 0) return Math.round(plot.y + plot.h / 2);
  const fraction = (value - low) / span;
  return Math.round(plot.y + plot.h * (1 - clamp01(fraction)));
}

function clamp01(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.min(1, Math.max(0, fraction));
}

/**
 * Every run as one `d`.
 *
 * `M` starts a run, `L` continues it, and a second `M` inside the same string is what a lifted pen
 * looks like to SVG. One path element for the whole series, however many holes it has — see the
 * module comment for why the node count has to be constant.
 *
 * A one-point run is emitted as a zero-length `M`/`L` pair rather than a bare `M`: with
 * `stroke-linecap: round` that paints a dot the width of the stroke, so a single reading in a window
 * is visible. A bare `M` paints nothing at all, which is the empty box this widget must never be.
 */
function seriesPathOf(runs: readonly (readonly ChartPoint[])[]): string {
  const parts: string[] = [];

  for (const run of runs) {
    const first = run[0];
    if (first === undefined) continue;
    parts.push(`M${String(first.x)} ${String(first.y)}`);
    for (let index = 1; index < run.length; index += 1) {
      const point = run[index];
      if (point === undefined) continue;
      parts.push(`L${String(point.x)} ${String(point.y)}`);
    }
    if (run.length === 1) parts.push(`L${String(first.x)} ${String(first.y)}`);
  }

  return parts.join('');
}

/**
 * The same runs closed to the baseline, as one `d`.
 *
 * A wash under the line, at a low opacity the sheet sets — it gives the series a body that reads from
 * across a room, where a bare stroke reads as a scratch. Closed **per run**, so a hole in the data is
 * a hole in the fill too: an area that spanned a gap the line broke across would put the gap back in
 * dispute.
 */
function areaPathOf(
  runs: readonly (readonly ChartPoint[])[],
  plot: ChartViewModel['plot'],
): string {
  const baseline = plot.y + plot.h;
  const parts: string[] = [];

  for (const run of runs) {
    const first = run[0];
    const last = run[run.length - 1];
    if (first === undefined || last === undefined) continue;
    // A one-point run has no width, so it has no area. Skipped rather than drawn as a hairline.
    if (run.length < 2) continue;

    parts.push(`M${String(first.x)} ${String(baseline)}`);
    for (const point of run) parts.push(`L${String(point.x)} ${String(point.y)}`);
    parts.push(`L${String(last.x)} ${String(baseline)}`, 'Z');
  }

  return parts.join('');
}

/** The newest drawn point: the end of the last run, or `null` when nothing is drawn. */
function markerFor(runs: readonly (readonly ChartPoint[])[]): ChartPoint | null {
  const lastRun = runs[runs.length - 1];
  if (lastRun === undefined) return null;
  return lastRun[lastRun.length - 1] ?? null;
}

/**
 * A window, worded.
 *
 * Whole units where the window is a whole number of them, because `5 min` is what an author wrote and
 * `300 s` is the same fact spelled in the unit the field happens to use. Milliseconds never appear:
 * `CHART_MIN_WINDOW_MS` is 1 s, so the smallest legal window is already a whole second.
 */
export function formatSpan(windowMs: number): string {
  if (!Number.isFinite(windowMs) || windowMs <= 0) return '0 s';

  const seconds = windowMs / 1_000;
  if (seconds < 60) return `${trimNumber(seconds)} s`;

  const minutes = seconds / 60;
  if (minutes < 60) return `${trimNumber(minutes)} min`;

  return `${trimNumber(minutes / 60)} h`;
}

/** `5` rather than `5.0`, and `1.5` rather than `1.5000000000000002`. */
function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}
