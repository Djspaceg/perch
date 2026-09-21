/**
 * Reporting a failure that keeps happening, without repeating yourself 360 000 times.
 *
 * The relay polls once a second against a host a human switches off for days. Logging every
 * failure means 86 400 identical lines a day, and the damage is not the volume — it is that the
 * two lines carrying information, the first failure and a *change* of reason, are buried in a
 * wall of text nobody scrolls through. Lowering the severity or dropping the message would fix
 * the volume and destroy the report, which is the opposite trade.
 *
 * So a run of failures is collapsed into the lines that say something new:
 *
 * - **The first failure**, in full. Its reason is the diagnostic.
 * - **A changed reason**, immediately, in full, naming what it changed *from*. `ECONNREFUSED`
 *   becoming a timeout is the difference between "host up, nothing listening" and "host gone",
 *   and it is invisible in a stream of identical lines.
 * - **A periodic summary**, on an escalating interval, so a reader tailing the log can answer
 *   "is it still broken, since when, and why" without waiting and without scrolling.
 * - **Recovery**, with the outage's duration and how many attempts failed, so an operator who
 *   walks up after it healed can still see that it happened.
 *
 * Everything in between is suppressed, and nothing is downgraded: failures stay on `error`.
 *
 * ## Why the summary interval escalates
 *
 * A fixed interval has to choose between being useless early and noisy late. Ten seconds is
 * right in the first minute, when a human is watching and wants to know the relay is still
 * trying; it is 36 000 lines across a four-day outage. An hour is right overnight and leaves the
 * first minute silent, which reads exactly like the process having died.
 *
 * So the gap starts at `FIRST_SUMMARY_MS` and doubles after each summary, capped at
 * `MAX_SUMMARY_INTERVAL_MS`: 10 s, 30 s, 1 m 10 s, 2 m 30 s, 5 m 10 s, 10 m 30 s, 21 m, 42 m,
 * then hourly. The cost is bounded and easy to reason about — logarithmic while it ramps, one
 * line an hour after, so the 100-hour outage this was written for produces about 108 lines
 * instead of 360 000, and the reader is never more than an hour from a fresh confirmation.
 *
 * ## The clock is a parameter
 *
 * Every decision here is about elapsed time, so every entry point takes `at` rather than reading
 * a clock. The timing is then assertable without waiting: `failure-log.test.ts` runs a hundred
 * hours of outage in a loop.
 */

/** The two levels this module writes at. Structurally satisfied by `RelayLogger`. */
export interface FailureLogger {
  info(message: string): void;
  error(message: string): void;
}

/**
 * How one kind of repeating failure is named in the log.
 *
 * Two fields rather than one, because the first line of an outage is the one place the wording
 * has to be specific: a poll that could not reach LHM "failed", while a tick that threw out of
 * the loop "aborted unexpectedly" — a defect in the relay itself, and worth saying so.
 */
export interface FailureKind {
  /** The thing that keeps failing, as the subject of every line: `poll`, `tick`. */
  readonly subject: string;
  /** How the first line of an outage reports it: `failed`, `aborted unexpectedly`. */
  readonly failed: string;
}

/**
 * What a run of failures remembers between events.
 *
 * Mutable and owned by the caller, like the rest of `RelayState`: the relay keeps one of these
 * per failure kind, and a single event stays a function of its inputs.
 */
export interface FailureRun {
  /** The reason currently repeating, or `undefined` when the last event was a success. */
  reason: string | undefined;
  /** Epoch ms of the first failure in this run. Survives a change of reason. */
  startedAt: number;
  /** Consecutive failures in this run, counting across changes of reason. */
  attempts: number;
  /** Epoch ms at or after which the next summary is due. */
  nextSummaryAt: number;
  /** The gap that produced `nextSummaryAt`. Doubles per summary, capped. */
  summaryIntervalMs: number;
}

/** The first summary of an outage, and the gap the ladder starts from. */
export const FIRST_SUMMARY_MS = 10_000;

/** The gap the ladder stops growing at: one confirmation an hour, however long the outage runs. */
export const MAX_SUMMARY_INTERVAL_MS = 3_600_000;

export function createFailureRun(): FailureRun {
  return {
    reason: undefined,
    startedAt: 0,
    attempts: 0,
    nextSummaryAt: 0,
    summaryIntervalMs: FIRST_SUMMARY_MS,
  };
}

/**
 * Record a failure, and log it if it says something new.
 *
 * Idle in the common case — a repeat inside the current quiet window mutates two counters and
 * writes nothing.
 */
export function noteFailure(
  logger: FailureLogger,
  run: FailureRun,
  kind: FailureKind,
  reason: string,
  at: number,
): void {
  if (run.reason === undefined) {
    run.reason = reason;
    run.startedAt = at;
    run.attempts = 1;
    restartLadder(run, at);
    logger.error(`${kind.subject} ${kind.failed}: ${reason}`);
    return;
  }

  run.attempts += 1;

  if (reason !== run.reason) {
    const previous = run.reason;
    run.reason = reason;
    // The ladder restarts but `startedAt` does not: the source is still down, and resetting the
    // outage clock would report a five-day outage as five seconds old. What restarts is the
    // reassurance cadence, because a new reason is the moment a human starts watching again.
    restartLadder(run, at);
    logger.error(
      `${kind.subject} failure reason changed after ${formatDuration(at - run.startedAt)} ` +
        `and ${countAttempts(run.attempts)}: ${reason} (was: ${previous})`,
    );
    return;
  }

  if (at < run.nextSummaryAt) return;

  run.summaryIntervalMs = Math.min(run.summaryIntervalMs * 2, MAX_SUMMARY_INTERVAL_MS);
  run.nextSummaryAt = at + run.summaryIntervalMs;
  logger.error(
    `${kind.subject} still failing after ${formatDuration(at - run.startedAt)} ` +
      `(${String(run.attempts)} consecutive failures since ${new Date(run.startedAt).toISOString()}): ` +
      run.reason,
  );
}

/**
 * Record a success, ending any run in progress.
 *
 * Silent when nothing was failing, so the steady state stays quiet. `detail` is whatever the
 * caller wants on the recovery line — the relay puts the reading count there, which is the
 * proof that the source is not just reachable but answering.
 */
export function noteSuccess(
  logger: FailureLogger,
  run: FailureRun,
  kind: FailureKind,
  at: number,
  detail?: string,
): void {
  const reason = run.reason;
  if (reason === undefined) return;

  const suffix = detail === undefined ? '' : `; ${detail}`;
  logger.info(
    `${kind.subject} recovered after ${formatDuration(at - run.startedAt)}, ` +
      `${countAttempts(run.attempts)}, last failure: ${reason}${suffix}`,
  );

  // Reset in full rather than clearing the reason alone, so a second outage is reported like a
  // first one: a line of its own, and the ladder back at its base.
  run.reason = undefined;
  run.startedAt = 0;
  run.attempts = 0;
  run.nextSummaryAt = 0;
  run.summaryIntervalMs = FIRST_SUMMARY_MS;
}

function restartLadder(run: FailureRun, at: number): void {
  run.summaryIntervalMs = FIRST_SUMMARY_MS;
  run.nextSummaryAt = at + FIRST_SUMMARY_MS;
}

function countAttempts(attempts: number): string {
  return `${String(attempts)} failed ${attempts === 1 ? 'attempt' : 'attempts'}`;
}

/**
 * An elapsed duration a human reads at a glance: `45s`, `2m 30s`, `4h 12m 03s`.
 *
 * Seconds are floored, not rounded: "still failing after 10s" on the tick that crossed ten
 * seconds is the honest reading, and a duration that rounds up can print a figure the clock has
 * not reached.
 */
export function formatDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  if (hours > 0) return `${String(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
  if (minutes > 0) return `${String(minutes)}m ${String(seconds)}s`;
  return `${String(seconds)}s`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
