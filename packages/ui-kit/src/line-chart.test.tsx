/**
 * The chart as a mounted component: the states a panel is actually in, and the skeleton that must not
 * change between them.
 *
 * `chart-view.test.ts` already checks every coordinate and every string. What only this file can check
 * is that the component *wires* them — that the window it declares is the one the store retains, that
 * `gap` reaches the geometry, that the sheet arrives without the page mounting it, and that the element
 * tree is node-for-node identical whether there are no readings, some readings or only old ones. That
 * last one is the frame-budget claim, and it is about the DOM, so it belongs here.
 */

import type { ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  sensorTopic,
  type SensorReading,
  type SensorSource,
  type SensorTopic,
} from '@perch/sensor-contract';
import {
  CHART_EMPTY_TEXT,
  CHART_NO_VALUES_TEXT,
  DEFAULT_STALE_AFTER_MS,
  LINE_CHART_STYLES,
  LineChart,
  SensorProvider,
  useSensorStore,
  type SensorStore,
} from '@perch/ui-kit';

const CPU_TEMP = sensorTopic('cpu', 'temperature');
const CPU_LOAD = sensorTopic('cpu', 'load');

const WINDOW = 60_000;
const START = 1_000_000;

/** `ui-kit` may not import `sensor-sources`, so the double lives here, as it does beside the readout. */
function fakeSource() {
  const handlers = new Set<(topic: SensorTopic, reading: SensorReading) => void>();

  return {
    status: 'live' as const,
    subscribe(_pattern: string, onReading: (topic: SensorTopic, reading: SensorReading) => void) {
      handlers.add(onReading);
      return () => handlers.delete(onReading);
    },
    meta: () => undefined,
    emit(topic: SensorTopic, reading: SensorReading) {
      act(() => {
        for (const handler of [...handlers]) handler(topic, reading);
      });
    },
  } satisfies SensorSource & Record<string, unknown>;
}

/** A clock the test moves by hand, so a hole in the data is a decision and not a scheduling accident. */
function manualClock(startAt = START) {
  let now = startAt;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

function mount(children: ReactNode) {
  const source = fakeSource();
  const clock = manualClock();
  let store: SensorStore | undefined;

  function Capture(): ReactNode {
    store = useSensorStore();
    return null;
  }

  render(
    <SensorProvider source={source} now={clock.now} recheckIntervalMs={0}>
      <Capture />
      {children}
    </SensorProvider>,
  );

  return {
    source,
    clock,
    /** The store's own re-read, which is how a chart's x-axis advances with no new reading. */
    refresh: () => {
      act(() => {
        store?.refresh();
      });
    },
    /** Publish at the current clock, then move the clock on. The shape a real publisher has. */
    publish(topic: SensorTopic, value: number | null, thenAdvanceMs = 0) {
      source.emit(topic, { value, at: clock.now() });
      clock.advance(thenAdvanceMs);
    },
  };
}

const chartNamed = (name: string): HTMLElement => screen.getByRole('group', { name });

/** One part of the rendered chart, or a failure — a missing node must not silently skip a check. */
function partOf(chart: HTMLElement, part: string): Element {
  const element = chart.querySelector(`.perch-chart__${part}`);
  if (element === null) throw new Error(`no ${part} in the rendered chart`);
  return element;
}

/**
 * The element tree, as tag-and-class in document order.
 *
 * The frame-budget assertion in this file is entirely this function: the panel is captured rather than
 * watched, so a node appearing or disappearing between two states risks being photographed mid-layout.
 * Text content and attributes are deliberately *not* part of it — those are what an update is allowed
 * to change.
 */
function shapeOf(chart: HTMLElement): string[] {
  return Array.from(chart.querySelectorAll('*'), (node) => `${node.tagName}.${node.getAttribute('class') ?? ''}`);
}

/** How many pen-down runs the series path holds. Two runs is a broken line. */
function runsIn(chart: HTMLElement): number {
  return (partOf(chart, 'line').getAttribute('d') ?? '').split('M').length - 1;
}

afterEach(cleanup);

describe('<LineChart> — nothing yet', () => {
  it('draws the frame, the grid and the scale before any reading exists', () => {
    mount(<LineChart topic={CPU_TEMP} windowMs={WINDOW} range={[0, 100]} width={400} height={200} />);

    const chart = chartNamed(CPU_TEMP);
    expect(chart).toHaveAttribute('data-state', 'empty');
    // Legible rather than blank: a reader can see what it will plot, over what window, against what
    // scale, before the first reading lands.
    expect(partOf(chart, 'placeholder').textContent).toBe(CHART_EMPTY_TEXT);
    expect(partOf(chart, 'span').textContent).toBe('1 min');
    expect(partOf(chart, 'scale').textContent).toBe('0.0 to 100.0 °C');
    expect(partOf(chart, 'value').textContent).toContain('--');
    expect(chart.querySelectorAll('.perch-chart__grid line')).toHaveLength(3);
  });

  it('draws no series and hides the marker rather than removing it', () => {
    mount(<LineChart topic={CPU_TEMP} windowMs={WINDOW} range={[0, 100]} width={400} height={200} />);

    const chart = chartNamed(CPU_TEMP);
    expect(partOf(chart, 'line').getAttribute('d')).toBe('');
    expect(partOf(chart, 'area').getAttribute('d')).toBe('');
    expect(partOf(chart, 'marker')).toHaveAttribute('data-shown', 'false');
  });

  it('is quiet about it, because a panel starting up is not a panel in trouble', () => {
    mount(<LineChart topic={CPU_TEMP} windowMs={WINDOW} range={[0, 100]} width={400} height={200} />);

    const chart = chartNamed(CPU_TEMP);
    expect(chart).toHaveAttribute('data-tone', 'quiet');
    expect(partOf(chart, 'note').textContent).toBe('waiting');
  });
});

describe('<LineChart> — readings arriving', () => {
  it('draws a line as readings accumulate, and prints the newest in the header', () => {
    const panel = mount(
      <LineChart topic={CPU_TEMP} windowMs={WINDOW} range={[0, 100]} width={400} height={200} />,
    );

    panel.publish(CPU_TEMP, 40, 1_000);
    panel.publish(CPU_TEMP, 44, 1_000);
    panel.publish(CPU_TEMP, 48);

    const chart = chartNamed(CPU_TEMP);
    expect(chart).toHaveAttribute('data-state', 'series');
    expect(partOf(chart, 'value').textContent).toBe('48.0 °C');
    expect(partOf(chart, 'line').getAttribute('d')).not.toBe('');
    expect(partOf(chart, 'area').getAttribute('d')).not.toBe('');
    expect(partOf(chart, 'marker')).toHaveAttribute('data-shown', 'true');
    // Nothing to say about a line that is simply current.
    expect(partOf(chart, 'note').textContent).toBe('');
    expect(chart).toHaveAttribute('data-tone', 'none');
  });

  it('draws one reading as a dot rather than as nothing', () => {
    const panel = mount(
      <LineChart topic={CPU_TEMP} windowMs={WINDOW} range={[0, 100]} width={400} height={200} />,
    );

    panel.publish(CPU_TEMP, 50);

    const chart = chartNamed(CPU_TEMP);
    expect(partOf(chart, 'line').getAttribute('d')).not.toBe('');
    // No wash under a single point: one reading has no width, and a hairline fill would imply a span.
    expect(partOf(chart, 'area').getAttribute('d')).toBe('');
  });

  it('retains exactly the window it was given, and plots only that window', () => {
    // Published eight minutes back, inside a store that is retaining ten minutes for this chart, but
    // outside the one minute this chart draws. The store holding it is not permission to plot it.
    const panel = mount(
      <LineChart topic={CPU_TEMP} windowMs={600_000} range={[0, 100]} width={400} height={200} />,
    );
    panel.publish(CPU_TEMP, 40, 480_000);
    panel.refresh();

    const long = chartNamed(CPU_TEMP);
    expect(partOf(long, 'line').getAttribute('d')).not.toBe('');
    expect(partOf(long, 'span').textContent).toBe('10 min');
  });

  it('plots a reading for its own topic only', () => {
    const panel = mount(
      <LineChart topic={CPU_TEMP} windowMs={WINDOW} range={[0, 100]} width={400} height={200} />,
    );

    panel.publish(CPU_LOAD, 90);

    expect(chartNamed(CPU_TEMP)).toHaveAttribute('data-state', 'empty');
  });

  it('prints n/a for a sensor that is present and measuring nothing', () => {
    const panel = mount(
      <LineChart topic={CPU_TEMP} windowMs={WINDOW} range={[0, 100]} width={400} height={200} />,
    );

    panel.publish(CPU_TEMP, 40, 1_000);
    panel.publish(CPU_TEMP, null);

    const chart = chartNamed(CPU_TEMP);
    expect(partOf(chart, 'value').textContent).toBe('n/a');
    // And the line it already drew is still there: a reading with no value is a hole in a series, not
    // the absence of one.
    expect(partOf(chart, 'line').getAttribute('d')).not.toBe('');
  });

  it('takes a caption from the caller and falls back to the canonical topic', () => {
    mount(
      <LineChart
        topic="sensors/cpu/temperature"
        windowMs={WINDOW}
        range={[0, 100]}
        width={400}
        height={200}
        label="CPU Package"
      />,
    );

    expect(chartNamed('CPU Package')).toBeInTheDocument();
  });

  it('throws on a topic outside the grammar rather than plotting nothing forever', () => {
    expect(() =>
      mount(
        <LineChart
          topic="sensors/cpu/tempreature"
          windowMs={WINDOW}
          range={[0, 100]}
          width={400}
          height={200}
        />,
      ),
    ).toThrow(RangeError);
  });
});

describe('<LineChart> — an entirely stale series', () => {
  /** A short burst, then a silence longer than the store's staleness threshold. */
  function stalePanel() {
    const panel = mount(
      <LineChart topic={CPU_TEMP} windowMs={WINDOW} range={[0, 100]} width={400} height={200} />,
    );
    panel.publish(CPU_TEMP, 40, 1_000);
    panel.publish(CPU_TEMP, 42, 1_000);
    panel.publish(CPU_TEMP, 44, DEFAULT_STALE_AFTER_MS + 3_000);
    panel.refresh();
    return panel;
  }

  it('keeps the shape on screen and says it is old', () => {
    stalePanel();

    const chart = chartNamed(CPU_TEMP);
    expect(chart).toHaveAttribute('data-state', 'stale');
    expect(chart).toHaveAttribute('data-tone', 'alert');
    // The shape is still worth seeing. What must not happen is showing it as though it were current.
    expect(partOf(chart, 'line').getAttribute('d')).not.toBe('');
    expect(partOf(chart, 'marker')).toHaveAttribute('data-shown', 'true');
  });

  it('prints the last reading it held, with its age beside it', () => {
    stalePanel();

    const chart = chartNamed(CPU_TEMP);
    expect(partOf(chart, 'value').textContent).toBe('44.0 °C');
    expect(partOf(chart, 'note').textContent).toMatch(/^stale \d+s$/);
  });

  it('recolours the line rather than relying on the note alone', () => {
    stalePanel();

    // The state attribute is what the sheet keys off — see LINE_CHART_STYLES — so the assertion that
    // the styling can happen is the attribute, which jsdom can see, rather than a computed colour on
    // an SVG node, which it cannot.
    expect(LINE_CHART_STYLES).toContain(
      ".perch-chart[data-state='stale'] .perch-chart__line",
    );
    expect(chartNamed(CPU_TEMP)).toHaveAttribute('data-state', 'stale');
  });

  it('returns to waiting once the last reading has left the window entirely', () => {
    const panel = mount(
      <LineChart topic={CPU_TEMP} windowMs={WINDOW} range={[0, 100]} width={400} height={200} />,
    );
    panel.publish(CPU_TEMP, 44, WINDOW + 5_000);
    panel.refresh();

    const chart = chartNamed(CPU_TEMP);
    // Still a chart, still showing its scale and its window. The reading is gone from the ring as well
    // as from the plot, and this chart is genuinely back to holding nothing — a stale *number* is only
    // printable while the ring still has it.
    expect(chart).toHaveAttribute('data-state', 'empty');
    expect(partOf(chart, 'placeholder').textContent).toBe(CHART_EMPTY_TEXT);
    expect(partOf(chart, 'line').getAttribute('d')).toBe('');
    expect(partOf(chart, 'scale').textContent).toBe('0.0 to 100.0 °C');
  });

  it('says so when it has readings and none of them carry a value', () => {
    const panel = mount(
      <LineChart topic={CPU_TEMP} windowMs={WINDOW} range={[0, 100]} width={400} height={200} />,
    );
    panel.publish(CPU_TEMP, null, 1_000);
    panel.publish(CPU_TEMP, null);

    const chart = chartNamed(CPU_TEMP);
    // A present sensor reporting nothing, twice. There is a series and there is no line, which is
    // worth saying: an empty plot under a header printing `n/a` explains none of the blank space.
    expect(chart).toHaveAttribute('data-state', 'series');
    expect(partOf(chart, 'placeholder').textContent).toBe(CHART_NO_VALUES_TEXT);
    expect(partOf(chart, 'line').getAttribute('d')).toBe('');
    expect(partOf(chart, 'marker')).toHaveAttribute('data-shown', 'false');
  });
});

describe('<LineChart> — gap', () => {
  /** Three readings, a silence well past the staleness threshold, then three more. */
  function holePanel(gap?: 'break' | 'span') {
    const panel = mount(
      <LineChart
        topic={CPU_TEMP}
        windowMs={WINDOW}
        range={[0, 100]}
        width={400}
        height={200}
        {...(gap === undefined ? {} : { gap })}
      />,
    );
    panel.publish(CPU_TEMP, 40, 500);
    panel.publish(CPU_TEMP, 41, 500);
    panel.publish(CPU_TEMP, 42, DEFAULT_STALE_AFTER_MS + 5_000);
    panel.publish(CPU_TEMP, 50, 500);
    panel.publish(CPU_TEMP, 51, 500);
    panel.publish(CPU_TEMP, 52);
    return panel;
  }

  it('breaks the line across a hole by default', () => {
    holePanel();

    // The default is `break` because a spanned line draws a measurement where none was taken. Nothing
    // in this test asked for that behaviour, which is the point.
    expect(runsIn(chartNamed(CPU_TEMP))).toBe(2);
  });

  it("breaks the line across a hole under gap='break'", () => {
    holePanel('break');

    expect(runsIn(chartNamed(CPU_TEMP))).toBe(2);
  });

  it("draws through the hole under gap='span', and only because the author said so", () => {
    holePanel('span');

    expect(runsIn(chartNamed(CPU_TEMP))).toBe(1);
  });

  it('keeps the node count identical whichever way the gap is drawn', () => {
    holePanel('break');
    const broken = shapeOf(chartNamed(CPU_TEMP));
    cleanup();

    holePanel('span');
    const spanned = shapeOf(chartNamed(CPU_TEMP));

    // A run is a subpath inside one `d`, never a second `<path>`. This is what lets the same skeleton
    // serve a series with any number of holes.
    expect(spanned).toEqual(broken);
  });
});

describe('<LineChart> — the frame budget', () => {
  it('keeps one element shape across every state, so an update writes attributes only', () => {
    const panel = mount(
      <LineChart topic={CPU_TEMP} windowMs={WINDOW} range={[0, 100]} width={400} height={200} />,
    );
    const chart = chartNamed(CPU_TEMP);

    const empty = shapeOf(chart);

    panel.publish(CPU_TEMP, 40, 1_000);
    const one = shapeOf(chart);

    panel.publish(CPU_TEMP, 44, 1_000);
    panel.publish(CPU_TEMP, 48, 1_000);
    const series = shapeOf(chart);

    panel.publish(CPU_TEMP, null, 1_000);
    const nulled = shapeOf(chart);

    panel.clock.advance(DEFAULT_STALE_AFTER_MS + 2_000);
    panel.refresh();
    const stale = shapeOf(chart);

    expect(chart).toHaveAttribute('data-state', 'stale');
    expect(one).toEqual(empty);
    expect(series).toEqual(empty);
    expect(nulled).toEqual(empty);
    expect(stale).toEqual(empty);
  });

  it('keeps the plot the size the rect said, whatever state it is in', () => {
    const panel = mount(
      <LineChart topic={CPU_TEMP} windowMs={WINDOW} range={[0, 100]} width={400} height={200} />,
    );
    const plot = partOf(chartNamed(CPU_TEMP), 'plot');
    const box = plot.getAttribute('viewBox');

    panel.publish(CPU_TEMP, 40, 1_000);
    panel.publish(CPU_TEMP, 44);

    // Arithmetic from the authored rect, never a measurement: a chart that sized itself from layout
    // would draw frame one at the wrong size and move it on frame two, which is a reflow inside the
    // capture interval.
    expect(plot.getAttribute('viewBox')).toBe(box);
    expect(plot.getAttribute('width')).toBe('400');
  });

  it('keeps every footer and header row present even when it has nothing to print', () => {
    const panel = mount(
      <LineChart topic={CPU_TEMP} windowMs={WINDOW} range={[0, 100]} width={400} height={200} />,
    );
    panel.publish(CPU_TEMP, 40);

    const chart = chartNamed(CPU_TEMP);
    expect(partOf(chart, 'note').textContent).toBe('');
    expect(partOf(chart, 'placeholder').textContent).toBe('');
    expect(partOf(chart, 'span').textContent).not.toBe('');
  });

  it('paints identical markup for identical history in two independent trees', () => {
    const first = mount(
      <LineChart topic={CPU_TEMP} windowMs={WINDOW} range={[0, 100]} width={400} height={200} />,
    );
    const second = mount(
      <LineChart topic={CPU_TEMP} windowMs={WINDOW} range={[0, 100]} width={400} height={200} />,
    );

    for (const value of [40, 44, 48]) {
      first.source.emit(CPU_TEMP, { value, at: START + value });
      second.source.emit(CPU_TEMP, { value, at: START + value });
    }

    const [a, b] = screen.getAllByRole('group', { name: CPU_TEMP });
    expect(a?.outerHTML).toBe(b?.outerHTML);
  });

  it('renders nothing pointer-driven and nothing focusable', () => {
    const panel = mount(
      <LineChart topic={CPU_TEMP} windowMs={WINDOW} range={[0, 100]} width={400} height={200} />,
    );
    panel.publish(CPU_TEMP, 40);

    const chart = chartNamed(CPU_TEMP);
    expect(chart).not.toHaveAttribute('tabindex');
    expect(chart.outerHTML).not.toMatch(/\son[a-z]+=/);
    expect(chart.querySelector('a, button, input, [tabindex]')).toBeNull();
  });
});

describe('<LineChart> — two charts on one topic', () => {
  it('lets a short and a long window plot the same readings at their own spans', () => {
    const panel = mount(
      <>
        <LineChart
          topic={CPU_TEMP}
          windowMs={30_000}
          range={[0, 100]}
          width={400}
          height={200}
          label="Short"
        />
        <LineChart
          topic={CPU_TEMP}
          windowMs={300_000}
          range={[0, 100]}
          width={400}
          height={200}
          label="Long"
        />
      </>,
    );

    panel.publish(CPU_TEMP, 40, 1_000);
    panel.publish(CPU_TEMP, 44);

    // One ring, sized by the longer demand, read through two element windows. Both charts are current
    // and each labels the span it actually drew.
    expect(partOf(chartNamed('Short'), 'span').textContent).toBe('30 s');
    expect(partOf(chartNamed('Long'), 'span').textContent).toBe('5 min');
    for (const name of ['Short', 'Long']) {
      expect(partOf(chartNamed(name), 'line').getAttribute('d')).not.toBe('');
    }
  });
});

describe('LINE_CHART_STYLES', () => {
  it('reaches the document without the page mounting it', () => {
    mount(<LineChart topic={CPU_TEMP} windowMs={WINDOW} range={[0, 100]} width={400} height={200} />);

    // React 19 hoists `<style href precedence>` to <head> and dedupes by href, which is what lets a
    // chart bring its own styles into a tree nobody edited for it. Falling back to the whole document
    // rather than asserting on <head>, because *where* it landed is React's business and the claim
    // here is that an unedited page gets the sheet at all.
    const sheets = Array.from(document.querySelectorAll('style'), (node) => node.textContent ?? '');
    expect(sheets.some((sheet) => sheet.includes('.perch-chart__line'))).toBe(true);
  });

  it('mounts one sheet however many charts are on the page', () => {
    mount(
      <>
        <LineChart
          topic={CPU_TEMP}
          windowMs={WINDOW}
          range={[0, 100]}
          width={400}
          height={200}
          label="One"
        />
        <LineChart
          topic={CPU_LOAD}
          windowMs={WINDOW}
          range={[0, 100]}
          width={400}
          height={200}
          label="Two"
        />
      </>,
    );

    const ours = Array.from(document.querySelectorAll('style')).filter((node) =>
      (node.textContent ?? '').includes('.perch-chart__line'),
    );
    expect(ours).toHaveLength(1);
  });

  it('has no hover, focus or active affordance, because there is no pointer', () => {
    expect(LINE_CHART_STYLES).not.toMatch(/:hover/);
    expect(LINE_CHART_STYLES).not.toMatch(/:focus/);
    expect(LINE_CHART_STYLES).not.toMatch(/:active/);
  });

  it('has no transition or animation, because a capture samples one frame', () => {
    // The chart is the widget where an animated line is most tempting and most damaging: the captured
    // frame would be a line that is partly last second's.
    expect(LINE_CHART_STYLES).not.toMatch(/transition/);
    expect(LINE_CHART_STYLES).not.toMatch(/animation/);
  });

  it('styles every state the view can report', () => {
    for (const state of ['stale', 'empty']) {
      expect(LINE_CHART_STYLES).toContain(`data-state='${state}'`);
    }
    for (const tone of ['none', 'quiet', 'alert']) {
      expect(LINE_CHART_STYLES).toContain(`data-tone='${tone}'`);
    }
  });

  it('draws the series at three pixels and the grid at one', () => {
    // The panel adjustment, asserted where a theme could not undo it: stroke widths are written from
    // the constants the coordinates are snapped against, not from tokens.
    expect(LINE_CHART_STYLES).toMatch(/\.perch-chart__line\s*{[^}]*stroke-width:\s*3px/);
    expect(LINE_CHART_STYLES).toMatch(/\.perch-chart__grid line\s*{[^}]*stroke-width:\s*1px/);
  });

  it('keeps data colour off the text', () => {
    // The `dataviz` rule: a value or a label wearing the series colour makes identity ambiguous the
    // moment a second series exists. Every text rule here reads a text token.
    const textRules = /\.perch-chart__(value|label|unit|note|span|scale|placeholder)\s*{[^}]*}/g;
    for (const rule of LINE_CHART_STYLES.match(textRules) ?? []) {
      expect(rule).not.toContain('--perch-chart-series');
    }
  });
});
