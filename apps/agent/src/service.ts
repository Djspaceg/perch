/**
 * The relay as a library: broker, control and poll loop, started together and stopped together.
 *
 * `runRelayCli` is this plus a command line and a startup report. The desktop app is this plus a
 * window: it runs the relay inside its own main process rather than as a child, so there is one
 * process to start, one to stop, and no port to agree on through a pipe. Both callers get the same
 * start order and the same stop order, because both come from here.
 */

import { startEmbeddedBroker, type EmbeddedBroker } from './broker.js';
import type { LhmEndpoint, RelayConfig } from './config.js';
import { createLhmDataFetcher } from './lhm-client.js';
import { startLhmControl, type LhmControl } from './lhm-control.js';
import { startRelay, type RelayHandle, type RelayLogger } from './relay.js';

export interface RelayServiceOptions {
  readonly config: RelayConfig;
  readonly logger: RelayLogger;
  /** See `EmbeddedBrokerOptions.freePortWhenHeld`. Default off, as the CLI runs. */
  readonly freePortWhenHeld?: boolean | undefined;
  /** Told each LHM host a client switched the relay to; see `LhmControlDeps.onRetarget`. */
  readonly onRetarget?: ((endpoint: LhmEndpoint) => void) | undefined;
}

/** A started relay. */
export interface RelayService {
  readonly config: RelayConfig;
  /** The port the MQTT listener actually bound, which differs from the config's when it asked for 0 or moved. */
  readonly mqttPort: number;
  /** The port the WebSocket listener actually bound; the one a page dials. */
  readonly wsPort: number;
  readonly broker: EmbeddedBroker;
  readonly relay: RelayHandle;
  /** Which LHM host is polled, as a client last asked; see `lhm-control.ts`. */
  readonly control: LhmControl;
  /** Resolves once the loop, the control and both listeners are closed. */
  stop(): Promise<void>;
}

/**
 * Start the broker, then the control, then the loop.
 *
 * Rejects when a listener cannot bind, with the broker's own message (see `portInUseGuidance`),
 * having opened nothing that is left running.
 */
export async function startRelayService(options: RelayServiceOptions): Promise<RelayService> {
  const { config, logger } = options;

  const broker = await startEmbeddedBroker(config.broker, {
    freePortWhenHeld: options.freePortWhenHeld,
  });
  reportMovedPort(logger, config.broker.mqttPort, broker.mqttPort, 'MQTT');
  reportMovedPort(logger, config.broker.wsPort, broker.wsPort, 'WebSocket');

  const fetcherFor = (endpoint: LhmEndpoint) =>
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
    onRetarget: options.onRetarget,
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
    config,
    mqttPort: broker.mqttPort,
    wsPort: broker.wsPort,
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
  };
}

/** One line when a held port was stepped around, so the log says which port the page must dial. */
function reportMovedPort(logger: RelayLogger, asked: number, bound: number, name: string): void {
  if (asked === 0 || asked === bound) return;

  logger.info(`${name} port ${asked} was in use; listening on ${bound} instead`);
}
