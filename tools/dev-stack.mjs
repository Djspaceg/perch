#!/usr/bin/env node
/**
 * Bring up the whole development stack in one terminal: the relay (which serves its own MQTT
 * broker) and the runtime's Vite dev server.
 *
 * Stdlib only, deliberately. A process runner would be a dependency, and `a & b` in an npm
 * script is a shell feature that does not survive Windows — where the relay is eventually
 * expected to run. `child_process` behaves the same everywhere.
 *
 * Order does not matter to the stack itself: the browser's MQTT source reconnects with backoff
 * and re-subscribes on every CONNECT, and sensor metadata is retained, so labels arrive
 * whenever the relay appears. The relay is started first anyway, so the first page load is
 * already populated.
 */

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline/promises';
import process from 'node:process';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** The relay's defaults, and therefore the ports a pre-existing broker collides with. */
const DEFAULT_PORTS = { mqtt: 1883, ws: 9001 };

/**
 * Who, if anyone, is listening on a port. Returns `{ pid, command }` or null.
 *
 * `lsof` only; there is no portable stdlib way to ask, and this whole check is a courtesy
 * rather than load-bearing — if it cannot answer, the relay's own EADDRINUSE still reports the
 * problem accurately.
 */
function listenerOn(port) {
  const out = spawnSync('lsof', [`-iTCP:${port}`, '-sTCP:LISTEN', '-n', '-P', '-F', 'pc'], {
    encoding: 'utf8',
  });
  if (out.status !== 0 || !out.stdout) return null;
  let pid = null;
  let command = null;
  for (const line of out.stdout.split('\n')) {
    if (line.startsWith('p')) pid = line.slice(1);
    else if (line.startsWith('c')) command = line.slice(1);
  }
  return pid && command ? { pid, command } : null;
}

/** True when Homebrew reports this service as started, so `brew services stop` is the right stop. */
function isBrewService(name) {
  const out = spawnSync('brew', ['services', 'list'], { encoding: 'utf8' });
  if (out.status !== 0 || !out.stdout) return false;
  return out.stdout.split('\n').some((l) => l.startsWith(`${name} `) && l.includes('started'));
}

/**
 * Offer to stop a broker squatting on the relay's default ports.
 *
 * Worth asking rather than just failing: a pre-existing mosquitto is the single most likely
 * reason a first run does not work, and the failure is *quiet* on the browser side — the other
 * broker accepts the connection, accepts the subscriptions, and delivers nothing, so the page
 * looks connected and stays empty.
 *
 * Only ever offered for a process we can name, only when stdin is a TTY, and only when the user
 * has not chosen their own ports. Stopping someone's system service is not something to do
 * unasked or non-interactively.
 */
async function offerToFreePorts() {
  if (process.env.PERCH_MQTT_PORT || process.env.PERCH_WS_PORT) return;

  const clashes = Object.entries(DEFAULT_PORTS)
    .map(([role, port]) => ({ role, port, holder: listenerOn(port) }))
    .filter((c) => c.holder);
  if (clashes.length === 0) return;

  const held = clashes
    .map((c) => `${c.port} (${c.holder.command}, pid ${c.holder.pid})`)
    .join(', ');

  // Only mosquitto is offered; anything else gets reported and left alone, because we cannot
  // know what it is or whether the user wants it gone.
  const mosquitto = clashes.find((c) => c.holder.command.includes('mosquitto'));
  if (!mosquitto) {
    process.stdout.write(`note: something already listens on ${held}. The relay will fail.\n`);
    return;
  }

  if (!process.stdin.isTTY) {
    process.stdout.write(
      `note: mosquitto already holds ${held}, and stdin is not a TTY so I will not ask.\n` +
        `      Stop it, or set PERCH_MQTT_PORT and PERCH_WS_PORT.\n`,
    );
    return;
  }

  const brewManaged = isBrewService('mosquitto');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (
    await rl.question(`mosquitto already holds ${held}. Shall it be stopped? [Y/n] `)
  ).trim();
  rl.close();

  if (answer && !/^y(es)?$/i.test(answer)) {
    process.stdout.write('leaving it alone — set PERCH_MQTT_PORT and PERCH_WS_PORT instead.\n');
    return;
  }

  const stop = brewManaged
    ? spawnSync('brew', ['services', 'stop', 'mosquitto'], { stdio: 'inherit' })
    : spawnSync('kill', [mosquitto.holder.pid], { stdio: 'inherit' });

  if (stop.status !== 0) {
    process.stdout.write('could not stop it; the relay will report the port clash itself.\n');
    return;
  }

  // brew services returns before launchd has released the socket.
  for (let i = 0; i < 20; i++) {
    if (!listenerOn(DEFAULT_PORTS.mqtt) && !listenerOn(DEFAULT_PORTS.ws)) {
      process.stdout.write('stopped; the relay can take its default ports.\n');
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  process.stdout.write('stop was requested but the ports are still held — continuing anyway.\n');
}

/** Distinct, low-saturation prefixes so interleaved output stays readable. */
const TAGS = {
  relay: '\u001b[36mrelay \u001b[0m',
  web: '\u001b[35mweb   \u001b[0m',
};

const children = new Set();
let shuttingDown = false;

/** Spawn a long-lived child, prefixing every line it writes so two streams stay legible. */
function start(name, args) {
  const child = spawn(NPM, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  children.add(child);

  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    let partial = '';
    stream.on('data', (chunk) => {
      const lines = (partial + chunk).split('\n');
      partial = lines.pop() ?? '';
      for (const line of lines) process.stdout.write(`${TAGS[name]}${line}\n`);
    });
  }

  child.on('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    // One side dying leaves a stack that looks alive but cannot work, so take the whole thing
    // down rather than leaving a half-stack to debug.
    process.stdout.write(`${TAGS[name]}exited (${signal ?? code}) — stopping the stack\n`);
    shutdown(typeof code === 'number' && code !== 0 ? code : 1);
  });

  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  // Give SIGTERM a moment; the relay tracks and destroys live sockets on shutdown, which takes
  // a tick, and a browser tab holding a WebSocket used to keep it from exiting at all.
  setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 2000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    process.stdout.write('\nstopping the stack…\n');
    shutdown(0);
  });
}

// Ask before anything is built or started: if the ports are taken the relay cannot run at all,
// and finding that out after a compile is a worse experience than being asked up front.
await offerToFreePorts();

// The relay runs from its build output, so it has to be compiled before it can start. Do this
// in the foreground: starting the dev server first would bury the compiler's errors.
process.stdout.write(`${TAGS.relay}building…\n`);
const build = spawn(NPM, ['run', 'build', '-w', '@perch/agent'], { stdio: 'inherit' });
const [buildCode] = await once(build, 'exit');
if (buildCode !== 0) {
  process.stdout.write('relay build failed — not starting the stack\n');
  process.exit(buildCode ?? 1);
}

if (!process.env.PERCH_BROKER_URL) {
  process.stdout.write(
    'note: PERCH_BROKER_URL is unset, so the page falls back to its built-in default.\n' +
      '      If another broker already holds that port it will accept the connection and\n' +
      '      deliver nothing — the page then looks connected and stays empty.\n',
  );
}

start('relay', ['start', '-w', '@perch/agent']);
start('web', ['run', 'dev', '-w', '@perch/runtime']);
