/**
 * One subscription to the source; per-topic snapshots out.
 *
 * This is the store behind `<SensorProvider>`. It is deliberately framework-free — no React
 * import in this file — because its whole surface is shaped to be exactly what
 * `useSyncExternalStore` wants: `subscribe(topic, onChange)` and a `snapshot(topic)` that
 * returns the *same object* until something changes. Everything React-shaped lives next door in
 * `sensor-context.tsx`.
 *
 * Four responsibilities, a fifth below for charts, and one read-only list:
 *
 * 1. Hold **one** subscription to the source, however many widgets are on the dashboard. A
 *    dashboard with forty readouts must not open forty subscriptions, and no widget may ever
 *    reach back to the source to open its own.
 * 2. Keep the latest reading per topic and *publish* a snapshot saying which of
 *    `waiting` / `live` / `stale` it is.
 * 3. Re-evaluate staleness on a clock, because a value ageing out is not an event — no reading
 *    arrives to tell you the publisher died.
 * 4. Pass the source's own connection status through, so nothing downstream holds the source.
 *
 * The source is **injected and never constructed here**. `ui-kit` has no transport and no edge
 * to `sensor-sources`; swapping the mock for MQTT is a change at the app root and touches
 * nothing in this package.
 *
 * ## Snapshots are published, not computed on read
 *
 * `snapshot(topic)` returns a cached object and mints a new one only when the snapshot
 * *materially* changes. That is not an optimisation: `useSyncExternalStore` compares snapshots
 * by reference, so a `getSnapshot` that computed a fresh `{ state, reading, ageMs }` on every
 * call — which is what a live age forces — makes React re-render forever. Publishing also gives
 * the frame budget what it asks for: between two publications the widget's props are byte-for-byte
 * identical, so the same state really is the same pixels.
 *
 * Material change means: the state changed, the reading changed, or a **stale** reading's age
 * crossed a whole second. A live reading's age is not part of it, because nothing renders it —
 * republishing a live value once a second would re-render every widget on the page for no
 * visible difference.
 *
 * ## The fifth responsibility: history, held only where it was asked for
 *
 * A chart needs a *series*, and nothing below this store has one — the source buffers nothing by
 * design and the relay publishes only the latest reading. So the store also keeps a bounded ring per
 * topic, sized by the longest window any mounted chart has retained. The mechanics are in
 * `sensor-history.ts`; what belongs in this comment is the part that is a store decision:
 *
 * - **A topic with no retention has no ring.** `history()` on an unretained topic answers
 *   `NO_HISTORY` and allocates nothing. Recording a series nobody asked for would make memory a
 *   function of how many topics the source publishes, which is the source's business, rather than of
 *   what the layout declared, which is the author's.
 * - **One ring per topic, not one per widget.** Two charts on one topic share the readings and
 *   differ only in how much of them they draw. The store keeps the longer window; each chart is
 *   handed the whole ring and clips to its own `windowMs` at draw time.
 * - **History is published like a snapshot**, for the same `useSyncExternalStore` reason, and it is
 *   republished once per recheck tick even when no reading arrived — because a history snapshot
 *   carries the instant its window *ends*, and a chart whose window stopped advancing would show a
 *   line frozen against a clock that did not stop. The materiality test is whole seconds of
 *   `endsAt` plus the ring's own revision counter, so an idle retained topic republishes at 1 Hz and
 *   a busy one republishes per reading.
 *
 * ## The list of topics seen
 *
 * `topics()` is every topic the source has actually delivered a reading for, in order of first
 * arrival. It is a read of what the one subscription already carries — nothing is subscribed, fetched
 * or published to build it — for a consumer that has to offer a person the sensors that exist, which
 * a topic grammar cannot enumerate: the editor's sensor picker. Published like a snapshot, the same
 * array until a new topic arrives, so `useSyncExternalStore` can read it.
 */

import {
  SENSOR_TOPIC_WILDCARD,
  normalizeSensorTopic,
  type SensorMeta,
  type SensorReading,
  type SensorReadingHandler,
  type SensorSource,
  type SensorSourceStatus,
  type SensorTopic,
  type Unsubscribe,
} from '@perch/sensor-contract';
import { createTopicRing, createWindowDemand, type TopicRing } from './sensor-history.js';

/**
 * What a widget gets for one topic. Three states, because those are the three the *store* can
 * tell apart:
 *
 * - `waiting` — nothing has ever arrived for this topic. Not an error, and not a zero.
 * - `live` — a reading, fresh enough to believe.
 * - `stale` — the last reading, held with its age, because a frozen number with no marking is
 *   worse than an obvious gap.
 *
 * A reading whose `value` is `null` is still a reading and still `live`: the sensor is present
 * and reporting nothing, which is a different fact from having heard nothing at all.
 * Distinguishing those two is the readout's job, and `ReadoutState` in `readout-view.ts` is
 * where the three become four.
 */
export type SensorSnapshot =
  | { readonly state: 'waiting' }
  | { readonly state: 'live'; readonly reading: SensorReading; readonly ageMs: number }
  | { readonly state: 'stale'; readonly reading: SensorReading; readonly ageMs: number };

/**
 * One frozen instance, shared by every topic that has heard nothing.
 *
 * Reference identity is the contract `useSyncExternalStore` reads, and `waiting` carries no
 * per-topic data, so there is nothing to distinguish two of them.
 */
const WAITING: SensorSnapshot = Object.freeze({ state: 'waiting' });

/**
 * One topic's retained series, as published.
 *
 * Three fields, and the middle one is the interesting one. `samples` is what happened; `windowMs` is
 * how much of it anybody asked for; `endsAt` is the instant that window ends — the store's own clock
 * at the moment of publication, carried in the value rather than read from `Date.now()` by whoever
 * draws it.
 *
 * Carrying the clock is what makes a chart's geometry a pure function of its snapshot. A renderer
 * that called `Date.now()` itself would draw a different picture from the same data depending on when
 * React happened to run it, so "same snapshot, same pixels" — the rule the readout is built around
 * and the reason a capture is reproducible — would stop being checkable with a plain assertion.
 *
 * `windowMs: 0` means **nothing is retained for this topic**, which is a different fact from a
 * retained window that happens to be empty: the first is a topic no chart is watching, the second is
 * a chart waiting for its first reading.
 */
export interface SensorHistorySnapshot {
  /** The longest window currently retained, or `0` when nothing retains this topic. */
  readonly windowMs: number;
  /** The instant the window ends: the store clock when this was published. */
  readonly endsAt: number;
  /** Every retained reading, oldest first. Never longer than the window's derived capacity. */
  readonly samples: readonly SensorReading[];
}

/**
 * One frozen instance for every topic nothing retains.
 *
 * Shared by reference for the same reason `WAITING` is: an unretained topic carries no per-topic
 * data, so two of them are indistinguishable, and a fresh object per call would re-render every
 * chart on the page forever.
 */
export const NO_HISTORY: SensorHistorySnapshot = Object.freeze({
  windowMs: 0,
  endsAt: 0,
  samples: Object.freeze([]),
});

/**
 * How long a reading stays believable, in ms.
 *
 * 5 s, from the publish rate: `sensor-contract`'s SPEC describes a 1 Hz publisher, so this
 * tolerates four consecutive missed ticks plus scheduling jitter before a widget starts claiming
 * the value is old. Much shorter (1-2 s) flaps on a GC pause or a slow hardware poll, and a
 * readout that flickers between live and stale is worse than either; much longer (30 s) leaves a
 * dead publisher's frozen number on a wall panel for half a minute, which is the exact failure
 * `at` exists to prevent. Override it per store — `<SensorProvider staleAfterMs={…}>` — for a
 * source that publishes on a different clock.
 */
export const DEFAULT_STALE_AFTER_MS = 5_000;

/**
 * Every optional member is read through a destructuring default, which fires on an explicit
 * `undefined` exactly as it does on absence — so each is declared `?: T | undefined`, which is
 * what `exactOptionalPropertyTypes` asks a type to state. A *payload* shape such as `SensorMeta`
 * deliberately does not do this: there, omitting a field and setting it to `undefined` are
 * different acts, and the flag exists to keep them apart.
 */
export interface SensorStoreOptions {
  /** The source. Injected, never built here. */
  source: SensorSource;
  /** Subscription pattern. Default: every sensor topic. */
  pattern?: string | undefined;
  /** Age after which a reading is reported `stale`. Default `DEFAULT_STALE_AFTER_MS`. */
  staleAfterMs?: number | undefined;
  /** Clock used to age readings. Default `Date.now`; inject one to make a test exact. */
  now?: (() => number) | undefined;
  /**
   * How often to re-check whether anything has aged out, in ms. `0` disables the internal timer,
   * leaving `refresh()` as the only trigger — which is what a test wants, and what a capture loop
   * that already has a frame tick wants.
   */
  recheckIntervalMs?: number | undefined;
}

export interface SensorStore {
  /**
   * The age at which this store reports a reading `stale`, as configured.
   *
   * Exposed because it is the only number in the system that says how long a silence is normal, and
   * a chart needs exactly that to decide where a *hole* is. A chart that picked its own threshold
   * would disagree with the readout beside it about whether the same publisher had gone quiet.
   */
  readonly staleAfterMs: number;
  /**
   * The source's own connection state as last published, so no widget holds the source.
   *
   * *As last published*, deliberately: like a snapshot, this is a value `useSyncExternalStore`
   * may compare by identity, so it changes only when `subscribeStatus` fires.
   */
  readonly sourceStatus: SensorSourceStatus;
  /**
   * The published snapshot for one topic. Accepts the authored shorthand.
   *
   * Stable by reference until the snapshot materially changes, which is the contract
   * `useSyncExternalStore` requires of a `getSnapshot`.
   */
  snapshot(topic: string): SensorSnapshot;
  /** Call `onChange` whenever this topic's published snapshot changes. */
  subscribe(topic: string, onChange: () => void): Unsubscribe;
  /** Call `onChange` whenever `sourceStatus` changes. Never on a mere reading. */
  subscribeStatus(onChange: () => void): Unsubscribe;
  /**
   * Ask this store to keep `windowMs` of history for `topic`, until the returned function is called.
   *
   * Retention is the *only* thing that starts recording. Before the first retention the topic has no
   * ring and costs nothing; after the last release the ring is dropped and the memory goes back.
   * Two charts on one topic retain independently and the store keeps the longer of their windows.
   *
   * Returns an idempotent release, so a React cleanup that runs twice releases one retention.
   */
  retainHistory(topic: string, windowMs: number): Unsubscribe;
  /**
   * The published series for one topic, or `NO_HISTORY` when nothing retains it.
   *
   * Stable by reference until the series or the window's end materially changes — the same contract
   * `snapshot` keeps, for the same `useSyncExternalStore` reason. Reading an unretained topic does
   * **not** start retaining it.
   */
  history(topic: string): SensorHistorySnapshot;
  /** Call `onChange` whenever this topic's published history changes. */
  subscribeHistory(topic: string, onChange: () => void): Unsubscribe;
  /** Metadata for a topic, or `undefined`. Accepts the authored shorthand. */
  meta(topic: string): SensorMeta | undefined;
  /**
   * Every topic the source has delivered a reading for, in order of first arrival.
   *
   * A topic that was only read or watched is not here: asking about a topic is not the source
   * publishing it. The same array until a new topic arrives.
   */
  topics(): readonly SensorTopic[];
  /** Call `onChange` whenever `topics()` gains a topic. Never on a reading for a known one. */
  subscribeTopics(onChange: () => void): Unsubscribe;
  /** Re-evaluate staleness now and notify whatever changed. */
  refresh(): void;
  /**
   * Take the source subscription and start the recheck timer. Idempotent.
   *
   * Separate from construction so that a React provider can build the store during render — a
   * render that React may throw away — and subscribe only from an effect, which React promises to
   * pair with exactly one cleanup. A store that is built and never opened has touched nothing.
   */
  open(): void;
  /** Drop the source subscription and stop the recheck timer. Idempotent, and `open()` may follow. */
  close(): void;
}

export function createSensorStore(options: SensorStoreOptions): SensorStore {
  const {
    source,
    pattern = SENSOR_TOPIC_WILDCARD,
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
    now = Date.now,
    // Half the threshold, capped at 1 s: a value never reads as live for much longer than it
    // should, and the timer never runs hotter than once a second on a normal threshold.
    recheckIntervalMs = Math.min(1_000, staleAfterMs / 2),
  } = options;

  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
    throw new RangeError(`staleAfterMs must be a positive number, got ${staleAfterMs}`);
  }
  if (!Number.isFinite(recheckIntervalMs) || recheckIntervalMs < 0) {
    throw new RangeError(
      `recheckIntervalMs must be zero or a positive number, got ${recheckIntervalMs}`,
    );
  }

  const latest = new Map<SensorTopic, SensorReading>();
  /**
   * The snapshot each known topic is currently published as. A topic joins this map the first
   * time it is read, watched, or receives a reading, and stays — `refresh()` iterates it, and the
   * set is bounded by the topics the source publishes plus the topics the page asks about.
   */
  const published = new Map<SensorTopic, SensorSnapshot>();
  const listeners = new Map<SensorTopic, Set<() => void>>();
  const statusListeners = new Set<() => void>();
  const topicListeners = new Set<() => void>();
  let publishedTopics: readonly SensorTopic[] = Object.freeze([]);

  /**
   * Everything history-related for one topic, in one record.
   *
   * One record rather than four parallel maps keyed by topic. The four are only ever correct
   * together — a ring with no demand is a leak, demand with no ring records nothing, a published
   * snapshot with no ring is stale forever — and parallel maps hold that invariant with nothing but
   * care. A record makes "this topic has history" one lookup that either finds all four or none.
   *
   * `ring` is `undefined` between the record existing and the first retention, which is the state a
   * topic with listeners but no retention sits in.
   */
  const retained = new Map<
    SensorTopic,
    {
      readonly demand: ReturnType<typeof createWindowDemand>;
      readonly historyListeners: Set<() => void>;
      ring: TopicRing | undefined;
      publishedHistory: SensorHistorySnapshot;
      /** The ring revision `publishedHistory` was built from. `-1` when it was built from no ring. */
      publishedRevision: number;
    }
  >();

  let publishedStatus: SensorSourceStatus = source.status;
  let unsubscribeSource: Unsubscribe | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const computed = (topic: SensorTopic): SensorSnapshot => {
    const reading = latest.get(topic);
    if (reading === undefined) return WAITING;

    // Clamp: a source whose clock runs ahead of ours would otherwise produce a negative age, and
    // "-2 s old" is a nonsense a widget should never have to render.
    const ageMs = Math.max(0, now() - reading.at);

    return ageMs > staleAfterMs
      ? { state: 'stale', reading, ageMs }
      : { state: 'live', reading, ageMs };
  };

  /** Republish `topic` if its snapshot materially changed. `true` when it did. */
  const publish = (topic: SensorTopic): boolean => {
    const next = computed(topic);
    const previous = published.get(topic);
    if (previous !== undefined && materiallySame(previous, next)) return false;
    published.set(topic, next);
    return true;
  };

  const notify = (topic: SensorTopic): void => {
    const set = listeners.get(topic);
    if (set === undefined) return;
    // A copy, so a listener that unsubscribes itself does not mutate the set being walked.
    for (const listener of [...set]) listener();
  };

  const publishStatus = (): void => {
    if (source.status === publishedStatus) return;
    publishedStatus = source.status;
    for (const listener of [...statusListeners]) listener();
  };

  /** Make a topic known, so `refresh()` covers it even before anything arrives. */
  const register = (topic: SensorTopic): SensorSnapshot => {
    const existing = published.get(topic);
    if (existing !== undefined) return existing;
    const next = computed(topic);
    published.set(topic, next);
    return next;
  };

  /** The history record for a topic, created empty on first mention. */
  const historyRecord = (topic: SensorTopic): NonNullable<ReturnType<typeof retained.get>> => {
    const existing = retained.get(topic);
    if (existing !== undefined) return existing;

    const created = {
      demand: createWindowDemand(),
      historyListeners: new Set<() => void>(),
      ring: undefined,
      publishedHistory: NO_HISTORY,
      publishedRevision: -1,
    };
    retained.set(topic, created);
    return created;
  };

  /**
   * Discard a history record that is holding nothing for nobody.
   *
   * Without this the `retained` map would grow by one entry per topic any chart ever watched, which
   * is the unbounded growth the whole design is against — small per entry, but a map that only ever
   * gains keys is a leak whatever the key costs.
   */
  const forgetHistoryIfIdle = (topic: SensorTopic): void => {
    const record = retained.get(topic);
    if (record === undefined) return;
    if (record.ring !== undefined) return;
    if (record.demand.windowMs !== 0) return;
    if (record.historyListeners.size > 0) return;
    retained.delete(topic);
  };

  /** Republish `topic`'s history if it materially changed. `true` when it did. */
  const publishHistory = (topic: SensorTopic): boolean => {
    const record = retained.get(topic);
    if (record === undefined) return false;

    const { ring } = record;
    if (ring === undefined) {
      if (record.publishedHistory === NO_HISTORY) return false;
      record.publishedHistory = NO_HISTORY;
      record.publishedRevision = -1;
      return true;
    }

    const endsAt = now();
    const sameContents = record.publishedRevision === ring.revision;
    const sameWindow = record.publishedHistory.windowMs === ring.windowMs;
    // Whole seconds, matching `materiallySame`: a chart's x-axis advancing by a millisecond is not a
    // visible difference, and a retained topic would otherwise republish on every recheck tick and
    // on every read.
    const sameEnd = wholeSeconds(record.publishedHistory.endsAt) === wholeSeconds(endsAt);
    if (sameContents && sameWindow && sameEnd) return false;

    record.publishedHistory = Object.freeze({
      windowMs: ring.windowMs,
      endsAt,
      samples: Object.freeze(ring.samples()),
    });
    record.publishedRevision = ring.revision;
    return true;
  };

  const notifyHistory = (topic: SensorTopic): void => {
    const record = retained.get(topic);
    if (record === undefined) return;
    for (const listener of [...record.historyListeners]) listener();
  };

  /** Add a first-seen topic to the published list, and say so. */
  const noteTopic = (topic: SensorTopic): void => {
    publishedTopics = Object.freeze([...publishedTopics, topic]);
    for (const listener of [...topicListeners]) listener();
  };

  const onReading: SensorReadingHandler = (topic, reading) => {
    const previous = latest.get(topic);
    // Before the ordering check: a topic whose first reading arrives out of order still published.
    if (previous === undefined) noteTopic(topic);
    // Keep the newest read, not the newest arrival: MQTT can reorder, and a retained message can
    // arrive after a fresher live one.
    if (previous !== undefined && previous.at > reading.at) return;
    latest.set(topic, reading);

    // Recorded before publication, so the snapshot a listener goes on to read already holds it.
    retained.get(topic)?.ring?.push(reading, now());

    if (publish(topic)) notify(topic);
    if (publishHistory(topic)) notifyHistory(topic);
    publishStatus();
  };

  const refresh = (): void => {
    // Safe to walk while publishing: `publish` only overwrites existing keys.
    for (const topic of published.keys()) {
      if (publish(topic)) notify(topic);
    }
    // History ages on the same clock and for the same reason: a reading leaving the window is not an
    // event, so nothing arrives to say the left edge moved.
    for (const [topic, record] of retained) {
      record.ring?.evict(now());
      if (publishHistory(topic)) notifyHistory(topic);
    }
    publishStatus();
  };

  return {
    staleAfterMs,

    get sourceStatus() {
      return publishedStatus;
    },

    snapshot(topic) {
      return register(canonical(topic));
    },

    subscribe(topic, onChange) {
      const key = canonical(topic);
      register(key);
      const set = listeners.get(key) ?? new Set<() => void>();
      listeners.set(key, set);
      set.add(onChange);

      let live = true;
      return () => {
        if (!live) return; // calling twice is harmless
        live = false;
        set.delete(onChange);
        if (set.size === 0) listeners.delete(key);
      };
    },

    subscribeStatus(onChange) {
      statusListeners.add(onChange);

      let live = true;
      return () => {
        if (!live) return;
        live = false;
        statusListeners.delete(onChange);
      };
    },

    retainHistory(topic, windowMs) {
      const key = canonical(topic);
      const record = historyRecord(key);
      const release = record.demand.retain(windowMs);

      /**
       * Size the ring to the new demand, and seed it with the one reading we already hold.
       *
       * Seeding matters for the first chart on a topic the readouts have been watching: without it,
       * a chart mounted at second thirty starts from nothing even though a reading is in hand, and
       * shows an empty plot for one publish interval with no reason a reader could name.
       */
      if (record.ring === undefined) {
        const ring = createTopicRing(record.demand.windowMs);
        const seed = latest.get(key);
        if (seed !== undefined) ring.push(seed, now());
        record.ring = ring;
      } else {
        record.ring.setWindow(record.demand.windowMs, now());
      }

      if (publishHistory(key)) notifyHistory(key);

      let held = true;
      return () => {
        if (!held) return; // calling twice is harmless
        held = false;
        release();

        const current = retained.get(key);
        if (current === undefined) return;

        if (current.demand.windowMs === 0) {
          // The last chart on this topic went away. Drop the readings rather than hold a series for
          // a chart that may never come back — this is the shrink the derivation exists to allow.
          current.ring = undefined;
        } else {
          // A shorter window is now the longest asked for, so the ring really does get smaller.
          current.ring?.setWindow(current.demand.windowMs, now());
        }

        if (publishHistory(key)) notifyHistory(key);
        forgetHistoryIfIdle(key);
      };
    },

    history(topic) {
      const key = canonical(topic);
      const record = retained.get(key);
      // Deliberately does not create a record: reading is not retaining, and a chart that has not
      // mounted yet must not cost a ring.
      // A pure read, exactly like `snapshot`: it returns what was last *published* and never mints.
      // `useSyncExternalStore` rejects a `getSnapshot` that returns a new object on two consecutive
      // calls, and republishing here would do that the moment a read crossed a whole second.
      return record === undefined ? NO_HISTORY : record.publishedHistory;
    },

    subscribeHistory(topic, onChange) {
      const key = canonical(topic);
      const record = historyRecord(key);
      record.historyListeners.add(onChange);

      let live = true;
      return () => {
        if (!live) return;
        live = false;
        record.historyListeners.delete(onChange);
        forgetHistoryIfIdle(key);
      };
    },

    meta(topic) {
      return source.meta(canonical(topic));
    },

    topics() {
      return publishedTopics;
    },

    subscribeTopics(onChange) {
      topicListeners.add(onChange);

      let live = true;
      return () => {
        if (!live) return;
        live = false;
        topicListeners.delete(onChange);
      };
    },

    refresh,

    open() {
      unsubscribeSource ??= source.subscribe(pattern, onReading);
      if (timer === undefined && recheckIntervalMs > 0) {
        timer = setInterval(refresh, recheckIntervalMs);
      }
      publishStatus();
    },

    close() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      if (unsubscribeSource !== undefined) {
        unsubscribeSource();
        unsubscribeSource = undefined;
      }
    },
  };
}

/**
 * Whether two snapshots would render identically.
 *
 * Written as a chain of narrowing checks rather than a field-by-field compare because the two
 * arguments are independent unions: the compiler does not correlate `a.state` with `b.state`, so
 * each side has to be narrowed on its own before a `reading` is in scope.
 */
function materiallySame(a: SensorSnapshot, b: SensorSnapshot): boolean {
  if (a.state === 'waiting' || b.state === 'waiting') return a.state === b.state;
  if (a.state !== b.state) return false;
  if (a.reading !== b.reading) return false;

  // Only the stale rendering prints an age, so only a stale reading republishes as it ages — and
  // only at the granularity the readout actually shows, which is whole seconds.
  return a.state === 'live' || wholeSeconds(a.ageMs) === wholeSeconds(b.ageMs);
}

function wholeSeconds(ageMs: number): number {
  return Math.round(ageMs / 1_000);
}

/**
 * Expand an authored topic, or throw.
 *
 * Throwing rather than returning `waiting` is deliberate: a mistyped topic that renders as "no
 * data" forever is indistinguishable from a dead publisher, and the person who has to tell them
 * apart is looking at a panel on a wall. Authored-topic validation belongs to `layout-schema`,
 * upstream of here — so reaching this throw means a bug, not bad input.
 */
function canonical(topic: string): SensorTopic {
  const normalized = normalizeSensorTopic(topic);
  if (normalized === null) {
    throw new RangeError(`not a sensor topic: ${topic}`);
  }
  return normalized;
}
