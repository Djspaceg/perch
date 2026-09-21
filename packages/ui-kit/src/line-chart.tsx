/**
 * perch's first chart: one topic's recent history, as a line on a wall.
 *
 * The same shape as `<Readout>` one level up in complexity. It reads one topic through
 * `useSensorHistory` — which is also what makes the store retain that window while this component is
 * mounted — hands the snapshot to the pure `chartView`, and places the resulting path data and strings
 * into a **fixed** element skeleton. It owns no subscription, holds no state, starts no timer, measures
 * nothing and never sees the source.
 *
 * ## Why the skeleton never changes shape, and why that is harder here
 *
 * `readout.tsx` establishes the rule and the reason: the panel is *captured*, not interacted with, so
 * a widget that inserts or removes a node between states risks being photographed mid-layout. A chart
 * strains that rule in a way a readout does not, because the *data* wants to change the node count —
 * a series with three holes has four runs of line, and the obvious implementation is four `<path>`
 * elements. Three things keep the count constant anyway:
 *
 * 1. **One `<path>` for the whole series, holes and all.** `chart-view.ts` lifts the pen with an `M`
 *    inside a single `d` string, so an update writes one attribute and never touches the tree. Same
 *    for the area wash.
 * 2. **A fixed gridline count.** `CHART_GRIDLINE_COUNT` is a constant, not a function of the range, so
 *    a retheme or a rescale cannot add a node.
 * 3. **Every text run and the marker are always rendered.** The placeholder is an empty string rather
 *    than an absent element, and the marker is present with `data-shown="false"` rather than removed.
 *    Both states differ by text content and attributes only.
 *
 * The plot is sized by arithmetic, never by measurement. `width` and `height` arrive as props from the
 * element's authored rect, the header and footer have fixed pixel heights, and the plot is what is
 * left. A `ResizeObserver` would fire *after* layout, so frame one would draw at the wrong size and
 * frame two would move it — a reflow on the first captured frame, which is exactly what is forbidden.
 * Because the SVG's `width`/`height` match its `viewBox`, one user unit is one canvas pixel, which is
 * what makes the half-integer gridlines and whole-pixel series coordinates mean anything.
 *
 * ## Why the sheet mounts itself
 *
 * `<style href="perch-chart" precedence="default">` is hoisted to `<head>` by React 19 and deduped by
 * `href`, so a chart appearing anywhere in a tree brings its own styles with it. The other widgets in
 * this package are mounted explicitly by the app instead, which works because every app was edited
 * when they were added; this one is deliberately self-sufficient. Hoisting also makes the explicit
 * mount harmless if an app adds one later — same `href`, one sheet.
 *
 * ## What it looks like when there is nothing to draw
 *
 * Both of the states a dashboard actually spends most of its time in are drawn, not skipped:
 *
 * - **Nothing yet.** The frame, the grid and the scale are painted, the header prints `--`, and the
 *   plot carries `waiting for readings`. A reader can see what the chart will plot and against what
 *   scale before the first reading lands.
 * - **Entirely stale.** The line is drawn in `--perch-stale` with the marker ringed the same way, the
 *   header prints the last reading it held, and the note prints its age. The shape is still worth
 *   seeing; what must not happen is showing it as though it were current.
 */

import type { ReactNode } from 'react';
import {
  SENSOR_METRIC_UNITS,
  normalizeSensorTopic,
  parseSensorTopic,
  type SensorMetric,
} from '@perch/sensor-contract';
import type { ChartGap, Range } from '@perch/layout-schema';
import { assertNever } from './exhaustive.js';
import {
  CHART_GRID_STROKE_PX,
  CHART_MARKER_RADIUS_PX,
  CHART_SERIES_STROKE_PX,
  chartView,
  type ChartStateKind,
} from './chart-view.js';
import { useSensorHistory, useSensorStore } from './sensor-context.js';
import { token } from './tokens.js';

/**
 * Height of the header row, in canvas pixels.
 *
 * Fixed, because the plot's height is `rect.h` minus this and the footer, and a header that sized
 * itself to its text would make the plot's geometry depend on the reading in it. At the default
 * `--perch-chart-value-size` of 1.5rem (24px) this is the line box plus two pixels of leading.
 */
export const CHART_HEADER_PX = 26;

/** Height of the footer row, in canvas pixels. The axis type at 0.8125rem (13px), plus leading. */
export const CHART_FOOTER_PX = 16;

/**
 * How loud a state should look.
 *
 * The same two-axis treatment as `readout.tsx`, and for the same reason: CSS has no exhaustiveness
 * check, so a state added to `ChartStateKind` with no rule written for it would render unstyled — an
 * invisible series on a panel nobody is watching. Deciding tone in TypeScript makes the omission a
 * compile error in `toneOf` instead.
 */
type ChartTone = 'none' | 'quiet' | 'alert';

export interface LineChartProps {
  /** The topic to plot. Canonical or the authored shorthand. */
  topic: string;
  /** How much history to draw, in ms back from now. The window this component retains while mounted. */
  windowMs: number;
  /** The authored y-scale. Never fitted to the data. */
  range: Range;
  /** The element's box, in canvas pixels. Authored, never measured. */
  width: number;
  height: number;
  /** What to draw across a stretch of time with no readings. The format's default when absent. */
  gap?: ChartGap | undefined;
  /** What to call it. Falls back to the canonical topic, as the readout's does. */
  label?: string | undefined;
  /** Override the metric's decimal count. */
  decimals?: number | undefined;
}

export function LineChart(props: LineChartProps): ReactNode {
  const { topic, windowMs, range, width, height, gap, label, decimals } = props;

  // Every hook first and unconditionally, before anything that can throw or branch.
  const store = useSensorStore();
  const history = useSensorHistory(topic, windowMs);
  const parsed = parseTopic(topic);

  const plotHeight = Math.max(0, Math.round(height) - CHART_HEADER_PX - CHART_FOOTER_PX);
  const view = chartView({
    history,
    windowMs,
    range,
    width,
    height: plotHeight,
    metric: parsed.metric,
    // Borrowed, not invented: the store's threshold is the one definition of "a publisher has gone
    // quiet" in the system, and a chart that located holes by its own rule would contradict the
    // readout beside it about the same silence.
    staleAfterMs: store.staleAfterMs,
    gap,
    decimals,
  });

  const caption = label ?? parsed.canonical;
  // The scale's unit comes from the metric, not from the header's reading: a chart with no reading
  // yet still has a scale, and it must be labelled in the unit that scale is in.
  const scaleLabel = scaleOf(view.gridlines, SENSOR_METRIC_UNITS[parsed.metric]);

  return (
    <div
      className="perch-chart"
      role="group"
      aria-label={caption}
      data-state={view.state}
      data-tone={toneOf(view.state)}
      data-topic={parsed.canonical}
    >
      {/*
       * The widget brings its own styles. Hoisted to <head> by React 19 and deduped by `href`, so a
       * chart works in any tree without that tree being edited — see the module comment.
       */}
      <style href="perch-chart" precedence="default">
        {LINE_CHART_STYLES}
      </style>

      <div className="perch-chart__header" style={{ height: `${String(CHART_HEADER_PX)}px` }}>
        <span className="perch-chart__label">{caption}</span>
        <span className="perch-chart__value">
          {view.value}
          {/* The space is in the text so the widget reads as `61.3 °C`, exactly as the readout does. */}
          <span className="perch-chart__unit">{view.unit === '' ? '' : ` ${view.unit}`}</span>
        </span>
      </div>

      <svg
        className="perch-chart__plot"
        width={width}
        height={plotHeight}
        viewBox={`0 0 ${String(width)} ${String(plotHeight)}`}
        // One user unit is one canvas pixel, which is what makes the pixel snapping in `chart-view`
        // real. Without this an SVG stretched to its box would resample every coordinate.
        preserveAspectRatio="none"
        role="presentation"
      >
        {/*
         * `crispEdges` on the grid only. A 1px line centred on a half-integer lands on exactly one row
         * of pixels with it, and smears across two at half intensity without it — which on an LCD at
         * three metres is the difference between a grid and a haze. The series keeps the default
         * rendering, because a diagonal stroke *needs* antialiasing to read as a line.
         */}
        <g className="perch-chart__grid" shapeRendering="crispEdges">
          {view.gridlines.map((line, index) => (
            <line
              // Index as key: the gridline count is a constant, so there is nothing to reorder.
              key={index}
              x1={view.plot.x}
              y1={line.y}
              x2={view.plot.x + view.plot.w}
              y2={line.y}
            />
          ))}
        </g>

        {/* Both always rendered, `d` empty or not: an absent node is a changed skeleton. */}
        <path className="perch-chart__area" d={view.areaPath} />
        <path className="perch-chart__line" d={view.seriesPath} />

        {/*
         * The marker on the newest reading, always present and hidden by attribute when there is
         * nothing to mark. `data-shown` rather than a conditional render, and `visibility` rather than
         * `display`, so nothing about the tree or the geometry changes between states.
         */}
        <circle
          className="perch-chart__marker"
          data-shown={view.marker === null ? 'false' : 'true'}
          cx={view.marker?.x ?? 0}
          cy={view.marker?.y ?? 0}
          r={CHART_MARKER_RADIUS_PX}
        />

        {/* Always rendered, empty or not. Carries `waiting for readings` and nothing else. */}
        <text
          className="perch-chart__placeholder"
          x={view.plot.x + view.plot.w / 2}
          y={view.plot.y + view.plot.h / 2}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {view.placeholder}
        </text>
      </svg>

      <div className="perch-chart__footer" style={{ height: `${String(CHART_FOOTER_PX)}px` }}>
        <span className="perch-chart__span">{view.spanLabel}</span>
        {/* Empty or not, always rendered: a note row that appears would change the height. */}
        <span className="perch-chart__note">{view.note}</span>
        <span className="perch-chart__scale">{scaleLabel}</span>
      </div>
    </div>
  );
}

/**
 * The scale, printed from the gridlines that were drawn.
 *
 * Read off `view.gridlines` rather than off `range` on purpose: the label and the line it belongs to
 * then cannot disagree, even at a precision where `[34, 92]` has no clean midpoint. The ends are
 * printed and the middle line is left for the reader to infer, which is the honest amount of axis for
 * a panel read from three metres — tick text small enough to sit inside the plot would be legible in a
 * browser and a smudge on the wall.
 *
 * A single series needs no legend, per the `dataviz` guidance: there is one colour, and the caption
 * already says what is plotted. This footer is the axis, not a legend.
 */
function scaleOf(gridlines: readonly { readonly label: string }[], unit: string): string {
  const high = gridlines[0]?.label;
  const low = gridlines[gridlines.length - 1]?.label;
  if (high === undefined || low === undefined) return '';
  return unit === '' ? `${low} to ${high}` : `${low} to ${high} ${unit}`;
}

/**
 * The component's own exhaustiveness check over the chart's states.
 *
 * A fourth state fails to compile here until somebody decides how loud it is.
 */
function toneOf(state: ChartStateKind): ChartTone {
  switch (state) {
    case 'series':
      // A line that is simply current needs no annotation.
      return 'none';
    case 'empty':
      // Not yet an event. A panel starting up must not read as a panel in trouble.
      return 'quiet';
    case 'stale':
      // Something is wrong upstream, and the line says so by changing colour as well as by the note.
      return 'alert';
    default:
      return assertNever(state, 'chart state kind');
  }
}

/**
 * The topic, split into the two things the widget needs from it.
 *
 * Throws rather than degrading, exactly as `Readout` does: a typo that renders as a permanent empty
 * chart is indistinguishable from a dead publisher, and the person who has to tell them apart is
 * standing in front of a panel.
 */
function parseTopic(topic: string): { canonical: string; metric: SensorMetric } {
  const canonical = normalizeSensorTopic(topic);
  const parts = parseSensorTopic(topic);
  if (canonical === null || parts === null) {
    throw new RangeError(`not a sensor topic: ${topic}`);
  }
  return { canonical, metric: parts.metric };
}

/**
 * The chart's styles, as a string, mounted by the component itself.
 *
 * What is absent is as deliberate as what is present, and for the reasons `READOUT_STYLES` sets out:
 * no hover, focus or active rule, because the panel has no pointer and no keyboard; no transition and
 * no keyframe, because a capture samples one frame and anything mid-flight is photographed half-done.
 * A chart is the widget where a transition would be most tempting — an animated line looks alive — and
 * it is the widget where it would do the most damage, because the frame that gets captured would be a
 * line that is partly last second's.
 *
 * The marks follow the `dataviz` specs, adjusted once for the target and only once:
 *
 * - **A 3px series line, round-joined and round-capped**, where a screen chart would use 2px. The
 *   output is captured onto a 1920x400 LCD read from across a room; 2px reads as a flicker there. The
 *   round cap is also what makes a single reading paint as a dot rather than as nothing.
 * - **A 10%-ish area wash**, at the token's default of 0.12, giving the line a body. Never a
 *   saturated block.
 * - **Hairline solid gridlines, one step off the surface.** Solid because a dashed grid reads as a
 *   projection or a threshold when it is only a grid; hairline because the grid must lose every
 *   contest with the series, and the panel is handled by *placing* the line on a half-integer instead
 *   of by thickening it.
 * - **A 10px marker with a 2px surface ring**, so the newest reading stays legible where it crosses
 *   the line.
 * - **No legend.** One series, and the caption names it. A box with one swatch restates the header.
 * - **Text never wears the data colour.** The value, the caption and the axis are text tokens; the
 *   series colour appears on the line, the wash and the marker only.
 *
 * The geometry that the frame budget depends on is deliberately not tokenised — the header and footer
 * heights are written on the elements from the exported constants the plot arithmetic uses, and the
 * stroke widths come from `chart-view.ts` where the coordinates they align to are computed. A theme
 * able to change a stroke width could put a 3px stroke on a half-integer, which is a blurry line that
 * no layout author would connect to the token they set.
 */
export const LINE_CHART_STYLES = `
.perch-chart {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-family: ${token('--perch-font')};
  color: ${token('--perch-fg')};
}
.perch-chart__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  min-width: 0;
  overflow: hidden;
  gap: 0.5em;
}
.perch-chart__label {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: ${token('--perch-chart-label-size')};
  letter-spacing: 0.02em;
  color: ${token('--perch-dim')};
}
.perch-chart__value {
  flex: none;
  white-space: nowrap;
  font-size: ${token('--perch-chart-value-size')};
  font-weight: ${token('--perch-value-weight')};
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.perch-chart__unit {
  font-size: ${token('--perch-chart-label-size')};
  font-weight: 500;
  color: ${token('--perch-dim')};
}
.perch-chart__plot {
  display: block;
  flex: none;
}
.perch-chart__grid line {
  stroke: ${token('--perch-chart-grid')};
  stroke-width: ${String(CHART_GRID_STROKE_PX)}px;
}
.perch-chart__area {
  fill: ${token('--perch-chart-series')};
  fill-opacity: ${token('--perch-chart-area-opacity')};
  stroke: none;
}
.perch-chart__line {
  fill: none;
  stroke: ${token('--perch-chart-series')};
  stroke-width: ${String(CHART_SERIES_STROKE_PX)}px;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.perch-chart__marker {
  fill: ${token('--perch-chart-series')};
  stroke: ${token('--perch-chart-surface')};
  stroke-width: 2px;
}
.perch-chart__marker[data-shown='false'] {
  visibility: hidden;
}
.perch-chart__placeholder {
  fill: ${token('--perch-faint')};
  font-size: ${token('--perch-chart-axis-size')};
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.perch-chart__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  overflow: hidden;
  gap: 0.5em;
  font-size: ${token('--perch-chart-axis-size')};
  font-variant-numeric: tabular-nums;
  color: ${token('--perch-faint')};
}
.perch-chart__span,
.perch-chart__scale {
  flex: none;
  white-space: nowrap;
}
.perch-chart__note {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.perch-chart[data-state='stale'] .perch-chart__line { stroke: ${token('--perch-stale')}; }
.perch-chart[data-state='stale'] .perch-chart__area { fill: ${token('--perch-stale')}; }
.perch-chart[data-state='stale'] .perch-chart__marker { fill: ${token('--perch-stale')}; }
.perch-chart[data-state='stale'] .perch-chart__value { color: ${token('--perch-stale')}; }
.perch-chart[data-state='empty'] .perch-chart__value { color: ${token('--perch-faint')}; }
.perch-chart[data-tone='none'] .perch-chart__note { color: transparent; }
.perch-chart[data-tone='quiet'] .perch-chart__note { color: ${token('--perch-faint')}; }
.perch-chart[data-tone='alert'] .perch-chart__note { color: ${token('--perch-alert')}; }
`;
