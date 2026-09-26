/**
 * The relay control: which LibreHardwareMonitor host the relay polls, asked for by a client, and
 * whether that poll is working, reported back by the relay.
 *
 * ## One request topic, one retained status topic
 *
 * ```text
 * perch/relay/lhm/request   client -> relay   {"host":"192.168.1.3","port":8085}   qos 1, not retained
 * perch/relay/lhm/status    relay -> client   {"host":…,"port":…,"state":"ok"}     qos 1, retained
 * ```
 *
 * Outside `sensors/`, so neither of the mqtt source's two subscriptions can match them and the
 * sensor topic grammar is untouched. The request's `port` is optional: absent, the relay uses the
 * LHM port it was configured with, which is how "localhost" means "LHM on the relay's own machine".
 * The status is retained so a client that connects later learns the current state without asking,
 * and it always names the host and port it is about, so a client can tell a report on the host it
 * asked for from one on the host before.
 *
 * `state` is `polling` (switched, no answer yet), `ok` (the last poll published readings) or
 * `failed` with a short `reason` (`EHOSTUNREACH`, `no response within 1500 ms`, `HTTP 404 …`).
 *
 * ## Why here and not in `sensor-contract`
 *
 * These carry hosts and ports, and that contract's rule 3 puts hosts, ports and URLs in this
 * package. `apps/agent` may not import this package, so it restates the two topic strings and its
 * tests pin them to the same literals this file's tests pin — the arrangement `RELAY_WEBSOCKET_PORT`
 * already has with the relay's 9001.
 */

import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import type { Unsubscribe } from '@perch/sensor-contract';
import type { SourceLogger } from './mqtt-source.js';

export const RELAY_LHM_REQUEST_TOPIC = 'perch/relay/lhm/request';
export const RELAY_LHM_STATUS_TOPIC = 'perch/relay/lhm/status';

/** Which host to poll. No `port` means the relay's own configured LHM port. */
export interface RelayLhmRequest {
  readonly host: string;
  readonly port?: number | undefined;
}

export const RELAY_LHM_STATES = Object.freeze(['polling', 'ok', 'failed'] as const);
export type RelayLhmState = (typeof RELAY_LHM_STATES)[number];

/** What the relay says about the host it is polling. */
export interface RelayLhmStatus {
  readonly host: string;
  readonly port: number;
  readonly state: RelayLhmState;
  readonly reason?: string | undefined;
}

/**
 * A host the relay may be told to fetch `http://<host>:<port>/data.json` from.
 *
 * A name or dotted address, or a bracketed IPv6 literal, and nothing else: no scheme, path, query,
 * credentials or port, because the relay builds a URL from this and anything more is a different
 * URL than the one asked for. The relay applies the same rule to what arrives on the wire.
 */
export function isLhmHost(host: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,252})$/.test(host) || /^\[[0-9A-Fa-f:.]+\]$/.test(host);
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65_535;
}

export function isRelayLhmRequest(candidate: unknown): candidate is RelayLhmRequest {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const { host, port } = candidate as Partial<Record<keyof RelayLhmRequest, unknown>>;

  return typeof host === 'string' && isLhmHost(host) && (port === undefined || isPort(port));
}

export function isRelayLhmStatus(candidate: unknown): candidate is RelayLhmStatus {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const { host, port, state, reason } = candidate as Partial<Record<keyof RelayLhmStatus, unknown>>;

  return (
    typeof host === 'string' &&
    isPort(port) &&
    (RELAY_LHM_STATES as readonly unknown[]).includes(state) &&
    (reason === undefined || typeof reason === 'string')
  );
}

/** Whether a status reports on the host a request asked for. Host names are case-insensitive. */
export function relayStatusMatches(request: RelayLhmRequest, status: RelayLhmStatus): boolean {
  return (
    request.host.toLowerCase() === status.host.toLowerCase() &&
    (request.port === undefined || request.port === status.port)
  );
}

export interface RelayControlOptions {
  /** The relay's MQTT-over-WebSockets URL. */
  url: string;
  /** First reconnect delay in ms. Default 1000. */
  reconnectDelayMs?: number | undefined;
  /** How long one connection attempt may take. Default 4000. */
  connectTimeoutMs?: number | undefined;
  /** Where warnings go. Default the console. */
  logger?: SourceLogger | undefined;
}

export interface RelayControl {
  readonly url: string;
  /** The link to the relay, as the transport reports it. */
  readonly link: 'opening' | 'up' | 'down';
  /** The relay's last retained status, or `undefined` before one arrives. */
  readonly status: RelayLhmStatus | undefined;
  /**
   * Ask the relay to poll `target`. Sent now if the link is up, and again on every reconnect, so a
   * relay that restarted is told again. Throws on a request the relay would refuse.
   */
  request(target: RelayLhmRequest): void;
  /** Called whenever `link` or `status` changes. */
  onChange(listener: () => void): Unsubscribe;
  close(): Promise<void>;
}

export function createRelayControl(options: RelayControlOptions): RelayControl {
  const {
    url,
    reconnectDelayMs = 1_000,
    connectTimeoutMs = 4_000,
    logger = {
      warn: (message: string) => {
        console.warn(message);
      },
    },
  } = options;

  const listeners = new Set<() => void>();
  let link: RelayControl['link'] = 'opening';
  let status: RelayLhmStatus | undefined;
  let wanted: RelayLhmRequest | undefined;
  let closed = false;

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const clientOptions: IClientOptions = {
    clientId: `perch-control-${Math.floor(Math.random() * 0x1_0000_0000).toString(16)}`,
    clean: true,
    reconnectPeriod: reconnectDelayMs,
    connectTimeout: connectTimeoutMs,
    resubscribe: false,
    protocolVersion: 4,
  };
  const client: MqttClient = mqtt.connect(url, clientOptions);

  const send = (): void => {
    if (wanted === undefined || link !== 'up') return;
    client.publish(RELAY_LHM_REQUEST_TOPIC, JSON.stringify(wanted), { qos: 1 }, (error) => {
      if (error instanceof Error) {
        logger.warn(
          `perch: asking the relay to poll ${wanted?.host ?? ''} failed: ${error.message}`,
        );
      }
    });
  };

  const setLink = (next: RelayControl['link']): void => {
    if (closed || link === next) return;
    link = next;
    notify();
  };

  client.on('connect', () => {
    setLink('up');
    client.subscribe(RELAY_LHM_STATUS_TOPIC, { qos: 1 }, (error) => {
      if (error !== null)
        logger.warn(`perch: subscribe to ${RELAY_LHM_STATUS_TOPIC} failed: ${error.message}`);
    });
    send();
  });
  client.on('close', () => {
    setLink('down');
  });
  client.on('offline', () => {
    setLink('down');
  });
  client.on('error', (error) => {
    setLink('down');
    logger.warn(`perch: relay control ${url} error: ${error.message}`);
  });

  client.on('message', (topic: string, payload: Uint8Array) => {
    if (closed || topic !== RELAY_LHM_STATUS_TOPIC) return;
    if (payload.length === 0) {
      status = undefined;
      notify();
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      body = undefined;
    }
    if (!isRelayLhmStatus(body)) {
      logger.warn(`perch: ignored a relay status that is not one on ${RELAY_LHM_STATUS_TOPIC}`);
      return;
    }
    status = body;
    notify();
  });

  return {
    url,
    get link() {
      return link;
    },
    get status() {
      return status;
    },
    request(target) {
      if (!isRelayLhmRequest(target)) {
        throw new TypeError(`not a host the relay can poll: ${JSON.stringify(target)}`);
      }
      wanted =
        target.port === undefined
          ? { host: target.host }
          : { host: target.host, port: target.port };
      send();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      await client.endAsync(true);
    },
  };
}
