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
import { portInUseGuidance, startEmbeddedBroker, suggestedListenPort } from './broker.js';
import type { EmbeddedBroker } from './broker.js';
import {
  DASHBOARD_BROKER_URL_ENV_VAR,
  RELAY_CLI_FLAGS,
  RELAY_DEFAULTS,
  RELAY_ENV_VARS,
} from './config.js';

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

/**
 * The first failure anyone with Mosquitto installed hits, so the message is part of the product.
 *
 * "cannot listen on 0.0.0.0:1883" names the port and stops there, which leaves the reader to
 * discover on their own that the port is configurable and what the setting is called. Every test
 * below asserts a *way out* is printed, not merely a diagnosis.
 */
describe('a port that is already taken', () => {
  /** The message from a start that collided, whichever listener collided. */
  async function failureMessage(address: {
    readonly mqttPort: number;
    readonly wsPort: number;
  }): Promise<string> {
    try {
      const broker = await startEmbeddedBroker({ bindHost: '127.0.0.1', ...address });
      opened.brokers.push(broker);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }

    throw new Error('expected the start to fail, but it bound both listeners');
  }

  it('carries the MQTT guidance when the MQTT listener is the one that collided', async () => {
    const first = await startOnFreePorts();
    const message = await failureMessage({ mqttPort: first.mqttPort, wsPort: 0 });

    expect(message).toContain(`cannot listen on 127.0.0.1:${first.mqttPort}`);
    // Asserted against the guidance for *this* setting: a message that pasted in the WebSocket
    // advice would name the wrong flag, the wrong variable and the wrong port, and would still
    // contain the word "port".
    expect(message).toContain(portInUseGuidance('mqttPort', first.mqttPort));
  });

  it('carries the WebSocket guidance when the WebSocket listener is the one that collided', async () => {
    const first = await startOnFreePorts();
    const message = await failureMessage({ mqttPort: 0, wsPort: first.wsPort });

    expect(message).toContain(`cannot listen on 127.0.0.1:${first.wsPort}`);
    expect(message).toContain(portInUseGuidance('wsPort', first.wsPort));
  });

  it('says nothing about ports when the failure was not a collision', async () => {
    // Binding an address this host does not have fails with EADDRNOTAVAIL. Advice to change the
    // port would be confidently wrong, and wrong advice costs more than none.
    await expect(
      startEmbeddedBroker({ bindHost: '203.0.113.1', mqttPort: 0, wsPort: 0 }),
    ).rejects.toThrow(/cannot listen on 203\.0\.113\.1:0(?!.*--mqtt-port)/s);
  });
});

/**
 * The guidance text itself, checked at the default ports — the case that actually happens.
 *
 * Kept separate from the tests above because those collide on OS-assigned ports, and an
 * ephemeral port near the top of the range has no `+10000` suggestion to print. The pure
 * function is where the wording is pinned down.
 */
describe('the way out printed with a port collision', () => {
  it('names the flag, the variable and a port to move to', () => {
    const guidance = portInUseGuidance('mqttPort', RELAY_DEFAULTS.broker.mqttPort);

    expect(guidance).toContain('1883');
    // A number to type, not merely the news that the port is configurable.
    expect(guidance).toContain(`--${RELAY_CLI_FLAGS.mqttPort} 11883`);
    expect(guidance).toContain(`${RELAY_ENV_VARS.mqttPort}=11883`);
    expect(guidance).toContain(`--${RELAY_CLI_FLAGS.mqttPort} 0`);
    // The default stays 1883; the message has to say why it is not the thing being changed.
    expect(guidance).toMatch(/registered MQTT port/);
  });

  it('tells a WebSocket collision to move the dashboard with it', () => {
    const guidance = portInUseGuidance('wsPort', RELAY_DEFAULTS.broker.wsPort);

    expect(guidance).toContain(`--${RELAY_CLI_FLAGS.wsPort} 19001`);
    expect(guidance).toContain(`${RELAY_ENV_VARS.wsPort}=19001`);
    // Moving this listener silently breaks the browser, which dials the port it was told to.
    // A message that omitted this would trade one afternoon of confusion for another.
    expect(guidance).toContain(`${DASHBOARD_BROKER_URL_ENV_VAR}=ws://localhost:19001`);
  });

  it('does not tell the MQTT case to change the dashboard URL, which it has nothing to do with', () => {
    expect(portInUseGuidance('mqttPort', 1883)).not.toContain(DASHBOARD_BROKER_URL_ENV_VAR);
  });

  it('degrades to port 0 rather than suggesting a port number that cannot exist', () => {
    // 65535 + 10000 is not a port. The suggestion has to fall back to the one answer that is
    // always available instead of printing an impossible number.
    expect(suggestedListenPort(65_535)).toBe(0);
    expect(suggestedListenPort(1883)).toBe(11_883);
    expect(suggestedListenPort(9001)).toBe(19_001);
  });

  it('prints no numeric suggestion at all when there is no valid one to print', () => {
    const guidance = portInUseGuidance('wsPort', 60_000);

    expect(guidance).toContain(`--${RELAY_CLI_FLAGS.wsPort} 0`);
    // Not `ws://localhost:0`, which is not an address a browser can dial.
    expect(guidance).not.toContain('localhost:0');
    // It still has to say the dashboard follows the port, because it still does.
    expect(guidance).toContain(DASHBOARD_BROKER_URL_ENV_VAR);
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
