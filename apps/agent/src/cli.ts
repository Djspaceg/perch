/**
 * The command line: resolve configuration, start the broker, start the loop, shut down cleanly.
 *
 * Everything here is a function of its arguments — `runRelayCli` takes the argv, the
 * environment and the two streams, so the whole startup path including the failure paths can
 * be exercised without spawning a process or capturing global stdout. `main.ts` is the only
 * file that touches `process`.
 */

import {
  describeRelayConfig,
  relayUsage,
  resolveRelayConfig,
  type RelayConfig,
  type RelayConfigOrigins,
} from './config.js';
import { startEmbeddedBroker, type EmbeddedBroker } from './broker.js';
import { createLhmDataFetcher } from './lhm-client.js';
import { startLhmControl, type LhmControl } from './lhm-control.js';
import { startRelay, type RelayHandle, type RelayLogger } from './relay.js';

/** Where the CLI writes. Two sinks rather than one, because a startup report and an error are not the same stream. */
export interface CliStreams {
  out(line: string): void;
  err(line: string): void;
}

export interface RelayCliOptions {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly streams: CliStreams;
}

/** A started relay, so the caller can shut it down on a signal. */
export interface RunningRelay {
  readonly config: RelayConfig;
  readonly broker: EmbeddedBroker;
  readonly relay: RelayHandle;
  /** Which LHM host is polled, as a client last asked; see `lhm-control.ts`. */
  readonly control: LhmControl;
  stop(): Promise<void>;
}

/**
 * The outcome of a CLI invocation.
 *
 * `exitCode` is the process's, and it distinguishes the three ways not to be running: help was
 * asked for (0), the configuration was rejected (2, the conventional usage-error code), and the
 * broker could not bind (1). Exit codes matter more than usual here because this runs as a
 * service wrapper's child, and the wrapper's restart policy reads them.
 */
export type RelayCliResult =
  | { readonly kind: 'running'; readonly running: RunningRelay }
  | { readonly kind: 'exit'; readonly exitCode: number };

export async function runRelayCli(options: RelayCliOptions): Promise<RelayCliResult> {
  const resolved = resolveRelayConfig({ argv: options.argv, env: options.env });

  if (resolved.kind === 'help') {
    options.streams.out(relayUsage());
    return { kind: 'exit', exitCode: 0 };
  }

  if (resolved.kind === 'invalid') {
    for (const error of resolved.errors) options.streams.err(`error: ${error}`);
    options.streams.err('');
    options.streams.err(relayUsage());
    return { kind: 'exit', exitCode: 2 };
  }

  const { config, origins } = resolved;
  reportConfig(options.streams, config, origins);

  let broker: EmbeddedBroker;
  try {
    broker = await startEmbeddedBroker(config.broker);
  } catch (error) {
    // Almost always EADDRINUSE, and on this machine almost always port 9001, which a Homebrew
    // Mosquitto holds on every interface. Naming the port is the difference between a
    // one-second fix and an afternoon wondering why the dashboard is reading someone else's
    // empty broker.
    options.streams.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return { kind: 'exit', exitCode: 1 };
  }

  options.streams.out(
    `broker listening: mqtt://${config.broker.bindHost}:${broker.mqttPort}, ws://${config.broker.bindHost}:${broker.wsPort}`,
  );

  const logger = createStreamLogger(options.streams);
  const fetcherFor = (endpoint: RelayConfig['lhm']) =>
    createLhmDataFetcher(endpoint, config.requestTimeoutMs);

  // The control first, so the status topic is retained before the first poll reports into it. The
  // loop is handed to it through a closure because each needs the other: the control retargets
  // the loop, and the loop reports every poll to the control.
  const loopRef: { current?: RelayHandle } = {};
  const control = await startLhmControl({
    broker,
    initial: config.lhm,
    defaultPort: config.lhm.port,
    fetcherFor,
    retarget: (fetchLhmData) => {
      loopRef.current?.retarget(fetchLhmData);
    },
    logger,
  });
  const loop = startRelay(config.pollIntervalMs, {
    fetchLhmData: fetcherFor(config.lhm),
    broker,
    logger,
    now: () => Date.now(),
    onPoll: (report) => {
      control.onPoll(report);
    },
  });
  loopRef.current = loop;

  return {
    kind: 'running',
    running: {
      config,
      broker,
      relay: loop,
      control,
      stop: async (): Promise<void> => {
        // Loop first, then broker: stopping the broker under a tick in flight would reject a
        // publish that the loop would then report as a defect in itself.
        await loop.stop();
        await control.stop();
        await broker.close();
      },
    },
  };
}

/**
 * Print what the relay resolved, and from where.
 *
 * This is SPEC.md's "first-run check that reports what it found rather than failing silently",
 * and the `(cli)`/`(env)`/`(default)` annotation is the load-bearing part: the failure a
 * misconfigured service actually presents as is "it is polling the wrong machine", and a
 * report that showed only the final value would leave a human guessing whether their
 * environment variable was read at all.
 */
function reportConfig(streams: CliStreams, config: RelayConfig, origins: RelayConfigOrigins): void {
  streams.out('perch-agent configuration (value, origin, environment variable):');
  for (const line of describeRelayConfig(config, origins)) streams.out(`  ${line}`);
  streams.out(`polling http://${config.lhm.host}:${config.lhm.port}/data.json`);
}

/** Level-prefixed lines, so a log reader can filter without the relay needing a log library. */
function createStreamLogger(streams: CliStreams): RelayLogger {
  return {
    info: (message) => {
      streams.out(`[info] ${message}`);
    },
    warn: (message) => {
      streams.err(`[warn] ${message}`);
    },
    error: (message) => {
      streams.err(`[error] ${message}`);
    },
  };
}
