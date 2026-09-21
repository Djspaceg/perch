/**
 * The collapsing failure log, driven by an injected clock.
 *
 * Every case here is about elapsed time, and none of it waits: the clock is a number this file
 * moves by hand, so a hundred hours of outage is a loop rather than a hundred hours. That is the
 * only way the escalation ladder is testable at all — the interesting line is the one emitted
 * after an hour of silence.
 */

import { describe, expect, it } from 'vitest';
import {
  FIRST_SUMMARY_MS,
  MAX_SUMMARY_INTERVAL_MS,
  createFailureRun,
  noteFailure,
  noteSuccess,
  type FailureKind,
  type FailureRun,
} from './failure-log.js';

const POLL: FailureKind = { subject: 'poll', failed: 'failed' };
const START = 1_758_000_000_000;
const TIMEOUT = 'GET http://192.168.1.3:8085/data.json failed: no response within 1500 ms';
const REFUSED = 'GET http://192.168.1.3:8085/data.json failed: fetch failed (ECONNREFUSED)';

function collecting(): {
  logger: { info(m: string): void; error(m: string): void };
  lines: string[];
} {
  const lines: string[] = [];

  return {
    lines,
    logger: {
      info: (message: string) => lines.push(`info: ${message}`),
      error: (message: string) => lines.push(`error: ${message}`),
    },
  };
}

/** One failure per second for `seconds`, starting at `START`, all with the same reason. */
function failFor(
  seconds: number,
  logger: { info(m: string): void; error(m: string): void },
  run: FailureRun,
  reason = TIMEOUT,
  from = START,
): number {
  let at = from;
  for (let second = 0; second < seconds; second += 1) {
    at = from + second * 1000;
    noteFailure(logger, run, POLL, reason, at);
  }
  return at;
}

describe('the first failure of an outage', () => {
  it('is logged in full, reason and all', () => {
    // The first failure's reason is the diagnostic. Nothing about collapsing repeats is allowed
    // to cost the one line that says what went wrong.
    const { logger, lines } = collecting();

    noteFailure(logger, createFailureRun(), POLL, TIMEOUT, START);

    expect(lines).toEqual([`error: poll failed: ${TIMEOUT}`]);
  });

  it("uses the kind's own verb, so a tick defect does not read as a poll failure", () => {
    const { logger, lines } = collecting();

    noteFailure(
      logger,
      createFailureRun(),
      { subject: 'tick', failed: 'aborted unexpectedly' },
      'broker gone',
      START,
    );

    expect(lines).toEqual(['error: tick aborted unexpectedly: broker gone']);
  });
});

describe('identical consecutive failures', () => {
  it('produce one line plus summaries, not one line each', () => {
    const { logger, lines } = collecting();
    const run = createFailureRun();

    failFor(300, logger, run);

    // 300 polls, and the reader is not asked to scroll past 300 lines to learn nothing.
    expect(lines.length).toBeLessThan(10);
    expect(lines.filter((line) => line === `error: poll failed: ${TIMEOUT}`)).toHaveLength(1);
  });

  it('emit their first summary at the base interval and nothing before it', () => {
    const { logger, lines } = collecting();
    const run = createFailureRun();

    failFor(FIRST_SUMMARY_MS / 1000, logger, run);
    expect(lines).toHaveLength(1);

    noteFailure(logger, run, POLL, TIMEOUT, START + FIRST_SUMMARY_MS);
    expect(lines).toHaveLength(2);
  });

  it('carry the reason, the duration and the count in every summary', () => {
    // Someone who starts tailing mid-outage sees only summaries. Each one has to answer "is it
    // still broken, since when, and why" on its own.
    const { logger, lines } = collecting();
    const run = createFailureRun();

    failFor(11, logger, run);

    expect(lines[1]).toContain('poll still failing after 10s');
    expect(lines[1]).toContain('11 consecutive failures');
    expect(lines[1]).toContain(TIMEOUT);
    expect(lines[1]).toContain(new Date(START).toISOString());
  });

  it('space the summaries out on a doubling ladder', () => {
    const { logger, lines } = collecting();
    const run = createFailureRun();

    failFor(700, logger, run);

    const elapsed = lines
      .filter((line) => line.includes('still failing'))
      .map((line) => /after ([0-9hms ]+) /.exec(line)?.[1]);
    expect(elapsed).toEqual(['10s', '30s', '1m 10s', '2m 30s', '5m 10s', '10m 30s']);
  });

  it('cap the ladder so a hundred-hour outage is a hundred lines, not 360 000', () => {
    const { logger, lines } = collecting();
    const run = createFailureRun();
    const hours = 100;

    for (let second = 0; second < hours * 3600; second += 1) {
      noteFailure(logger, run, POLL, TIMEOUT, START + second * 1000);
    }

    // Bounded by the ramp plus one an hour once the interval caps.
    expect(lines.length).toBeLessThan(hours + 15);
    expect(lines.length).toBeGreaterThan(hours);
    expect(MAX_SUMMARY_INTERVAL_MS).toBe(3_600_000);
  });
});

describe('a changed reason', () => {
  it('logs immediately, even mid-silence, and names what it changed from', () => {
    // ECONNREFUSED becoming a timeout is the difference between "host up, nothing listening" and
    // "host gone". Holding that until the next scheduled summary would hide a state change.
    const { logger, lines } = collecting();
    const run = createFailureRun();

    const last = failFor(5, logger, run, REFUSED);
    noteFailure(logger, run, POLL, TIMEOUT, last + 1000);

    const changed = lines[lines.length - 1];
    expect(changed).toContain('poll failure reason changed');
    expect(changed).toContain(TIMEOUT);
    expect(changed).toContain(`was: ${REFUSED}`);
    expect(changed).toContain('6 failed attempts');
  });

  it('restarts the summary ladder without restarting the outage clock', () => {
    const { logger, lines } = collecting();
    const run = createFailureRun();

    failFor(100, logger, run, REFUSED);
    lines.length = 0;
    noteFailure(logger, run, POLL, TIMEOUT, START + 100_000);
    // The ladder is back at its base, so the change is followed by an early reassurance.
    noteFailure(logger, run, POLL, TIMEOUT, START + 100_000 + FIRST_SUMMARY_MS);

    expect(lines[1]).toContain('still failing after 1m 50s');
    expect(lines[1]).toContain('102 consecutive failures');
  });
});

describe('recovery', () => {
  it('says how long the outage lasted and how many attempts failed', () => {
    const { logger, lines } = collecting();
    const run = createFailureRun();

    const last = failFor(65, logger, run);
    noteSuccess(logger, run, POLL, last + 1000, '213 readings published');

    const recovered = lines[lines.length - 1];
    expect(recovered).toContain('info: poll recovered after 1m 5s');
    expect(recovered).toContain('65 failed attempts');
    expect(recovered).toContain(TIMEOUT);
    expect(recovered).toContain('213 readings published');
  });

  it('counts one failed attempt as one', () => {
    const { logger, lines } = collecting();
    const run = createFailureRun();

    noteFailure(logger, run, POLL, TIMEOUT, START);
    noteSuccess(logger, run, POLL, START + 1000);

    expect(lines[1]).toContain('1 failed attempt,');
  });

  it('says nothing when nothing was wrong', () => {
    const { logger, lines } = collecting();

    noteSuccess(logger, createFailureRun(), POLL, START);

    expect(lines).toEqual([]);
  });
});

describe('a second outage', () => {
  it('behaves like a fresh first failure, not a continuation of the old one', () => {
    const { logger, lines } = collecting();
    const run = createFailureRun();

    failFor(100, logger, run);
    noteSuccess(logger, run, POLL, START + 100_000);
    lines.length = 0;

    const secondStart = START + 200_000;
    noteFailure(logger, run, POLL, TIMEOUT, secondStart);
    noteFailure(logger, run, POLL, TIMEOUT, secondStart + FIRST_SUMMARY_MS);

    expect(lines[0]).toBe(`error: poll failed: ${TIMEOUT}`);
    expect(lines[1]).toContain('still failing after 10s');
    expect(lines[1]).toContain('2 consecutive failures');
    expect(lines[1]).toContain(new Date(secondStart).toISOString());
  });
});
