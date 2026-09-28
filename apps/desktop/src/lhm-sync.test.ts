/**
 * The LHM host, between the editor and the runner: the editor starts on the host the relay is
 * polling, and a host the editor switches the relay to is what the runner resumes with.
 *
 * Against a real relay on ephemeral loopback ports, with the request published in process exactly as
 * a client's would arrive, and the runner's own settings store on a temporary file.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LHM_REQUEST_TOPIC } from '@perch/agent';
import { afterEach, describe, expect, it } from 'vitest';
import { relayTarget } from './lhm-sync.js';
import { desktopRelayConfig, startDesktopRelay, type DesktopRelay } from './relay-host.js';
import { createSettingsStore, readSettings } from './settings.js';

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

let folder: string | undefined;
let relay: DesktopRelay | undefined;

afterEach(async () => {
  await relay?.service.stop();
  relay = undefined;
  if (folder !== undefined) await rm(folder, { recursive: true, force: true });
  folder = undefined;
});

async function start(remembered: { host: string; port: number } | null) {
  folder = await mkdtemp(join(tmpdir(), 'perch-lhm-sync-'));
  const file = join(folder, 'perch-desktop.json');
  const settings = createSettingsStore(file);
  await settings.load();
  const base = desktopRelayConfig({}, remembered);
  // Ephemeral ports: this test must never take 1883 or 9001 from anything on the machine.
  const config = { ...base, broker: { ...base.broker, mqttPort: 0, wsPort: 0 } };
  const writes: Promise<void>[] = [];
  relay = await startDesktopRelay(config, quiet, (endpoint) => {
    writes.push(settings.update({ lhm: endpoint }));
  });

  return { file, relay, writes };
}

describe('relayTarget', () => {
  it('is the host being polled and the port a bare "localhost" request means', async () => {
    const { relay: started } = await start(null);

    expect(relayTarget(started.service)).toEqual({
      host: 'localhost',
      port: 8085,
      defaultPort: 8085,
    });
  });

  it('starts from the remembered host', async () => {
    const { relay: started } = await start({ host: '192.0.2.7', port: 9999 });

    expect(relayTarget(started.service)).toEqual({
      host: '192.0.2.7',
      port: 9999,
      defaultPort: 9999,
    });
  });
});

describe('a host the editor asks for', () => {
  it('moves the relay, and is written to the runner settings for the next launch', async () => {
    const { file, relay: started, writes } = await start(null);

    await started.service.broker.publish(
      LHM_REQUEST_TOPIC,
      JSON.stringify({ host: '192.0.2.9', port: 8086 }),
      { retain: false },
    );
    await expect.poll(() => writes.length).toBe(1);
    await Promise.all(writes);

    expect(relayTarget(started.service)).toMatchObject({ host: '192.0.2.9', port: 8086 });
    expect((await readSettings(file)).settings.lhm).toEqual({ host: '192.0.2.9', port: 8086 });
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      lhm: { host: '192.0.2.9', port: 8086 },
    });
  });

  it('writes nothing when the editor asks for the host already being polled', async () => {
    const { relay: started, writes } = await start({ host: '192.0.2.7', port: 9999 });

    await started.service.broker.publish(
      LHM_REQUEST_TOPIC,
      JSON.stringify({ host: '192.0.2.7', port: 9999 }),
      { retain: false },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(writes).toHaveLength(0);
  });
});
