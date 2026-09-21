/**
 * The poll loop: read LHM, map, publish, report. One process, one tick at a time.
 *
 * ## What a tick does
 *
 * 1. Take the clock **once**, then `GET /data.json`. `at` is the time the response arrived,
 *    which is as close to "when the source read it" as an HTTP poller can get, and it is one
 *    timestamp for the whole snapshot so two sensors from the same poll never look differently
 *    stale.
 * 2. Publish every reading, unretained.
 * 3. Publish each sensor's metadata **once**, retained, the first time that topic is seen. A
 *    label does not change between polls, and re-sending 213 retained messages a second would
 *    make the broker's retained store the busiest thing in the process for no information.
 * 4. Report what happened, including the things that went wrong.
 *
 * ## Ticks never overlap
 *
 * The next tick is scheduled when the current one finishes, not on a fixed `setInterval`. With
 * an interval, a poll slower than the period — a sleeping host, a 1500 ms timeout against a
 * 1000 ms interval — would have a second poll start before the first returned, and the two
 * would publish interleaved snapshots with `at` values out of order. A dashboard's staleness
 * check cannot recover from that. The cost is that the real period is interval plus poll
 * duration, which is the honest trade and is what the startup report calls an interval.
 *
 * ## A failed poll publishes nothing at all
 *
 * Not `null` for every sensor. `SensorReading.value === null` means "this sensor is present and
 * reporting nothing" — the unpopulated fan header in the capture — and overloading it with "the
 * relay cannot reach LHM" would destroy a distinction the contract exists to make. When the
 * source is unreachable the relay publishes nothing, `at` ages, and the runtime's staleness
 * detection is what tells the dashboard. The failure is written to the log every time it
 * happens, so it is visible where a human looks, which is what SPEC rule 4 asks for. See
 * DECISIONS.md.
 */

import { SENSOR_META_SUFFIX, type SensorTopic } from '@perch/sensor-contract';
import type { BrokerPublisher } from './broker.js';
import type { LhmDataFetcher } from './lhm-client.js';
import { readLhmPayload, type LhmTopicCollision } from './lhm-tree.js';

/** Where the relay's own diagnostics go. Injected so a test can read them instead of stderr. */
export interface RelayLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface RelayDeps {
  readonly fetchLhmData: LhmDataFetcher;
  readonly broker: BrokerPublisher;
  readonly logger: RelayLogger;
  /** Epoch milliseconds. Injected so `at` is assertable. */
  readonly now: () => number;
}

/** What one tick did. Returned for the log line and for tests to assert on. */
export interface PollReport {
  /** Epoch ms stamped on every reading in this tick. */
  readonly at: number;
  /** Sensor nodes found in the payload, before mapping. */
  readonly sensorsRead: number;
  /** Reading messages published — one per distinct topic. */
  readonly readingsPublished: number;
  /** Retained metadata messages published this tick. Zero after the first successful poll. */
  readonly metaPublished: number;
  /** Identifiers the contract had no topic for. */
  readonly unmapped: readonly string[];
  /** Duplicate-identifier collisions seen this tick. */
  readonly collisions: readonly LhmTopicCollision[];
  /** Set when the poll failed; every count above is then zero. */
  readonly failure?: string;
}

export interface RelayHandle {
  /** Resolves once the loop has stopped and no further publish will happen. */
  stop(): Promise<void>;
}

/**
 * Run one poll: fetch, map, publish.
 *
 * Resolves with a report in every case, including failure, so a caller cannot forget to handle
 * a rejection and silently stop polling. `state` carries what must persist across ticks — which
 * metadata has been sent and which collisions have already been warned about — and is owned by
 * the caller so that a single poll stays a function of its inputs.
 */
export async function runOnePoll(deps: RelayDeps, state: RelayState): Promise<PollReport> {
  let payload: unknown;
  const at = deps.now();

  try {
    payload = await deps.fetchLhmData();
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    deps.logger.error(`poll failed: ${failure}`);

    return {
      at,
      sensorsRead: 0,
      readingsPublished: 0,
      metaPublished: 0,
      unmapped: [],
      collisions: [],
      failure,
    };
  }

  // The clock is read again here rather than reusing the pre-request reading: `at` is meant to
  // be when the source produced the value, and LHM samples on the request. Between the two
  // lies the whole round trip, which on a LAN at a 1 s interval is a material fraction of a
  // tick.
  const readAt = deps.now();
  const mapping = readLhmPayload(payload, readAt);

  let metaPublished = 0;
  for (const sensor of mapping.sensors) {
    await deps.broker.publish(sensor.topic, JSON.stringify(sensor.reading), { retain: false });

    if (!state.metaSent.has(sensor.topic)) {
      // The meta topic is built by appending the contract's own suffix constant to a topic the
      // contract produced, rather than by calling `sensorMetaTopic` with re-parsed parts: the
      // topic in hand is already canonical, and re-deriving it would mean parsing a string
      // this module just received from the builder.
      await deps.broker.publish(
        `${sensor.topic}/${SENSOR_META_SUFFIX}`,
        JSON.stringify(sensor.meta),
        { retain: true },
      );
      state.metaSent.add(sensor.topic);
      metaPublished += 1;
    }
  }

  reportAnomalies(deps.logger, state, mapping.unmapped, mapping.collisions);

  return {
    at: readAt,
    sensorsRead: mapping.sensors.length + mapping.collisions.length + mapping.unmapped.length,
    readingsPublished: mapping.sensors.length,
    metaPublished,
    unmapped: mapping.unmapped,
    collisions: mapping.collisions,
  };
}

/** What the loop remembers between ticks. */
export interface RelayState {
  /** Topics whose retained metadata has been published. */
  readonly metaSent: Set<SensorTopic>;
  /** Topics whose duplicate-identifier collision has been warned about. */
  readonly collisionsWarned: Set<SensorTopic>;
  /** Identifiers already reported as unmappable. */
  readonly unmappedWarned: Set<string>;
  /** Whether the previous tick failed, so recovery is logged once rather than never. */
  failing: boolean;
}

export function createRelayState(): RelayState {
  return {
    metaSent: new Set<SensorTopic>(),
    collisionsWarned: new Set<SensorTopic>(),
    unmappedWarned: new Set<string>(),
    failing: false,
  };
}

/**
 * Start the loop. Returns a handle whose `stop` waits for the tick in flight.
 *
 * The first poll runs immediately rather than after one interval, so a human starting the
 * relay finds out within a second whether it can reach LHM — SPEC.md's "first-run check that
 * reports what it found rather than failing silently".
 */
export function startRelay(pollIntervalMs: number, deps: RelayDeps): RelayHandle {
  const state = createRelayState();
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const tick = async (): Promise<void> => {
    const report = await runOnePoll(deps, state);
    logTick(deps.logger, state, report);
  };

  const schedule = (): void => {
    if (stopped) return;

    timer = setTimeout(() => {
      inFlight = tick().then(schedule, (error: unknown) => {
        // `runOnePoll` resolves on every expected failure, so reaching here means a defect in
        // the relay itself — a publish that rejected, say. Reported loudly, and the loop
        // continues, because a broker hiccup must not end a long-lived service.
        deps.logger.error(`tick aborted unexpectedly: ${describe(error)}`);
        schedule();
      });
    }, pollIntervalMs);
  };

  inFlight = tick().then(schedule, (error: unknown) => {
    deps.logger.error(`first tick aborted unexpectedly: ${describe(error)}`);
    schedule();
  });

  return {
    stop: async (): Promise<void> => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      await inFlight;
    },
  };
}

/**
 * One line per tick, and only when it says something new.
 *
 * A per-tick success line at 1 Hz is 86 400 identical lines a day, which is how a log stops
 * being read at all. So the steady state is quiet: the first successful poll is logged, every
 * failure is logged, and a recovery is logged. Anything anomalous is logged once per distinct
 * cause by `reportAnomalies`.
 */
function logTick(logger: RelayLogger, state: RelayState, report: PollReport): void {
  if (report.failure !== undefined) {
    state.failing = true;
    return;
  }

  if (state.failing) {
    logger.info(`recovered: ${report.readingsPublished} readings published`);
    state.failing = false;
    return;
  }

  if (report.metaPublished > 0) {
    logger.info(
      `publishing ${report.readingsPublished} readings, ${report.metaPublished} retained metadata topics`,
    );
  }
}

/** Warn once per distinct cause, so a per-tick anomaly does not become a per-tick log line. */
function reportAnomalies(
  logger: RelayLogger,
  state: RelayState,
  unmapped: readonly string[],
  collisions: readonly LhmTopicCollision[],
): void {
  for (const sensorId of unmapped) {
    if (state.unmappedWarned.has(sensorId)) continue;
    state.unmappedWarned.add(sensorId);
    logger.warn(
      `no topic for LHM sensor ${sensorId}: its hardware or sensor type is outside the contract's vocabulary, so it is not published`,
    );
  }

  for (const collision of collisions) {
    if (state.collisionsWarned.has(collision.topic)) continue;
    state.collisionsWarned.add(collision.topic);
    logger.warn(
      `LHM reports two sensors under one identifier ${collision.sensorId}: ` +
        `publishing ${JSON.stringify(collision.keptLabel)} and dropping ` +
        `${JSON.stringify(collision.droppedLabel)} on ${collision.topic}. ` +
        `Two sensors share one identity at the source, so no topic can carry both.`,
    );
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
