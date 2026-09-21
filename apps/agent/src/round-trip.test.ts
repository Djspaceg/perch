/**
 * The whole relay, end to end, with a real subscriber on the wire.
 *
 * Every other test file cuts the thing somewhere: the mapping is tested against the fixture with
 * no broker, the broker is tested with hand-written payloads and no mapping. This one runs the
 * real poll loop and the real embedded broker together, with the captured 214-sensor payload
 * standing in for the HTTP response, and asserts on the messages a **real MQTT client receives
 * over WebSockets** — the transport and the library the dashboard itself uses.
 *
 * What that proves and the others cannot: that 213 readings and 213 retained metadata companions
 * actually arrive, on the topics the contract accepts, with bodies the contract validates, from a
 * process with no external broker installed.
 */

import { afterEach, describe, expect, it } from 'vitest';
import mqtt, { type MqttClient } from 'mqtt';
import {
  SENSOR_TOPIC_WILDCARD,
  isSensorMeta,
  isSensorReading,
  isSensorTopic,
  type SensorMeta,
  type SensorReading,
} from '@perch/sensor-contract';
import { startEmbeddedBroker, type EmbeddedBroker } from './broker.js';
import { createRelayState, runOnePoll, startRelay, type RelayLogger } from './relay.js';
import { LHM_FIXTURE_TOPIC_COUNT, loadLhmFixturePayload } from './lhm-fixture.test-support.js';

const opened: { brokers: EmbeddedBroker[]; clients: MqttClient[]; stops: (() => Promise<void>)[] } =
  { brokers: [], clients: [], stops: [] };

afterEach(async () => {
  for (const stop of opened.stops.splice(0)) await stop();
  for (const client of opened.clients.splice(0)) await client.endAsync(true);
  for (const broker of opened.brokers.splice(0)) await broker.close();
});

const payload = loadLhmFixturePayload();
const AT = 1_758_000_000_000;

function silentLogger(): { logger: RelayLogger; lines: string[] } {
  const lines: string[] = [];

  return {
    lines,
    logger: {
      info: (message) => lines.push(`info: ${message}`),
      warn: (message) => lines.push(`warn: ${message}`),
      error: (message) => lines.push(`error: ${message}`),
    },
  };
}

interface Inbox {
  readonly messages: { topic: string; body: string }[];
  /** Resolves once `count` messages have arrived, or rejects on timeout. */
  waitFor(count: number, timeoutMs?: number): Promise<void>;
}

/** Subscribe to every sensor topic and collect what arrives. */
async function subscribeAll(url: string): Promise<Inbox> {
  const client = await mqtt.connectAsync(url, { reconnectPeriod: 0, connectTimeout: 4000 });
  opened.clients.push(client);

  const messages: { topic: string; body: string }[] = [];
  const waiters: { count: number; resolve: () => void }[] = [];

  client.on('message', (topic: string, buffer: Buffer) => {
    messages.push({ topic, body: buffer.toString('utf8') });
    for (const waiter of waiters.filter((candidate) => messages.length >= candidate.count)) {
      waiter.resolve();
    }
  });

  // `sensors/#` from the contract, not a literal: the subscription and the publisher must use
  // the same name or the failure mode is a subscription that never fires.
  await client.subscribeAsync(SENSOR_TOPIC_WILDCARD);

  return {
    messages,
    waitFor: (count, timeoutMs = 8000) =>
      new Promise<void>((resolve, reject) => {
        if (messages.length >= count) {
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          reject(new Error(`timed out with ${messages.length} of ${count} messages`));
        }, timeoutMs);
        waiters.push({
          count,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
        });
      }),
  };
}

describe('the captured payload, all the way to a WebSocket subscriber', () => {
  it('delivers 213 readings and 213 retained metadata companions', async () => {
    const broker = await startEmbeddedBroker({ bindHost: '127.0.0.1', mqttPort: 0, wsPort: 0 });
    opened.brokers.push(broker);
    const inbox = await subscribeAll(`ws://127.0.0.1:${broker.wsPort}`);
    const { logger } = silentLogger();

    const report = await runOnePoll(
      { fetchLhmData: () => Promise.resolve(payload), broker, logger, now: () => AT },
      createRelayState(),
    );
    await inbox.waitFor(LHM_FIXTURE_TOPIC_COUNT * 2);

    expect(report.readingsPublished).toBe(LHM_FIXTURE_TOPIC_COUNT);

    const readings = inbox.messages.filter((message) => !message.topic.endsWith('/meta'));
    const metas = inbox.messages.filter((message) => message.topic.endsWith('/meta'));
    expect(readings).toHaveLength(LHM_FIXTURE_TOPIC_COUNT);
    expect(metas).toHaveLength(LHM_FIXTURE_TOPIC_COUNT);
  });

  it('delivers bodies the contract validates, on topics it accepts', async () => {
    const broker = await startEmbeddedBroker({ bindHost: '127.0.0.1', mqttPort: 0, wsPort: 0 });
    opened.brokers.push(broker);
    const inbox = await subscribeAll(`ws://127.0.0.1:${broker.wsPort}`);
    const { logger } = silentLogger();

    await runOnePoll(
      { fetchLhmData: () => Promise.resolve(payload), broker, logger, now: () => AT },
      createRelayState(),
    );
    await inbox.waitFor(LHM_FIXTURE_TOPIC_COUNT * 2);

    for (const message of inbox.messages) {
      const body: unknown = JSON.parse(message.body);
      if (message.topic.endsWith('/meta')) {
        expect(isSensorMeta(body), message.topic).toBe(true);
        expect(isSensorTopic(message.topic.slice(0, -'/meta'.length)), message.topic).toBe(true);
      } else {
        expect(isSensorReading(body), message.topic).toBe(true);
        expect(isSensorTopic(message.topic), message.topic).toBe(true);
      }
    }
  });

  it('delivers the known-null reading as null and the throughput reading in B/s', async () => {
    // The two things the whole exercise turns on, checked on the far side of a socket rather than
    // on the mapper's return value.
    const broker = await startEmbeddedBroker({ bindHost: '127.0.0.1', mqttPort: 0, wsPort: 0 });
    opened.brokers.push(broker);
    const inbox = await subscribeAll(`ws://127.0.0.1:${broker.wsPort}`);
    const { logger } = silentLogger();

    await runOnePoll(
      { fetchLhmData: () => Promise.resolve(payload), broker, logger, now: () => AT },
      createRelayState(),
    );
    await inbox.waitFor(LHM_FIXTURE_TOPIC_COUNT * 2);

    const bodyOf = (topic: string): unknown => {
      const message = inbox.messages.find((candidate) => candidate.topic === topic);
      return message === undefined ? undefined : JSON.parse(message.body);
    };

    // The unpopulated header: present, reporting nothing. `0` would render as a plausible 0 °C.
    expect(bodyOf('sensors/embedded-controller/0/temperature/1')).toEqual({ value: null, at: AT });
    // B/s, not the 6.4 MB/s that `Value` would have given.
    expect(bodyOf('sensors/gpu/0/throughput/0')).toEqual({ value: 6699008, at: AT });
    expect(bodyOf('sensors/embedded-controller/0/temperature/1/meta')).toEqual({
      label: 'T Sensor',
    });
  });

  it('gives the duplicated identifier one topic, carrying the first sensor', async () => {
    const broker = await startEmbeddedBroker({ bindHost: '127.0.0.1', mqttPort: 0, wsPort: 0 });
    opened.brokers.push(broker);
    const inbox = await subscribeAll(`ws://127.0.0.1:${broker.wsPort}`);
    const { logger, lines } = silentLogger();

    await runOnePoll(
      { fetchLhmData: () => Promise.resolve(payload), broker, logger, now: () => AT },
      createRelayState(),
    );
    await inbox.waitFor(LHM_FIXTURE_TOPIC_COUNT * 2);

    const onTheWire = inbox.messages.filter((message) => message.topic === 'sensors/gpu/0/load/3');
    const meta = inbox.messages.find((message) => message.topic === 'sensors/gpu/0/load/3/meta');

    // One message, not two: a subscriber never sees the topic flicker between two unrelated
    // sensors, and the label it receives is the one whose reading it is getting.
    expect(onTheWire).toHaveLength(1);
    expect(JSON.parse(onTheWire[0]?.body ?? 'null')).toEqual({ value: 11.9, at: AT });
    expect(JSON.parse(meta?.body ?? 'null')).toEqual({ label: 'GPU Memory', vendor: 'nvidia' });
    // And the human is told, which is the part that makes this a decision rather than a silent loss.
    expect(lines).toContainEqual(expect.stringContaining('warn:'));
  });

  it('gives a late subscriber the metadata but not a stale reading', async () => {
    // The dashboard's real case: the relay has been up for a while, then a tab opens. Labels
    // arrive immediately from retention; readings arrive on the next poll, never from the past.
    const broker = await startEmbeddedBroker({ bindHost: '127.0.0.1', mqttPort: 0, wsPort: 0 });
    opened.brokers.push(broker);
    const { logger } = silentLogger();
    const state = createRelayState();

    await runOnePoll(
      { fetchLhmData: () => Promise.resolve(payload), broker, logger, now: () => AT },
      state,
    );

    const inbox = await subscribeAll(`ws://127.0.0.1:${broker.wsPort}`);
    await inbox.waitFor(LHM_FIXTURE_TOPIC_COUNT);

    expect(inbox.messages).toHaveLength(LHM_FIXTURE_TOPIC_COUNT);
    expect(inbox.messages.every((message) => message.topic.endsWith('/meta'))).toBe(true);
  });

  it('is typed all the way through: a subscriber can consume it with the contract types', async () => {
    // Not a type-level trick — this is the consumer's actual code path, and if the relay
    // published a shape the contract's guards rejected, `value` would never be read at all.
    const broker = await startEmbeddedBroker({ bindHost: '127.0.0.1', mqttPort: 0, wsPort: 0 });
    opened.brokers.push(broker);
    const inbox = await subscribeAll(`ws://127.0.0.1:${broker.wsPort}`);
    const { logger } = silentLogger();

    await runOnePoll(
      { fetchLhmData: () => Promise.resolve(payload), broker, logger, now: () => AT },
      createRelayState(),
    );
    await inbox.waitFor(LHM_FIXTURE_TOPIC_COUNT * 2);

    const readings = new Map<string, SensorReading>();
    const labels = new Map<string, SensorMeta>();
    for (const message of inbox.messages) {
      const body: unknown = JSON.parse(message.body);
      if (message.topic.endsWith('/meta')) {
        if (isSensorMeta(body)) labels.set(message.topic.slice(0, -'/meta'.length), body);
      } else if (isSensorReading(body)) {
        readings.set(message.topic, body);
      }
    }

    expect(readings.size).toBe(LHM_FIXTURE_TOPIC_COUNT);
    expect(labels.size).toBe(LHM_FIXTURE_TOPIC_COUNT);
    // `temperature/2` because that is where this CPU's temperature indices start in the capture.
    expect(readings.get('sensors/cpu/0/temperature/2')?.value).toBeTypeOf('number');
    expect(labels.get('sensors/cpu/0/temperature/2')?.label).toBe('Core (Tctl/Tdie)');
  });
});

describe('the loop, over the wire', () => {
  it('republishes readings on each tick but metadata only once', async () => {
    const broker = await startEmbeddedBroker({ bindHost: '127.0.0.1', mqttPort: 0, wsPort: 0 });
    opened.brokers.push(broker);
    const inbox = await subscribeAll(`ws://127.0.0.1:${broker.wsPort}`);
    const { logger } = silentLogger();

    let tick = 0;
    const relay = startRelay(60, {
      fetchLhmData: () => Promise.resolve(payload),
      broker,
      logger,
      now: () => {
        tick += 1;
        return AT + tick;
      },
    });
    opened.stops.push(() => relay.stop());

    // Two ticks: 213 metas and 213 readings, then 213 readings alone.
    await inbox.waitFor(LHM_FIXTURE_TOPIC_COUNT * 3);
    await relay.stop();

    const metas = inbox.messages.filter((message) => message.topic.endsWith('/meta'));
    const readings = inbox.messages.filter((message) => !message.topic.endsWith('/meta'));

    expect(metas).toHaveLength(LHM_FIXTURE_TOPIC_COUNT);
    expect(readings.length).toBeGreaterThanOrEqual(LHM_FIXTURE_TOPIC_COUNT * 2);
    // Distinct `at` per tick, which is what a staleness check downstream reads.
    const timestamps = new Set(
      readings.map((message) => (JSON.parse(message.body) as SensorReading).at),
    );
    expect(timestamps.size).toBeGreaterThanOrEqual(2);
  }, 20_000);
});
