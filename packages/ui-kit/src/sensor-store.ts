/**
 * One subscription to the source; per-topic snapshots out.
 *
 * This is the store behind `<SensorProvider>`. It is deliberately framework-free — no React
 * import in this file — because its whole surface is shaped to be exactly what
 * `useSyncExternalStore` wants: `subscribe(topic, onChange)` and a `snapshot(topic)` that
 * returns the *same object* until something changes. Everything React-shaped lives next door in
 * `sensor-context.tsx`.
 *
 * Four responsibilities and no more:
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
  /** Metadata for a topic, or `undefined`. Accepts the authored shorthand. */
  meta(topic: string): SensorMeta | undefined;
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

  const onReading: SensorReadingHandler = (topic, reading) => {
    const previous = latest.get(topic);
    // Keep the newest read, not the newest arrival: MQTT can reorder, and a retained message can
    // arrive after a fresher live one.
    if (previous !== undefined && previous.at > reading.at) return;
    latest.set(topic, reading);
    if (publish(topic)) notify(topic);
    publishStatus();
  };

  const refresh = (): void => {
    // Safe to walk while publishing: `publish` only overwrites existing keys.
    for (const topic of published.keys()) {
      if (publish(topic)) notify(topic);
    }
    publishStatus();
  };

  return {
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

    meta(topic) {
      return source.meta(canonical(topic));
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
