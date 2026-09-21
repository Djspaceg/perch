import { afterEach, describe, expect, it } from 'vitest';
import {
  SENSOR_TOPIC_WILDCARD,
  sensorTopic,
  type SensorMeta,
  type SensorReading,
  type SensorSource,
  type SensorSourceStatus,
  type SensorTopic,
} from '@perch/sensor-contract';
import { DEFAULT_STALE_AFTER_MS, createSensorStore, type SensorStore } from '@perch/ui-kit';

const CPU_TEMP = sensorTopic('cpu', 'temperature');
const GPU_FAN = sensorTopic('gpu', 'fan');

/** A listener that exists to be counted, not to do anything. */
const noop = (): void => undefined;

/**
 * A source with no transport at all. `ui-kit` may not import `sensor-sources`, so the store is
 * exercised against a hand-rolled double — which is the point of injecting it.
 */
function fakeSource(status: SensorSourceStatus = 'live') {
  const handlers = new Set<(topic: SensorTopic, reading: SensorReading) => void>();
  const metas = new Map<string, SensorMeta>([[CPU_TEMP, { label: 'CPU Package' }]]);
  let subscriptions = 0;

  const source = {
    status,
    subscribe(pattern: string, onReading: (topic: SensorTopic, reading: SensorReading) => void) {
      subscriptions += 1;
      source.patterns.push(pattern);
      handlers.add(onReading);
      return () => {
        handlers.delete(onReading);
        source.unsubscribes += 1;
      };
    },
    meta(topic: SensorTopic) {
      return metas.get(topic);
    },
    patterns: [] as string[],
    unsubscribes: 0,
    get subscriptions() {
      return subscriptions;
    },
    emit(topic: SensorTopic, reading: SensorReading) {
      for (const handler of [...handlers]) handler(topic, reading);
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

const openStores: SensorStore[] = [];

/** Build a store and open it, the way the provider's effect does. */
function store(options: Parameters<typeof createSensorStore>[0]): SensorStore {
  const created = createSensorStore(options);
  openStores.push(created);
  created.open();
  return created;
}

afterEach(() => {
  while (openStores.length > 0) openStores.pop()?.close();
});

describe('DEFAULT_STALE_AFTER_MS', () => {
  it('is 5 s: four missed ticks of a 1 Hz publisher plus jitter', () => {
    expect(DEFAULT_STALE_AFTER_MS).toBe(5_000);
  });
});

describe('createSensorStore: one subscription, owned here', () => {
  it('subscribes once at the root, however many topics are read or watched', () => {
    const source = fakeSource();
    const root = store({ source, recheckIntervalMs: 0 });

    root.snapshot(CPU_TEMP);
    root.snapshot(GPU_FAN);
    root.subscribe(CPU_TEMP, noop);
    root.subscribe(GPU_FAN, noop);
    root.subscribe(GPU_FAN, noop);

    expect(source.subscriptions).toBe(1);
    expect(source.patterns).toEqual([SENSOR_TOPIC_WILDCARD]);
  });

  it('does not touch the source until it is opened', () => {
    const source = fakeSource();
    const created = createSensorStore({ source, recheckIntervalMs: 0 });
    openStores.push(created);

    expect(source.subscriptions).toBe(0);
    expect(created.snapshot(CPU_TEMP)).toEqual({ state: 'waiting' });

    created.open();
    expect(source.subscriptions).toBe(1);
  });

  it('is idempotent on open, so a double-invoked effect cannot double-subscribe', () => {
    const source = fakeSource();
    const root = store({ source, recheckIntervalMs: 0 });

    root.open();
    root.open();

    expect(source.subscriptions).toBe(1);
  });

  it('can be reopened after closing, which is what a remount does', () => {
    const source = fakeSource();
    const clock = manualClock();
    const root = store({ source, now: clock.now, recheckIntervalMs: 0 });

    root.close();
    expect(source.unsubscribes).toBe(1);

    root.open();
    source.emit(CPU_TEMP, { value: 61, at: clock.now() });

    expect(source.subscriptions).toBe(2);
    expect(root.snapshot(CPU_TEMP)).toMatchObject({ state: 'live' });
  });

  it('subscribes to a caller-supplied pattern when given one', () => {
    const source = fakeSource();
    store({ source, pattern: 'sensors/cpu/#', recheckIntervalMs: 0 });

    expect(source.patterns).toEqual(['sensors/cpu/#']);
  });
});

describe('SensorStore.snapshot', () => {
  it('reports waiting before any reading arrives', () => {
    const root = store({ source: fakeSource(), recheckIntervalMs: 0 });

    expect(root.snapshot(CPU_TEMP)).toEqual({ state: 'waiting' });
  });

  it('reports live with an age once a reading arrives', () => {
    const source = fakeSource();
    const clock = manualClock();
    const root = store({ source, now: clock.now, recheckIntervalMs: 0 });

    source.emit(CPU_TEMP, { value: 61.25, at: clock.now() });

    expect(root.snapshot(CPU_TEMP)).toEqual({
      state: 'live',
      reading: { value: 61.25, at: 10_000 },
      ageMs: 0,
    });
  });

  it('returns the same object until something changes, so React can cache it', () => {
    const source = fakeSource();
    const clock = manualClock();
    const root = store({ source, now: clock.now, recheckIntervalMs: 0 });

    const first = root.snapshot(CPU_TEMP);
    clock.advance(400);

    // Identical, not merely equal: `useSyncExternalStore` compares by reference and loops
    // forever on a `getSnapshot` that mints a fresh object on every read.
    expect(root.snapshot(CPU_TEMP)).toBe(first);

    source.emit(CPU_TEMP, { value: 61, at: clock.now() });
    expect(root.snapshot(CPU_TEMP)).not.toBe(first);
  });

  it('keeps the last reading and reports stale once it ages out', () => {
    const source = fakeSource();
    const clock = manualClock();
    const root = store({ source, now: clock.now, recheckIntervalMs: 0 });

    source.emit(CPU_TEMP, { value: 61, at: clock.now() });
    clock.advance(DEFAULT_STALE_AFTER_MS);
    root.refresh();
    expect(root.snapshot(CPU_TEMP).state).toBe('live');

    clock.advance(1);
    root.refresh();

    expect(root.snapshot(CPU_TEMP)).toEqual({
      state: 'stale',
      reading: { value: 61, at: 10_000 },
      ageMs: DEFAULT_STALE_AFTER_MS + 1,
    });
  });

  it('honours an overridden threshold', () => {
    const source = fakeSource();
    const clock = manualClock();
    const root = store({ source, now: clock.now, staleAfterMs: 500, recheckIntervalMs: 0 });

    source.emit(CPU_TEMP, { value: 61, at: clock.now() });
    clock.advance(501);
    root.refresh();

    expect(root.snapshot(CPU_TEMP).state).toBe('stale');
  });

  it('rejects a threshold that is not a positive number', () => {
    const source = fakeSource();

    expect(() => createSensorStore({ source, staleAfterMs: 0 })).toThrow(RangeError);
    expect(() => createSensorStore({ source, staleAfterMs: -1 })).toThrow(RangeError);
    expect(() => createSensorStore({ source, recheckIntervalMs: -1 })).toThrow(RangeError);
  });

  it('keeps a null value as a reading, not as an absence', () => {
    const source = fakeSource();
    const clock = manualClock();
    const root = store({ source, now: clock.now, recheckIntervalMs: 0 });

    source.emit(CPU_TEMP, { value: null, at: clock.now() });

    expect(root.snapshot(CPU_TEMP)).toEqual({
      state: 'live',
      reading: { value: null, at: 10_000 },
      ageMs: 0,
    });
  });

  it('clamps a negative age from a source clock running ahead', () => {
    const source = fakeSource();
    const clock = manualClock();
    const root = store({ source, now: clock.now, recheckIntervalMs: 0 });

    source.emit(CPU_TEMP, { value: 61, at: clock.now() + 2_000 });

    expect(root.snapshot(CPU_TEMP)).toMatchObject({ state: 'live', ageMs: 0 });
  });

  it('keeps the newest read rather than the newest arrival', () => {
    const source = fakeSource();
    const clock = manualClock();
    const root = store({ source, now: clock.now, recheckIntervalMs: 0 });

    source.emit(CPU_TEMP, { value: 61, at: clock.now() });
    source.emit(CPU_TEMP, { value: 12, at: clock.now() - 3_000 });

    expect(root.snapshot(CPU_TEMP)).toMatchObject({ reading: { value: 61 } });
  });

  it('routes a reading only to the topic that got it', () => {
    const source = fakeSource();
    const clock = manualClock();
    const root = store({ source, now: clock.now, recheckIntervalMs: 0 });

    source.emit(CPU_TEMP, { value: 61, at: clock.now() });

    expect(root.snapshot(CPU_TEMP).state).toBe('live');
    expect(root.snapshot(GPU_FAN).state).toBe('waiting');
  });

  it('accepts the authored shorthand and answers with the canonical topic behind it', () => {
    const source = fakeSource();
    const clock = manualClock();
    const root = store({ source, now: clock.now, recheckIntervalMs: 0 });

    source.emit(CPU_TEMP, { value: 61, at: clock.now() });

    expect(root.snapshot('sensors/cpu/temperature')).toBe(root.snapshot(CPU_TEMP));
  });

  it('throws on a topic outside the grammar, rather than showing "no data" forever', () => {
    const root = store({ source: fakeSource(), recheckIntervalMs: 0 });

    expect(() => root.snapshot('sensors/cpu/tempreature')).toThrow(RangeError);
    expect(() => root.subscribe('not/a/topic', noop)).toThrow(RangeError);
  });

  it('passes metadata and source status through, so no widget holds the source', () => {
    const source = fakeSource('connecting');
    const root = store({ source, recheckIntervalMs: 0 });

    expect(root.meta(CPU_TEMP)).toEqual({ label: 'CPU Package' });
    expect(root.meta('sensors/cpu/temperature')).toEqual({ label: 'CPU Package' });
    expect(root.meta(GPU_FAN)).toBeUndefined();
    expect(root.sourceStatus).toBe('connecting');
  });
});

describe('SensorStore.subscribe', () => {
  it('notifies a subscriber on each reading for its topic only', () => {
    const source = fakeSource();
    const clock = manualClock();
    const root = store({ source, now: clock.now, recheckIntervalMs: 0 });
    let calls = 0;

    root.subscribe(CPU_TEMP, () => (calls += 1));
    source.emit(CPU_TEMP, { value: 61, at: clock.now() });
    source.emit(GPU_FAN, { value: 1200, at: clock.now() });

    expect(calls).toBe(1);
  });

  it('notifies once when a value ages out, and not again while it stays stale', () => {
    const source = fakeSource();
    const clock = manualClock();
    const root = store({ source, now: clock.now, recheckIntervalMs: 0 });
    const states: string[] = [];

    source.emit(CPU_TEMP, { value: 61, at: clock.now() });
    root.subscribe(CPU_TEMP, () => states.push(root.snapshot(CPU_TEMP).state));

    clock.advance(1_000);
    root.refresh();
    clock.advance(DEFAULT_STALE_AFTER_MS);
    root.refresh();
    root.refresh();

    expect(states).toEqual(['stale']);
  });

  it('re-notifies as a stale reading ages, so its printed age ticks up', () => {
    const source = fakeSource();
    const clock = manualClock();
    const root = store({ source, now: clock.now, staleAfterMs: 1_000, recheckIntervalMs: 0 });
    const ages: number[] = [];

    source.emit(CPU_TEMP, { value: 61, at: clock.now() });
    root.subscribe(CPU_TEMP, () => {
      const snapshot = root.snapshot(CPU_TEMP);
      if (snapshot.state === 'stale') ages.push(snapshot.ageMs);
    });

    clock.advance(1_500);
    root.refresh();
    clock.advance(1_000);
    root.refresh();

    expect(ages).toEqual([1_500, 2_500]);
  });

  it('does not re-notify a live reading merely because time passed', () => {
    const source = fakeSource();
    const clock = manualClock();
    const root = store({ source, now: clock.now, recheckIntervalMs: 0 });
    let calls = 0;

    source.emit(CPU_TEMP, { value: 61, at: clock.now() });
    root.subscribe(CPU_TEMP, () => (calls += 1));

    clock.advance(1_200);
    root.refresh();
    clock.advance(1_200);
    root.refresh();

    expect(calls).toBe(0);
  });

  it('stops notifying an unsubscribed listener, and is harmless called twice', () => {
    const source = fakeSource();
    const clock = manualClock();
    const root = store({ source, now: clock.now, recheckIntervalMs: 0 });
    let calls = 0;

    const off = root.subscribe(CPU_TEMP, () => (calls += 1));
    source.emit(CPU_TEMP, { value: 61, at: clock.now() });
    off();
    off();
    source.emit(CPU_TEMP, { value: 62, at: clock.now() + 1 });

    expect(calls).toBe(1);
  });

  it('re-evaluates staleness on its own interval', async () => {
    const source = fakeSource();
    const clock = manualClock();
    const root = store({ source, now: clock.now, staleAfterMs: 5, recheckIntervalMs: 5 });
    const states: string[] = [];

    source.emit(CPU_TEMP, { value: 61, at: clock.now() });
    root.subscribe(CPU_TEMP, () => states.push(root.snapshot(CPU_TEMP).state));
    clock.advance(1_000);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(states).toContain('stale');
  });
});

describe('SensorStore.subscribeStatus', () => {
  it('notifies when the source status changes, and not on every reading', () => {
    let status: SensorSourceStatus = 'connecting';
    const handlers = new Set<(topic: SensorTopic, reading: SensorReading) => void>();
    const source: SensorSource = {
      get status() {
        return status;
      },
      subscribe(_pattern, onReading) {
        handlers.add(onReading);
        return () => handlers.delete(onReading);
      },
      meta: () => undefined,
    };
    const clock = manualClock();
    const root = store({ source, now: clock.now, recheckIntervalMs: 0 });
    const seen: SensorSourceStatus[] = [];

    root.subscribeStatus(() => seen.push(root.sourceStatus));

    const emit = (value: number): void => {
      for (const handler of [...handlers]) handler(CPU_TEMP, { value, at: clock.now() });
    };

    emit(61);
    emit(62);
    status = 'live';
    emit(63);
    emit(64);

    expect(seen).toEqual(['live']);
  });
});

describe('SensorStore.close', () => {
  it('releases the source subscription and stops the recheck', async () => {
    const source = fakeSource();
    const clock = manualClock();
    const root = store({ source, now: clock.now, staleAfterMs: 5, recheckIntervalMs: 5 });
    let calls = 0;

    source.emit(CPU_TEMP, { value: 61, at: clock.now() });
    root.subscribe(CPU_TEMP, () => (calls += 1));
    root.close();
    clock.advance(1_000);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(source.unsubscribes).toBe(1);
    expect(calls).toBe(0);
  });

  it('is harmless called twice', () => {
    const source = fakeSource();
    const root = store({ source, recheckIntervalMs: 0 });

    root.close();
    root.close();

    expect(source.unsubscribes).toBe(1);
  });
});
