/**
 * `startRelayService`: the relay as a library, for a host that embeds it in its own process.
 *
 * Every case binds on port 0 or on a port this test holds itself. Asking for 9001 would either
 * fail against this machine's Homebrew Mosquitto or, far worse, succeed at talking to it.
 */

import { createConnection, createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import mqtt, { type MqttClient } from 'mqtt';
import { RELAY_DEFAULTS, type RelayConfig } from './config.js';
import { LHM_REQUEST_TOPIC } from './lhm-control.js';
import type { RelayLogger } from './relay.js';
import { startRelayService, type RelayService } from './service.js';

const started: RelayService[] = [];
const clients: MqttClient[] = [];
const holders: Server[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.endAsync(true);
  for (const service of started.splice(0)) await service.stop();
  for (const holder of holders.splice(0)) {
    await new Promise<void>((resolve) =>
      holder.close(() => {
        resolve();
      }),
    );
  }
});

/** Nothing listens on 127.0.0.1:9 on a developer machine, so every poll fails fast. */
function configWith(broker: Partial<RelayConfig['broker']>): RelayConfig {
  return {
    ...RELAY_DEFAULTS,
    lhm: { host: '127.0.0.1', port: 9 },
    broker: { bindHost: '127.0.0.1', mqttPort: 0, wsPort: 0, ...broker },
    requestTimeoutMs: 200,
  };
}

function quietLogger(): RelayLogger & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (message) => lines.push(`info ${message}`),
    warn: (message) => lines.push(`warn ${message}`),
    error: (message) => lines.push(`error ${message}`),
  };
}

async function start(
  options: Omit<Parameters<typeof startRelayService>[0], 'logger'> & { logger?: RelayLogger },
): Promise<RelayService> {
  const service = await startRelayService({ logger: quietLogger(), ...options });
  started.push(service);
  return service;
}

/** Hold a port on 127.0.0.1, the way a Mosquitto would. Resolves the port. */
async function holdPort(): Promise<number> {
  const holder = createServer();
  holders.push(holder);
  await new Promise<void>((resolve) =>
    holder.listen(0, '127.0.0.1', () => {
      resolve();
    }),
  );
  const address = holder.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

describe('startRelayService', () => {
  it('returns the ports it actually bound', async () => {
    const service = await start({ config: configWith({}) });

    expect(service.mqttPort).toBeGreaterThan(0);
    expect(service.wsPort).toBeGreaterThan(0);
    expect(service.mqttPort).not.toBe(service.wsPort);
    expect(await canConnect(service.mqttPort)).toBe(true);
    expect(await canConnect(service.wsPort)).toBe(true);
  });

  it('stops cleanly: both listeners are closed once stop resolves', async () => {
    const service = await startRelayService({ config: configWith({}), logger: quietLogger() });
    const { mqttPort, wsPort } = service;

    await service.stop();

    expect(await canConnect(mqttPort)).toBe(false);
    expect(await canConnect(wsPort)).toBe(false);
  });

  it('stops cleanly with a client still connected', async () => {
    const service = await startRelayService({ config: configWith({}), logger: quietLogger() });
    const client = await mqtt.connectAsync(`mqtt://127.0.0.1:${service.mqttPort}`);
    clients.push(client);

    await expect(service.stop()).resolves.toBeUndefined();
  });

  it('refuses a held port by default, as the CLI does', async () => {
    const held = await holdPort();

    await expect(
      startRelayService({ config: configWith({ wsPort: held }), logger: quietLogger() }),
    ).rejects.toThrow(/EADDRINUSE/);
  });

  it('binds a free port instead of a held one when asked to, and says so', async () => {
    const heldMqtt = await holdPort();
    const heldWs = await holdPort();
    const logger = quietLogger();

    const service = await start({
      config: configWith({ mqttPort: heldMqtt, wsPort: heldWs }),
      freePortWhenHeld: true,
      logger,
    });

    expect(service.mqttPort).not.toBe(heldMqtt);
    expect(service.wsPort).not.toBe(heldWs);
    expect(await canConnect(service.wsPort)).toBe(true);
    expect(logger.lines.join('\n')).toContain(`port ${heldWs} was in use`);
  });

  it('keeps the free port it was given when the configured one is free', async () => {
    const free = await holdPort();
    await new Promise<void>((resolve) =>
      holders.pop()?.close(() => {
        resolve();
      }),
    );

    const service = await start({ config: configWith({ wsPort: free }), freePortWhenHeld: true });

    expect(service.wsPort).toBe(free);
  });

  it('keeps the control topic working, and reports a retarget', async () => {
    const retargets: unknown[] = [];
    const service = await start({
      config: configWith({}),
      onRetarget: (endpoint) => retargets.push(endpoint),
    });
    const client = await mqtt.connectAsync(`mqtt://127.0.0.1:${service.mqttPort}`);
    clients.push(client);

    await client.publishAsync(LHM_REQUEST_TOPIC, JSON.stringify({ host: '127.0.0.2' }), { qos: 1 });
    await expect.poll(() => retargets).toEqual([{ host: '127.0.0.2', port: 9 }]);
    expect(service.control.endpoint).toEqual({ host: '127.0.0.2', port: 9 });
  });
});
