import type { ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  sensorTopic,
  type SensorMeta,
  type SensorReading,
  type SensorSource,
  type SensorTopic,
} from '@perch/sensor-contract';
import {
  READOUT_NO_READING_TEXT,
  READOUT_STYLES,
  READOUT_WAITING_TEXT,
  Readout,
  SensorProvider,
  useSensorStore,
  type SensorStore,
} from '@perch/ui-kit';

const CPU_TEMP = sensorTopic('cpu', 'temperature');
const GPU_FAN = sensorTopic('gpu', 'fan');
const CPU_FACTOR = sensorTopic('cpu', 'factor');
const PSU_VOLTAGE = sensorTopic('psu', 'voltage');

/** `ui-kit` may not import `sensor-sources`, so the double lives here. */
function fakeSource() {
  const handlers = new Set<(topic: SensorTopic, reading: SensorReading) => void>();
  const metas = new Map<string, SensorMeta>([
    [CPU_TEMP, { label: 'CPU Package' }],
    [CPU_FACTOR, { label: 'CPU Multiplier' }],
  ]);

  const source = {
    status: 'live' as const,
    subscribe(_pattern: string, onReading: (topic: SensorTopic, reading: SensorReading) => void) {
      handlers.add(onReading);
      return () => handlers.delete(onReading);
    },
    meta(topic: SensorTopic) {
      return metas.get(topic);
    },
    emit(topic: SensorTopic, reading: SensorReading) {
      act(() => {
        for (const handler of [...handlers]) handler(topic, reading);
      });
    },
  } satisfies SensorSource & Record<string, unknown>;

  return source;
}

/** A clock the test moves by hand, so staleness never depends on real time. */
function manualClock(startAt = 10_000) {
  let now = startAt;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

function mount(children: ReactNode, options: { now?: () => number } = {}) {
  const source = fakeSource();
  let store: SensorStore | undefined;

  /**
   * Reaches the store the way any component does — through the hook — so the test drives
   * staleness with the store's own `refresh()` instead of waiting on a timer, and
   * `SensorProvider` needs no test-only prop to make that possible.
   */
  function Capture(): ReactNode {
    store = useSensorStore();
    return null;
  }

  const view = render(
    <SensorProvider
      source={source}
      recheckIntervalMs={0}
      {...(options.now === undefined ? {} : { now: options.now })}
    >
      <Capture />
      {children}
    </SensorProvider>,
  );

  return {
    source,
    view,
    refresh: () => {
      act(() => {
        store?.refresh();
      });
    },
  };
}

/** The rendered readout, found the way a reader finds it: by its label. */
const readoutNamed = (name: string): HTMLElement => screen.getByRole('group', { name });

/**
 * One structural query, used only for the invariants that *are* structural: the element shape
 * must not change between states, and the note row must exist even when it has nothing to say.
 * Everything else in this file asserts on rendered text.
 */
function shapeOf(readout: HTMLElement): string[] {
  // `Array.from` rather than a spread: the package's `lib` deliberately omits `dom.iterable`, so a
  // `NodeList` is an `ArrayLike` here and not an iterable.
  return Array.from(readout.querySelectorAll('*'), (node) => `${node.tagName}.${node.className}`);
}

describe('<Readout> — the four states, rendered', () => {
  it('shows the waiting glyph before anything has arrived', () => {
    mount(<Readout topic={PSU_VOLTAGE} label="PSU Rail" />);

    const readout = readoutNamed('PSU Rail');
    expect(readout).toHaveAttribute('data-state', 'waiting');
    expect(readout).toHaveTextContent(READOUT_WAITING_TEXT);
    expect(readout).toHaveTextContent('waiting');
  });

  it('shows a live value with the unit its metric defines', () => {
    const { source } = mount(<Readout topic={CPU_TEMP} />);

    source.emit(CPU_TEMP, { value: 61.25, at: Date.now() });

    const readout = readoutNamed('CPU Package');
    expect(readout).toHaveAttribute('data-state', 'value');
    expect(readout).toHaveTextContent('61.3 °C');
  });

  it('shows "no reading" for a sensor that is present and reporting nothing', () => {
    const { source } = mount(<Readout topic={GPU_FAN} label="GPU Fan" />);

    source.emit(GPU_FAN, { value: null, at: Date.now() });

    const readout = readoutNamed('GPU Fan');
    expect(readout).toHaveAttribute('data-state', 'no-reading');
    expect(readout).toHaveTextContent(READOUT_NO_READING_TEXT);
    expect(readout).toHaveTextContent('no reading');
    expect(readout).not.toHaveTextContent(READOUT_WAITING_TEXT);
  });

  it('marks a value that has aged out, and prints how old it is', () => {
    const clock = manualClock();
    const { source, refresh } = mount(<Readout topic={CPU_TEMP} />, { now: clock.now });

    source.emit(CPU_TEMP, { value: 61, at: clock.now() });
    clock.advance(8_400);
    refresh();

    const readout = readoutNamed('CPU Package');
    expect(readout).toHaveAttribute('data-state', 'stale');
    expect(readout).toHaveTextContent('61.0 °C');
    expect(readout).toHaveTextContent('stale 8s');
  });

  it('renders a real zero as a number, not as an absence', () => {
    const { source } = mount(<Readout topic={CPU_TEMP} />);

    source.emit(CPU_TEMP, { value: 0, at: Date.now() });

    expect(readoutNamed('CPU Package')).toHaveTextContent('0.0 °C');
  });

  it('renders the dimensionless metric with no unit and no trailing space', () => {
    const { source } = mount(<Readout topic={CPU_FACTOR} />);

    source.emit(CPU_FACTOR, { value: 43.5, at: Date.now() });

    const text = readoutNamed('CPU Multiplier').textContent;
    expect(text).toMatch(/^43\.5/);
    // No unit means no separator either: the next character after the value is the label's, not a
    // space left behind by a unit that is the empty string.
    expect(text).not.toMatch(/43\.5\s\S/);
  });

  it('ignores a reading for another topic', () => {
    const { source } = mount(<Readout topic={CPU_TEMP} />);

    source.emit(GPU_FAN, { value: 1400, at: Date.now() });

    expect(readoutNamed('CPU Package')).toHaveAttribute('data-state', 'waiting');
  });
});

describe('<Readout> — labelling', () => {
  it('takes its label from metadata, because a topic cannot carry one', () => {
    mount(<Readout topic={CPU_TEMP} />);

    expect(readoutNamed('CPU Package')).toBeInTheDocument();
  });

  it('lets the caller override the label', () => {
    mount(<Readout topic={CPU_TEMP} label="Package" />);

    expect(readoutNamed('Package')).toBeInTheDocument();
  });

  it('falls back to the canonical topic when metadata has no label', () => {
    mount(<Readout topic="sensors/gpu/fan" />);

    expect(readoutNamed(GPU_FAN)).toBeInTheDocument();
  });

  it('honours an explicit decimal count', () => {
    const { source } = mount(<Readout topic={CPU_TEMP} decimals={3} />);

    source.emit(CPU_TEMP, { value: 61.23456, at: Date.now() });

    expect(readoutNamed('CPU Package')).toHaveTextContent('61.235 °C');
  });

  it('throws on a topic outside the grammar rather than showing no data forever', () => {
    expect(() => mount(<Readout topic="sensors/cpu/tempreature" />)).toThrow(RangeError);
  });
});

describe('<Readout> — the frame budget', () => {
  it('keeps one element shape across every state, so React only patches text', () => {
    const clock = manualClock();
    const { source, refresh } = mount(<Readout topic={CPU_TEMP} />, { now: clock.now });
    const readout = readoutNamed('CPU Package');

    const waiting = shapeOf(readout);

    source.emit(CPU_TEMP, { value: 61, at: clock.now() });
    const value = shapeOf(readout);

    source.emit(CPU_TEMP, { value: null, at: clock.now() + 1 });
    const noReading = shapeOf(readout);

    clock.advance(9_000);
    refresh();
    const stale = shapeOf(readout);

    expect(readout).toHaveAttribute('data-state', 'stale');
    expect(value).toEqual(waiting);
    expect(noReading).toEqual(waiting);
    expect(stale).toEqual(waiting);
  });

  it('keeps the note row present even when there is nothing to note', () => {
    const { source } = mount(<Readout topic={CPU_TEMP} />);
    const readout = readoutNamed('CPU Package');

    source.emit(CPU_TEMP, { value: 61, at: Date.now() });

    const note = readout.querySelector('.perch-readout__note');
    expect(note).not.toBeNull();
    expect(note?.textContent).toBe('');
  });

  it('paints the same markup for the same reading, in two independent trees', () => {
    const first = mount(<Readout topic={CPU_TEMP} />);
    const second = mount(<Readout topic={CPU_TEMP} />);
    const at = 10_000;

    first.source.emit(CPU_TEMP, { value: 61.25, at });
    second.source.emit(CPU_TEMP, { value: 61.25, at });

    const [a, b] = screen.getAllByRole('group', { name: 'CPU Package' });
    expect(a?.outerHTML).toBe(b?.outerHTML);
  });

  it('renders nothing pointer-driven and nothing focusable', () => {
    const { source } = mount(<Readout topic={CPU_TEMP} />);
    source.emit(CPU_TEMP, { value: 61.25, at: Date.now() });

    const readout = readoutNamed('CPU Package');
    expect(readout).not.toHaveAttribute('tabindex');
    expect(readout.outerHTML).not.toMatch(/\son[a-z]+=/);
    expect(readout.querySelector('a, button, input, [tabindex]')).toBeNull();
  });
});

describe('READOUT_STYLES', () => {
  it('has no hover, focus or active affordance, because there is no pointer', () => {
    expect(READOUT_STYLES).not.toMatch(/:hover/);
    expect(READOUT_STYLES).not.toMatch(/:focus/);
    expect(READOUT_STYLES).not.toMatch(/:active/);
  });

  it('has no transition or animation, because a capture frame has no time for one', () => {
    expect(READOUT_STYLES).not.toMatch(/transition/);
    expect(READOUT_STYLES).not.toMatch(/animation/);
  });

  it('styles every state the view can report', () => {
    for (const state of ['waiting', 'no-reading', 'value', 'stale']) {
      expect(READOUT_STYLES).toContain(`data-state='${state}'`);
    }
  });

  it('gives the note row a fixed height, so a state change cannot reflow the widget', () => {
    expect(READOUT_STYLES).toMatch(/\.perch-readout__note\s*{[^}]*\bheight:/);
  });

  it('stops the label and note from driving the widget width', () => {
    // The defect this fixes: the no-reading fallback label is the raw topic, and in the old
    // two-`max-content`-column grid it spanned both tracks and set the widget's width.
    for (const part of ['label', 'note']) {
      const rule = new RegExp(`\\.perch-readout__${part}\\s*{[^}]*}`).exec(READOUT_STYLES)?.[0];
      expect(rule).toBeDefined();
      expect(rule).toMatch(/min-width:\s*0/);
      expect(rule).toMatch(/white-space:\s*nowrap/);
      expect(rule).toMatch(/text-overflow:\s*ellipsis/);
      expect(rule).toMatch(/overflow:\s*hidden/);
    }
    expect(READOUT_STYLES).not.toMatch(/grid-template-columns/);
  });
});
