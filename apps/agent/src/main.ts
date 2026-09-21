/**
 * The executable entry point, and the only file in this app that touches `process`.
 *
 * Deliberately thin. Everything it does beyond wiring is signal handling, which cannot be
 * tested without a real process and is therefore the one thing worth keeping out of
 * `runRelayCli` — `apps/agent/src/cli.test.ts` covers the startup and failure paths by calling
 * that function directly.
 */

import { runRelayCli } from './cli.js';

const result = await runRelayCli({
  argv: process.argv.slice(2),
  env: process.env,
  streams: {
    out: (line) => {
      process.stdout.write(`${line}\n`);
    },
    err: (line) => {
      process.stderr.write(`${line}\n`);
    },
  },
});

if (result.kind === 'exit') {
  process.exit(result.exitCode);
}

const { running } = result;
let stopping = false;

/**
 * Shut down on a signal, once.
 *
 * A second Ctrl-C while the first shutdown is draining must not start a second one — two
 * concurrent `broker.close()` calls would race on the same listeners. The second signal is
 * ignored rather than escalated to a hard exit, because the drain here is bounded: clients are
 * terminated, not asked to leave.
 */
const shutdown = (signal: string): void => {
  if (stopping) return;
  stopping = true;
  process.stderr.write(`[info] ${signal} received, stopping\n`);

  running.stop().then(
    () => {
      process.exit(0);
    },
    (error: unknown) => {
      process.stderr.write(
        `[error] shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    },
  );
};

process.on('SIGINT', () => {
  shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
