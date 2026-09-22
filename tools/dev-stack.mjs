#!/usr/bin/env node
/**
 * Bring up the development stack in one terminal, and say where to go.
 *
 * Two servers, always: the **editor** on 5402 and the **runtime** on 5173. They are one command
 * because they are one loop — the editor's save endpoint writes the real `layouts/<name>.json` and
 * the runtime's dev server watches it, so authoring a layout and seeing it render is a save and a
 * glance at the other tab. Running them from two terminals was the previous arrangement and the
 * save endpoint only exists under `npm run dev`, which made "the editor cannot save" a thing you
 * could arrange by accident. Relay third, and only when something would read it; see `decideRelay`.
 *
 * Stdlib only, deliberately. A process runner would be a dependency, and `a & b` in an npm script
 * is a shell feature that does not survive Windows — where the relay is eventually expected to run.
 * `child_process` behaves the same everywhere.
 *
 * Order does not matter to the stack itself: the browser's MQTT source reconnects with backoff and
 * re-subscribes on every CONNECT, and sensor metadata is retained, so labels arrive whenever the
 * relay appears. The relay is started first anyway, so the first page load is already populated.
 *
 * Everything this file decides *before* spawning — argument parsing, whether the relay has a
 * reader, the wording of every message — lives in `dev-startup.mjs`, which is importable and
 * tested. What is left here is the part that needs a socket or a child process.
 */

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { get } from 'node:http';
import { createConnection, createServer } from 'node:net';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  USAGE,
  classifyLayouts,
  decideRelay,
  describeSensorHost,
  formatBanner,
  formatPortClash,
  parseStackOptions,
  portSettings,
} from './dev-startup.mjs';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** The repository root: one directory up from `tools/`. */
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** The relay's defaults, and therefore the ports a pre-existing broker collides with. */
const DEFAULT_PORTS = { mqtt: 1883, ws: 9001 };

/** LibreHardwareMonitor's defaults, matching `apps/agent/src/config.ts`. */
const DEFAULT_LHM = { host: 'localhost', port: 8085 };

/**
 * Who, if anyone, is listening on a port. Returns `{ pid, command }` or null.
 *
 * `lsof` only; there is no portable stdlib way to ask, and this is a courtesy rather than
 * load-bearing — `isPortFree` decides whether a port is taken, and a server's own EADDRINUSE still
 * reports the problem accurately. The `command` is taken from `ps` rather than from lsof's own
 * short name, because three worktrees of this repo all produce `node` and only the full argument
 * list says which checkout is holding the port.
 */
function listenerOn(port) {
  const out = spawnSync('lsof', [`-iTCP:${port}`, '-sTCP:LISTEN', '-n', '-P', '-F', 'p'], {
    encoding: 'utf8',
  });
  if (out.status !== 0 || !out.stdout) return null;

  const pid = out.stdout
    .split('\n')
    .find((line) => line.startsWith('p'))
    ?.slice(1);
  if (pid === undefined || pid.length === 0) return null;

  const ps = spawnSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' });
  const command = ps.status === 0 ? ps.stdout.trim().split('\n')[0] : '';

  return { pid, command: command.length > 0 ? command.slice(0, 96) : 'unknown' };
}

/**
 * Whether a dev server could bind this port, asked by binding it.
 *
 * Authoritative in a way `lsof` is not: it answers the exact question Vite is about to ask, on the
 * same host and with the same stack, so an IPv4/IPv6 split or a socket lsof cannot see cannot make
 * this disagree with the failure it is trying to pre-empt. There is a race — the port could be
 * taken in the moment between this closing and Vite listening — and that is fine: Vite still fails,
 * just without the better message.
 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.listen({ port, host: 'localhost' }, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

/** A free port to suggest, from the ephemeral range, so the advice is a port that works now. */
function suggestPort() {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      resolve(0);
    });
    server.listen({ port: 0, host: 'localhost' }, () => {
      const { port } = server.address();
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/** Whether a TCP connect to `host:port` succeeds within `timeoutMs`. `null` if it cannot be asked. */
function probeTcp(host, port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const settle = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      settle(true);
    });
    socket.once('timeout', () => {
      settle(false);
    });
    socket.once('error', (error) => {
      settle(error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN' ? null : false);
    });
  });
}

/** Poll `url` until it answers with any status, or give up. Resolves the status code, or null. */
async function waitForHttp(url, { timeoutMs = 30_000, everyMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline && !shuttingDown) {
    const status = await new Promise((resolve) => {
      const request = get(url, (response) => {
        response.resume();
        resolve(response.statusCode ?? null);
      });
      request.setTimeout(2000, () => {
        request.destroy();
      });
      request.once('error', () => {
        resolve(null);
      });
    });
    if (status !== null) return status;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return null;
}

/** Every `layouts/` file the pages will see, as `{ file, text }`, or `[]` if there is no directory. */
async function readLayoutFiles() {
  const directory = join(REPO_ROOT, 'layouts');
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  return Promise.all(
    files.map(async (entry) => ({
      file: entry.name,
      text: await readFile(join(directory, entry.name), 'utf8'),
    })),
  );
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
 * Worth asking rather than just failing: a pre-existing mosquitto is the single most likely reason
 * a first run does not work, and the failure is *quiet* on the browser side — the other broker
 * accepts the connection, accepts the subscriptions, and delivers nothing, so the page looks
 * connected and stays empty.
 *
 * Only ever offered for a process we can name, only when stdin is a TTY, and only when the user has
 * not chosen their own ports. Stopping someone's system service is not something to do unasked or
 * non-interactively.
 */
async function offerToFreePorts() {
  if (process.env.PERCH_MQTT_PORT || process.env.PERCH_WS_PORT) return;

  const clashes = Object.entries(DEFAULT_PORTS)
    .map(([role, port]) => ({ role, port, holder: listenerOn(port) }))
    .filter((c) => c.holder);
  if (clashes.length === 0) return;

  const held = clashes.map((c) => `${c.port} (pid ${c.holder.pid})`).join(', ');

  // Only mosquitto is offered; anything else gets reported and left alone, because we cannot know
  // what it is or whether the user wants it gone.
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
  relay: '\u001b[36mrelay   \u001b[0m',
  runtime: '\u001b[35mruntime \u001b[0m',
  editor: '\u001b[34meditor  \u001b[0m',
};

const children = new Set();
let shuttingDown = false;

/**
 * The child whose death started the shutdown, so its own last words still get through.
 *
 * Everything else is silenced once shutdown begins, and that is worth the variable: `npm run` prints
 * a seven-line post-mortem when its script is signalled, so a deliberate Ctrl-C used to end in
 * fourteen lines of `npm error code 143` — a clean stop that reads as two failures. The child that
 * actually failed is exempt because its diagnostic can still be flushing when its `exit` fires, and
 * that one is the whole reason the stack is stopping.
 */
let failingChild = null;

/** Spawn a long-lived child, prefixing every line it writes so the streams stay legible. */
function start(name, args) {
  const child = spawn(NPM, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  children.add(child);

  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    let partial = '';
    stream.on('data', (chunk) => {
      const lines = (partial + chunk).split('\n');
      partial = lines.pop() ?? '';
      if (shuttingDown && child !== failingChild) return;
      for (const line of lines) process.stdout.write(`${TAGS[name]}${line}\n`);
    });
  }

  child.on('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    // One side dying leaves a stack that looks alive but cannot work, so take the whole thing down
    // rather than leaving a half-stack to debug.
    failingChild = child;
    process.stdout.write(`${TAGS[name]}exited (${signal ?? code}) — stopping the stack\n`);
    shutdown(typeof code === 'number' && code !== 0 ? code : 1);
  });

  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;

  // Set the code now, not only in the escalation below. The timer is `unref`ed, so once the last
  // child's streams close there is nothing keeping the loop alive and Node exits *before* it fires
  // — which used to mean a stack that died on a relay that could not bind its port still reported
  // success to whatever ran it. Caught by running it: `npm run dev -- --relay` against this
  // machine's Mosquitto printed "stopping the stack" and exited 0.
  process.exitCode = code;

  for (const child of children) child.kill('SIGTERM');
  // Give SIGTERM a moment; the relay tracks and destroys live sockets on shutdown, which takes a
  // tick, and a browser tab holding a WebSocket used to keep it from exiting at all.
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

// ---- what was asked for -------------------------------------------------------------------

const parsed = parseStackOptions(process.argv.slice(2), process.env);
if (!parsed.ok) {
  process.stderr.write(`${parsed.message}\n`);
  process.exit(1);
}
if (parsed.options.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}
const options = parsed.options;

// ---- the ports, before anything is built ---------------------------------------------------
//
// Checked first because a held dev-server port is the one failure that wastes the most time: both
// servers set `strictPort`, so the failure arrives after the relay has been compiled and started,
// as a stack trace naming neither the holder nor a way out.

const clashes = [];
for (const setting of portSettings(options)) {
  if (await isPortFree(setting.port)) continue;
  clashes.push({ ...setting, holder: listenerOn(setting.port), suggestion: await suggestPort() });
}
if (clashes.length > 0) {
  process.stderr.write(formatPortClash(clashes));
  process.exit(1);
}

// ---- the relay, if anything would read it --------------------------------------------------

const relay = decideRelay(options.relay, process.env);

if (relay.start) {
  // Ask before anything is built or started: if the ports are taken the relay cannot run at all,
  // and finding that out after a compile is a worse experience than being asked up front.
  await offerToFreePorts();

  // The relay runs from its build output, so it has to be compiled before it can start. Do this in
  // the foreground: starting the dev servers first would bury the compiler's errors.
  process.stdout.write(`${TAGS.relay}building…\n`);
  const build = spawn(NPM, ['run', 'build', '-w', '@perch/agent'], { stdio: 'inherit' });
  const [buildCode] = await once(build, 'exit');
  if (buildCode !== 0) {
    process.stderr.write('relay build failed — not starting the stack\n');
    process.exit(buildCode ?? 1);
  }

  start('relay', ['start', '-w', '@perch/agent']);
}

// ---- the two dev servers ------------------------------------------------------------------
//
// The port is passed on the command line rather than written into each `vite.config.ts`, so
// `strictPort` keeps meaning what it says: the URL is fixed for this run and a capture can navigate
// to it, while a second worktree can still take a port of its own.

const editorUrl = `http://localhost:${options.editorPort}/`;
const runtimeUrl = `http://localhost:${options.runtimePort}/`;

start('editor', ['run', 'dev', '-w', '@perch/editor', '--', '--port', String(options.editorPort)]);
start('runtime', [
  'run',
  'dev',
  '-w',
  '@perch/runtime',
  '--',
  '--port',
  String(options.runtimePort),
]);

// ---- where to go --------------------------------------------------------------------------
//
// The banner waits for both servers to actually answer, and is therefore printed last: the
// complaint this change answers is that startup "tells you nothing about where to go", and a banner
// printed before Vite's own output has scrolled away by the time the servers are up. Waiting also
// means the URLs in it have been checked rather than predicted.

const statuses = await Promise.all([waitForHttp(editorUrl), waitForHttp(runtimeUrl)]);

if (statuses.includes(null)) {
  if (!shuttingDown) {
    const which = statuses[0] === null ? 'editor' : 'runtime';
    const url = statuses[0] === null ? editorUrl : runtimeUrl;
    process.stderr.write(
      `\nthe ${which} never answered on ${url}. Its output is above, tagged ${which}.\n`,
    );
    shutdown(1);
  }
} else {
  const relayNote = relay.start
    ? `${relay.note} ${describeSensorHost({
        host: process.env.PERCH_LHM_HOST || DEFAULT_LHM.host,
        port: Number(process.env.PERCH_LHM_PORT || DEFAULT_LHM.port),
        reachable: await probeTcp(
          process.env.PERCH_LHM_HOST || DEFAULT_LHM.host,
          Number(process.env.PERCH_LHM_PORT || DEFAULT_LHM.port),
        ),
      })}`
    : relay.note;

  process.stdout.write(
    formatBanner({
      editorUrl,
      runtimeUrl,
      layouts: classifyLayouts(await readLayoutFiles()),
      relayNote,
    }),
  );
}
