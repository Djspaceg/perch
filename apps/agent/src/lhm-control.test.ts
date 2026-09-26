/**
 * The one control path: a client asks the relay to poll another LHM host, and the relay reports
 * whether that poll is working, retained, on the status topic.
 *
 * End to end where it matters — the real embedded broker, the real poll loop, a real MQTT client on
 * WebSockets — with the HTTP fetch replaced per host, so "the host is up", "the host is unreachable"
 * and "the host answers with something that is not LHM" are each one line.
 */

import { afterEach, describe, expect, it } from 'vitest';
import mqtt, { type MqttClient } from 'mqtt';
import { startEmbeddedBroker, type EmbeddedBroker } from './broker.js';
import type { LhmEndpoint } from './config.js';
import { LhmRequestError, type LhmDataFetcher } from './lhm-client.js';
import {
  LHM_REQUEST_TOPIC,
  LHM_STATUS_TOPIC,
  parseLhmRequest,
  startLhmControl,
  type LhmControl,
} from './lhm-control.js';
import { loadLhmFixturePayload } from './lhm-fixture.test-support.js';
import { startRelay, type RelayHandle, type RelayLogger } from './relay.js';

const payload = loadLhmFixturePayload();

const opened: { brokers: EmbeddedBroker[]; clients: MqttClient[]; stops: (() => Promise<void>)[] } =
  { brokers: [], clients: [], stops: [] };

afterEach(async () => {
  for (const stop of opened.stops.splice(0)) await stop();
  for (const client of opened.clients.splice(0)) await client.endAsync(true);
  for (const broker of opened.brokers.splice(0)) await broker.close();
});

const quiet: RelayLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** Each host behaves as its name says. */
function fetcherFor(endpoint: LhmEndpoint): LhmDataFetcher {
  const url = `http://${endpoint.host}:${endpoint.port}/data.json`;
  if (endpoint.host.startsWith('up')) return () => Promise.resolve(payload);
  if (endpoint.host.startsWith('empty')) return () => Promise.resolve({ Children: [] });
  return () =>
    Promise.reject(
      new LhmRequestError(url, 'fetch failed (connect EHOSTUNREACH)', undefined, 'EHOSTUNREACH'),
    );
}

async function stack(initial: LhmEndpoint): Promise<{ url: string; control: LhmControl }> {
  const broker = await startEmbeddedBroker({ bindHost: '127.0.0.1', mqttPort: 0, wsPort: 0 });
  opened.brokers.push(broker);

  const loopRef: { current?: RelayHandle } = {};
  const control = await startLhmControl({
    broker,
    initial,
    defaultPort: 8085,
    fetcherFor,
    retarget: (fetcher) => {
      loopRef.current?.retarget(fetcher);
    },
    logger: quiet,
  });
  const relay = startRelay(40, {
    fetchLhmData: fetcherFor(initial),
    broker,
    logger: quiet,
    now: () => Date.now(),
    onPoll: (report) => {
      control.onPoll(report);
    },
  });
  loopRef.current = relay;
  opened.stops.push(async () => {
    await relay.stop();
    await control.stop();
  });

  return { url: `ws://127.0.0.1:${broker.wsPort}`, control };
}

async function client(url: string): Promise<MqttClient> {
  const made = await mqtt.connectAsync(url, { protocolVersion: 4 });
  opened.clients.push(made);
  return made;
}

/** Every status body the client sees, in order. */
async function statuses(url: string): Promise<{ client: MqttClient; seen: unknown[] }> {
  const made = await client(url);
  const seen: unknown[] = [];
  made.on('message', (topic, body) => {
    if (topic === LHM_STATUS_TOPIC && body.length > 0) seen.push(JSON.parse(body.toString()));
  });
  await made.subscribeAsync(LHM_STATUS_TOPIC, { qos: 1 });
  return { client: made, seen };
}

async function eventually(check: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const last = (seen: unknown[]): unknown => seen.at(-1);

/** The last status's `state` and `host`, for waiting on. */
function lastField(seen: unknown[], field: 'state' | 'host'): string | undefined {
  const body = seen.at(-1) as { state?: string; host?: string } | undefined;
  return body?.[field];
}

describe('parseLhmRequest', () => {
  it('fills a missing port from the relay’s own configured one', () => {
    expect(parseLhmRequest('{"host":"localhost"}', 28085)).toEqual({
      host: 'localhost',
      port: 28085,
    });
    expect(parseLhmRequest('{"host":"192.168.1.3","port":8085}', 28085)).toEqual({
      host: '192.168.1.3',
      port: 8085,
    });
  });

  it('refuses anything that could change the URL beyond host and port', () => {
    for (const body of [
      '',
      'not json',
      '{}',
      '{"host":""}',
      '{"host":"a b"}',
      '{"host":"evil.com/x?"}',
      '{"host":"user@h"}',
      '{"host":"h","port":0}',
      '{"host":"h","port":"8085"}',
    ]) {
      expect(parseLhmRequest(body, 8085), body).toBeNull();
    }
  });
});

describe('startLhmControl', () => {
  it('publishes the starting host as ok once the first poll lands, retained', async () => {
    const { url } = await stack({ host: 'up-local', port: 28085 });
    const { seen } = await statuses(url);

    await eventually(() => lastField(seen, 'state') === 'ok', 'ok');
    expect(last(seen)).toEqual({ host: 'up-local', port: 28085, state: 'ok' });
  });

  it('switches host on request: polling first, then failed with the fetch’s short reason', async () => {
    const { url, control } = await stack({ host: 'up-local', port: 28085 });
    const { client: editor, seen } = await statuses(url);
    await eventually(() => lastField(seen, 'state') === 'ok', 'ok');

    await editor.publishAsync(LHM_REQUEST_TOPIC, JSON.stringify({ host: 'down-pc', port: 8085 }));

    await eventually(() => lastField(seen, 'state') === 'failed', 'failed');
    expect(seen).toContainEqual({ host: 'down-pc', port: 8085, state: 'polling' });
    expect(last(seen)).toEqual({
      host: 'down-pc',
      port: 8085,
      state: 'failed',
      reason: 'EHOSTUNREACH',
    });
    expect(control.endpoint).toEqual({ host: 'down-pc', port: 8085 });
  });

  it('says so when the host answers but publishes no sensors, rather than calling that ok', async () => {
    const { url } = await stack({ host: 'up-local', port: 28085 });
    const { client: editor, seen } = await statuses(url);

    await editor.publishAsync(LHM_REQUEST_TOPIC, JSON.stringify({ host: 'empty-box' }));

    await eventually(
      () => lastField(seen, 'state') === 'failed' && lastField(seen, 'host') === 'empty-box',
      'failed on empty',
    );
    expect(last(seen)).toMatchObject({ host: 'empty-box', port: 8085, state: 'failed' });
    expect((last(seen) as { reason: string }).reason).toMatch(/no LHM sensors/);
  });

  it('publishes a status only when it changes, not once per poll', async () => {
    const { url } = await stack({ host: 'up-local', port: 28085 });
    const { seen } = await statuses(url);
    await eventually(() => seen.length > 0, 'a status');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(seen).toEqual([{ host: 'up-local', port: 28085, state: 'ok' }]);
  });

  it('withdraws the previous host’s retained metadata when the host changes', async () => {
    const { url } = await stack({ host: 'up-local', port: 28085 });
    const { client: editor, seen } = await statuses(url);
    await eventually(() => lastField(seen, 'state') === 'ok', 'ok');

    await editor.publishAsync(LHM_REQUEST_TOPIC, JSON.stringify({ host: 'down-pc' }));
    await eventually(() => lastField(seen, 'state') === 'failed', 'failed');

    const late = await client(url);
    const metas: string[] = [];
    late.on('message', (topic, body) => {
      if (body.length > 0) metas.push(topic);
    });
    await late.subscribeAsync('sensors/+/+/+/+/meta', { qos: 1 });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(metas).toEqual([]);
  });

  it('ignores a malformed request and keeps polling what it was', async () => {
    const { url, control } = await stack({ host: 'up-local', port: 28085 });
    const editor = await client(url);

    await editor.publishAsync(LHM_REQUEST_TOPIC, '{"host":"evil.com/x?"}');
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(control.endpoint).toEqual({ host: 'up-local', port: 28085 });
  });
});
