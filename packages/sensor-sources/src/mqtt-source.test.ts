/**
 * The mqtt source against a real broker.
 *
 * Every test in this file stands up `aedes` over `ws` in process and dials it with the same
 * `mqtt` client the browser uses. Nothing is stubbed: the CONNECT, the SUBSCRIBE, the retained
 * delivery and the socket drop are all real. That is the point — a stub would prove the source
 * calls a library, and what needs proving is that readings, metadata and `status` come out
 * right at the other end of a wire.
 *
 * The broker always listens on an ephemeral port, never on `RELAY_WEBSOCKET_PORT`. See
 * `mqtt-broker.test-support.ts` for why that is a correctness requirement and not tidiness.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SENSOR_TOPIC_WILDCARD,
  sensorMetaTopic,
  sensorTopic,
  type SensorMeta,
  type SensorReading,
  type SensorTopic,
} from '@perch/sensor-contract';
import {
  DEFAULT_BROKER_URL_WARNING,
  SENSOR_META_SUBSCRIPTION,
  SENSOR_READING_SUBSCRIPTION,
  createMqttSource,
  topicMatchesPattern,
  type MqttSensorSource,
  type MqttSourceOptions,
  type SourceLogger,
} from '@perch/sensor-sources';
import { startTestBroker, type TestBroker } from './mqtt-broker.test-support.js';

const CPU_TEMP = sensorTopic('cpu', 'temperature');
const CPU_TEMP_META = sensorMetaTopic('cpu', 'temperature');
const GPU_TEMP = sensorTopic('gpu', 'temperature');

/** A port nothing listens on, for the cases that are about a link that cannot be made. */
const DEAD_URL = 'ws://127.0.0.1:1';

/** Collects warnings instead of printing them, so a test can assert on the trap warning. */
function recordingLogger(): SourceLogger & { readonly messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    warn(message) {
      messages.push(message);
    },
  };
}

/** A clock the test drives, so the `live` -> `stale` boundary is exact rather than timed. */
function manualClock(start = 1_700_000_000_000): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let at = start;
  return {
    now: () => at,
    advance(ms) {
      at += ms;
    },
  };
}

/** Everything opened during a test, torn down whether it passed or not. */
const openBrokers: TestBroker[] = [];
const openSources: MqttSensorSource[] = [];

async function broker(port?: number): Promise<TestBroker> {
  const started = await startTestBroker(port === undefined ? {} : { port });
  openBrokers.push(started);
  return started;
}

function source(url: string, options: MqttSourceOptions = {}): MqttSensorSource {
  const created = createMqttSource({
    url,
    // Every test passes an explicit URL, so the origin is `env` — the trap warning fires only
    // for the one test that is about the trap.
    origin: 'env',
    reconnectDelayMs: 50,
    maxReconnectDelayMs: 200,
    connectTimeoutMs: 1_000,
    ...options,
  });
  openSources.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(openSources.splice(0).map((open) => open.close()));
  await Promise.all(openBrokers.splice(0).map((open) => open.stop()));
});

describe('the two narrow subscriptions', () => {
  it('is why the decision was made: the contract wildcard matches meta topics too', () => {
    // This is the fact the decision turns on. A source on `sensors/#` receives metadata
    // interleaved with readings and must route on the suffix; a routing slip then hands a
    // SensorMeta body to a widget expecting a number.
    expect(topicMatchesPattern(CPU_TEMP_META, SENSOR_TOPIC_WILDCARD)).toBe(true);
  });

  it('keeps meta out of the reading pattern structurally, not by filtering', () => {
    expect(topicMatchesPattern(CPU_TEMP, SENSOR_READING_SUBSCRIPTION)).toBe(true);
    expect(topicMatchesPattern(CPU_TEMP_META, SENSOR_READING_SUBSCRIPTION)).toBe(false);

    expect(topicMatchesPattern(CPU_TEMP_META, SENSOR_META_SUBSCRIPTION)).toBe(true);
    expect(topicMatchesPattern(CPU_TEMP, SENSOR_META_SUBSCRIPTION)).toBe(false);
  });

  it('builds both patterns from the contract rather than hand-writing them', () => {
    expect(SENSOR_READING_SUBSCRIPTION).toBe('sensors/+/+/+/+');
    expect(SENSOR_META_SUBSCRIPTION).toBe('sensors/+/+/+/+/meta');
  });
});

describe('createMqttSource: a real round trip', () => {
  it('delivers a reading published to a real topic, on the canonical topic', async () => {
    const test = await broker();
    const src = source(test.url);
    const seen: [SensorTopic, SensorReading][] = [];
    src.subscribe(SENSOR_TOPIC_WILDCARD, (topic, reading) => {
      seen.push([topic, reading]);
    });

    await src.ready();
    await test.publishReading(CPU_TEMP, { value: 61.5, at: 1_700_000_000_000 });

    await vi.waitFor(() => {
      expect(seen).toHaveLength(1);
    });
    expect(seen[0]).toEqual([CPU_TEMP, { value: 61.5, at: 1_700_000_000_000 }]);
    expect(src.stats.readingsAccepted).toBe(1);
    expect(src.stats.rejected).toBe(0);
    expect(src.status).toBe('live');
  });

  it('carries a null value through, because a sensor can report nothing', async () => {
    const test = await broker();
    const src = source(test.url);
    const seen: SensorReading[] = [];
    src.subscribe(CPU_TEMP, (_topic, reading) => {
      seen.push(reading);
    });

    await src.ready();
    await test.publishReading(CPU_TEMP, { value: null, at: 42 });

    await vi.waitFor(() => {
      expect(seen).toEqual([{ value: null, at: 42 }]);
    });
  });

  it('reads retained metadata published before it ever connected', async () => {
    const test = await broker();
    const meta: SensorMeta = { label: 'CPU Package', vendor: 'intel' };
    // Retained and published first: this is the arrangement widgets depend on, because `label`
    // cannot be derived from a topic.
    await test.publishMeta(CPU_TEMP_META, meta);

    const src = source(test.url);
    await src.ready();

    await vi.waitFor(() => {
      expect(src.meta(CPU_TEMP)).toEqual(meta);
    });
    expect(src.stats.metaAccepted).toBe(1);
    expect(src.meta(GPU_TEMP)).toBeUndefined();
  });

  it('delivers to each subscriber only the topics its pattern matches', async () => {
    const test = await broker();
    const src = source(test.url);
    const cpu: SensorTopic[] = [];
    const gpu: SensorTopic[] = [];
    const unsubscribeCpu = src.subscribe(CPU_TEMP, (topic) => {
      cpu.push(topic);
    });
    src.subscribe(GPU_TEMP, (topic) => {
      gpu.push(topic);
    });

    await src.ready();
    await test.publishReading(CPU_TEMP, { value: 50, at: 1 });
    await test.publishReading(GPU_TEMP, { value: 40, at: 1 });

    await vi.waitFor(() => {
      expect(src.stats.readingsAccepted).toBe(2);
    });
    expect(cpu).toEqual([CPU_TEMP]);
    expect(gpu).toEqual([GPU_TEMP]);

    unsubscribeCpu();
    unsubscribeCpu(); // calling twice is harmless, per the contract
    await test.publishReading(CPU_TEMP, { value: 51, at: 2 });
    await vi.waitFor(() => {
      expect(src.stats.readingsAccepted).toBe(3);
    });
    expect(cpu).toEqual([CPU_TEMP]);
  });

  it('withdraws metadata on an empty retained publish, which is not a rejection', async () => {
    const test = await broker();
    await test.publishMeta(CPU_TEMP_META, { label: 'CPU Package' });
    const src = source(test.url);
    await src.ready();
    await vi.waitFor(() => {
      expect(src.meta(CPU_TEMP)).toBeDefined();
    });

    // Zero-length retained publish: MQTT's own way of deleting a retained message.
    await test.publishRaw(CPU_TEMP_META, '', { retain: true, qos: 1 });

    await vi.waitFor(() => {
      expect(src.meta(CPU_TEMP)).toBeUndefined();
    });
    expect(src.stats.metaCleared).toBe(1);
    expect(src.stats.rejected).toBe(0);
  });
});

describe('the validating boundary', () => {
  it('drops every malformed payload and counts it by reason', async () => {
    const test = await broker();
    const logger = recordingLogger();
    const src = source(test.url, { logger });
    const seen: SensorReading[] = [];
    src.subscribe(SENSOR_TOPIC_WILDCARD, (_topic, reading) => {
      seen.push(reading);
    });

    await src.ready();

    await test.publishRaw(CPU_TEMP, 'not json at all');
    await test.publishRaw(CPU_TEMP, new Uint8Array([0xff, 0xfe, 0xfd])); // not UTF-8
    await test.publishRaw(CPU_TEMP, JSON.stringify({ value: 'hot', at: 1 }));
    await test.publishRaw(CPU_TEMP, JSON.stringify({ value: 1 })); // no `at`
    await test.publishRaw(CPU_TEMP, '{"value":1e999,"at":1}'); // Infinity, not a reading
    await test.publishRaw(CPU_TEMP, JSON.stringify([{ value: 1, at: 1 }])); // an array
    await test.publishRaw('sensors/cpu/0/bogus/0', JSON.stringify({ value: 1, at: 1 }));
    await test.publishRaw('sensors/cpu/00/temperature/0', JSON.stringify({ value: 1, at: 1 }));

    // One good reading last, as the fence: once it lands and the eight rejections are counted,
    // every message has been processed, so the counts below are complete.
    await test.publishReading(CPU_TEMP, { value: 61, at: 1 });
    await vi.waitFor(() => {
      expect(src.stats.readingsAccepted).toBe(1);
      expect(src.stats.rejected).toBe(8);
    });

    expect(seen).toEqual([{ value: 61, at: 1 }]);
    expect(src.stats.rejectionsByReason).toEqual({
      undecodable: 1,
      'invalid-json': 1,
      'unroutable-topic': 0,
      'uncanonical-topic': 2,
      'not-a-reading': 4,
      'not-a-meta': 0,
    });

    // Visible, not invisible: one line per reason, then counters. Four reasons fired.
    const rejectionWarnings = logger.messages.filter((message) =>
      message.includes('dropped a message'),
    );
    expect(rejectionWarnings).toHaveLength(4);
  });

  it('never hands a meta payload to a reading subscriber', async () => {
    const test = await broker();
    const src = source(test.url);
    const seen: SensorReading[] = [];
    // Subscribing on the contract wildcard, which *does* match meta topics. The two narrow
    // broker subscriptions are what make this safe.
    src.subscribe(SENSOR_TOPIC_WILDCARD, (_topic, reading) => {
      seen.push(reading);
    });

    await src.ready();
    await test.publishMeta(CPU_TEMP_META, { label: 'CPU Package' });
    await test.publishReading(CPU_TEMP, { value: 61, at: 1 });

    await vi.waitFor(() => {
      expect(src.stats.readingsAccepted).toBe(1);
      expect(src.stats.metaAccepted).toBe(1);
    });
    expect(seen).toEqual([{ value: 61, at: 1 }]);
    expect(src.stats.rejected).toBe(0);
  });

  it('rejects a reading-shaped body on a meta topic, and still delivers no reading', async () => {
    const test = await broker();
    const src = source(test.url);
    const seen: SensorReading[] = [];
    src.subscribe(SENSOR_TOPIC_WILDCARD, (_topic, reading) => {
      seen.push(reading);
    });

    await src.ready();
    await test.publishRaw(CPU_TEMP_META, JSON.stringify({ value: 61, at: 1 }), {
      retain: true,
      qos: 1,
    });
    await test.publishReading(CPU_TEMP, { value: 62, at: 2 });

    await vi.waitFor(() => {
      expect(src.stats.readingsAccepted).toBe(1);
      expect(src.stats.rejectionsByReason['not-a-meta']).toBe(1);
    });
    expect(seen).toEqual([{ value: 62, at: 2 }]);
    expect(src.meta(CPU_TEMP)).toBeUndefined();
  });

  it('rejects a meta body missing its label, because label is the reason meta exists', async () => {
    const test = await broker();
    const src = source(test.url);
    await src.ready();

    await test.publishRaw(CPU_TEMP_META, JSON.stringify({ vendor: 'intel' }), {
      retain: true,
      qos: 1,
    });
    await test.publishReading(CPU_TEMP, { value: 61, at: 1 });

    await vi.waitFor(() => {
      expect(src.stats.readingsAccepted).toBe(1);
      expect(src.stats.rejectionsByReason['not-a-meta']).toBe(1);
    });
    expect(src.meta(CPU_TEMP)).toBeUndefined();
  });
});

describe('status: three absences a dashboard has to tell apart', () => {
  it('is connecting before the link is up, and still connecting once it is but with no data', async () => {
    const test = await broker();
    const src = source(test.url);

    // "Nothing has arrived and nothing has failed" — before CONNACK.
    expect(src.status).toBe('connecting');

    await src.ready();
    // Subscribed, link demonstrably fine, and still no reading has ever arrived. That is
    // `connecting`, not `stale`: nothing has gone quiet, because nothing has spoken.
    expect(src.status).toBe('connecting');
  });

  it('is live while readings arrive and stale exactly when the window closes', async () => {
    const test = await broker();
    const clock = manualClock();
    const src = source(test.url, { now: clock.now, staleAfterMs: 3_000 });

    await src.ready();
    await test.publishReading(CPU_TEMP, { value: 61, at: 1 });
    await vi.waitFor(() => {
      expect(src.stats.readingsAccepted).toBe(1);
    });

    expect(src.status).toBe('live');
    clock.advance(3_000);
    expect(src.status).toBe('live'); // the boundary is inclusive
    clock.advance(1);
    // Connected, and the publisher stopped. The transport is fine, and saying `error` here
    // would send someone to look at the network.
    expect(src.status).toBe('stale');
  });

  it('is error when the connection dies, which is not stale', async () => {
    const test = await broker();
    const src = source(test.url);

    await src.ready();
    await test.publishReading(CPU_TEMP, { value: 61, at: 1 });
    await vi.waitFor(() => {
      expect(src.status).toBe('live');
    });

    await test.stop();
    openBrokers.length = 0;

    await vi.waitFor(() => {
      expect(src.status).toBe('error');
    });
    expect(src.stats.connectionFailures).toBeGreaterThanOrEqual(1);
  });

  it('is error when the broker was never there, rather than connecting forever', async () => {
    const src = source(DEAD_URL);

    await vi.waitFor(
      () => {
        expect(src.status).toBe('error');
      },
      { timeout: 5_000 },
    );
    expect(src.stats.connects).toBe(0);
  });

  it('is error after close, so a closed source cannot be read as merely quiet', async () => {
    const test = await broker();
    const src = source(test.url);
    await src.ready();

    await src.close();
    await src.close(); // idempotent

    expect(src.status).toBe('error');
  });

  it('rejects ready() when closed before it subscribed', async () => {
    const src = source(DEAD_URL);
    const ready = src.ready();
    await src.close();

    await expect(ready).rejects.toThrow(/closed before it subscribed/);
  });
});

describe('reconnect: the sensor host reboots', () => {
  it('resubscribes, recovers retained metadata, and never claims live during the gap', async () => {
    const first = await broker();
    const { port } = first;
    const clock = manualClock();
    const src = source(first.url, { now: clock.now, staleAfterMs: 3_000 });
    const seen: SensorReading[] = [];
    src.subscribe(SENSOR_TOPIC_WILDCARD, (_topic, reading) => {
      seen.push(reading);
    });

    await first.publishMeta(CPU_TEMP_META, { label: 'CPU Package', vendor: 'intel' });
    await src.ready();
    await vi.waitFor(() => {
      expect(src.meta(CPU_TEMP)).toBeDefined();
    });
    await first.publishReading(CPU_TEMP, { value: 61, at: 1 });
    await vi.waitFor(() => {
      expect(src.status).toBe('live');
    });

    // The host goes away. Sockets are destroyed, not closed politely.
    await first.stop();
    openBrokers.length = 0;
    await vi.waitFor(() => {
      expect(src.status).toBe('error');
    });

    // Through the whole gap the status stays `error` — never `live` off the pre-gap reading,
    // and never `connecting`, which would read as "nothing has failed yet".
    clock.advance(60_000);
    expect(src.status).toBe('error');

    // The label survives the gap: `status` already says the link is down, and blanking every
    // widget's label would make a reboot look like a data-model failure.
    expect(src.meta(CPU_TEMP)).toEqual({ label: 'CPU Package', vendor: 'intel' });

    // The host comes back on the same port, with its retained metadata republished as a real
    // relay would on restart.
    const second = await broker(port);
    await second.publishMeta(CPU_TEMP_META, { label: 'CPU Package', vendor: 'intel' });

    await vi.waitFor(
      () => {
        expect(src.stats.connects).toBe(2);
      },
      { timeout: 10_000 },
    );
    // Reconnected, and no reading yet on the new link. `stale` is the honest answer: the
    // transport has proved itself and the data has not arrived.
    expect(src.status).toBe('stale');

    // Publish until it lands: the resubscription is in flight, and a single publish could be
    // dropped by the broker as having no subscriber yet. A real publisher retries at 1 Hz.
    await vi.waitFor(
      async () => {
        await second.publishReading(CPU_TEMP, { value: 63, at: 2 });
        expect(src.status).toBe('live');
      },
      { timeout: 10_000, interval: 50 },
    );

    expect(seen[0]).toEqual({ value: 61, at: 1 });
    expect(seen.at(-1)).toEqual({ value: 63, at: 2 });
    expect(src.meta(CPU_TEMP)).toEqual({ label: 'CPU Package', vendor: 'intel' });
  });
});

describe('the default broker URL is a trap, and says so', () => {
  it('warns loudly when nothing overrode it', () => {
    const logger = recordingLogger();
    const src = createMqttSource({
      url: DEAD_URL,
      origin: 'default',
      logger,
      connectTimeoutMs: 200,
      reconnectDelayMs: 100,
      maxReconnectDelayMs: 100,
    });
    openSources.push(src);

    expect(logger.messages[0]).toBe(DEFAULT_BROKER_URL_WARNING);
    expect(DEFAULT_BROKER_URL_WARNING).toContain('PERCH_BROKER_URL');
    expect(DEFAULT_BROKER_URL_WARNING).toContain('9001');
  });

  it('says nothing when an override decided', async () => {
    const test = await broker();
    const logger = recordingLogger();
    const src = source(test.url, { logger, origin: 'env' });
    await src.ready();

    expect(logger.messages).toEqual([]);
  });
});

describe('option validation', () => {
  it('rejects a non-positive window or delay rather than producing a source that lies', () => {
    expect(() => createMqttSource({ url: DEAD_URL, staleAfterMs: 0 })).toThrow(RangeError);
    expect(() => createMqttSource({ url: DEAD_URL, reconnectDelayMs: -1 })).toThrow(RangeError);
    expect(() => createMqttSource({ url: DEAD_URL, reconnectBackoffFactor: 0.5 })).toThrow(
      RangeError,
    );
    expect(() =>
      createMqttSource({ url: DEAD_URL, reconnectDelayMs: 5_000, maxReconnectDelayMs: 1_000 }),
    ).toThrow(RangeError);
  });
});
