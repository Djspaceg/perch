/**
 * The buffer, tested where it is cheapest to test: no store, no clock, no React tree.
 *
 * Every assertion here is about a bound. A history buffer's whole risk is that it grows — quietly,
 * for the life of a page that is meant to run for months on a wall — so the cases are the ones that
 * would let it: a publisher that never stops, a window that shrank, a chart that unmounted, two
 * charts wanting different windows on one topic.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  sensorTopic,
  type SensorReading,
  type SensorSource,
  type SensorTopic,
} from '@perch/sensor-contract';
import {
  HISTORY_MIN_CAPACITY,
  HISTORY_SLOT_MS,
  createSensorStore,
  createTopicRing,
  createWindowDemand,
  historyCapacity,
  type SensorStore,
} from '@perch/ui-kit';

const CPU_TEMP = sensorTopic('cpu', 'temperature');

/** A reading at an instant. The value is the instant, which makes eviction order readable. */
function at(ms: number, value: number | null = ms): SensorReading {
  return { at: ms, value };
}

/**
 * A source with no transport, the way `sensor-store.test.ts` does it: `ui-kit` may not import
 * `sensor-sources`, and a hand-rolled double is the point of injecting the source at all.
 */
function fakeSource() {
  const handlers = new Set<(topic: SensorTopic, reading: SensorReading) => void>();

  const source = {
    status: 'live' as const,
    subscribe(_pattern: string, onReading: (topic: SensorTopic, reading: SensorReading) => void) {
      handlers.add(onReading);
      return () => {
        handlers.delete(onReading);
      };
    },
    meta() {
      return undefined;
    },
    emit(topic: SensorTopic, reading: SensorReading) {
      for (const handler of [...handlers]) handler(topic, reading);
    },
  } satisfies SensorSource & Record<string, unknown>;

  return source;
}

/** A clock the test moves by hand, so nothing here depends on real time. */
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

/**
 * A store, its source and its clock, opened the way the provider's effect does.
 *
 * `recheckIntervalMs: 0` because every history test below advances the clock and calls `refresh()`
 * itself: a real interval firing on wall-clock time would republish at an instant no assertion
 * expects.
 */
function harness(staleAfterMs?: number) {
  const source = fakeSource();
  const clock = manualClock();
  const store: SensorStore = createSensorStore({
    source,
    now: clock.now,
    recheckIntervalMs: 0,
    ...(staleAfterMs === undefined ? {} : { staleAfterMs }),
  });
  openStores.push(store);
  store.open();
  return { source, clock, store };
}

afterEach(() => {
  while (openStores.length > 0) openStores.pop()?.close();
});

describe('historyCapacity', () => {
  it('derives the count bound from the window through the retained resolution', () => {
    // A 1 s window at 250 ms spacing spans five readings, not four: 0, 250, 500, 750, 1000.
    expect(historyCapacity(1_000)).toBe(1_000 / HISTORY_SLOT_MS + 1);
    expect(historyCapacity(60_000)).toBe(241);
  });

  it('rounds a window that is not a whole number of slots upwards', () => {
    // Downwards would silently drop the newest reading in the window.
    expect(historyCapacity(1_100)).toBe(Math.ceil(1_100 / HISTORY_SLOT_MS) + 1);
  });

  it('never sizes below two, because a line needs two points', () => {
    expect(historyCapacity(1)).toBe(HISTORY_MIN_CAPACITY);
    expect(historyCapacity(0)).toBe(HISTORY_MIN_CAPACITY);
    expect(historyCapacity(Number.NaN)).toBe(HISTORY_MIN_CAPACITY);
    expect(historyCapacity(-5_000)).toBe(HISTORY_MIN_CAPACITY);
  });

  it('scales with the window rather than with anything else', () => {
    const day = historyCapacity(24 * 60 * 60 * 1_000);
    expect(day).toBe(24 * 60 * 60 * 4 + 1);
    // The bound is a count, and the ring does not preallocate it — see the ring's own test below.
    expect(day).toBeLessThan(1_000_000);
  });
});

describe('createTopicRing: bounded in time', () => {
  it('keeps a reading that is inside the window', () => {
    const ring = createTopicRing(10_000);
    ring.push(at(1_000), 1_000);
    ring.push(at(2_000), 2_000);
    expect(ring.samples().map((sample) => sample.at)).toEqual([1_000, 2_000]);
  });

  it('drops the oldest first, and only the ones that left the window', () => {
    const ring = createTopicRing(5_000);
    for (let ms = 1_000; ms <= 10_000; ms += 1_000) ring.push(at(ms), ms);

    // At t=10s a 5s window starts at 5s, so 1..4s have gone and 5..10s remain, in order.
    expect(ring.samples().map((sample) => sample.at)).toEqual([
      5_000, 6_000, 7_000, 8_000, 9_000, 10_000,
    ]);
  });

  it('ages against the clock, not against the newest reading it holds', () => {
    const ring = createTopicRing(5_000);
    ring.push(at(1_000), 1_000);
    ring.push(at(2_000), 2_000);

    // The publisher died at 2s. Twenty seconds later its readings are not a trend, they are history
    // that has walked off the left edge, and the ring must not hold them just because nothing new
    // arrived to push them out.
    ring.evict(22_000);
    expect(ring.samples()).toEqual([]);
    expect(ring.size).toBe(0);
  });

  it('empties rather than keeping a last reading forever', () => {
    const ring = createTopicRing(1_000);
    ring.push(at(1_000), 1_000);
    ring.evict(5_000);
    // Deliberate: a chart with nothing in its window says so. Keeping one reading alive would draw a
    // dot at the left edge of a window it is no longer in.
    expect(ring.size).toBe(0);
  });
});

describe('createTopicRing: bounded in count', () => {
  it('never exceeds the capacity its window derives, however fast the publisher is', () => {
    const ring = createTopicRing(2_000);
    expect(ring.capacity).toBe(historyCapacity(2_000));

    // A 100 Hz publisher inside a 2 s window: 2,000 readings arrive, and the time bound alone would
    // have admitted every one of them.
    for (let index = 0; index < 2_000; index += 1) {
      const ms = 1_000 + index * 10;
      ring.push(at(ms), ms);
      expect(ring.size).toBeLessThanOrEqual(ring.capacity);
    }

    expect(ring.size).toBe(ring.capacity);
    // And what survived is the newest end of the series, not the oldest.
    const samples = ring.samples();
    expect(samples[samples.length - 1]?.at).toBe(1_000 + 1_999 * 10);
  });

  it('does not grow without limit over a long run', () => {
    const ring = createTopicRing(10_000);
    // Ten thousand readings through a ten second window at 1 Hz spacing: the size settles and stays.
    let maximum = 0;
    for (let index = 0; index < 10_000; index += 1) {
      const ms = 1_000 + index * 1_000;
      ring.push(at(ms), ms);
      maximum = Math.max(maximum, ring.size);
    }
    expect(maximum).toBeLessThanOrEqual(ring.capacity);
    expect(ring.size).toBeLessThanOrEqual(11);
  });

  it('keeps the backing array from outgrowing the live readings', () => {
    const ring = createTopicRing(1_000);
    for (let index = 0; index < 5_000; index += 1) {
      const ms = 1_000 + index * 250;
      ring.push(at(ms), ms);
    }
    // `samples()` materialises exactly what is live; the array behind it compacts, so a ring that had
    // 5,000 readings pushed through it is not holding 5,000 slots. This asserts the observable half —
    // the live count — and the compaction it depends on is what keeps that cheap.
    expect(ring.samples()).toHaveLength(ring.size);
    expect(ring.size).toBeLessThanOrEqual(ring.capacity);
  });
});

describe('createTopicRing: out-of-order readings', () => {
  it('drops a reading older than the newest one held', () => {
    const ring = createTopicRing(60_000);
    ring.push(at(5_000), 5_000);
    // A retained MQTT message arriving after a live one, or a broker replaying a backlog.
    ring.push(at(3_000), 5_000);
    expect(ring.samples().map((sample) => sample.at)).toEqual([5_000]);
  });

  it('drops a reading that has already left the window, without a revision bump', () => {
    const ring = createTopicRing(5_000);
    const before = ring.revision;
    // A broker replaying an hour-old backlog. Inserting it and trimming it on the next line would be
    // the same contents and a republish for every chart on the topic.
    ring.push(at(1_000), 60_000);
    expect(ring.size).toBe(0);
    expect(ring.revision).toBe(before);
  });

  it('keeps a reading at the same instant, which is a legitimate republish', () => {
    const ring = createTopicRing(60_000);
    ring.push(at(5_000, 40), 5_000);
    ring.push(at(5_000, 41), 5_000);
    expect(ring.samples().map((sample) => sample.value)).toEqual([40, 41]);
  });

  it('stores a null reading rather than discarding it', () => {
    const ring = createTopicRing(60_000);
    ring.push(at(1_000, 20), 1_000);
    ring.push(at(2_000, null), 2_000);
    ring.push(at(3_000, 22), 3_000);
    // A present sensor measuring nothing is a measured hole, and the chart needs it to know the break
    // is real rather than inferred from a silence.
    expect(ring.samples().map((sample) => sample.value)).toEqual([20, null, 22]);
  });
});

describe('createTopicRing.revision', () => {
  it('bumps on a push and on an eviction, and not otherwise', () => {
    const ring = createTopicRing(2_000);
    const start = ring.revision;

    ring.push(at(1_000), 1_000);
    expect(ring.revision).toBe(start + 1);

    // No reading left the window, so nothing changed.
    ring.evict(1_500);
    expect(ring.revision).toBe(start + 1);

    // Now one did.
    ring.evict(9_000);
    expect(ring.revision).toBe(start + 2);

    // A dropped out-of-order reading is not a content change either.
    ring.push(at(1), 9_000);
    expect(ring.revision).toBe(start + 2);
  });

  it('does not bump when a window grows, because nothing held changed', () => {
    const ring = createTopicRing(2_000);
    ring.push(at(1_000), 1_000);
    const before = ring.revision;
    ring.setWindow(60_000, 1_000);
    expect(ring.revision).toBe(before);
  });
});

describe('createTopicRing.setWindow', () => {
  it('evicts immediately when the window shrinks', () => {
    const ring = createTopicRing(60_000);
    for (let ms = 1_000; ms <= 60_000; ms += 1_000) ring.push(at(ms), ms);
    expect(ring.size).toBe(60);

    // The 60 s chart unmounted; a 5 s chart is all that is left wanting this topic. The readings from
    // before that window are memory nobody can draw, and they go now rather than aging out over the
    // next minute.
    ring.setWindow(5_000, 60_000);
    expect(ring.windowMs).toBe(5_000);
    expect(ring.capacity).toBe(historyCapacity(5_000));
    expect(ring.samples().map((sample) => sample.at)).toEqual([
      55_000, 56_000, 57_000, 58_000, 59_000, 60_000,
    ]);
  });

  it('keeps what it holds when the window grows, and admits more from then on', () => {
    const ring = createTopicRing(5_000);
    for (let ms = 1_000; ms <= 10_000; ms += 1_000) ring.push(at(ms), ms);
    const before = ring.samples().length;

    ring.setWindow(60_000, 10_000);
    // A grow cannot invent history it did not keep; it only stops throwing away what arrives next.
    expect(ring.samples()).toHaveLength(before);
    for (let ms = 11_000; ms <= 30_000; ms += 1_000) ring.push(at(ms), ms);
    expect(ring.samples()).toHaveLength(before + 20);
  });

  it('is a no-op when the window did not change', () => {
    const ring = createTopicRing(5_000);
    ring.push(at(1_000), 1_000);
    const before = ring.revision;
    ring.setWindow(5_000, 99_000);
    // Not even an eviction, so a redundant call from a re-render cannot cost a republish.
    expect(ring.revision).toBe(before);
    expect(ring.size).toBe(1);
  });
});

describe('createWindowDemand', () => {
  it('has no window when nothing is retained', () => {
    const demand = createWindowDemand();
    expect(demand.windowMs).toBe(0);
    expect(demand.windows).toBe(0);
  });

  it('reports the longest window asked for, whatever order it arrived in', () => {
    const demand = createWindowDemand();
    demand.retain(5_000);
    demand.retain(60_000);
    demand.retain(30_000);
    expect(demand.windowMs).toBe(60_000);
    expect(demand.windows).toBe(3);
  });

  it('shrinks when the longest window is released', () => {
    const demand = createWindowDemand();
    const short = demand.retain(5_000);
    const long = demand.retain(60_000);
    expect(demand.windowMs).toBe(60_000);

    // The whole point of the ledger. A monotonic maximum would keep 60 s of readings for a page that
    // now contains one 5 s chart.
    long();
    expect(demand.windowMs).toBe(5_000);

    short();
    expect(demand.windowMs).toBe(0);
    expect(demand.windows).toBe(0);
  });

  it('counts two retentions of the same window separately', () => {
    const demand = createWindowDemand();
    const first = demand.retain(60_000);
    const second = demand.retain(60_000);
    expect(demand.windows).toBe(1);

    first();
    // A set-based ledger would have dropped to 0 here, shrinking a buffer the second chart is drawing.
    expect(demand.windowMs).toBe(60_000);

    second();
    expect(demand.windowMs).toBe(0);
  });

  it('treats a release as idempotent', () => {
    const demand = createWindowDemand();
    const first = demand.retain(60_000);
    demand.retain(60_000);

    // StrictMode runs a cleanup twice. The second call must not free the other chart's retention.
    first();
    first();
    expect(demand.windowMs).toBe(60_000);
  });

  it('refuses a window that is not a positive duration', () => {
    const demand = createWindowDemand();
    expect(() => demand.retain(0)).toThrow(RangeError);
    expect(() => demand.retain(-1)).toThrow(RangeError);
    expect(() => demand.retain(Number.NaN)).toThrow(RangeError);
    expect(() => demand.retain(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('SensorStore history: retained only where it was asked for', () => {
  it('retains nothing, and allocates nothing, until a chart asks', () => {
    const { source, clock, store } = harness();

    source.emit(CPU_TEMP, at(clock.now(), 40));

    const history = store.history(CPU_TEMP);
    expect(history.windowMs).toBe(0);
    expect(history.samples).toEqual([]);
  });

  it('seeds from the reading already in hand, so a late mount is not blank', () => {
    const { source, clock, store } = harness();

    source.emit(CPU_TEMP, at(clock.now(), 41));
    clock.advance(500);

    // A chart mounted at second thirty of an uptime has a reading available; starting empty would
    // make it wait a whole publish interval to draw its first point for no reason.
    const release = store.retainHistory(CPU_TEMP, 60_000);
    expect(store.history(CPU_TEMP).samples.map((sample) => sample.value)).toEqual([41]);
    expect(store.history(CPU_TEMP).windowMs).toBe(60_000);

    release();
  });

  it('collects readings while retained and stops when the last chart releases', () => {
    const { source, clock, store } = harness();

    const release = store.retainHistory(CPU_TEMP, 60_000);
    for (const value of [40, 41, 42]) {
      clock.advance(1_000);
      source.emit(CPU_TEMP, at(clock.now(), value));
    }
    expect(store.history(CPU_TEMP).samples.map((sample) => sample.value)).toEqual([40, 41, 42]);

    // Unmount. The memory goes back, which is the behaviour that makes an editor session that opens
    // and closes forty charts not a leak.
    release();
    expect(store.history(CPU_TEMP).windowMs).toBe(0);
    expect(store.history(CPU_TEMP).samples).toEqual([]);

    clock.advance(1_000);
    source.emit(CPU_TEMP, at(clock.now(), 43));
    expect(store.history(CPU_TEMP).samples).toEqual([]);
  });

  it('shares one buffer between two charts on one topic, sized by the longer window', () => {
    const { source, clock, store } = harness();

    const releaseShort = store.retainHistory(CPU_TEMP, 5_000);
    const releaseLong = store.retainHistory(CPU_TEMP, 60_000);
    expect(store.history(CPU_TEMP).windowMs).toBe(60_000);

    for (let index = 0; index < 30; index += 1) {
      clock.advance(1_000);
      source.emit(CPU_TEMP, at(clock.now(), 40 + index));
    }

    // One ring per topic, not per widget: both charts read this same series and the short one clips
    // it at draw time.
    const shared = store.history(CPU_TEMP);
    expect(shared.samples).toHaveLength(30);
    expect(store.history(CPU_TEMP)).toBe(shared);

    // The long chart unmounts. Demand drops to 5 s and the buffer really does shrink.
    releaseLong();
    const shortened = store.history(CPU_TEMP);
    expect(shortened.windowMs).toBe(5_000);
    // Six, not five: the window's edge is inclusive, so the reading exactly 5 s old is still in it.
    expect(shortened.samples.map((sample) => sample.value)).toEqual([64, 65, 66, 67, 68, 69]);

    releaseShort();
    expect(store.history(CPU_TEMP).windowMs).toBe(0);
  });

  it('notifies a history listener on a reading, and not on an unretained topic', () => {
    const { source, clock, store } = harness();

    let notifications = 0;
    const unsubscribe = store.subscribeHistory(CPU_TEMP, () => {
      notifications += 1;
    });
    const release = store.retainHistory(CPU_TEMP, 60_000);
    const baseline = notifications;

    clock.advance(1_000);
    source.emit(CPU_TEMP, at(clock.now(), 40));
    expect(notifications).toBe(baseline + 1);

    release();
    unsubscribe();

    const after = notifications;
    clock.advance(1_000);
    source.emit(CPU_TEMP, at(clock.now(), 41));
    expect(notifications).toBe(after);
  });

  it('republishes on a recheck tick so an idle chart still advances its axis', () => {
    const { source, clock, store } = harness();

    const release = store.retainHistory(CPU_TEMP, 60_000);
    source.emit(CPU_TEMP, at(clock.now(), 40));
    const before = store.history(CPU_TEMP);

    // No new reading, only time passing. The window's right edge is *now*, so a chart drawing a
    // silence needs a new snapshot to draw a longer one.
    clock.advance(2_000);
    store.refresh();
    const after = store.history(CPU_TEMP);
    expect(after).not.toBe(before);
    expect(after.endsAt).toBe(clock.now());
    expect(after.samples.map((sample) => sample.value)).toEqual([40]);

    release();
  });

  it('returns the same snapshot object on consecutive reads', () => {
    const { source, clock, store } = harness();

    const release = store.retainHistory(CPU_TEMP, 60_000);
    source.emit(CPU_TEMP, at(clock.now(), 40));

    // `useSyncExternalStore` throws on a `getSnapshot` that mints. Crossing a second must not change
    // that, which is why `history()` reads what was published rather than recomputing.
    const first = store.history(CPU_TEMP);
    clock.advance(1_500);
    expect(store.history(CPU_TEMP)).toBe(first);

    release();
  });

  it('ages history on the same clock as staleness', () => {
    const { source, clock, store } = harness();

    const release = store.retainHistory(CPU_TEMP, 5_000);
    source.emit(CPU_TEMP, at(clock.now(), 40));
    expect(store.history(CPU_TEMP).samples).toHaveLength(1);

    clock.advance(30_000);
    store.refresh();
    // The reading left the window without a new one arriving to push it out, exactly as the axis says.
    expect(store.history(CPU_TEMP).samples).toEqual([]);

    release();
  });

  it('exposes the one staleness threshold rather than letting a chart invent a second', () => {
    const { store } = harness(7_000);
    // A chart locating a hole and the readout beside it reporting one must use the same number.
    expect(store.staleAfterMs).toBe(7_000);
  });
});
