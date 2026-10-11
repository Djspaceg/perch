/**
 * A text element's template, painted: sensors as a readout's value row would say them, the fallback
 * while there is nothing to believe, and the clock in the layout's locale and zone, on the boundary.
 */

import type { ReactNode } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  sensorTopic,
  type SensorMeta,
  type SensorReading,
  type SensorSource,
  type SensorTopic,
} from '@perch/sensor-contract';
import {
  READOUT_STYLES,
  SensorProvider,
  TEXT_BLOCK_STYLES,
  TextBlock,
  formatClockToken,
  useSensorStore,
  type SensorStore,
} from '@perch/ui-kit';

const FAN = sensorTopic('cooler', 'fan');
const CPU_TEMP = sensorTopic('cpu', 'temperature');

function fakeSource() {
  const handlers = new Set<(topic: SensorTopic, reading: SensorReading) => void>();
  const metas = new Map<string, SensorMeta>([[CPU_TEMP, { label: 'CPU Package' }]]);
  return {
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
}

function mount(node: ReactNode, now: () => number = Date.now) {
  const source = fakeSource();
  let store: SensorStore | undefined;
  function Capture(): ReactNode {
    store = useSensorStore();
    return null;
  }
  const view = render(
    <SensorProvider source={source} recheckIntervalMs={0} now={now}>
      <Capture />
      {node}
    </SensorProvider>,
  );
  const body = (): string => view.container.querySelector('.perch-text__body')?.textContent ?? '';
  return {
    source,
    body,
    view,
    refresh: () => {
      act(() => {
        store?.refresh();
      });
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('<TextBlock> as a template', () => {
  it('paints a sensor as its value and unit, and the fallback until it has one', () => {
    const { source, body } = mount(<TextBlock text={`fan {${FAN}} · {${FAN} || Dunno!}`} />);

    expect(body()).toBe('fan -- · Dunno!');
    source.emit(FAN, { value: 1487.6, at: Date.now() });
    expect(body()).toBe('fan 1488 RPM · 1488 RPM');
  });

  it('applies fixed, value, unit and label', () => {
    const { source, body } = mount(
      <TextBlock
        text={`{${CPU_TEMP} | label}: {${CPU_TEMP} | fixed:2 | value}{${CPU_TEMP} | unit}`}
      />,
    );

    expect(body()).toBe('CPU Package: --°C');
    source.emit(CPU_TEMP, { value: 61.256, at: Date.now() });
    expect(body()).toBe('CPU Package: 61.26°C');
  });

  it('shows the fallback for a stale reading, an empty one too, and n/a for a reading of nothing', () => {
    let now = 10_000;
    const { source, body, refresh } = mount(
      <TextBlock text={`[{${FAN} ||}] [{${CPU_TEMP}}]`} />,
      () => now,
    );

    source.emit(FAN, { value: 900, at: now });
    source.emit(CPU_TEMP, { value: null, at: now });
    expect(body()).toBe('[900 RPM] [n/a]');
    now += 9_000;
    refresh();
    expect(body()).toBe('[] [--]');
  });

  it('keeps its skeleton as readings arrive: text changes, nodes do not', () => {
    const { source, view } = mount(<TextBlock text={`a {${FAN}} b`} />);
    const before = view.container.querySelectorAll('span');

    source.emit(FAN, { value: 1, at: Date.now() });

    const after = view.container.querySelectorAll('span');
    expect([...after]).toEqual([...before]);
  });

  it('paints the clock in the layout locale and zone, and repaints on the minute', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-10-10T15:42:58Z'));
    const { body } = mount(
      <TextBlock text="{weekday}, {date:long} {time}" locale="de-DE" timeZone="Europe/Berlin" />,
    );

    expect(body()).toBe('Samstag, 10. Oktober 2026 17:42');
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    expect(body()).toBe('Samstag, 10. Oktober 2026 17:43');
  });

  it('paints the request example: a month and a fan', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-10-10T15:42:00Z'));
    const { source, body } = mount(
      <TextBlock text={`{month:short} {${FAN}}`} locale="en-US" timeZone="UTC" />,
    );
    source.emit(FAN, { value: 810, at: Date.now() });

    expect(body()).toBe('Oct 810 RPM');
  });

  it('sets no timer for a template with no clock, nor for a plain caption', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mount(<TextBlock text={`{${FAN}} and {{braces}}`} />);
    mount(<TextBlock text="plain" />);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('paints doubled braces as single ones', () => {
    const { body } = mount(<TextBlock text="{{not a token}}" />);

    expect(body()).toBe('{not a token}');
  });
});

describe('formatClockToken', () => {
  const at = new Date('2026-10-10T15:42:07Z');

  it.each([
    ['time', 'short', 'en-US', '3:42 PM'],
    ['time', 'seconds', 'en-US', '3:42:07 PM'],
    ['time', 'short', 'de-DE', '15:42'],
    ['date', 'short', 'en-US', '10/10/2026'],
    ['date', 'medium', 'en-US', 'Oct 10, 2026'],
    ['date', 'long', 'en-US', 'October 10, 2026'],
    ['date', 'full', 'en-US', 'Saturday, October 10, 2026'],
    ['date', 'short', 'de-DE', '10.10.2026'],
    ['weekday', 'long', 'de-DE', 'Samstag'],
    ['weekday', 'short', 'en-US', 'Sat'],
    ['month', 'short', 'en-US', 'Oct'],
    ['month', 'long', 'de-DE', 'Oktober'],
    ['day', '2-digit', 'en-US', '10'],
    ['year', '2-digit', 'en-US', '26'],
    ['hour', 'numeric', 'en-US', '3'],
    ['hour', 'numeric', 'de-DE', '15'],
    ['minute', '2-digit', 'en-US', '42'],
    ['second', '2-digit', 'en-US', '07'],
    ['dayperiod', 'short', 'en-US', 'PM'],
    ['dayperiod', 'short', 'de-DE', ''],
  ] as const)('%s:%s in %s is %j', (token, variant, locale, expected) => {
    expect(formatClockToken(token, variant, at, locale, 'UTC')).toBe(expected);
  });

  it('keeps a minute its leading zero', () => {
    expect(
      formatClockToken('minute', '2-digit', new Date('2026-10-10T15:05:00Z'), 'en-US', 'UTC'),
    ).toBe('05');
  });
});

/** The declarations of the first rule for `selector` in `sheet`. */
function rule(sheet: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)${escaped}\\s*{([^}]*)}`).exec(sheet)?.[1] ?? '';
}

describe('<TextBlock> annotations: the readout, in a template', () => {
  const text = (view: { container: HTMLElement }, selector: string): string =>
    view.container.querySelector(selector)?.textContent ?? '';

  it('fits a value to the box, as the readout sizes its number, with its unit after it', () => {
    const { source, view } = mount(<TextBlock text={`{${CPU_TEMP} | fit}`} />);
    const fit = (): HTMLElement => {
      const found = view.container.querySelector<HTMLElement>('.perch-text__fit');
      if (found === null) throw new Error('no fitted value');
      return found;
    };

    expect(view.container.querySelector('.perch-text')).toHaveClass('perch-text--fit');
    expect(text(view, '.perch-text__fit-value')).toBe('--');
    expect(text(view, '.perch-text__fit-unit')).toBe('');
    source.emit(CPU_TEMP, { value: 61.25, at: Date.now() });
    expect(text(view, '.perch-text__fit-value')).toBe('61.3');
    expect(text(view, '.perch-text__fit-unit')).toBe(' °C');
    expect(fit().style.getPropertyValue('--perch-readout-chars')).toBe('4');
    expect(fit().style.getPropertyValue('--perch-readout-unit-chars')).toBe('2');
    expect(fit()).toHaveAttribute('data-state', 'value');

    // The very expression the readout's number is sized by, so the two cannot drift apart.
    const sizeOf = (sheet: string, selector: string): string =>
      /font-size:\s*([\s\S]*?);\n/.exec(rule(sheet, selector))?.[1] ?? 'none';
    expect(sizeOf(TEXT_BLOCK_STYLES, '.perch-text__fit-value')).toBe(
      sizeOf(READOUT_STYLES, '.perch-readout__value'),
    );
    expect(rule(TEXT_BLOCK_STYLES, '.perch-text--fit')).toContain('container-type: inline-size');
  });

  it('drops the unit with | value, and keeps fixed', () => {
    const { source, view } = mount(<TextBlock text={`{${CPU_TEMP} | fit | value | fixed:2}`} />);

    source.emit(CPU_TEMP, { value: 61.25, at: Date.now() });
    expect(text(view, '.perch-text__fit')).toBe('61.25');
  });

  it('paints the unit small and dim, inside fit and in a {#unit} span, by the readout tokens', () => {
    const { view } = mount(<TextBlock text={`{#unit}RPM{/unit}`} />);

    expect(view.container.querySelector('.perch-text__style--unit')?.textContent).toBe('RPM');
    for (const selector of ['.perch-text__style--unit', '.perch-text__fit-unit']) {
      const declarations = rule(TEXT_BLOCK_STYLES, selector);
      expect(declarations).toContain('font-size: var(--perch-unit-size');
      expect(declarations).toContain('color: var(--perch-dim');
    }
  });

  it('paints a label row in the readout label style, above the value', () => {
    const { source, body, view } = mount(
      <TextBlock text={`{#label}{${CPU_TEMP} | label}{/label}\n{${CPU_TEMP} | fit}`} />,
    );
    source.emit(CPU_TEMP, { value: 40, at: Date.now() });

    expect(body()).toBe('CPU Package\n40.0 °C');
    expect(text(view, '.perch-text__style--label')).toBe('CPU Package');
    const declarations = rule(TEXT_BLOCK_STYLES, '.perch-text__style--label');
    expect(declarations).toContain('font-size: var(--perch-label-size');
    expect(declarations).toContain('color: var(--perch-dim');
  });

  it('says waiting, no reading and stale in the note, in the readout tones, and nothing live', () => {
    let now = 10_000;
    const { source, view, refresh } = mount(
      <TextBlock text={`{${FAN} | note}|{${CPU_TEMP} | note}`} />,
      () => now,
    );
    const notes = (): string[] =>
      [...view.container.querySelectorAll('.perch-text__note')].map(
        (note) => `${note.getAttribute('data-tone') ?? ''}:${note.textContent}`,
      );

    expect(notes()).toEqual(['quiet:waiting', 'quiet:waiting']);
    source.emit(FAN, { value: 900, at: now });
    source.emit(CPU_TEMP, { value: null, at: now });
    expect(notes()).toEqual(['none:', 'warn:no reading']);
    now += 9_000;
    refresh();
    expect(notes()).toEqual(['alert:stale 9s', 'alert:stale 9s']);

    expect(rule(TEXT_BLOCK_STYLES, ".perch-text__note[data-tone='warn']")).toContain(
      'color: var(--perch-warn',
    );
    expect(rule(TEXT_BLOCK_STYLES, ".perch-text__note[data-tone='alert']")).toContain(
      'color: var(--perch-alert',
    );
    expect(rule(TEXT_BLOCK_STYLES, '.perch-text__note')).toMatch(/\bheight: 1\.125rem/);
  });

  it('holds the last value while stale, with the fallback only before the first', () => {
    let now = 10_000;
    const { source, body, refresh, view } = mount(
      <TextBlock text={`[{${FAN} | hold || none yet}] [{${FAN} | fit | hold}] [{${FAN}}]`} />,
      () => now,
    );

    expect(body()).toBe('[none yet] [--] [--]');
    source.emit(FAN, { value: 900, at: now });
    now += 9_000;
    refresh();
    expect(body()).toBe('[900 RPM] [900 RPM] [--]');
    expect(view.container.querySelector('.perch-text__held')).toHaveAttribute(
      'data-state',
      'stale',
    );
    expect(rule(TEXT_BLOCK_STYLES, ".perch-text__held[data-state='stale']")).toContain(
      'color: var(--perch-stale',
    );
  });

  it('paints a template with no annotation exactly as before: no fit box, no styled run', () => {
    const { view } = mount(<TextBlock text={`fan {${FAN} | fixed:0} at {time}`} />);

    expect(view.container.querySelector('.perch-text')?.className).toBe('perch-text');
    expect(
      view.container.querySelector('[class*="perch-text__"]:not(.perch-text__body)'),
    ).toBeNull();
  });

  it('nests spans as written, so the inner one wins', () => {
    const { view } = mount(<TextBlock text={'{#value}12{#unit} V{/unit}{/value}'} />);
    const inner = view.container.querySelector(
      '.perch-text__style--value .perch-text__style--unit',
    );

    expect(inner?.textContent).toBe(' V');
  });

  it('keeps its skeleton as a fitted, held and noted reading arrives and goes stale', () => {
    let now = 10_000;
    const { source, view, refresh } = mount(
      <TextBlock text={`{${FAN} | fit | hold}\n{${FAN} | note}`} />,
      () => now,
    );
    const before = [...view.container.querySelectorAll('span')];

    source.emit(FAN, { value: 1, at: now });
    now += 9_000;
    refresh();

    expect([...view.container.querySelectorAll('span')]).toEqual(before);
  });
});
