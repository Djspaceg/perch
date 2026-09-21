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
/** The tile that carried the truncation defect: LHM reports this in raw bytes per second. */
const GPU_THROUGHPUT = sensorTopic('gpu', 'throughput');
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
      {/*
       * The widget's own stylesheet, mounted the way the page mounts it, because some of what this
       * file has to prove is not in the markup. jsdom has no layout engine, but it does resolve the
       * cascade, so a declared field width or an ellipsis can be read off the rendered element
       * rather than regexed out of the stylesheet string.
       */}
      <style>{READOUT_STYLES}</style>
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

/** One part of the rendered widget, or a failure — a missing element must not skip an assertion. */
function partOf(readout: HTMLElement, part: string): HTMLElement {
  const element = readout.querySelector(`.perch-readout__${part}`);
  if (!(element instanceof HTMLElement)) throw new Error(`no ${part} in the rendered readout`);
  return element;
}

/**
 * How many characters the rendered value's field holds.
 *
 * "Is this number clipped?" is a question about pixels, and jsdom has no layout engine — every
 * geometry it reports is 0. The field is written on the element in `ch` against `tabular-nums`,
 * where one `ch` is one digit, so the same question can be asked in characters: a field of N
 * characters renders a value of N characters or fewer in full, whatever the font or the type size.
 *
 * Read off the element's own `style`, not through `getComputedStyle`: jsdom normalises a computed
 * `8ch` to `64px` on an assumed 8px advance, which is both wrong and a moving target between
 * versions. Anything that is not a character field — `auto`, a percentage, nothing at all — returns
 * 0, which is the pre-fix state: the value got whatever width was left over in the row, and
 * left-over is what the ellipsis ate.
 */
function valueFieldChars(readout: HTMLElement): number {
  const chars = /^([0-9.]+)ch$/.exec(partOf(readout, 'value').style.width)?.[1];
  return chars === undefined ? 0 : Number(chars);
}

/** What the value element renders, as the reader sees it. */
function valueTextOf(readout: HTMLElement): string {
  return partOf(readout, 'value').textContent;
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

describe('<Readout> — the value is printed in full, never truncated', () => {
  /**
   * The reported defect. `6699008 B/s` rendered as `669…` in a 216px tile at both captured
   * viewports, and `669` is a plausible reading four orders of magnitude out — the worst kind of
   * wrong, because nothing on the panel says it happened.
   */
  it('prints a seven-digit throughput reading in full', () => {
    const { source } = mount(<Readout topic={GPU_THROUGHPUT} label="GPU PCIe Rx" />);

    source.emit(GPU_THROUGHPUT, { value: 6699008, at: Date.now() });

    const readout = readoutNamed('GPU PCIe Rx');
    expect(valueTextOf(readout)).toBe('6699008');
    expect(valueFieldChars(readout)).toBeGreaterThanOrEqual('6699008'.length);
  });

  /**
   * The widest reading the field is sized for, and not a hypothetical one: the same machine's
   * GPU PCIe Tx sensor reports it, in `fixtures/lhm-data.sample.json`.
   */
  it('prints an eight-digit throughput reading in full', () => {
    const { source } = mount(<Readout topic={GPU_THROUGHPUT} label="GPU PCIe Tx" />);

    source.emit(GPU_THROUGHPUT, { value: 37699580, at: Date.now() });

    const readout = readoutNamed('GPU PCIe Tx');
    expect(valueTextOf(readout)).toBe('37699580');
    expect(valueFieldChars(readout)).toBeGreaterThanOrEqual('37699580'.length);
  });

  it('prints a real zero in full', () => {
    const { source } = mount(<Readout topic={GPU_THROUGHPUT} label="GPU PCIe Rx" />);

    source.emit(GPU_THROUGHPUT, { value: 0, at: Date.now() });

    const readout = readoutNamed('GPU PCIe Rx');
    expect(valueTextOf(readout)).toBe('0');
    expect(valueFieldChars(readout)).toBeGreaterThanOrEqual('0'.length);
  });

  it('prints a negative reading in full, minus sign included', () => {
    const { source } = mount(<Readout topic={CPU_TEMP} />);

    source.emit(CPU_TEMP, { value: -40, at: Date.now() });

    const readout = readoutNamed('CPU Package');
    // The sign is the whole point: `40.0` where `-40.0` belongs is an 80-degree error.
    expect(valueTextOf(readout)).toBe('-40.0');
    expect(valueFieldChars(readout)).toBeGreaterThanOrEqual('-40.0'.length);
  });

  it('prints a long decimal in full', () => {
    const { source } = mount(<Readout topic={CPU_FACTOR} decimals={3} />);

    source.emit(CPU_FACTOR, { value: 48.5, at: Date.now() });

    const readout = readoutNamed('CPU Multiplier');
    expect(valueTextOf(readout)).toBe('48.500');
    expect(valueFieldChars(readout)).toBeGreaterThanOrEqual('48.500'.length);
  });

  it('prints the no-reading placeholder in full', () => {
    const { source } = mount(<Readout topic={GPU_FAN} label="GPU Fan" />);

    source.emit(GPU_FAN, { value: null, at: Date.now() });

    const readout = readoutNamed('GPU Fan');
    expect(valueTextOf(readout)).toBe(READOUT_NO_READING_TEXT);
    expect(valueFieldChars(readout)).toBeGreaterThanOrEqual(READOUT_NO_READING_TEXT.length);
  });

  it('prints the waiting placeholder in full', () => {
    mount(<Readout topic={GPU_THROUGHPUT} label="GPU PCIe Rx" />);

    const readout = readoutNamed('GPU PCIe Rx');
    expect(valueTextOf(readout)).toBe(READOUT_WAITING_TEXT);
    expect(valueFieldChars(readout)).toBeGreaterThanOrEqual(READOUT_WAITING_TEXT.length);
  });

  /**
   * The frame-budget half of the fix, asked the only way jsdom can answer it: the field is declared
   * in characters, so a reading that grows by seven digits cannot change it. Nothing beside the
   * value — the unit, the label, the tile, the row — moves when a value crosses a digit boundary.
   */
  it('keeps one field width across every length of reading', () => {
    const { source } = mount(<Readout topic={GPU_THROUGHPUT} label="GPU PCIe Rx" />);
    const readout = readoutNamed('GPU PCIe Rx');

    const waiting = valueFieldChars(readout);

    source.emit(GPU_THROUGHPUT, { value: 0, at: Date.now() });
    const zero = valueFieldChars(readout);

    source.emit(GPU_THROUGHPUT, { value: 6699008, at: Date.now() + 1 });
    const seven = valueFieldChars(readout);

    source.emit(GPU_THROUGHPUT, { value: 37699580, at: Date.now() + 2 });
    const eight = valueFieldChars(readout);

    expect(zero).toBe(waiting);
    expect(seven).toBe(waiting);
    expect(eight).toBe(waiting);
    expect(waiting).toBeGreaterThanOrEqual(8);
  });

  /**
   * The original defect, re-checked on the rendered element rather than on the stylesheet string.
   * An unlabelled topic's fallback label is the raw canonical topic — the longest string the widget
   * ever prints — and it must still be unable to set the widget's width. Exempting the value must
   * not have exempted the label with it.
   */
  it('still keeps an unlabelled topic from setting the widget width', () => {
    mount(<Readout topic={PSU_VOLTAGE} />);

    const readout = readoutNamed(PSU_VOLTAGE);
    const label = partOf(readout, 'label');
    expect(label.textContent).toBe(PSU_VOLTAGE);

    const labelStyle = getComputedStyle(label);
    expect(labelStyle.whiteSpace).toBe('nowrap');
    expect(labelStyle.overflow).toBe('hidden');
    expect(labelStyle.textOverflow).toBe('ellipsis');
    // The label cannot contribute width, and now neither can anything else inside: an inline-size
    // query container's width is independent of its contents by definition.
    expect(getComputedStyle(readout).getPropertyValue('container-type')).toBe('inline-size');
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
