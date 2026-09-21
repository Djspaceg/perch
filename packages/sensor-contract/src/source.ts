/**
 * What a sensor source is: the one shape every input adapter implements.
 *
 * This interface lives in the contract rather than in `sensor-sources` because `ui-kit`
 * needs it — its provider takes a source as an argument — and `ARCHITECTURE.md` gives
 * `ui-kit` an edge to `sensor-contract` and deliberately no edge to `sensor-sources`.
 * That is the right way round: an interface is a contract, and the implementations are
 * the replaceable part. `sensor-sources` keeps the implementations and imports this.
 *
 * Nothing here knows about a transport. A source may be MQTT over WebSockets, an HTTP
 * poller, a host that already emits metrics, or the mock — SPEC rule 3 holds.
 */

import type { SensorMeta } from './meta.js';
import type { SensorReading } from './reading.js';
import type { SensorTopic } from './topics.js';

/**
 * The connection states a dashboard has to tell apart.
 *
 * `status` is part of the contract deliberately. "No data yet", "the connection died" and
 * "connected, but the publisher stopped" look identical from a widget's point of view —
 * each is simply an absent value — and only the source knows which one it is. A dashboard
 * that renders all three the same way is lying about one of them.
 *
 * - `connecting` — not yet carrying data. Nothing has arrived, and nothing has failed.
 * - `live` — connected and receiving.
 * - `stale` — connected, but the publisher has gone quiet. The transport is fine.
 * - `error` — the connection itself failed. Distinct from `stale`: retrying is the
 *   source's job, and a dashboard should say so rather than show an old number.
 *
 * Per-topic freshness is a separate question from this, and `ui-kit`'s provider answers
 * it from each reading's `at`. A source can be `live` while one sensor of many has aged
 * out.
 */
export const SENSOR_SOURCE_STATUSES = Object.freeze([
  'connecting',
  'live',
  'stale',
  'error',
] as const);

export type SensorSourceStatus = (typeof SENSOR_SOURCE_STATUSES)[number];

/** What `subscribe` hands back. Calling it twice must be harmless. */
export type Unsubscribe = () => void;

/**
 * Called once per reading. The topic is always canonical and fully indexed, so a consumer
 * can use it as an identity key without normalising first.
 */
export type SensorReadingHandler = (topic: SensorTopic, reading: SensorReading) => void;

export interface SensorSource {
  /**
   * Receive every reading whose topic matches `pattern`, until the returned function is
   * called.
   *
   * `pattern` is a plain string rather than a narrowed type because it spans two cases: a
   * single canonical topic from `sensorTopic()`, and a wildcard such as
   * `SENSOR_TOPIC_WILDCARD`. Build the exact-topic case with the contract's builders;
   * never hand-write one. A typed pattern grammar is deferred — see DECISIONS.md.
   *
   * An implementation may deliver readings for topics the caller has already seen, and may
   * deliver nothing at all; a subscription is not a promise that data exists.
   */
  subscribe(pattern: string, onReading: SensorReadingHandler): Unsubscribe;

  /**
   * The metadata for one topic, or `undefined` if the source has none.
   *
   * Synchronous on purpose: metadata is published to a retained companion topic, so a
   * source that is up has it already. `undefined` means "not published", which a consumer
   * renders as a missing label rather than as an error — the topic itself is still valid.
   */
  meta(topic: SensorTopic): SensorMeta | undefined;

  /** The current connection state. Read it; never cache it. */
  readonly status: SensorSourceStatus;
}
