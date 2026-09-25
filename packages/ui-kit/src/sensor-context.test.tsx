import { StrictMode, type ReactNode } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  sensorTopic,
  type SensorMeta,
  type SensorReading,
  type SensorSource,
  type SensorSourceStatus,
  type SensorTopic,
} from '@perch/sensor-contract';
import {
  SensorProvider,
  useSensor,
  useSensorMeta,
  useSensorStatus,
  useSensorStore,
  useSensorTopics,
} from '@perch/ui-kit';

const CPU_TEMP = sensorTopic('cpu', 'temperature');
const GPU_FAN = sensorTopic('gpu', 'fan');

/** `ui-kit` may not import `sensor-sources`, so the double lives here. */
function fakeSource(status: SensorSourceStatus = 'live') {
  const handlers = new Set<(topic: SensorTopic, reading: SensorReading) => void>();
  const metas = new Map<string, SensorMeta>([[CPU_TEMP, { label: 'CPU Package' }]]);
  // Counted in closure variables rather than on the object: a method that reached back through
  // `source.subscribes` would make the literal reference its own inferred type, and TypeScript
  // resolves that circularity by giving up and calling the whole double `any`.
  let subscribes = 0;
  let unsubscribes = 0;

  return {
    status,
    subscribe(_pattern: string, onReading: (topic: SensorTopic, reading: SensorReading) => void) {
      subscribes += 1;
      handlers.add(onReading);
      return () => {
        handlers.delete(onReading);
        unsubscribes += 1;
      };
    },
    meta(topic: SensorTopic) {
      return metas.get(topic);
    },
    get subscribes(): number {
      return subscribes;
    },
    get unsubscribes(): number {
      return unsubscribes;
    },
    /** Subscriptions that are open right now, which is the number the rule is about. */
    get live(): number {
      return subscribes - unsubscribes;
    },
    emit(topic: SensorTopic, reading: SensorReading) {
      act(() => {
        for (const handler of [...handlers]) handler(topic, reading);
      });
    },
  } satisfies SensorSource & Record<string, unknown>;
}

/** A tiny probe so a hook's value is asserted as rendered text. */
function Probe({ topic }: { topic: string }): ReactNode {
  const snapshot = useSensor(topic);

  return <span>{snapshot.state === 'waiting' ? 'waiting' : String(snapshot.reading.value)}</span>;
}

describe('useSensor outside a provider', () => {
  it('throws, naming the fix, rather than rendering no data forever', () => {
    // React logs the thrown error; the assertion is that it throws at all.
    expect(() => renderHook(() => useSensor(CPU_TEMP))).toThrow(/SensorProvider/);
  });

  it('throws from useSensorStore too, which is the shared seam', () => {
    expect(() => renderHook(() => useSensorStore())).toThrow(/SensorProvider/);
  });
});

describe('SensorProvider', () => {
  it('holds one source subscription however many widgets read from it', () => {
    const source = fakeSource();

    render(
      <SensorProvider source={source} recheckIntervalMs={0}>
        <Probe topic={CPU_TEMP} />
        <Probe topic={CPU_TEMP} />
        <Probe topic={GPU_FAN} />
        <Probe topic={GPU_FAN} />
      </SensorProvider>,
    );

    expect(source.subscribes).toBe(1);
    expect(source.live).toBe(1);
  });

  it('still holds exactly one under StrictMode, whose effects run twice', () => {
    const source = fakeSource();

    render(
      <StrictMode>
        <SensorProvider source={source} recheckIntervalMs={0}>
          <Probe topic={CPU_TEMP} />
          <Probe topic={GPU_FAN} />
        </SensorProvider>
      </StrictMode>,
    );

    expect(source.live).toBe(1);
  });

  it('re-renders a reading into every widget bound to that topic', () => {
    const source = fakeSource();
    render(
      <SensorProvider source={source} recheckIntervalMs={0}>
        <Probe topic={CPU_TEMP} />
        <Probe topic={CPU_TEMP} />
        <Probe topic={GPU_FAN} />
      </SensorProvider>,
    );

    source.emit(CPU_TEMP, { value: 61.25, at: Date.now() });

    expect(screen.getAllByText('61.25')).toHaveLength(2);
    expect(screen.getByText('waiting')).toBeInTheDocument();
  });

  it('accepts the authored shorthand in a widget, not just the canonical topic', () => {
    const source = fakeSource();
    render(
      <SensorProvider source={source} recheckIntervalMs={0}>
        <Probe topic="sensors/cpu/temperature" />
      </SensorProvider>,
    );

    source.emit(CPU_TEMP, { value: 61.25, at: Date.now() });

    expect(screen.getByText('61.25')).toBeInTheDocument();
  });

  it('releases the subscription when it unmounts', () => {
    const source = fakeSource();
    const view = render(
      <SensorProvider source={source} recheckIntervalMs={0}>
        <Probe topic={CPU_TEMP} />
      </SensorProvider>,
    );

    view.unmount();

    expect(source.live).toBe(0);
  });

  it('swaps stores when the injected source changes, closing the old one', () => {
    const first = fakeSource();
    const second = fakeSource();
    const view = render(
      <SensorProvider source={first} recheckIntervalMs={0}>
        <Probe topic={CPU_TEMP} />
      </SensorProvider>,
    );

    view.rerender(
      <SensorProvider source={second} recheckIntervalMs={0}>
        <Probe topic={CPU_TEMP} />
      </SensorProvider>,
    );

    expect(first.live).toBe(0);
    expect(second.live).toBe(1);

    second.emit(CPU_TEMP, { value: 42, at: Date.now() });
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('passes an overridden staleness threshold down to its store', () => {
    const source = fakeSource();
    const { result } = renderHook(() => useSensorStore(), {
      wrapper: ({ children }: { children?: ReactNode }) => (
        <SensorProvider source={source} staleAfterMs={25} recheckIntervalMs={0}>
          {children}
        </SensorProvider>
      ),
    });

    source.emit(CPU_TEMP, { value: 61, at: Date.now() - 30 });
    act(() => {
      result.current.refresh();
    });

    expect(result.current.snapshot(CPU_TEMP).state).toBe('stale');
  });
});

describe('useSensorMeta', () => {
  it('reads the label a topic cannot carry', () => {
    const source = fakeSource();
    const { result } = renderHook(() => useSensorMeta(CPU_TEMP), {
      wrapper: ({ children }: { children?: ReactNode }) => (
        <SensorProvider source={source} recheckIntervalMs={0}>
          {children}
        </SensorProvider>
      ),
    });

    expect(result.current).toEqual({ label: 'CPU Package' });
  });

  it('is undefined for a topic the source published no metadata for', () => {
    const source = fakeSource();
    const { result } = renderHook(() => useSensorMeta(GPU_FAN), {
      wrapper: ({ children }: { children?: ReactNode }) => (
        <SensorProvider source={source} recheckIntervalMs={0}>
          {children}
        </SensorProvider>
      ),
    });

    expect(result.current).toBeUndefined();
  });
});

describe('useSensorStatus', () => {
  it('reports the source status without any component holding the source', () => {
    const source = fakeSource('connecting');
    const { result } = renderHook(() => useSensorStatus(), {
      wrapper: ({ children }: { children?: ReactNode }) => (
        <SensorProvider source={source} recheckIntervalMs={0}>
          {children}
        </SensorProvider>
      ),
    });

    expect(result.current).toBe('connecting');
  });
});

describe('useSensorTopics', () => {
  it('re-renders with each topic the source publishes for the first time', () => {
    const source = fakeSource();
    const { result } = renderHook(() => useSensorTopics(), {
      wrapper: ({ children }: { children?: ReactNode }) => (
        <SensorProvider source={source} recheckIntervalMs={0}>
          {children}
        </SensorProvider>
      ),
    });

    expect(result.current).toEqual([]);
    source.emit(CPU_TEMP, { value: 61, at: Date.now() });
    source.emit(GPU_FAN, { value: 1200, at: Date.now() });

    expect(result.current).toEqual([CPU_TEMP, GPU_FAN]);
  });
});
