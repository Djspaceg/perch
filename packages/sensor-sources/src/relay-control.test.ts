/**
 * The relay control: the editor telling the relay which LibreHardwareMonitor host to poll, and the
 * relay saying whether that poll is working.
 *
 * Against a real in-process broker, with a second plain MQTT client standing in for the relay, so
 * the assertions are about what actually crosses the wire rather than about a stub being called.
 */

import { afterEach, describe, expect, it } from 'vitest';
import mqtt, { type MqttClient } from 'mqtt';
import { startTestBroker, type TestBroker } from './mqtt-broker.test-support.js';
import {
  RELAY_LHM_REQUEST_TOPIC,
  RELAY_LHM_STATUS_TOPIC,
  createRelayControl,
  isLhmHost,
  isRelayLhmRequest,
  isRelayLhmStatus,
  relayStatusMatches,
  type RelayControl,
} from './relay-control.js';

const opened: { brokers: TestBroker[]; clients: MqttClient[]; controls: RelayControl[] } = {
  brokers: [],
  clients: [],
  controls: [],
};

afterEach(async () => {
  for (const control of opened.controls.splice(0)) await control.close();
  for (const client of opened.clients.splice(0)) await client.endAsync(true);
  for (const broker of opened.brokers.splice(0)) await broker.stop();
});

async function broker(port?: number): Promise<TestBroker> {
  const started = await startTestBroker({ port });
  opened.brokers.push(started);
  return started;
}

function control(url: string): RelayControl {
  const made = createRelayControl({ url, reconnectDelayMs: 50, logger: { warn: () => undefined } });
  opened.controls.push(made);
  return made;
}

/** A plain client playing the relay: collects what the editor asks for. */
async function fakeRelay(url: string): Promise<{ client: MqttClient; requests: unknown[] }> {
  const client = await mqtt.connectAsync(url, { protocolVersion: 4 });
  opened.clients.push(client);
  const requests: unknown[] = [];
  client.on('message', (topic, payload) => {
    if (topic === RELAY_LHM_REQUEST_TOPIC) requests.push(JSON.parse(payload.toString()));
  });
  await client.subscribeAsync(RELAY_LHM_REQUEST_TOPIC, { qos: 1 });
  return { client, requests };
}

async function eventually(check: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('the control topics', () => {
  it('live outside the sensors/ tree, so no sensor subscription can match them', () => {
    expect(RELAY_LHM_REQUEST_TOPIC).toBe('perch/relay/lhm/request');
    expect(RELAY_LHM_STATUS_TOPIC).toBe('perch/relay/lhm/status');
  });
});

describe('isLhmHost', () => {
  it('accepts names, dotted addresses and bracketed IPv6', () => {
    for (const host of ['localhost', 'desk.local', '192.168.1.3', 'sensor-pc', '[::1]']) {
      expect(isLhmHost(host), host).toBe(true);
    }
  });

  it('refuses anything that would change the URL the relay fetches', () => {
    for (const host of ['', ' ', 'a b', 'evil.com/x', 'a?b', 'a#b', 'user@host', 'h:8085', '::1']) {
      expect(isLhmHost(host), host).toBe(false);
    }
  });
});

describe('isRelayLhmRequest', () => {
  it('takes a host, with or without a port', () => {
    expect(isRelayLhmRequest({ host: 'localhost' })).toBe(true);
    expect(isRelayLhmRequest({ host: '192.168.1.3', port: 8085 })).toBe(true);
  });

  it('refuses a bad host or a port outside 1-65535', () => {
    expect(isRelayLhmRequest({ host: '' })).toBe(false);
    expect(isRelayLhmRequest({ host: 'a/b' })).toBe(false);
    expect(isRelayLhmRequest({ host: 'h', port: 0 })).toBe(false);
    expect(isRelayLhmRequest({ host: 'h', port: 65536 })).toBe(false);
    expect(isRelayLhmRequest({ host: 'h', port: 80.5 })).toBe(false);
    expect(isRelayLhmRequest(null)).toBe(false);
  });
});

describe('isRelayLhmStatus', () => {
  it('takes each of the three states, with an optional reason', () => {
    expect(isRelayLhmStatus({ host: 'h', port: 8085, state: 'polling' })).toBe(true);
    expect(isRelayLhmStatus({ host: 'h', port: 8085, state: 'ok' })).toBe(true);
    expect(
      isRelayLhmStatus({ host: 'h', port: 8085, state: 'failed', reason: 'EHOSTUNREACH' }),
    ).toBe(true);
  });

  it('refuses an unknown state or a non-string reason', () => {
    expect(isRelayLhmStatus({ host: 'h', port: 8085, state: 'live' })).toBe(false);
    expect(isRelayLhmStatus({ host: 'h', port: 8085, state: 'failed', reason: 7 })).toBe(false);
    expect(isRelayLhmStatus({ host: 'h', state: 'ok' })).toBe(false);
  });
});

describe('relayStatusMatches', () => {
  it('matches a request with no port against whatever port the relay filled in', () => {
    expect(
      relayStatusMatches({ host: 'localhost' }, { host: 'localhost', port: 28085, state: 'ok' }),
    ).toBe(true);
  });

  it('compares hosts case-insensitively and ports exactly', () => {
    const status = { host: 'Desk.Local', port: 8085, state: 'ok' } as const;
    expect(relayStatusMatches({ host: 'desk.local', port: 8085 }, status)).toBe(true);
    expect(relayStatusMatches({ host: 'desk.local', port: 8086 }, status)).toBe(false);
    expect(relayStatusMatches({ host: 'other', port: 8085 }, status)).toBe(false);
  });
});

describe('createRelayControl', () => {
  it('sends the request once the link is up, even when asked before it was', async () => {
    const server = await broker();
    const relay = await fakeRelay(server.url);
    const made = control(server.url);

    made.request({ host: '192.168.1.3', port: 8085 });
    await eventually(() => relay.requests.length > 0, 'the request');

    expect(relay.requests).toEqual([{ host: '192.168.1.3', port: 8085 }]);
    expect(made.link).toBe('up');
  });

  it('receives the retained status the relay published before the editor connected', async () => {
    const server = await broker();
    await server.publishRaw(
      RELAY_LHM_STATUS_TOPIC,
      JSON.stringify({ host: 'localhost', port: 28085, state: 'ok' }),
      { retain: true, qos: 1 },
    );
    const made = control(server.url);
    let changes = 0;
    made.onChange(() => {
      changes += 1;
    });

    await eventually(() => made.status !== undefined, 'the status');

    expect(made.status).toEqual({ host: 'localhost', port: 28085, state: 'ok' });
    expect(changes).toBeGreaterThan(0);
  });

  it('ignores a status body that is not one, keeping the last good one', async () => {
    const server = await broker();
    const made = control(server.url);
    await eventually(() => made.link === 'up', 'the link');
    await server.publishRaw(
      RELAY_LHM_STATUS_TOPIC,
      JSON.stringify({ host: 'h', port: 1, state: 'failed', reason: 'ECONNREFUSED' }),
      { qos: 1 },
    );
    await eventually(() => made.status?.state === 'failed', 'the failed status');

    await server.publishRaw(RELAY_LHM_STATUS_TOPIC, '{"state":"nonsense"}', { qos: 1 });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(made.status).toEqual({ host: 'h', port: 1, state: 'failed', reason: 'ECONNREFUSED' });
  });

  it('reports the link down when the relay goes away, and re-sends the request when it returns', async () => {
    const first = await broker();
    const made = control(first.url);
    made.request({ host: 'localhost' });
    await eventually(() => made.link === 'up', 'the link');

    const port = first.port;
    await first.stop();
    opened.brokers.splice(opened.brokers.indexOf(first), 1);
    await eventually(() => made.link === 'down', 'the drop');

    const second = await broker(port);
    const relay = await fakeRelay(second.url);
    await eventually(() => relay.requests.length > 0, 'the re-sent request', 5000);

    expect(relay.requests).toEqual([{ host: 'localhost' }]);
  });

  it('refuses a request its own guard would refuse, rather than sending it', () => {
    const made = control('ws://127.0.0.1:1');
    expect(() => {
      made.request({ host: 'a b' });
    }).toThrow(/host/);
  });
});
