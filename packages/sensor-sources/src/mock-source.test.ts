import { assert, describe, expect, it } from 'vitest';
import {
  isSensorMeta,
  isSensorReading,
  isSensorTopic,
  normalizeSensorTopic,
  parseSensorTopic,
  SENSOR_TOPIC_WILDCARD,
  sensorTopic,
  type SensorReading,
  type SensorTopic,
} from '@perch/sensor-contract';
import { MOCK_SENSOR_SPECS, createMockSource } from '@perch/sensor-sources';

/** A clock that advances a fixed second per read, so `at` is deterministic too. */
function steadyClock(startAt = 1_700_000_000_000, stepMs = 1_000): () => number {
  let now = startAt - stepMs;
  return () => (now += stepMs);
}

function collect(
  source: ReturnType<typeof createMockSource>,
  ticks: number,
): [SensorTopic, SensorReading][] {
  const seen: [SensorTopic, SensorReading][] = [];
  source.subscribe(SENSOR_TOPIC_WILDCARD, (topic, reading) => seen.push([topic, reading]));
  for (let i = 0; i < ticks; i += 1) source.tick();
  return seen;
}

describe('MOCK_SENSOR_SPECS', () => {
  it('describes a handful of real topics, not one per metric', () => {
    expect(MOCK_SENSOR_SPECS.length).toBeGreaterThanOrEqual(5);
    expect(MOCK_SENSOR_SPECS.length).toBeLessThanOrEqual(12);
  });

  it('builds every topic through the contract, so none is hand-written', () => {
    for (const spec of MOCK_SENSOR_SPECS) {
      const topic = sensorTopic(spec.device, spec.metric, spec.indices);
      expect(isSensorTopic(topic)).toBe(true);
      expect(parseSensorTopic(topic)).toMatchObject({ device: spec.device, metric: spec.metric });
    }
  });

  it('covers the empty-unit case, so a renderer cannot assume a unit is non-empty', () => {
    expect(MOCK_SENSOR_SPECS.some((spec) => spec.metric === 'factor')).toBe(true);
  });

  it('covers the enumerated-but-reporting-nothing case', () => {
    expect(MOCK_SENSOR_SPECS.some((spec) => spec.reportsNothing === true)).toBe(true);
  });

  it('has a plausible range for every reporting spec', () => {
    for (const spec of MOCK_SENSOR_SPECS) {
      expect(spec.min).toBeLessThan(spec.max);
      expect(spec.label.length).toBeGreaterThan(0);
    }
  });
});

describe('createMockSource: the source contract', () => {
  it('starts connecting and goes live on its first tick', () => {
    const source = createMockSource({ seed: 1, autoStart: false, now: steadyClock() });

    expect(source.status).toBe('connecting');
    source.tick();
    expect(source.status).toBe('live');
  });

  it('reports stale when the publisher stops, which is not an error', () => {
    const source = createMockSource({ seed: 1, autoStart: false, now: steadyClock() });

    source.tick();
    source.stop();

    expect(source.status).toBe('stale');
  });

  it('emits one valid reading per topic per tick', () => {
    const source = createMockSource({ seed: 7, autoStart: false, now: steadyClock() });
    const seen = collect(source, 2);

    expect(seen).toHaveLength(MOCK_SENSOR_SPECS.length * 2);
    for (const [topic, reading] of seen) {
      expect(isSensorTopic(topic)).toBe(true);
      expect(isSensorReading(reading)).toBe(true);
    }
  });

  it('stamps at from the injected clock, not from Date.now', () => {
    const source = createMockSource({
      seed: 7,
      autoStart: false,
      now: steadyClock(1_000, 1_000),
    });
    const seen = collect(source, 2);
    const stamps = [...new Set(seen.map(([, reading]) => reading.at))];

    expect(stamps).toEqual([1_000, 2_000]);
  });

  it('stops delivering to an unsubscribed handler', () => {
    const source = createMockSource({ seed: 7, autoStart: false, now: steadyClock() });
    const seen: SensorTopic[] = [];
    const unsubscribe = source.subscribe(SENSOR_TOPIC_WILDCARD, (topic) => seen.push(topic));

    source.tick();
    const afterFirst = seen.length;
    unsubscribe();
    source.tick();

    expect(afterFirst).toBe(MOCK_SENSOR_SPECS.length);
    expect(seen).toHaveLength(afterFirst);
  });

  it('honours the pattern, so a widget-scoped subscription sees only its topic', () => {
    const source = createMockSource({ seed: 7, autoStart: false, now: steadyClock() });
    const cpuTemp = sensorTopic('cpu', 'temperature');
    const seen: SensorTopic[] = [];

    source.subscribe(cpuTemp, (topic) => seen.push(topic));
    source.tick();

    expect(seen).toEqual([cpuTemp]);
  });

  it('publishes metadata for every topic it emits, and nothing for a topic it does not', () => {
    const source = createMockSource({ seed: 7, autoStart: false, now: steadyClock() });

    for (const topic of source.topics) {
      const meta = source.meta(topic);
      expect(isSensorMeta(meta)).toBe(true);
    }
    expect(source.meta(sensorTopic('battery', 'level', { deviceIndex: 9 }))).toBeUndefined();
  });

  it('answers on the canonical topic an authored shorthand normalises to', () => {
    const source = createMockSource({ seed: 7, autoStart: false, now: steadyClock() });
    const canonical = normalizeSensorTopic('sensors/cpu/temperature');

    // `meta` takes a `SensorTopic`, so normalising free text is the caller's step — which
    // is the provider's job in `ui-kit`, not every source's.
    // `assert` narrows to `SensorTopic`, so `meta` is called with the type it asks for and a
    // normalisation regression fails on this line rather than at the `meta` call.
    assert(canonical !== null, 'sensors/cpu/temperature should normalise');
    expect(source.meta(canonical)).toEqual(source.meta(sensorTopic('cpu', 'temperature')));
  });
});

describe('createMockSource: determinism', () => {
  it('produces an identical stream for the same seed', () => {
    const options = { seed: 42, autoStart: false } as const;
    const a = collect(createMockSource({ ...options, now: steadyClock() }), 5);
    const b = collect(createMockSource({ ...options, now: steadyClock() }), 5);

    expect(a).toEqual(b);
  });

  it('produces a different stream for a different seed', () => {
    const a = collect(createMockSource({ seed: 1, autoStart: false, now: steadyClock() }), 5);
    const b = collect(createMockSource({ seed: 2, autoStart: false, now: steadyClock() }), 5);

    expect(a).not.toEqual(b);
  });

  it('moves, rather than repeating one value forever', () => {
    const source = createMockSource({ seed: 3, autoStart: false, now: steadyClock() });
    const cpuTemp = sensorTopic('cpu', 'temperature');
    const values = collect(source, 6)
      .filter(([topic]) => topic === cpuTemp)
      .map(([, reading]) => reading.value);

    expect(new Set(values).size).toBeGreaterThan(1);
  });

  it('keeps every value inside its spec range', () => {
    const source = createMockSource({ seed: 5, autoStart: false, now: steadyClock() });
    const byTopic = new Map(
      MOCK_SENSOR_SPECS.map((spec) => [sensorTopic(spec.device, spec.metric, spec.indices), spec]),
    );

    for (const [topic, reading] of collect(source, 40)) {
      const spec = byTopic.get(topic);
      if (spec === undefined) throw new Error(`unexpected topic ${topic}`);
      if (spec.reportsNothing === true) {
        expect(reading.value).toBeNull();
        continue;
      }
      // `assert` replaces the `.not.toBeNull()` expectation *and* the `!` that followed it:
      // one statement that both fails the test and narrows the type, rather than an assertion
      // repeating a fact the previous line had already checked but could not tell the compiler.
      assert(reading.value !== null, `${topic} should report a value`);
      expect(reading.value).toBeGreaterThanOrEqual(spec.min);
      expect(reading.value).toBeLessThanOrEqual(spec.max);
    }
  });

  it('is lively without a seed: two unseeded sources disagree', () => {
    const a = collect(createMockSource({ autoStart: false, now: steadyClock() }), 5);
    const b = collect(createMockSource({ autoStart: false, now: steadyClock() }), 5);

    expect(a).not.toEqual(b);
  });
});

describe('createMockSource: the interval', () => {
  it('runs on its own interval once subscribed, and stops when told', async () => {
    const source = createMockSource({ seed: 11, intervalMs: 5 });
    let count = 0;
    const unsubscribe = source.subscribe(SENSOR_TOPIC_WILDCARD, () => (count += 1));

    await new Promise((resolve) => setTimeout(resolve, 40));
    const ticked = count;
    unsubscribe();
    source.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(ticked).toBeGreaterThan(0);
    expect(count).toBe(ticked);
  });
});
