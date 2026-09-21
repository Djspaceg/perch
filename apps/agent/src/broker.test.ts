/**
 * The embedded broker, verified by connecting real MQTT clients to it over both transports.
 *
 * This is the file that proves the point of the whole app: a browser can connect straight to
 * this process, with no Mosquitto installed. It binds on port 0 throughout — the OS picks a
 * free port — which is not merely a testing convenience. A Homebrew Mosquitto on this machine
 * holds 9001 on every interface, so a test that asked for the default port would either fail to
 * bind or, worse, pass by talking to *that* broker and prove nothing about this code.
 *
 * `mqtt` is the same client library the browser side uses, over `ws://` here as there.
 */

import { afterEach, describe, expect, it } from 'vitest';
import mqtt, { type MqttClient } from 'mqtt';
import { SENSOR_META_SUFFIX, sensorMetaTopic, sensorTopic } from '@perch/sensor-contract';
import { startEmbeddedBroker, type EmbeddedBroker } from './broker.js';

/** Everything opened during a test, torn down afterwards even when the test fails. */
const opened: { brokers: EmbeddedBroker[]; clients: MqttClient[] } = { brokers: [], clients: [] };

afterEach(async () => {
  for (const client of opened.clients) await client.endAsync(true);
  for (const broker of opened.brokers) await broker.close();
  opened.clients = [];
  opened.brokers = [];
});

/** Start a broker on OS-assigned ports. */
async function startOnFreePorts(): Promise<EmbeddedBroker> {
  const broker = await startEmbeddedBroker({ bindHost: '127.0.0.1', mqttPort: 0, wsPort: 0 });
  opened.brokers.push(broker);

  return broker;
}

async function connect(url: string): Promise<MqttClient> {
  const client = await mqtt.connectAsync(url, { reconnectPeriod: 0, connectTimeout: 4000 });
  opened.clients.push(client);

  return client;
}

/** Wait for `count` messages on an already-subscribed client. */
async function receive(
  client: MqttClient,
  count: number,
): Promise<readonly { topic: string; body: string }[]> {
  const received: { topic: string; body: string }[] = [];

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${received.length} of ${count} messages`));
    }, 5000);

    client.on('message', (topic: string, payload: Buffer) => {
      received.push({ topic, body: payload.toString('utf8') });
      if (received.length >= count) {
        clearTimeout(timer);
        resolve(received);
      }
    });
  });
}

const TEMP_TOPIC = sensorTopic('cpu', 'temperature', { sensorIndex: 3 });
const TEMP_META_TOPIC = sensorMetaTopic('cpu', 'temperature', { sensorIndex: 3 });

describe('listeners', () => {
  it('binds both transports and reports the ports it actually got', async () => {
    const broker = await startOnFreePorts();

    expect(broker.mqttPort).toBeGreaterThan(0);
    expect(broker.wsPort).toBeGreaterThan(0);
    expect(broker.mqttPort).not.toBe(broker.wsPort);
  });

  it('rejects rather than half-starting when a port is taken', async () => {
    const first = await startOnFreePorts();

    // Asking for the port the first broker already holds. The failure names the port, which on
    // this machine is the difference between a one-second fix and an afternoon of confusion.
    await expect(
      startEmbeddedBroker({ bindHost: '127.0.0.1', mqttPort: first.mqttPort, wsPort: 0 }),
    ).rejects.toThrow(/cannot listen on 127\.0\.0\.1/);
  });

  it('leaves nothing listening after a failed start', async () => {
    const first = await startOnFreePorts();

    // The WebSocket listener is requested second, so this failure happens *after* the MQTT one
    // bound. If the cleanup path were missing, that orphan listener would hold its port for the
    // life of the process and the next start would fail for a reason that made no sense.
    await expect(
      startEmbeddedBroker({ bindHost: '127.0.0.1', mqttPort: 0, wsPort: first.wsPort }),
    ).rejects.toThrow();

    // Proof the orphan is gone: a fresh broker starts and works.
    const replacement = await startOnFreePorts();
    const client = await connect(`mqtt://127.0.0.1:${replacement.mqttPort}`);

    expect(client.connected).toBe(true);
  });

  it('is listening on the WebSocket port a browser would use', async () => {
    const broker = await startOnFreePorts();
    const client = await connect(`ws://127.0.0.1:${broker.wsPort}`);

    expect(client.connected).toBe(true);
    expect(broker.clientCount).toBe(1);
  });
});

describe('a reading published by the relay reaches a subscriber', () => {
  it('over native MQTT on TCP', async () => {
    const broker = await startOnFreePorts();
    const client = await connect(`mqtt://127.0.0.1:${broker.mqttPort}`);
    await client.subscribeAsync('sensors/#');
    const inbox = receive(client, 1);

    await broker.publish(TEMP_TOPIC, JSON.stringify({ value: 44, at: 1758000000000 }), {
      retain: false,
    });

    expect(await inbox).toEqual([{ topic: TEMP_TOPIC, body: '{"value":44,"at":1758000000000}' }]);
  });

  it('over MQTT-on-WebSockets, which is the only transport a page can use', async () => {
    const broker = await startOnFreePorts();
    const client = await connect(`ws://127.0.0.1:${broker.wsPort}`);
    await client.subscribeAsync('sensors/#');
    const inbox = receive(client, 1);

    await broker.publish(TEMP_TOPIC, JSON.stringify({ value: 44, at: 1758000000000 }), {
      retain: false,
    });

    const [message] = await inbox;
    expect(message?.topic).toBe(TEMP_TOPIC);
    expect(JSON.parse(message?.body ?? 'null')).toEqual({ value: 44, at: 1758000000000 });
  });

  it('to both transports at once, from one broker and one publish', async () => {
    // Two listeners, one broker: a reading published once is visible on both, and retained state
    // is shared. Two brokers would have been two sources of truth.
    const broker = await startOnFreePorts();
    const tcp = await connect(`mqtt://127.0.0.1:${broker.mqttPort}`);
    const ws = await connect(`ws://127.0.0.1:${broker.wsPort}`);
    await tcp.subscribeAsync('sensors/#');
    await ws.subscribeAsync('sensors/#');
    const both = Promise.all([receive(tcp, 1), receive(ws, 1)]);

    await broker.publish(TEMP_TOPIC, '{"value":44,"at":1}', { retain: false });

    const [fromTcp, fromWs] = await both;
    expect(fromTcp).toEqual(fromWs);
    expect(broker.clientCount).toBe(2);
  });
});

describe('retention', () => {
  it('delivers retained metadata to a subscriber that connects afterwards', async () => {
    // The dashboard's actual case: the relay has been running for an hour, a browser tab opens,
    // and it needs labels immediately rather than never.
    const broker = await startOnFreePorts();

    await broker.publish(TEMP_META_TOPIC, '{"label":"CPU Core #3","vendor":"amd"}', {
      retain: true,
    });

    const late = await connect(`ws://127.0.0.1:${broker.wsPort}`);
    const inbox = receive(late, 1);
    await late.subscribeAsync('sensors/#');

    expect(await inbox).toEqual([
      { topic: TEMP_META_TOPIC, body: '{"label":"CPU Core #3","vendor":"amd"}' },
    ]);
    expect(TEMP_META_TOPIC.endsWith(`/${SENSOR_META_SUFFIX}`)).toBe(true);
  });

  it('does not deliver an unretained reading to a subscriber that connects afterwards', async () => {
    // A retained reading is a stale reading that arrives looking fresh. This is the assertion
    // that says the relay does not create one.
    const broker = await startOnFreePorts();

    await broker.publish(TEMP_TOPIC, '{"value":44,"at":1}', { retain: false });

    const late = await connect(`mqtt://127.0.0.1:${broker.mqttPort}`);
    await late.subscribeAsync('sensors/#');

    await expect(receive(late, 1)).rejects.toThrow(/timed out after 0 of 1/);
  }, 10_000);
});

describe('shutdown', () => {
  it('frees both ports, so a restart is not a race against TIME_WAIT', async () => {
    const broker = await startEmbeddedBroker({ bindHost: '127.0.0.1', mqttPort: 0, wsPort: 0 });
    const { mqttPort, wsPort } = broker;
    await broker.close();

    // Reclaiming the exact same two ports is the proof: if either listener were still open,
    // this would throw.
    const restarted = await startEmbeddedBroker({ bindHost: '127.0.0.1', mqttPort, wsPort });
    opened.brokers.push(restarted);

    expect(restarted.mqttPort).toBe(mqttPort);
    expect(restarted.wsPort).toBe(wsPort);
  });

  it('closes even with clients connected', async () => {
    const broker = await startEmbeddedBroker({ bindHost: '127.0.0.1', mqttPort: 0, wsPort: 0 });
    const tcp = await mqtt.connectAsync(`mqtt://127.0.0.1:${broker.mqttPort}`, {
      reconnectPeriod: 0,
    });
    const ws = await mqtt.connectAsync(`ws://127.0.0.1:${broker.wsPort}`, { reconnectPeriod: 0 });

    // No `opened` registration: closing the broker under live clients is the subject here, and a
    // shutdown that hangs on a connected client is a relay that does not exit on Ctrl-C.
    await expect(broker.close()).resolves.toBeUndefined();

    await tcp.endAsync(true);
    await ws.endAsync(true);
  });
});

describe('no authentication, deliberately', () => {
  it('accepts a client that offers no credentials', async () => {
    // The human's answer was "unrestricted for now". It is a LAN-only posture, recorded here and
    // in DECISIONS.md rather than left to be discovered; `--bind-host` is how it narrows.
    const broker = await startOnFreePorts();
    const client = await connect(`mqtt://127.0.0.1:${broker.mqttPort}`);

    expect(client.connected).toBe(true);
  });

  it('accepts a client that publishes, not only one that subscribes', async () => {
    const broker = await startOnFreePorts();
    const publisher = await connect(`mqtt://127.0.0.1:${broker.mqttPort}`);
    const subscriber = await connect(`ws://127.0.0.1:${broker.wsPort}`);
    await subscriber.subscribeAsync('sensors/#');
    const inbox = receive(subscriber, 1);

    await publisher.publishAsync(TEMP_TOPIC, '{"value":1,"at":1}');

    expect((await inbox)[0]?.topic).toBe(TEMP_TOPIC);
  });
});
