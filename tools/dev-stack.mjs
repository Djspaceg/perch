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

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

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
