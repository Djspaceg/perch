/**
 * The one control path into the relay: a client asks which LibreHardwareMonitor host to poll, and
 * the relay reports, retained, whether that poll is working.
 *
 * ```text
 * perch/relay/lhm/request   {"host":"192.168.1.3","port":8085}   port optional: the configured one
 * perch/relay/lhm/status    {"host":…,"port":…,"state":"polling"|"ok"|"failed","reason"?:…}
 * ```
 *
 * The shape is owned by `packages/sensor-sources/src/relay-control.ts`, the browser side, and the
 * two topic strings are restated here rather than imported: ARCHITECTURE.md gives this app a single
 * edge, `sensor-contract`, and that contract's rule 3 keeps hosts and ports out of it. The same
 * knowingly-paid cost as `RELAY_DEFAULTS.broker.wsPort`; both sides' tests pin the same literals.
 *
 * ## What "ok" means
 *
 * A poll that published at least one reading. A host that answers `/data.json` with JSON holding no
 * LHM sensors is `failed`, because the editor waits for readings before it says "connected" and a
 * status of `ok` over an empty stream would leave it saying "connecting" with no reason forever.
 *
 * ## Who may ask
 *
 * Anyone who can reach the broker, which has no authentication (see `broker.ts`). The request can
 * only name a host and a port — the path is always `/data.json`, the method always GET, and a
 * response is only ever published if it maps onto the sensor contract — so the widening is "any
 * LAN client can point this relay's poll at another machine". Recorded in DECISIONS.md.
 */

import type { BrokerPublisher } from './broker.js';
import type { LhmEndpoint } from './config.js';
import type { LhmDataFetcher } from './lhm-client.js';
import type { PollReport, RelayLogger } from './relay.js';

/** Restated from `sensor-sources`' `RELAY_LHM_REQUEST_TOPIC`; see the module comment. */
export const LHM_REQUEST_TOPIC = 'perch/relay/lhm/request';

/** Restated from `sensor-sources`' `RELAY_LHM_STATUS_TOPIC`. */
export const LHM_STATUS_TOPIC = 'perch/relay/lhm/status';

/** What the broker must offer this module: publish, and an in-process subscription. */
export interface ControlBroker extends BrokerPublisher {
  subscribe(topic: string, onMessage: (payload: string) => void): Promise<() => Promise<void>>;
}

export interface LhmControlDeps {
  readonly broker: ControlBroker;
  /** The host the relay started on, from its configuration. */
  readonly initial: LhmEndpoint;
  /** The port a request without one means: the relay's configured LHM port. */
  readonly defaultPort: number;
  readonly fetcherFor: (endpoint: LhmEndpoint) => LhmDataFetcher;
  /** Hand the poll loop a new fetcher; `RelayHandle.retarget`. */
  readonly retarget: (fetchLhmData: LhmDataFetcher) => void;
  /**
   * Told the host a client asked for, once the loop has been retargeted at it. For a host that
   * remembers the choice across launches; the relay itself keeps nothing.
   */
  readonly onRetarget?: ((endpoint: LhmEndpoint) => void) | undefined;
  readonly logger: RelayLogger;
}

export interface LhmControl {
  /** The host being polled now. */
  readonly endpoint: LhmEndpoint;
  /** Feed every poll of the current host here; `RelayDeps.onPoll`. */
  onPoll(report: PollReport): void;
  stop(): Promise<void>;
}

/** The same host rule the browser side applies before it sends; see `isLhmHost` there. */
function isLhmHost(host: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,252})$/.test(host) || /^\[[0-9A-Fa-f:.]+\]$/.test(host);
}

/** A request body as an endpoint, or `null` for anything that is not exactly a host and a port. */
export function parseLhmRequest(payload: string, defaultPort: number): LhmEndpoint | null {
  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;

  const { host, port } = body as { host?: unknown; port?: unknown };
  if (typeof host !== 'string' || !isLhmHost(host)) return null;
  if (port === undefined) return { host, port: defaultPort };
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) return null;

  return { host, port };
}

interface StatusBody {
  readonly host: string;
  readonly port: number;
  readonly state: 'polling' | 'ok' | 'failed';
  readonly reason?: string;
}

const NO_SENSORS = 'the host answered, but with no LHM sensors';

export async function startLhmControl(deps: LhmControlDeps): Promise<LhmControl> {
  let endpoint = deps.initial;
  let published: string | undefined;

  /** Publish, retained, only when the body differs from the last one: never once per poll. */
  const report = (body: StatusBody): void => {
    const text = JSON.stringify(body);
    if (text === published) return;
    published = text;
    deps.broker.publish(LHM_STATUS_TOPIC, text, { retain: true }).catch((error: unknown) => {
      deps.logger.warn(
        `could not publish the LHM status: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  };

  const onRequest = (payload: string): void => {
    const requested = parseLhmRequest(payload, deps.defaultPort);
    if (requested === null) {
      deps.logger.warn(
        `ignored an LHM host request that is not a host and port: ${payload.slice(0, 120)}`,
      );
      return;
    }
    if (requested.host === endpoint.host && requested.port === endpoint.port) return;

    endpoint = requested;
    deps.retarget(deps.fetcherFor(requested));
    deps.onRetarget?.(requested);
    deps.logger.info(
      `a client asked for http://${requested.host}:${requested.port}/data.json; polling it`,
    );
    report({ ...requested, state: 'polling' });
  };

  const unsubscribe = await deps.broker.subscribe(LHM_REQUEST_TOPIC, onRequest);
  report({ ...endpoint, state: 'polling' });

  return {
    get endpoint() {
      return endpoint;
    },
    onPoll(poll) {
      if (poll.failure !== undefined) {
        report({ ...endpoint, state: 'failed', reason: poll.reason ?? poll.failure });
      } else if (poll.readingsPublished === 0) {
        report({ ...endpoint, state: 'failed', reason: NO_SENSORS });
      } else {
        report({ ...endpoint, state: 'ok' });
      }
    },
    stop: unsubscribe,
  };
}
