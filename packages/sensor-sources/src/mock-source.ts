/**
 * The mock source: plausible readings with no hardware and no broker.
 *
 * Not scaffolding, and not a test fixture that will be deleted later. The editor needs
 * live-looking data to author against on a machine with no sensors, and every test in the
 * repo needs a source it can predict — so this is permanent, and it is the source both of
 * them run by default.
 *
 * Two behaviours in one implementation:
 * - **Seeded**: the same seed replays the same values in the same order, so a test can
 *   assert on them. With an injected clock, `at` is deterministic too.
 * - **Unseeded**: a random seed, so the editor's canvas moves and looks like real
 *   hardware rather than a frozen mockup.
 *
 * Every topic is built with the contract's `sensorTopic()`. There is not a hand-written
 * topic string in this file, which is SPEC rule 5 held to in the one place that would
 * otherwise be tempting.
 */

import {
  sensorTopic,
  type SensorDevice,
  type SensorMeta,
  type SensorMetric,
  type SensorReading,
  type SensorReadingHandler,
  type SensorSource,
  type SensorSourceStatus,
  type SensorTopic,
  type SensorTopicIndices,
  type Unsubscribe,
} from '@perch/sensor-contract';
import { topicMatchesPattern } from './topic-pattern.js';

/** One simulated sensor: which topic it is, what it is called, and how it moves. */
export interface MockSensorSpec {
  device: SensorDevice;
  metric: SensorMetric;
  indices?: SensorTopicIndices;
  /** Goes into `SensorMeta.label`, the way LHM's `Name` does. */
  label: string;
  vendor?: string;
  hidden?: boolean;
  /** Inclusive bounds. A generated value never leaves them. */
  min: number;
  max: number;
  /** Largest step between consecutive readings. Small means a slow drift. */
  drift: number;
  /**
   * Enumerated but reporting nothing: every reading is `value: null`.
   *
   * LHM does this — `ISensor.Value` is `float?` — so the mock has to, or nothing in the
   * repo ever exercises the null path that `SensorReading` exists to express.
   */
  reportsNothing?: boolean;
}

/**
 * The default sensor set: a handful of topics a real desktop would actually publish,
 * chosen to cover the cases a renderer gets wrong.
 *
 * `cpu/factor` is here because its unit is the empty string, and `cooler/fan` reports
 * nothing because a header with no pump attached is exactly how LHM presents one.
 */
export const MOCK_SENSOR_SPECS: readonly MockSensorSpec[] = Object.freeze([
  {
    device: 'cpu',
    metric: 'temperature',
    label: 'CPU Package',
    vendor: 'intel',
    min: 34,
    max: 92,
    drift: 3.5,
  },
  {
    device: 'cpu',
    metric: 'load',
    label: 'CPU Total',
    min: 1,
    max: 100,
    drift: 12,
  },
  {
    device: 'cpu',
    metric: 'power',
    label: 'CPU Package Power',
    min: 8,
    max: 125,
    drift: 9,
  },
  {
    device: 'cpu',
    metric: 'factor',
    label: 'CPU Core Multiplier',
    min: 8,
    max: 52,
    drift: 4,
  },
  {
    device: 'gpu',
    metric: 'temperature',
    label: 'GPU Core',
    vendor: 'nvidia',
    min: 30,
    max: 84,
    drift: 2.5,
  },
  {
    device: 'gpu',
    metric: 'fan',
    label: 'GPU Fan',
    vendor: 'nvidia',
    min: 0,
    max: 2400,
    drift: 180,
  },
  {
    device: 'memory',
    metric: 'level',
    label: 'Memory Used',
    min: 18,
    max: 96,
    drift: 2,
  },
  {
    device: 'storage',
    metric: 'temperature',
    indices: { deviceIndex: 1 },
    label: 'Drive 2 Temperature',
    min: 28,
    max: 62,
    drift: 1.2,
  },
  {
    device: 'cooler',
    metric: 'fan',
    label: 'Pump Header (not connected)',
    // A nominal range, kept for the day the header reports: `reportsNothing` is a
    // statement about this sensor's wiring, not about the range being unknowable.
    min: 0,
    max: 2_600,
    drift: 120,
    reportsNothing: true,
  },
] as const);

/**
 * An options bag, so every optional member is `?: T | undefined`: each is read through a
 * destructuring default, which fires on an explicit `undefined` exactly as it does on
 * absence. `MockSensorSpec` above is a *payload* and deliberately stays `?: T` — omitting
 * `vendor` and setting it to `undefined` are different acts there, which is the distinction
 * `exactOptionalPropertyTypes` exists to keep.
 */
export interface MockSourceOptions {
  /** Fix the value stream. Omit for a different stream every run. */
  seed?: number | undefined;
  /** Publish period in ms once something is subscribed. Default 1000, the SPEC's 1 Hz. */
  intervalMs?: number | undefined;
  /** Clock for `at`. Default `Date.now`; inject one to make `at` deterministic. */
  now?: (() => number) | undefined;
  /** Override the sensor set. Default `MOCK_SENSOR_SPECS`. */
  specs?: readonly MockSensorSpec[] | undefined;
  /** Start publishing on the first subscriber. Default true; false means `tick()` only. */
  autoStart?: boolean | undefined;
}

export interface MockSensorSource extends SensorSource {
  /** The canonical topics this source publishes, in spec order. */
  readonly topics: readonly SensorTopic[];
  /** Begin the interval. Idempotent. */
  start(): void;
  /**
   * Stop publishing and report `stale`.
   *
   * Deliberately not `error`: the mock has no transport, so it can model a publisher going
   * quiet but it cannot model a connection failing. That distinction is the mqtt source's
   * to exercise.
   */
  stop(): void;
  /** Publish one reading per topic, now. The seam that makes a test need no timers. */
  tick(): void;
}

/** Build a mock source. Nothing here touches the network, a timer excepted. */
export function createMockSource(options: MockSourceOptions = {}): MockSensorSource {
  const {
    seed = randomSeed(),
    intervalMs = 1_000,
    now = Date.now,
    specs = MOCK_SENSOR_SPECS,
    autoStart = true,
  } = options;

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError(`intervalMs must be a positive number, got ${intervalMs}`);
  }

  const random = mulberry32(seed);
  // One array of pairs rather than two parallel arrays indexed in lockstep. The old shape
  // held `specs[i]` and `topics[i]` together only by an invariant nothing enforced;
  // `noUncheckedIndexedAccess` made that invariant visible, and pairing the two makes it
  // structural instead.
  const entries: { readonly spec: MockSensorSpec; readonly topic: SensorTopic }[] = [];
  const metas = new Map<SensorTopic, SensorMeta>();
  const values = new Map<SensorTopic, number>();

  for (const spec of specs) {
    const topic = sensorTopic(spec.device, spec.metric, spec.indices);
    entries.push({ spec, topic });
    metas.set(topic, buildMeta(spec));
    // Midpoint, not a random start: a seeded run's first frame is then also predictable.
    values.set(topic, (spec.min + spec.max) / 2);
  }

  const topics: readonly SensorTopic[] = entries.map((entry) => entry.topic);

  const subscribers = new Map<SensorReadingHandler, string>();
  let status: SensorSourceStatus = 'connecting';
  let timer: ReturnType<typeof setInterval> | undefined;

  const startTimer = (): void => {
    if (timer !== undefined) return;
    timer = setInterval(() => {
      source.tick();
    }, intervalMs);
  };

  /** Stop the interval without claiming the publisher died — used when nobody is listening. */
  const stopTimer = (): void => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  };

  const source: MockSensorSource = {
    topics,

    get status() {
      return status;
    },

    subscribe(pattern: string, onReading: SensorReadingHandler): Unsubscribe {
      subscribers.set(onReading, pattern);
      if (autoStart) startTimer();

      let live = true;
      return () => {
        if (!live) return; // calling twice is harmless
        live = false;
        subscribers.delete(onReading);
        if (subscribers.size === 0) stopTimer();
      };
    },

    meta(topic) {
      // A plain lookup on the canonical topic. Expanding an authored shorthand is the
      // caller's step — `normalizeSensorTopic` is the contract's seam for free text, and
      // `ui-kit`'s provider does it once rather than every source doing it forever.
      return metas.get(topic);
    },

    start: startTimer,

    stop() {
      stopTimer();
      status = 'stale';
    },

    tick() {
      const at = now();
      status = 'live';

      for (const { spec, topic } of entries) {
        const reading = nextReading(spec, topic, at);

        for (const [handler, pattern] of subscribers) {
          if (topicMatchesPattern(topic, pattern)) handler(topic, reading);
        }
      }
    },
  };

  function nextReading(spec: MockSensorSpec, topic: SensorTopic, at: number): SensorReading {
    if (spec.reportsNothing === true) return { value: null, at };

    const previous = values.get(topic) ?? (spec.min + spec.max) / 2;
    const step = (random() * 2 - 1) * spec.drift;
    const value = clamp(previous + step, spec.min, spec.max);
    values.set(topic, value);

    return { value, at };
  }

  return source;
}

function buildMeta(spec: MockSensorSpec): SensorMeta {
  const meta: SensorMeta = { label: spec.label };
  if (spec.vendor !== undefined) meta.vendor = spec.vendor;
  if (spec.hidden !== undefined) meta.hidden = spec.hidden;
  return meta;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * mulberry32: 32 bits of state, one multiply-xorshift round. Chosen because it is short
 * enough to read, has no dependency, and is stable across engines — a seeded assertion
 * must not change because V8 changed `Math.random`.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A different stream every run when no seed is given, so the editor looks alive. */
function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
}
