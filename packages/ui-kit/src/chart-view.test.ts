/**
 * The chart, tested as numbers and strings.
 *
 * Every visual claim this widget makes is checkable here, before any DOM exists: that a hole in the
 * data breaks the line, that `gap: 'span'` draws through it and only when asked, that an empty window
 * and an all-stale window both produce something to look at, and that the path stays bounded however
 * many readings the ring holds. A component test can confirm the strings reach the element; only this
 * file can confirm they are the right strings.
 */

import { describe, expect, it } from 'vitest';
import type { SensorReading } from '@perch/sensor-contract';
import { DEFAULT_CHART_GAP } from '@perch/layout-schema';
import {
  CHART_COLUMN_PX,
  CHART_GRIDLINE_COUNT,
  CHART_GRID_STROKE_PX,
  CHART_MARKER_RADIUS_PX,
  CHART_PLOT_INSET_PX,
  CHART_SERIES_STROKE_PX,
  DEFAULT_STALE_AFTER_MS,
  NO_HISTORY,
  chartView,
  formatSpan,
  type ChartViewInput,
  type SensorHistorySnapshot,
} from '@perch/ui-kit';

const NOW = 1_000_000;
const WIDTH = 400;
const HEIGHT = 200;
const WINDOW = 60_000;

/** The plot the numbers below are in, derived rather than restated. */
const PLOT = {
  x: CHART_PLOT_INSET_PX,
  y: CHART_PLOT_INSET_PX,
  w: WIDTH - CHART_PLOT_INSET_PX * 2,
  h: HEIGHT - CHART_PLOT_INSET_PX * 2,
};

/** A history snapshot, the shape the store publishes. */
function history(samples: readonly SensorReading[], endsAt = NOW): SensorHistorySnapshot {
  return { windowMs: WINDOW, endsAt, samples };
}

/** A reading `agoMs` before the window's end. */
function ago(agoMs: number, value: number | null): SensorReading {
  return { at: NOW - agoMs, value };
}

function input(overrides: Partial<ChartViewInput> = {}): ChartViewInput {
  return {
    history: history([]),
    windowMs: WINDOW,
    range: [0, 100],
    width: WIDTH,
    height: HEIGHT,
    metric: 'temperature',
    staleAfterMs: DEFAULT_STALE_AFTER_MS,
    ...overrides,
  };
}

/** How many pen-down runs a `d` string contains. */
function moves(path: string): number {
  return path.split('M').length - 1;
}

/** The points of a `d` string, in order, as `[x, y]` pairs. */
function points(path: string): readonly [number, number][] {
  const matched = path.match(/[ML]-?\d+ -?\d+/g) ?? [];
  return matched.map((command) => {
    const [x, y] = command.slice(1).split(' ');
    return [Number(x), Number(y)];
  });
}

describe('the marks are sized for a physical panel, not a browser', () => {
  it('draws a 3px series line rather than the 2px a screen chart would use', () => {
    // 1920x400 on a wall at three metres. A 2px line reads as a flicker and a 1px one leans on
    // antialiasing the LCD does not reward. Odd-times-one, so a stroke centred on an integer pixel
    // covers whole pixels.
    expect(CHART_SERIES_STROKE_PX).toBe(3);
    expect(CHART_SERIES_STROKE_PX % 2).toBe(1);
  });

  it('keeps gridlines hairline and solves the panel with placement instead of weight', () => {
    // Thickening the grid is how a chart starts reading as a table of boxes. The answer is the
    // half-integer y below, not a second pixel of ink.
    expect(CHART_GRID_STROKE_PX).toBe(1);
  });

  it('draws a marker at least eight pixels across', () => {
    expect(CHART_MARKER_RADIUS_PX * 2).toBeGreaterThanOrEqual(8);
  });

  it('insets the plot far enough for a whole marker at the edge of the range', () => {
    // The newest reading can sit anywhere in the range, including exactly on it, and its marker plus
    // the 2px surface ring must be whole wherever that is.
    expect(CHART_PLOT_INSET_PX).toBeGreaterThanOrEqual(CHART_MARKER_RADIUS_PX + 2);
  });

  it('samples at one canvas pixel, which is what the output can resolve', () => {
    expect(CHART_COLUMN_PX).toBe(1);
  });
});

describe('chartView geometry', () => {
  it('derives the plot from the rect, with no measurement anywhere', () => {
    const view = chartView(input());
    expect(view.plot).toEqual(PLOT);
  });

  it('gives a rect too small for its own inset a zero-area plot rather than inverted geometry', () => {
    const view = chartView(input({ width: 4, height: 4 }));
    expect(view.plot.w).toBe(0);
    expect(view.plot.h).toBe(0);
    // And it still renders: an under-sized chart looks starved, it does not throw.
    expect(view.state).toBe('empty');
  });

  it('draws a fixed number of gridlines, on half-integers, labelled at the range ends', () => {
    const view = chartView(input({ range: [20, 80] }));
    expect(view.gridlines).toHaveLength(CHART_GRIDLINE_COUNT);
    // Half-integer centres, so a 1px stroke lands on one row of pixels rather than smearing over two.
    for (const line of view.gridlines) expect(line.y % 1).toBe(0.5);
    expect(view.gridlines.map((line) => line.label)).toEqual(['80.0', '50.0', '20.0']);
    expect(view.gridlines[0]?.y).toBe(PLOT.y + 0.5);
    expect(view.gridlines[CHART_GRIDLINE_COUNT - 1]?.y).toBe(PLOT.y + PLOT.h + 0.5);
  });

  it('keeps the gridline count constant across ranges, so the skeleton never changes shape', () => {
    const tight = chartView(input({ range: [34, 35] }));
    const wide = chartView(input({ range: [-40, 1_000] }));
    expect(tight.gridlines).toHaveLength(wide.gridlines.length);
  });
});

describe('chartView: nothing yet', () => {
  it('renders the waiting state rather than an empty box', () => {
    const view = chartView(input({ history: history([]) }));
    expect(view.state).toBe('empty');
    expect(view.value).toBe('--');
    expect(view.note).toBe('waiting');
    expect(view.seriesPath).toBe('');
    expect(view.areaPath).toBe('');
    expect(view.marker).toBeNull();
    // The grid and the axis labels are still there, which is what makes an empty chart legible: a
    // reader can see what it will plot and over what scale before the first reading lands.
    expect(view.gridlines).toHaveLength(CHART_GRIDLINE_COUNT);
    expect(view.spanLabel).toBe('1 min');
  });

  it('treats an unretained topic the same way', () => {
    const view = chartView(input({ history: NO_HISTORY }));
    expect(view.state).toBe('empty');
    expect(view.seriesPath).toBe('');
  });

  it('treats a window holding only readings older than itself as empty', () => {
    // The samples exist but every one of them is off the left edge — the store had a longer window
    // retained for another chart, and this chart's declared window excludes them all.
    const view = chartView(input({ history: history([ago(600_000, 40)]) }));
    expect(view.state).toBe('empty');
    expect(view.note).toBe('waiting');
  });
});

describe('chartView: a partial series', () => {
  it('draws a single reading as a dot rather than nothing', () => {
    const view = chartView(input({ history: history([ago(0, 50)]) }));
    expect(view.state).toBe('series');
    // A bare `M` paints nothing at all. The zero-length line plus a round linecap paints a dot the
    // width of the stroke, so one reading in a window is visible.
    expect(view.seriesPath).toBe(
      `M${String(PLOT.x + PLOT.w)} ${String(PLOT.y + PLOT.h / 2)}L${String(PLOT.x + PLOT.w)} ${String(PLOT.y + PLOT.h / 2)}`,
    );
    // No area, though: one point has no width, and a hairline wash would suggest a span.
    expect(view.areaPath).toBe('');
    expect(view.pointCount).toBe(1);
  });

  it('starts the line where the readings start, not at the left edge', () => {
    // Fifteen seconds of history in a sixty second window: the line occupies the right quarter and
    // the empty three quarters are the truth about how long this has been running.
    const view = chartView(
      input({
        history: history([ago(15_000, 40), ago(10_000, 42), ago(5_000, 44), ago(0, 46)]),
      }),
    );
    const drawn = points(view.seriesPath);
    expect(drawn[0]?.[0]).toBe(Math.round(PLOT.x + PLOT.w * (1 - 15_000 / WINDOW)));
    expect(drawn[drawn.length - 1]?.[0]).toBe(PLOT.x + PLOT.w);
  });

  it('ends the line at the last reading and extrapolates nothing to the right edge', () => {
    const view = chartView(input({ history: history([ago(30_000, 40), ago(20_000, 42)]) }));
    const drawn = points(view.seriesPath);
    const lastX = drawn[drawn.length - 1]?.[0];
    expect(lastX).toBe(Math.round(PLOT.x + PLOT.w * (1 - 20_000 / WINDOW)));
    // The distance from there to the right edge is how long the publisher has been quiet, to scale.
    expect(lastX).toBeLessThan(PLOT.x + PLOT.w);
  });

  it('puts the marker on the newest drawn reading', () => {
    const view = chartView(input({ history: history([ago(10_000, 40), ago(0, 100)]) }));
    expect(view.marker).toEqual({ x: PLOT.x + PLOT.w, y: PLOT.y });
  });
});

describe('chartView: the y-scale is authored, never fitted', () => {
  it('maps the range ends to the plot ends', () => {
    const view = chartView(input({ range: [0, 100], history: history([ago(0, 0)]) }));
    expect(view.marker?.y).toBe(PLOT.y + PLOT.h);
    const top = chartView(input({ range: [0, 100], history: history([ago(0, 100)]) }));
    expect(top.marker?.y).toBe(PLOT.y);
  });

  it('clamps a reading outside the range instead of rescaling the axis', () => {
    const view = chartView(input({ range: [0, 100], history: history([ago(0, 250)]) }));
    // A fitted axis would make every capture incomparable with the last one. The line touches the
    // top edge and the header still prints the real number.
    expect(view.marker?.y).toBe(PLOT.y);
    expect(view.value).toBe('250.0');
    expect(view.gridlines[0]?.label).toBe('100.0');
  });

  it('reads an inverted range downwards rather than refusing it', () => {
    const view = chartView(input({ range: [100, 0], history: history([ago(0, 100)]) }));
    expect(view.marker?.y).toBe(PLOT.y + PLOT.h);
  });

  it('puts every reading on the midline when the range has no span', () => {
    const view = chartView(input({ range: [50, 50], history: history([ago(0, 50)]) }));
    expect(view.marker?.y).toBe(Math.round(PLOT.y + PLOT.h / 2));
  });
});

describe('chartView: gap', () => {
  /** Three readings, a twenty second silence, then three more. */
  const withHole = history([
    ago(40_000, 40),
    ago(39_000, 41),
    ago(38_000, 42),
    ago(18_000, 50),
    ago(17_000, 51),
    ago(16_000, 52),
  ]);

  it("defaults to the format's default rather than restating it", () => {
    const implicit = chartView(input({ history: withHole }));
    const explicit = chartView(input({ history: withHole, gap: DEFAULT_CHART_GAP }));
    // One absent `gap` must not mean two things. If `layout-schema` ever changes its default, this
    // widget follows it without an edit here.
    expect(implicit).toEqual(explicit);
  });

  it("lifts the pen across a hole under 'break'", () => {
    const view = chartView(input({ history: withHole, gap: 'break' }));
    expect(view.segmentCount).toBe(2);
    // Two subpaths in one `d`: the node count is the thing that must not change, not the run count.
    expect(moves(view.seriesPath)).toBe(2);
  });

  it('holes the area fill too, so the gap is not put back in dispute', () => {
    const view = chartView(input({ history: withHole, gap: 'break' }));
    expect(moves(view.areaPath)).toBe(2);
    expect(view.areaPath.split('Z')).toHaveLength(3);
  });

  it("draws through a hole under 'span', and only when asked", () => {
    const spanned = chartView(input({ history: withHole, gap: 'span' }));
    expect(spanned.segmentCount).toBe(1);
    expect(moves(spanned.seriesPath)).toBe(1);
    // Same data, same everything else: the only reason the line is continuous is that an author said so.
    const broken = chartView(input({ history: withHole, gap: 'break' }));
    expect(broken.segmentCount).toBe(2);
  });

  it('measures a hole with the store’s own staleness threshold', () => {
    // A ten second silence is a hole to a chart whose store calls five seconds stale, and is not one
    // to a store configured for thirty. The chart must not invent a second definition of quiet, or it
    // will disagree with the readout beside it about the same publisher.
    const tenSecondSilence = history([ago(30_000, 40), ago(20_000, 41)]);
    expect(chartView(input({ history: tenSecondSilence, staleAfterMs: 5_000 })).segmentCount).toBe(
      2,
    );
    expect(chartView(input({ history: tenSecondSilence, staleAfterMs: 30_000 })).segmentCount).toBe(
      1,
    );
  });

  it("breaks across a null reading under 'break', because there is no y for nothing", () => {
    const view = chartView(
      input({
        history: history([ago(30_000, 40), ago(29_000, null), ago(28_000, 42)]),
        gap: 'break',
      }),
    );
    expect(view.segmentCount).toBe(2);
    expect(view.pointCount).toBe(2);
  });

  it("bridges a null reading under 'span', and never plots it as a value", () => {
    const view = chartView(
      input({
        history: history([ago(30_000, 40), ago(29_000, null), ago(28_000, 42)]),
        gap: 'span',
      }),
    );
    expect(view.segmentCount).toBe(1);
    // Two points, not three: a null contributes no coordinate under either setting. `span` decides
    // whether the pen lifts, never whether a missing measurement becomes a number.
    expect(view.pointCount).toBe(2);
  });

  it('prints n/a when the newest reading is a present sensor measuring nothing', () => {
    const view = chartView(input({ history: history([ago(1_000, 40), ago(0, null)]) }));
    expect(view.value).toBe('n/a');
    expect(view.unit).toBe('');
    // The line is still there. The reading that has no value is a hole in it, not an absence of chart.
    expect(view.seriesPath).not.toBe('');
  });
});

describe('chartView: an entirely stale series', () => {
  const stale = history([ago(70_000, 40), ago(65_000, 42), ago(61_000, 44)]);

  it('shows the shape and says it is old, rather than showing nothing', () => {
    const view = chartView(input({ history: stale, windowMs: 120_000 }));
    expect(view.state).toBe('stale');
    expect(view.seriesPath).not.toBe('');
    expect(view.marker).not.toBeNull();
  });

  it('prints the last reading it held, with its age beside it', () => {
    const view = chartView(input({ history: stale, windowMs: 120_000 }));
    // A held-but-old number is information; what must not happen is printing it as though it were
    // current. Same wording as the readout, from the same helper.
    expect(view.value).toBe('44.0');
    expect(view.note).toBe('stale 61s');
  });

  it('says nothing when the newest reading is fresh', () => {
    const view = chartView(input({ history: history([ago(0, 44)]) }));
    expect(view.state).toBe('series');
    expect(view.note).toBe('');
  });

  it('turns stale exactly at the threshold the store gave it', () => {
    const atThreshold = history([ago(DEFAULT_STALE_AFTER_MS, 44)]);
    expect(chartView(input({ history: atThreshold })).state).toBe('series');
    const past = history([ago(DEFAULT_STALE_AFTER_MS + 1, 44)]);
    expect(chartView(input({ history: past })).state).toBe('stale');
  });
});

describe('chartView: the frame budget', () => {
  /** A 4 Hz publisher filling a whole window. */
  function dense(windowMs: number, spacingMs: number): SensorHistorySnapshot {
    const samples: SensorReading[] = [];
    for (let agoMs = windowMs; agoMs >= 0; agoMs -= spacingMs) {
      samples.push(ago(agoMs, 50 + 40 * Math.sin(agoMs / 900)));
    }
    return { windowMs, endsAt: NOW, samples };
  }

  it('thins the series to the pixel columns it can occupy', () => {
    const packed = dense(WINDOW, 250);
    expect(packed.samples.length).toBeGreaterThan(200);

    const view = chartView(input({ history: packed }));
    // At most two points per column — the min and the max — whatever the ring holds. This is the bound
    // that makes redraw cost a function of the rect rather than of the publish rate.
    expect(view.pointCount).toBeLessThanOrEqual((PLOT.w / CHART_COLUMN_PX + 1) * 2);
  });

  it('caps the path by the rect when the publisher speeds up', () => {
    const packed = dense(WINDOW, 25);
    const fast = chartView(input({ history: packed }));
    const cap = (PLOT.w / CHART_COLUMN_PX + 1) * 2;

    // 2,401 readings through 386 pixel columns. Forty times the readings of a 1 Hz publisher, and the
    // cost of drawing them is the *rect's* — which is constant across a capture — not the rate's.
    expect(packed.samples.length).toBeGreaterThan(2_000);
    expect(fast.pointCount).toBeLessThanOrEqual(cap);
    expect(fast.pointCount).toBeLessThan(packed.samples.length / 2);

    // Doubling the rate again cannot push it past the same cap.
    const faster = chartView(input({ history: dense(WINDOW, 10) }));
    expect(faster.pointCount).toBeLessThanOrEqual(cap);
  });

  it('keeps the whole vertical extent of a column, so a spike is not smoothed away', () => {
    // Two readings landing in the same column, thirty apart. Keeping one representative would erase
    // the spike a person watching a wall panel is specifically looking for.
    const spike = history([ago(20_000, 40), ago(19_990, 90), ago(10_000, 41)]);
    const view = chartView(input({ history: spike }));
    const ys = points(view.seriesPath).map(([, y]) => y);
    expect(Math.min(...ys)).toBe(chartView(input({ history: history([ago(0, 90)]) })).marker?.y);
  });

  it('emits whole-pixel coordinates, so the path is stable between identical frames', () => {
    const view = chartView(input({ history: dense(WINDOW, 250) }));
    for (const [x, y] of points(view.seriesPath)) {
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
    }
    // An unrounded coordinate changes in its fifteenth decimal between two frames of identical data,
    // which rewrites the attribute and re-rasterises the path for no visible reason.
    expect(view.seriesPath).not.toContain('.');
  });

  it('is a pure function of its input, clock included', () => {
    const shared = input({ history: dense(WINDOW, 250) });
    // "Same snapshot, same pixels" is the claim the whole capture story rests on, and the clock
    // arriving inside the snapshot is what lets a plain assertion check it.
    expect(chartView(shared)).toEqual(chartView(shared));
    expect(chartView(shared).seriesPath).toBe(chartView(shared).seriesPath);
  });

  it('draws x monotonically left to right within a run', () => {
    const view = chartView(input({ history: dense(WINDOW, 250) }));
    const xs = points(view.seriesPath).map(([x]) => x);
    for (let index = 1; index < xs.length; index += 1) {
      expect(xs[index]).toBeGreaterThanOrEqual(xs[index - 1] ?? 0);
    }
  });
});

describe('chartView: the element window, not the ring window', () => {
  it('clips to the window the element declared, however much the store retained', () => {
    // Two charts on one topic share a ring sized to the longer of them. The shorter chart must not
    // quietly draw the other chart's window.
    const longRing: SensorHistorySnapshot = {
      windowMs: 600_000,
      endsAt: NOW,
      samples: [ago(500_000, 10), ago(30_000, 40), ago(0, 44)],
    };
    const view = chartView(input({ history: longRing, windowMs: 60_000 }));
    expect(view.pointCount).toBe(2);
    expect(view.spanLabel).toBe('1 min');
  });
});

describe('formatSpan', () => {
  it('words a window in the unit an author would have written', () => {
    expect(formatSpan(1_000)).toBe('1 s');
    expect(formatSpan(45_000)).toBe('45 s');
    expect(formatSpan(90_000)).toBe('1.5 min');
    expect(formatSpan(300_000)).toBe('5 min');
    expect(formatSpan(3_600_000)).toBe('1 h');
    expect(formatSpan(86_400_000)).toBe('24 h');
  });

  it('never prints a float artefact', () => {
    expect(formatSpan(5_400_000)).toBe('1.5 h');
    expect(formatSpan(100_000)).toBe('1.7 min');
  });

  it('degrades rather than throwing on a window no validated layout can hold', () => {
    expect(formatSpan(0)).toBe('0 s');
    expect(formatSpan(Number.NaN)).toBe('0 s');
  });
});
