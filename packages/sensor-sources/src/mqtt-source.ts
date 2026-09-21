/**
 * The mqtt source: real readings off a real broker, over WebSockets.
 *
 * This is the one implementation that carries hardware data in production. Everything about it
 * is shaped by two facts: **every byte on the wire is untrusted**, and **the machine at the
 * other end reboots**. So there is a validating boundary that drops rather than coerces, and a
 * reconnect loop whose effect on `status` is specified rather than incidental.
 *
 * ## Two narrow subscriptions, not `sensors/#`
 *
 * `SENSOR_TOPIC_WILDCARD` matches the retained `<topic>/meta` companions as well as readings.
 * A subscriber on it therefore receives metadata interleaved with readings and has to route on
 * the suffix — and a routing bug there hands a `SensorMeta` body to a widget expecting a
 * number. The type guards would reject it, but the correct fix is structural: subscribe to the
 * five-level reading form and the six-level meta form as two separate patterns, so a meta
 * payload is never even a candidate for the reading path. Decided; see DECISIONS.md.
 *
 * ## `status`, and the three states it has to keep apart
 *
 * The contract's four states are not four labels for "no number on screen":
 *
 * - `connecting` — nothing has arrived and nothing has failed. The first connection is still
 *   in flight, or it is up and the first reading has not landed yet.
 * - `live` — the link is up and a reading arrived inside the staleness window.
 * - `stale` — the link is up and no reading arrived inside the window. The transport is fine;
 *   the publisher went quiet. Also the state immediately after a *reconnect*, before the first
 *   reading of the new session: the link is demonstrably fine, and data is demonstrably absent.
 * - `error` — the link is down after a failure. The source is retrying; a dashboard should say
 *   so rather than show a six-minute-old number as though it were current.
 *
 * `status` is **derived on read** from the link state and the clock, not written by a timer.
 * The contract says "read it; never cache it", and a timer-driven status is a cached one: it is
 * correct only as often as the timer fires, and it is a leak if the source is dropped without
 * being closed. Deriving it means the transition from `live` to `stale` happens at the exact
 * moment the window closes, with no timer to own.
 *
 * ## No Node built-ins
 *
 * `mqtt` is imported as a default namespace rather than with named imports, because the
 * browser build (`mqtt/dist/mqtt.esm.js`, selected by the `browser` export condition) exposes
 * only a default export. `import { connect } from 'mqtt'` typechecks and then fails in the
 * bundle. `TextDecoder` is used for payloads because it is in both lib DOM and Node.
 */

import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import {
  isSensorMeta,
  isSensorReading,
  normalizeSensorTopic,
  SENSOR_META_SUFFIX,
  SENSOR_TOPIC_ROOT,
  type SensorMeta,
  type SensorReadingHandler,
  type SensorSource,
  type SensorSourceStatus,
  type SensorTopic,
  type Unsubscribe,
} from '@perch/sensor-contract';
import { type BrokerUrlOrigin, RELAY_BROKER_URL_ENV_VAR } from './broker-url.js';
import { relayWebSocketUrl } from './relay-endpoint.js';
import { topicMatchesPattern } from './topic-pattern.js';

/**
 * The reading subscription: exactly the five levels `sensorTopic()` builds, so the
 * six-level `<topic>/meta` companion cannot match it. Built from the contract's root rather
 * than hand-written, per SPEC rule 5.
 */
export const SENSOR_READING_SUBSCRIPTION = `${SENSOR_TOPIC_ROOT}/+/+/+/+`;

/** The metadata subscription: the same five levels plus the suffix, and nothing else. */
export const SENSOR_META_SUBSCRIPTION = `${SENSOR_TOPIC_ROOT}/+/+/+/+/${SENSOR_META_SUFFIX}`;

/**
 * Why a message was dropped. Enumerated rather than free text so the counters are a fixed
 * shape a dashboard or a test can assert on.
 *
 * - `undecodable` — the payload is not UTF-8.
 * - `invalid-json` — it is UTF-8 but not JSON.
 * - `unroutable-topic` — it arrived on neither subscription. Only a broker bug produces this,
 *   which is exactly why it is counted rather than assumed away.
 * - `uncanonical-topic` — the shape is right but the topic is not one `sensorTopic()` builds:
 *   a device or metric outside the vocabulary, or an index spelled `00`.
 * - `not-a-reading` / `not-a-meta` — the body failed the contract's guard.
 */
export const SENSOR_MESSAGE_REJECTIONS = Object.freeze([
  'undecodable',
  'invalid-json',
  'unroutable-topic',
  'uncanonical-topic',
  'not-a-reading',
  'not-a-meta',
] as const);

export type SensorMessageRejection = (typeof SENSOR_MESSAGE_REJECTIONS)[number];

/**
 * What the source has seen. Exposed because "the broker is connected and nothing renders" is
 * otherwise indistinguishable from "the broker is connected and every payload is being
 * dropped" — a silent schema mismatch is the failure mode a validating boundary creates if it
 * validates quietly.
 */
export interface MqttSourceStats {
  readonly readingsAccepted: number;
  readonly metaAccepted: number;
  /** A retained meta companion published empty, i.e. withdrawn. Not a rejection. */
  readonly metaCleared: number;
  readonly rejected: number;
  readonly rejectionsByReason: Readonly<Record<SensorMessageRejection, number>>;
  /** CONNACKs, including reconnects. `connects > 1` means the link has dropped at least once. */
  readonly connects: number;
  /** Failed attempts and dropped links, i.e. every entry into `error`. */
  readonly connectionFailures: number;
}

/** Somewhere to put a warning. Injected so a test can read them instead of the console. */
export interface SourceLogger {
  warn(message: string): void;
}

/**
 * An options bag, so every member is `?: T | undefined` and is read through a destructuring
 * default — the same convention `MockSourceOptions` follows, for the same reason.
 */
export interface MqttSourceOptions {
  /** The broker URL. Default `relayWebSocketUrl()`, which is the trap — see `broker-url.ts`. */
  url?: string | undefined;
  /** Which input decided `url`, from `resolveBrokerUrl`. Default `'default'`, which warns. */
  origin?: BrokerUrlOrigin | undefined;
  /**
   * How long after the last accepted reading the source reports `stale`. Default 3000: the
   * SPEC publishes at 1 Hz, so three missed intervals is a publisher that stopped rather than
   * a scheduler that slipped.
   */
  staleAfterMs?: number | undefined;
  /** First reconnect delay in ms. Default 1000. */
  reconnectDelayMs?: number | undefined;
  /** Ceiling for the backoff. Default 30000, so a rebooting host is retried indefinitely. */
  maxReconnectDelayMs?: number | undefined;
  /** Backoff multiplier applied per attempt. Default 2. */
  reconnectBackoffFactor?: number | undefined;
  /** How long a single connection attempt may take. Default 4000. */
  connectTimeoutMs?: number | undefined;
  /** Clock for the staleness window. Default `Date.now`; inject one to make `status` exact. */
  now?: (() => number) | undefined;
  /** Where warnings go. Default the console. */
  logger?: SourceLogger | undefined;
  /** MQTT client id. Default a random `perch-` id, so two tabs do not evict each other. */
  clientId?: string | undefined;
}

export interface MqttSensorSource extends SensorSource {
  /** The broker this source dialed, after resolution. */
  readonly url: string;
  /** Which of env / config file / default produced `url`. */
  readonly origin: BrokerUrlOrigin;
  /** A snapshot of the counters. Frozen, so a caller cannot hold a live view of them. */
  readonly stats: MqttSourceStats;
  /**
   * Resolves when the broker has acknowledged both subscriptions, so retained metadata is on
   * its way and live readings will be delivered. Rejects if the source is closed first.
   *
   * Not part of `SensorSource`: a consumer that must render before data arrives reads `status`
   * instead. This exists for the callers that legitimately want to wait — a test, and the
   * bundle's ready signal in `apps/runtime`.
   */
  ready(): Promise<void>;
  /** Disconnect and stop retrying. Idempotent. */
  close(): Promise<void>;
}

/** The warning logged when nothing overrode the default. Exported so the tests assert on it. */
export const DEFAULT_BROKER_URL_WARNING =
  `perch: broker URL fell through to the built-in default ${relayWebSocketUrl()}. ` +
  `On a developer machine that port is frequently a different broker (a system mosquitto ` +
  `bound to 0.0.0.0:9001 with anonymous access will accept the connection and deliver ` +
  `nothing). Set ${RELAY_BROKER_URL_ENV_VAR} or a brokerUrl in the config file beside the ` +
  `bundle to say which broker you mean.`;

/** Build an mqtt source. Connects immediately; `status` is `connecting` until it does. */
export function createMqttSource(options: MqttSourceOptions = {}): MqttSensorSource {
  const {
    url = relayWebSocketUrl(),
    origin = 'default',
    staleAfterMs = 3_000,
    reconnectDelayMs = 1_000,
    maxReconnectDelayMs = 30_000,
    reconnectBackoffFactor = 2,
    connectTimeoutMs = 4_000,
    now = Date.now,
    logger = consoleLogger,
    clientId = randomClientId(),
  } = options;

  checkPositive(staleAfterMs, 'staleAfterMs');
  checkPositive(reconnectDelayMs, 'reconnectDelayMs');
  checkPositive(maxReconnectDelayMs, 'maxReconnectDelayMs');
  checkPositive(connectTimeoutMs, 'connectTimeoutMs');
  if (!Number.isFinite(reconnectBackoffFactor) || reconnectBackoffFactor < 1) {
    throw new RangeError(`reconnectBackoffFactor must be >= 1, got ${reconnectBackoffFactor}`);
  }
  if (maxReconnectDelayMs < reconnectDelayMs) {
    throw new RangeError(
      `maxReconnectDelayMs (${maxReconnectDelayMs}) must be >= reconnectDelayMs (${reconnectDelayMs})`,
    );
  }

  // The trap, announced once at construction. A source that fell through to the default is
  // the one case where "connected, subscribed, nothing arriving" is the expected outcome.
  if (origin === 'default') logger.warn(DEFAULT_BROKER_URL_WARNING);

  const subscribers = new Map<SensorReadingHandler, string>();
  const metas = new Map<SensorTopic, SensorMeta>();
  const decoder = new TextDecoder('utf-8', { fatal: true });

  /**
   * The link, as the transport reports it — deliberately not the same thing as `status`.
   * `opening` is "the first attempt has not resolved either way", which is why an initial
   * failure can move to `error` without ever having been `up`.
   */
  let link: 'opening' | 'up' | 'down' = 'opening';
  let closed = false;
  /** Arrival time of the last accepted reading *on the current link*. Cleared on a drop. */
  let lastReadingAt: number | undefined;
  /** Whether a reading has ever been accepted, which is what separates `stale` from `connecting`. */
  let everReceived = false;
  let backoffMs = reconnectDelayMs;

  const counters: Record<SensorMessageRejection, number> = {
    undecodable: 0,
    'invalid-json': 0,
    'unroutable-topic': 0,
    'uncanonical-topic': 0,
    'not-a-reading': 0,
    'not-a-meta': 0,
  };
  const loggedReasons = new Set<SensorMessageRejection>();
  let readingsAccepted = 0;
  let metaAccepted = 0;
  let metaCleared = 0;
  let rejected = 0;
  let connects = 0;
  let connectionFailures = 0;

  let resolveReady: (() => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // The consumer may never call `ready()`. An unobserved rejection is a process-level warning
  // in Node and a noisy console in a browser, so it is observed here once and swallowed; the
  // rejection is still delivered to every real `ready()` caller.
  readyPromise.catch(() => undefined);

  const clientOptions: IClientOptions = {
    clientId,
    // A fresh session every time. The broker holds no subscription state for us, so a
    // reconnect must resubscribe — which is exactly what the `connect` handler below does,
    // making the resubscription explicit rather than a library default we rely on silently.
    clean: true,
    reconnectPeriod: reconnectDelayMs,
    connectTimeout: connectTimeoutMs,
    resubscribe: false,
    protocolVersion: 4,
  };

  const client: MqttClient = mqtt.connect(url, clientOptions);

  const noteFailure = (): void => {
    if (closed) return;
    if (link === 'down') return; // one drop, one count: `error` then `close` is one event
    link = 'down';
    lastReadingAt = undefined;
    connectionFailures += 1;
  };

  client.on('connect', () => {
    link = 'up';
    connects += 1;
    // A reconnect starts with no data on the new link, which is `stale` rather than `live`.
    // Leaving the old timestamp in place would report `live` off a reading from before the gap.
    lastReadingAt = undefined;
    backoffMs = reconnectDelayMs;
    client.options.reconnectPeriod = reconnectDelayMs;

    // qos 0 for readings: at 1 Hz the next one is worth more than a redelivery of the last.
    // qos 1 for metadata: it is published once, retained, and a lost one means a widget with
    // no label until the publisher restarts.
    client.subscribe([SENSOR_READING_SUBSCRIPTION], { qos: 0 }, (readingError) => {
      if (readingError !== null) {
        logger.warn(
          `perch: subscribe to ${SENSOR_READING_SUBSCRIPTION} failed: ${readingError.message}`,
        );
        return;
      }

      client.subscribe([SENSOR_META_SUBSCRIPTION], { qos: 1 }, (metaError) => {
        if (metaError !== null) {
          logger.warn(
            `perch: subscribe to ${SENSOR_META_SUBSCRIPTION} failed: ${metaError.message}`,
          );
          return;
        }

        resolveReady?.();
      });
    });
  });

  client.on('reconnect', () => {
    // Fires as an attempt begins, so this sets the delay before the *next* one. Capped, and
    // never reset except by a successful connect.
    backoffMs = Math.min(backoffMs * reconnectBackoffFactor, maxReconnectDelayMs);
    client.options.reconnectPeriod = backoffMs;
  });

  client.on('error', (error) => {
    noteFailure();
    logger.warn(`perch: broker ${url} error: ${error.message}`);
  });

  client.on('close', noteFailure);
  client.on('offline', noteFailure);

  client.on('message', (topic: string, payload: Uint8Array) => {
    if (closed) return;

    // Meta first: it is the more specific pattern, and a topic that matches it must never
    // reach the reading path even if the reading pattern were widened by accident.
    if (topicMatchesPattern(topic, SENSOR_META_SUBSCRIPTION)) {
      acceptMeta(topic, payload);
      return;
    }

    if (topicMatchesPattern(topic, SENSOR_READING_SUBSCRIPTION)) {
      acceptReading(topic, payload);
      return;
    }

    reject('unroutable-topic', topic);
  });

  function acceptReading(topic: string, payload: Uint8Array): void {
    const canonical = normalizeSensorTopic(topic);
    if (canonical === null) {
      reject('uncanonical-topic', topic);
      return;
    }

    const decoded = decodeBody(payload);
    if (!decoded.ok) {
      reject(decoded.reason, topic);
      return;
    }

    if (!isSensorReading(decoded.body)) {
      reject('not-a-reading', topic);
      return;
    }

    readingsAccepted += 1;
    everReceived = true;
    // Arrival time by our clock, not the reading's own `at`. `at` is the publisher's clock and
    // the two machines need not agree; `status` is a statement about *this* process's link.
    lastReadingAt = now();

    for (const [handler, pattern] of subscribers) {
      if (topicMatchesPattern(canonical, pattern)) handler(canonical, decoded.body);
    }
  }

  function acceptMeta(topic: string, payload: Uint8Array): void {
    const canonical = normalizeSensorTopic(stripMetaSuffix(topic));
    if (canonical === null) {
      reject('uncanonical-topic', topic);
      return;
    }

    // A zero-length retained publish is how MQTT withdraws a retained message. It is a real
    // instruction, not a malformed body: the sensor's label is gone, not corrupt.
    if (payload.length === 0) {
      metas.delete(canonical);
      metaCleared += 1;
      return;
    }

    const decoded = decodeBody(payload);
    if (!decoded.ok) {
      reject(decoded.reason, topic);
      return;
    }

    if (!isSensorMeta(decoded.body)) {
      reject('not-a-meta', topic);
      return;
    }

    metaAccepted += 1;
    metas.set(canonical, decoded.body);
  }

  function decodeBody(payload: Uint8Array): DecodedBody {
    let text: string;
    try {
      text = decoder.decode(payload);
    } catch {
      return { ok: false, reason: 'undecodable' };
    }

    try {
      return { ok: true, body: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, reason: 'invalid-json' };
    }
  }

  function reject(reason: SensorMessageRejection, topic: string): void {
    rejected += 1;
    counters[reason] += 1;

    // Once per reason, with the topic that caused it. Every rejection is counted, so the
    // scale is never lost; logging all of them at 1 Hz across 200 topics would be a flood
    // that hides the first occurrence, which is the one worth reading.
    if (!loggedReasons.has(reason)) {
      loggedReasons.add(reason);
      logger.warn(
        `perch: dropped a message on ${topic} (${reason}); further ones are counted only`,
      );
    }
  }

  function currentStatus(): SensorSourceStatus {
    if (closed) return 'error';

    if (link === 'opening') return 'connecting';
    if (link === 'down') return 'error';

    if (lastReadingAt === undefined) {
      // Link up, nothing on it yet. Before the first reading ever, that is `connecting`;
      // after a reconnect it is `stale`, because the transport has already proved itself.
      return everReceived ? 'stale' : 'connecting';
    }

    return now() - lastReadingAt <= staleAfterMs ? 'live' : 'stale';
  }

  return {
    url,
    origin,

    get status() {
      return currentStatus();
    },

    get stats(): MqttSourceStats {
      return Object.freeze({
        readingsAccepted,
        metaAccepted,
        metaCleared,
        rejected,
        rejectionsByReason: Object.freeze({ ...counters }),
        connects,
        connectionFailures,
      });
    },

    subscribe(pattern: string, onReading: SensorReadingHandler): Unsubscribe {
      // The broker subscription is fixed at two patterns (see the module comment), so a
      // consumer's pattern is a local filter on an already-narrow stream rather than a new
      // SUBSCRIBE. A desktop publishes on the order of 200 topics at 1 Hz; matching those in
      // process costs less than a subscription table that has to be reconciled on every
      // reconnect, and it keeps meta structurally out of this path.
      subscribers.set(onReading, pattern);

      let live = true;
      return () => {
        if (!live) return; // calling twice is harmless
        live = false;
        subscribers.delete(onReading);
      };
    },

    meta(topic) {
      // Retained metadata is deliberately *not* cleared on a link drop: the retained
      // companions will be redelivered on resubscribe, and blanking every label for the
      // duration of a reboot would make the gap look like a data-model failure. `status`
      // already says the link is down; the label is still the right label.
      return metas.get(topic);
    },

    ready() {
      return readyPromise;
    },

    async close() {
      if (closed) return;
      closed = true;
      link = 'down';
      rejectReady?.(new Error(`perch: source for ${url} was closed before it subscribed`));
      // `force: true`: a broker that has already gone away will never acknowledge a clean
      // DISCONNECT, and a close that can hang is a close a test cannot rely on.
      await client.endAsync(true);
    },
  };
}

type DecodedBody =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly reason: SensorMessageRejection };

const consoleLogger: SourceLogger = {
  warn(message: string) {
    console.warn(message);
  },
};

/** Drop the trailing `/meta` level. The caller has already matched the meta pattern. */
function stripMetaSuffix(topic: string): string {
  return topic.slice(0, -(SENSOR_META_SUFFIX.length + 1));
}

function checkPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number, got ${value}`);
  }
}

/**
 * A distinct client id per source. Two sources sharing one id make the broker evict whichever
 * connected first, which presents as an endless reconnect loop with no error worth reading.
 */
function randomClientId(): string {
  return `perch-${Math.floor(Math.random() * 0x1_0000_0000).toString(16)}`;
}
