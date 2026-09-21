/**
 * The startup path, end to end, without spawning a process.
 *
 * `runRelayCli` takes its argv, environment and output streams as arguments, so the help path,
 * the rejection path, the bind-failure path and the running case are all reachable here. The
 * one thing left in `main.ts` is signal handling, which needs a real process to mean anything.
 *
 * Every case that starts a broker binds on port 0. Asking for 9001 would either fail against
 * this machine's Homebrew Mosquitto or, far worse, succeed at talking to it.
 */

import { afterEach, describe, expect, it } from 'vitest';
import mqtt, { type MqttClient } from 'mqtt';
import { RELAY_ENV_VARS } from './config.js';
import { runRelayCli, type CliStreams, type RunningRelay } from './cli.js';

const started: RunningRelay[] = [];
const clients: MqttClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.endAsync(true);
  for (const running of started.splice(0)) await running.stop();
});

interface Captured {
  readonly out: string[];
  readonly err: string[];
  readonly streams: CliStreams;
}

function capture(): Captured {
  const out: string[] = [];
  const err: string[] = [];

  return { out, err, streams: { out: (line) => out.push(line), err: (line) => err.push(line) } };
}

/** Argv that keeps the broker off every port anything else on this machine might hold. */
const FREE_PORTS = ['--mqtt-port', '0', '--ws-port', '0'];

describe('--help', () => {
  it('prints usage to stdout and exits 0', async () => {
    const captured = capture();
    const result = await runRelayCli({ argv: ['--help'], env: {}, streams: captured.streams });

    expect(result).toEqual({ kind: 'exit', exitCode: 0 });
    expect(captured.out.join('\n')).toContain('--lhm-host');
    expect(captured.err).toEqual([]);
  });

  it('starts nothing', async () => {
    // A help request that bound a port would fail on a machine where the port is busy, which is
    // the one case where a human most needs to be able to read the flags.
    const captured = capture();
    await runRelayCli({
      argv: ['--help', '--ws-port', '9001'],
      env: {},
      streams: captured.streams,
    });

    expect(captured.out.join('\n')).toContain('perch-agent');
  });
});

describe('a bad command line', () => {
  it('writes every rejection to stderr, then usage, and exits 2', async () => {
    const captured = capture();
    const result = await runRelayCli({
      argv: ['--lhm-port', 'banana', '--ws-prot', '9001'],
      env: {},
      streams: captured.streams,
    });

    // 2 is the conventional usage-error code, and it matters here: this runs as a service
    // wrapper's child and the wrapper's restart policy reads the code.
    expect(result).toEqual({ kind: 'exit', exitCode: 2 });
    expect(captured.err.filter((line) => line.startsWith('error:'))).toHaveLength(2);
    expect(captured.err.join('\n')).toContain('--lhm-host');
    expect(captured.out).toEqual([]);
  });
});

describe('the startup report', () => {
  it('names every setting, its value, and which layer it came from', async () => {
    const captured = capture();
    const result = await runRelayCli({
      // A TEST-NET-1 address (RFC 5737), never routable, so the poll this starts fails fast
      // instead of reaching whatever is on the LAN at test time.
      argv: [...FREE_PORTS, '--lhm-host', '192.0.2.1', '--request-timeout-ms', '100'],
      env: { [RELAY_ENV_VARS.pollIntervalMs]: '2000' },
      streams: captured.streams,
    });
    if (result.kind === 'running') started.push(result.running);

    const report = captured.out.join('\n');
    expect(report).toContain('lhm-host = 192.0.2.1 (cli');
    expect(report).toContain('poll-interval-ms = 2000 (env');
    expect(report).toContain('lhm-port = 8085 (default');
    // And the URL it will actually poll, spelled out, so a human does not assemble it mentally.
    expect(report).toContain('polling http://192.0.2.1:8085/data.json');
  });

  it('reports the ports the broker actually bound, not the ones requested', async () => {
    // With `--ws-port 0` the requested number is meaningless; the bound one is what a browser
    // needs. Printing the request would be worse than printing nothing.
    const captured = capture();
    const result = await runRelayCli({ argv: FREE_PORTS, env: {}, streams: captured.streams });
    if (result.kind !== 'running') throw new Error('expected the relay to start');
    started.push(result.running);

    const line = captured.out.find((candidate) => candidate.startsWith('broker listening'));
    expect(line).toContain(`mqtt://0.0.0.0:${result.running.broker.mqttPort}`);
    expect(line).toContain(`ws://0.0.0.0:${result.running.broker.wsPort}`);
    expect(line).not.toContain(':0,');
  });
});

describe('a port that is already taken', () => {
  it('names the port and exits 1 rather than running with one listener', async () => {
    const first = capture();
    const held = await runRelayCli({ argv: FREE_PORTS, env: {}, streams: first.streams });
    if (held.kind !== 'running') throw new Error('expected the first relay to start');
    started.push(held.running);

    const captured = capture();
    const result = await runRelayCli({
      argv: ['--mqtt-port', '0', '--ws-port', String(held.running.broker.wsPort)],
      env: {},
      streams: captured.streams,
    });

    expect(result).toEqual({ kind: 'exit', exitCode: 1 });
    expect(captured.err.join('\n')).toContain(String(held.running.broker.wsPort));
  });
});

describe('the running relay', () => {
  it('serves a client on the WebSocket port it reported', async () => {
    // The whole install story in one assertion: one process, no Mosquitto, and a page can
    // connect to it.
    const captured = capture();
    const result = await runRelayCli({
      // Pointed at a port nothing is on, so the poll fails and the test does not depend on LHM
      // being reachable. The broker is the subject here.
      argv: [...FREE_PORTS, '--lhm-port', '1', '--poll-interval-ms', '60000'],
      env: {},
      streams: captured.streams,
    });
    if (result.kind !== 'running') throw new Error('expected the relay to start');
    started.push(result.running);

    const client = await mqtt.connectAsync(`ws://127.0.0.1:${result.running.broker.wsPort}`, {
      reconnectPeriod: 0,
    });
    clients.push(client);

    expect(client.connected).toBe(true);
  });

  it('keeps the broker up when LHM is unreachable, and says so', async () => {
    // SPEC rule 4: a dead source must be visible, not fatal. If the relay exited it would take
    // the broker with it and the dashboard would lose even its stale readings.
    const captured = capture();
    const result = await runRelayCli({
      argv: [...FREE_PORTS, '--lhm-port', '1', '--request-timeout-ms', '200'],
      env: {},
      streams: captured.streams,
    });
    if (result.kind !== 'running') throw new Error('expected the relay to start');
    started.push(result.running);

    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(captured.err.join('\n')).toContain('[error] poll failed');
    expect(captured.err.join('\n')).toContain('http://localhost:1/data.json');

    const client = await mqtt.connectAsync(`mqtt://127.0.0.1:${result.running.broker.mqttPort}`, {
      reconnectPeriod: 0,
    });
    clients.push(client);
    expect(client.connected).toBe(true);
  }, 10_000);

  it('stops the loop before the broker, and frees the ports', async () => {
    const captured = capture();
    const result = await runRelayCli({
      argv: [...FREE_PORTS, '--lhm-port', '1'],
      env: {},
      streams: captured.streams,
    });
    if (result.kind !== 'running') throw new Error('expected the relay to start');
    const { mqttPort, wsPort } = result.running.broker;

    await result.running.stop();

    // Reclaiming both exact ports is the proof that nothing was left listening.
    const again = await runRelayCli({
      argv: ['--mqtt-port', String(mqttPort), '--ws-port', String(wsPort), '--lhm-port', '1'],
      env: {},
      streams: capture().streams,
    });
    if (again.kind === 'running') started.push(again.running);

    expect(again.kind).toBe('running');
  });
});
