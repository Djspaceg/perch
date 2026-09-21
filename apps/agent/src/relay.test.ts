/**
 * The poll loop, against a recording broker and a stubbed fetch.
 *
 * No sockets and no timers-in-anger: `runOnePoll` is called directly with the captured payload,
 * so what the relay would actually put on the wire for real hardware is assertable message by
 * message. `broker.test.ts` covers the transport; this file covers what goes through it.
 */

import { describe, expect, it, vi } from 'vitest';
import { isSensorMeta, isSensorReading, isSensorTopic } from '@perch/sensor-contract';
import type { BrokerPublisher, PublishOptions } from './broker.js';
import {
  createRelayState,
  runOnePoll,
  startRelay,
  type RelayDeps,
  type RelayLogger,
} from './relay.js';
import {
  LHM_FIXTURE_SENSOR_COUNT,
  LHM_FIXTURE_TOPIC_COUNT,
  loadLhmFixturePayload,
} from './lhm-fixture.test-support.js';

interface RecordedMessage {
  readonly topic: string;
  readonly payload: string;
  readonly retain: boolean;
}

/** A broker that records instead of transporting. */
function recordingBroker(): { broker: BrokerPublisher; messages: RecordedMessage[] } {
  const messages: RecordedMessage[] = [];

  return {
    messages,
    broker: {
      publish: (topic: string, payload: string, options: PublishOptions) => {
        messages.push({ topic, payload, retain: options.retain });
        return Promise.resolve();
      },
    },
  };
}

function collectingLogger(): { logger: RelayLogger; lines: string[] } {
  const lines: string[] = [];

  return {
    lines,
    logger: {
      info: (message) => lines.push(`info: ${message}`),
      warn: (message) => lines.push(`warn: ${message}`),
      error: (message) => lines.push(`error: ${message}`),
    },
  };
}

const AT = 1_758_000_000_000;

function depsFor(
  fetchLhmData: () => Promise<unknown>,
  now: () => number = () => AT,
): { deps: RelayDeps; messages: RecordedMessage[]; lines: string[] } {
  const { broker, messages } = recordingBroker();
  const { logger, lines } = collectingLogger();

  return { deps: { fetchLhmData, broker, logger, now }, messages, lines };
}

const payload = loadLhmFixturePayload();

describe('one poll against the captured payload', () => {
  it('publishes 213 readings and 213 retained metadata companions', async () => {
    const { deps, messages } = depsFor(() => Promise.resolve(payload));
    const report = await runOnePoll(deps, createRelayState());

    expect(report.sensorsRead).toBe(LHM_FIXTURE_SENSOR_COUNT);
    expect(report.readingsPublished).toBe(LHM_FIXTURE_TOPIC_COUNT);
    expect(report.metaPublished).toBe(LHM_FIXTURE_TOPIC_COUNT);
    expect(messages).toHaveLength(LHM_FIXTURE_TOPIC_COUNT * 2);
  });

  it('publishes readings unretained and metadata retained', async () => {
    // A retained reading is a stale reading that arrives looking fresh to a late subscriber;
    // `at` is the only thing that would tell them otherwise. A label, by contrast, is exactly
    // what a late subscriber needs and cannot recompute.
    const { deps, messages } = depsFor(() => Promise.resolve(payload));
    await runOnePoll(deps, createRelayState());

    for (const message of messages) {
      expect(message.retain, message.topic).toBe(message.topic.endsWith('/meta'));
    }
  });

  it('publishes bodies the contract validates, on topics it accepts', async () => {
    const { deps, messages } = depsFor(() => Promise.resolve(payload));
    await runOnePoll(deps, createRelayState());

    for (const message of messages) {
      const body: unknown = JSON.parse(message.payload);

      if (message.topic.endsWith('/meta')) {
        expect(isSensorMeta(body), message.topic).toBe(true);
        expect(isSensorTopic(message.topic.slice(0, -'/meta'.length)), message.topic).toBe(true);
      } else {
        expect(isSensorReading(body), message.topic).toBe(true);
        expect(isSensorTopic(message.topic), message.topic).toBe(true);
      }
    }
  });

  it('puts the meta companion on the topic plus /meta and nowhere else', async () => {
    const { deps, messages } = depsFor(() => Promise.resolve(payload));
    await runOnePoll(deps, createRelayState());

    const readings = messages.filter((message) => !message.topic.endsWith('/meta'));
    const metas = messages.filter((message) => message.topic.endsWith('/meta'));

    expect(new Set(metas.map((message) => message.topic.slice(0, -'/meta'.length)))).toEqual(
      new Set(readings.map((message) => message.topic)),
    );
  });

  it('stamps at from read time, not publish time', async () => {
    // `now` is called twice — once before the request, once when the response is in hand — and
    // the reading carries the second, because `at` means when the source produced the value.
    let call = 0;
    const clock = (): number => {
      call += 1;
      return AT + call * 10;
    };
    const { deps, messages } = depsFor(() => Promise.resolve(payload), clock);
    const report = await runOnePoll(deps, createRelayState());

    expect(report.at).toBe(AT + 20);
    for (const message of messages.filter((m) => !m.topic.endsWith('/meta'))) {
      expect(JSON.parse(message.payload)).toEqual(expect.objectContaining({ at: AT + 20 }));
    }
  });
});

describe('metadata is published once, not every tick', () => {
  it('sends nothing retained on the second poll', async () => {
    // 213 retained messages a second would make the broker's retained store the busiest thing
    // in the process, and a label does not change between polls.
    const { deps, messages } = depsFor(() => Promise.resolve(payload));
    const state = createRelayState();

    const first = await runOnePoll(deps, state);
    messages.length = 0;
    const second = await runOnePoll(deps, state);

    expect(first.metaPublished).toBe(LHM_FIXTURE_TOPIC_COUNT);
    expect(second.metaPublished).toBe(0);
    expect(messages).toHaveLength(LHM_FIXTURE_TOPIC_COUNT);
    expect(messages.every((message) => !message.topic.endsWith('/meta'))).toBe(true);
  });

  it('sends metadata for a sensor that appears later', async () => {
    // A GPU that was asleep on the first poll, a USB sensor plugged in afterwards.
    const one = {
      Children: [{ SensorId: '/amdcpu/0/temperature/0', Text: 'A', RawValue: '40.0 °C' }],
    };
    const two = {
      Children: [
        { SensorId: '/amdcpu/0/temperature/0', Text: 'A', RawValue: '41.0 °C' },
        { SensorId: '/gpu-nvidia/0/temperature/0', Text: 'B', RawValue: '50.0 °C' },
      ],
    };
    let next: unknown = one;
    const { deps, messages } = depsFor(() => Promise.resolve(next));
    const state = createRelayState();

    await runOnePoll(deps, state);
    next = two;
    messages.length = 0;
    const second = await runOnePoll(deps, state);

    expect(second.metaPublished).toBe(1);
    expect(messages.filter((m) => m.retain).map((m) => m.topic)).toEqual([
      'sensors/gpu/0/temperature/0/meta',
    ]);
  });
});

describe('a failed poll publishes nothing at all', () => {
  it('does not publish null for every sensor', async () => {
    // `value: null` means "this sensor is present and reporting nothing" — the unpopulated fan
    // header in the capture. Overloading it with "the relay cannot reach LHM" would destroy a
    // distinction the contract exists to make. Staleness is `at`'s job.
    const { deps, messages, lines } = depsFor(() =>
      Promise.reject(new Error('GET http://localhost:8085/data.json failed: connect ECONNREFUSED')),
    );
    const report = await runOnePoll(deps, createRelayState());

    expect(messages).toEqual([]);
    expect(report.readingsPublished).toBe(0);
    expect(report.failure).toContain('ECONNREFUSED');
    expect(lines).toEqual([expect.stringContaining('error: poll failed')]);
  });

  it('resolves rather than rejecting, so a caller cannot silently stop polling', async () => {
    const { deps } = depsFor(() => Promise.reject(new Error('boom')));

    await expect(runOnePoll(deps, createRelayState())).resolves.toEqual(
      expect.objectContaining({ failure: 'boom' }),
    );
  });

  it('keeps polling after a failure and recovers', async () => {
    let fail = true;
    const { deps, messages, lines } = depsFor(() =>
      fail ? Promise.reject(new Error('down')) : Promise.resolve(payload),
    );
    const state = createRelayState();

    await runOnePoll(deps, state);
    fail = false;
    const second = await runOnePoll(deps, state);

    expect(second.readingsPublished).toBe(LHM_FIXTURE_TOPIC_COUNT);
    expect(messages.length).toBeGreaterThan(0);
    expect(lines[0]).toContain('poll failed: down');
  });

  it('reports a non-Error rejection rather than losing it', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- rejecting with a non-Error is the case under test: `fetch` and its dependencies can throw anything, and "[object Object]" in the log would be worse than useless.
    const { deps } = depsFor(() => Promise.reject('just a string'));

    expect((await runOnePoll(deps, createRelayState())).failure).toBe('just a string');
  });

  it('survives a payload that is not an LHM tree', async () => {
    const { deps, messages } = depsFor(() => Promise.resolve({ unexpected: true }));
    const report = await runOnePoll(deps, createRelayState());

    expect(report.failure).toBeUndefined();
    expect(report.sensorsRead).toBe(0);
    expect(messages).toEqual([]);
  });
});

describe('the duplicate identifier is warned about, once', () => {
  it('names both sensors and the topic on the first poll', async () => {
    const { deps, lines } = depsFor(() => Promise.resolve(payload));
    const warning = await runOnePoll(deps, createRelayState()).then(() =>
      lines.find((line) => line.startsWith('warn:')),
    );

    expect(warning).toContain('/gpu-nvidia/0/load/3');
    expect(warning).toContain('GPU Memory');
    expect(warning).toContain('GPU Bus');
    expect(warning).toContain('sensors/gpu/0/load/3');
  });

  it('does not repeat the warning every tick', async () => {
    // At 1 Hz an every-tick warning is 86 400 identical lines a day, which is how a log stops
    // being read. Once per distinct cause is the rule.
    const { deps, lines } = depsFor(() => Promise.resolve(payload));
    const state = createRelayState();

    await runOnePoll(deps, state);
    const afterFirst = lines.filter((line) => line.startsWith('warn:')).length;
    await runOnePoll(deps, state);
    await runOnePoll(deps, state);

    expect(afterFirst).toBe(1);
    expect(lines.filter((line) => line.startsWith('warn:'))).toHaveLength(1);
  });

  it('still reports the collision in every report, even when it does not log it again', async () => {
    const { deps } = depsFor(() => Promise.resolve(payload));
    const state = createRelayState();

    await runOnePoll(deps, state);
    const second = await runOnePoll(deps, state);

    expect(second.collisions).toHaveLength(1);
  });
});

describe('an unmappable sensor is warned about, once', () => {
  it('names the identifier and says it is not published', async () => {
    const tree = {
      Children: [
        { SensorId: '/unobtanium/0/temperature/0', Text: 'Mystery', RawValue: '40.0 °C' },
        { SensorId: '/amdcpu/0/temperature/0', Text: 'Core', RawValue: '44.0 °C' },
      ],
    };
    const { deps, messages, lines } = depsFor(() => Promise.resolve(tree));
    const state = createRelayState();

    const report = await runOnePoll(deps, state);
    await runOnePoll(deps, state);

    expect(report.unmapped).toEqual(['/unobtanium/0/temperature/0']);
    expect(lines.filter((line) => line.startsWith('warn:'))).toEqual([
      expect.stringContaining('/unobtanium/0/temperature/0'),
    ]);
    // The sensor it does understand is published regardless.
    expect(messages.some((message) => message.topic === 'sensors/cpu/0/temperature/0')).toBe(true);
  });
});

describe('the loop', () => {
  it('polls immediately rather than waiting out the first interval', async () => {
    // A human starting the relay should find out within a second whether it can reach LHM.
    vi.useFakeTimers();
    try {
      const fetchLhmData = vi.fn(() => Promise.resolve(payload));
      const { deps } = depsFor(fetchLhmData);
      const handle = startRelay(60_000, deps);

      await vi.advanceTimersByTimeAsync(0);
      expect(fetchLhmData).toHaveBeenCalledTimes(1);

      await handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules the next tick only after the current one finishes', async () => {
    // With `setInterval`, a poll slower than the period would overlap the next one and publish
    // two snapshots with `at` out of order, which a staleness check cannot recover from.
    vi.useFakeTimers();
    try {
      let inFlight = 0;
      let maxInFlight = 0;
      let release: (() => void) | undefined;
      const fetchLhmData = vi.fn(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        inFlight -= 1;
        return payload;
      });
      const { deps } = depsFor(fetchLhmData);
      const handle = startRelay(100, deps);

      await vi.advanceTimersByTimeAsync(0);
      // The first poll is still hanging; a whole second of timer time must not start another.
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchLhmData).toHaveBeenCalledTimes(1);
      expect(maxInFlight).toBe(1);

      release?.();
      await vi.advanceTimersByTimeAsync(100);
      expect(fetchLhmData).toHaveBeenCalledTimes(2);
      expect(maxInFlight).toBe(1);

      release?.();
      await handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops cleanly and publishes nothing afterwards', async () => {
    vi.useFakeTimers();
    try {
      const { deps, messages } = depsFor(() => Promise.resolve(payload));
      const handle = startRelay(100, deps);

      await vi.advanceTimersByTimeAsync(0);
      await handle.stop();
      const published = messages.length;

      await vi.advanceTimersByTimeAsync(10_000);
      expect(messages).toHaveLength(published);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps running when a publish rejects, rather than ending the service', async () => {
    vi.useFakeTimers();
    try {
      const { logger, lines } = collectingLogger();
      const handle = startRelay(100, {
        fetchLhmData: () => Promise.resolve(payload),
        broker: { publish: () => Promise.reject(new Error('broker gone')) },
        logger,
        now: () => AT,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(lines).toEqual([expect.stringContaining('broker gone')]);

      // And it is still scheduled: a broker hiccup must not end a long-lived service.
      await vi.advanceTimersByTimeAsync(100);
      expect(lines.length).toBeGreaterThan(1);

      await handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs the first successful poll and then goes quiet', async () => {
    // A per-tick success line at 1 Hz is how a log stops being read at all.
    vi.useFakeTimers();
    try {
      const { deps, lines } = depsFor(() => Promise.resolve(payload));
      const handle = startRelay(100, deps);

      await vi.advanceTimersByTimeAsync(0);
      const afterFirst = lines.filter((line) => line.startsWith('info:'));
      await vi.advanceTimersByTimeAsync(500);

      expect(afterFirst).toEqual([expect.stringContaining('213 readings')]);
      expect(lines.filter((line) => line.startsWith('info:'))).toEqual(afterFirst);

      await handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs a recovery, so a silent log is not the only sign the source came back', async () => {
    vi.useFakeTimers();
    try {
      let fail = true;
      const { deps, lines } = depsFor(() =>
        fail ? Promise.reject(new Error('down')) : Promise.resolve(payload),
      );
      const handle = startRelay(100, deps);

      await vi.advanceTimersByTimeAsync(0);
      fail = false;
      await vi.advanceTimersByTimeAsync(100);

      expect(lines).toContainEqual(expect.stringContaining('info: recovered'));

      await handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
