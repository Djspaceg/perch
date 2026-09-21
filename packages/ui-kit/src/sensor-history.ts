/**
 * History, bounded by what the layout asked for.
 *
 * Nothing in this project buffered a series until this file. The MQTT source buffers nothing on
 * purpose — "a gap in the data is a gap, reported through `status`" (`sensor-sources/README.md`) —
 * and the relay publishes only the latest reading per topic. So a chart drawing the last five
 * minutes has to be told those five minutes by something, and this is that something.
 *
 * Two pieces, both framework-free and both testable without a store, a clock or a React tree:
 *
 * - **`TopicRing`** — one topic's readings, oldest first, bounded twice over.
 * - **`WindowDemand`** — a multiset of the windows currently being asked for, whose maximum is the
 *   window the ring is sized by.
 *
 * ## Why the size is derived and not configured
 *
 * The approved design is "a bounded ring buffer in the ui-kit store, sized by the longest
 * `windowMs` any mounted chart requests". Derived, therefore, rather than a constant: a constant
 * large enough for a 24 h chart is wasted on a panel of one-minute charts, and one small enough for
 * a one-minute chart silently truncates the 24 h one — a chart drawing a quarter of its declared
 * window, with nothing on screen saying so, which is the class of untruth this format spends its
 * `gap` field to avoid.
 *
 * Derivation has a consequence that is easy to get wrong, so it is stated as a rule: **demand goes
 * down as well as up.** A ledger that only ever remembered the largest window it had ever seen
 * would be monotonic forever — swap a 24 h chart for a 1 min one and the buffer keeps 24 h of
 * readings nobody will draw, for the life of the page. `WindowDemand` therefore counts retentions
 * per window and recomputes its maximum when a count reaches zero, so releasing the last 24 h chart
 * really does shrink the buffer, and releasing the last chart of all frees it.
 *
 * ## The two bounds, and why one is not enough
 *
 * `windowMs` bounds the ring **in time**: a reading older than the window has left the x-axis and is
 * memory nobody can draw. That is the bound the layout author declared, and it is the one that
 * matters.
 *
 * `capacity` bounds it **in count**, because a window is a duration and memory is a sample count, and
 * the exchange rate between them is the publish rate — which no layout declares and no source
 * promises. `sensor-contract`'s SPEC describes a 1 Hz publisher; a broker replaying a backlog, or a
 * publisher misconfigured to 100 Hz, would fill a 24 h window with eight million readings before the
 * time bound removed the first one. So the count bound is the guard against a rate nobody declared,
 * derived from the same window through one stated retained resolution.
 *
 * Neither bound preallocates. The ring's array grows only as readings arrive, so a 24 h window on a
 * 1 Hz publisher costs what 24 h at 1 Hz costs and not what the cap allows.
 *
 * ## What is deliberately not here
 *
 * No persistence. History dies on page reload, which is an accepted cost on the record: a live wall
 * panel wants *now*, not last week. The two alternatives were rejected before this file existed —
 * relay-side retention (a protocol change, and retained MQTT models a series badly) and a
 * time-series store (a different product, and a new prerequisite before anyone can run perch).
 *
 * No aggregation. The ring holds readings as they arrived, undisturbed; thinning a series to the
 * pixel columns it will occupy is the *renderer's* step, done at draw time in `chart-view.ts`, where
 * the width it is thinning to is actually known.
 */

import type { SensorReading } from '@perch/sensor-contract';

/**
 * The finest spacing the ring is sized to keep, in ms.
 *
 * The count bound is `windowMs / HISTORY_SLOT_MS`, so this is the exchange rate between a declared
 * duration and a retained sample count — read it as "the ring is sized for a publisher up to 4 Hz".
 *
 * Four times the 1 Hz `sensor-contract` describes, which is headroom for a publisher that ticks
 * fast or bursts on reconnect without sizing for one that floods. It is also comfortably finer than
 * anything a chart can *show*: `target.frameRate` is capped at 60, and a chart is at most
 * `target.width` pixel columns wide, so two readings 250 ms apart are already sub-pixel on any
 * window over about eight minutes on the widest panel this format allows. Raising it would retain
 * detail no capture can resolve; lowering it would start discarding readings a slow chart could
 * plot.
 */
export const HISTORY_SLOT_MS = 250;

/**
 * Smallest count bound, whatever the window.
 *
 * Two, because a line needs two points, and because `CHART_MIN_WINDOW_MS` is 1 s — which the
 * formula alone would already size at five slots, so this floor is unreachable through a validated
 * layout and exists for the direct caller that asks for a 100 ms window.
 */
export const HISTORY_MIN_CAPACITY = 2;

/**
 * How many readings a window is sized to hold.
 *
 * `+ 1` because a window of *n* slots has *n + 1* boundaries: a 1 s window at 250 ms spacing spans
 * five readings, at 0, 250, 500, 750 and 1000 ms, and dropping the fifth would leave the chart's
 * right edge one slot short of now.
 */
export function historyCapacity(windowMs: number): number {
  if (!Number.isFinite(windowMs) || windowMs <= 0) return HISTORY_MIN_CAPACITY;
  return Math.max(HISTORY_MIN_CAPACITY, Math.ceil(windowMs / HISTORY_SLOT_MS) + 1);
}

/**
 * One topic's readings, oldest first.
 *
 * A ring rather than an array with `shift()`: eviction happens on every reading once the window is
 * full, and `Array.prototype.shift` is O(n) on a large array in every engine that does not special-
 * case it. This keeps a read offset and compacts when the dead prefix is at least half the array, so
 * the amortised cost of a push-and-evict is constant and the array never grows past twice the live
 * count.
 *
 * ## `revision`, and why the store reads it instead of comparing arrays
 *
 * Every content change bumps `revision`. The store publishes a snapshot per topic and
 * `useSyncExternalStore` compares those by reference, so the store must answer "did the contents
 * change" on every reading and every recheck tick. Answering it by comparing the sample arrays is
 * O(n) per tick on a buffer whose whole purpose is to be long; answering it with a counter is O(1),
 * and a counter cannot disagree with itself the way a shallow compare can when a reading is replaced
 * in place.
 */
export interface TopicRing {
  /** The window the ring is currently keeping, in ms. */
  readonly windowMs: number;
  /** The count bound derived from `windowMs`. */
  readonly capacity: number;
  /** How many readings are live right now. Never above `capacity`. */
  readonly size: number;
  /** Bumped on every content change, and never otherwise. */
  readonly revision: number;
  /**
   * Take a reading, then evict whatever the two bounds now exclude.
   *
   * A reading older than the newest one held is **dropped**, not inserted. MQTT can reorder and a
   * retained message can arrive after a fresher live one; a series whose x values go backwards is a
   * scribble rather than a trend, and the store applies the same rule to `latest` one layer up.
   */
  push(reading: SensorReading, nowMs: number): void;
  /** Evict against a later clock, with no reading to prompt it. */
  evict(nowMs: number): void;
  /** Re-derive both bounds from a new window, evicting immediately if it shrank. */
  setWindow(windowMs: number, nowMs: number): void;
  /**
   * The live readings, oldest first.
   *
   * A fresh array each call, materialised from the ring — so the store calls it once per
   * publication and hands the result out by reference, rather than every reader rebuilding it.
   */
  samples(): readonly SensorReading[];
}

export function createTopicRing(windowMs: number): TopicRing {
  let window = windowMs;
  let capacity = historyCapacity(window);
  let revision = 0;

  /** The backing store. Live readings are `items[head .. items.length)`. */
  let items: SensorReading[] = [];
  let head = 0;

  const live = (): number => items.length - head;

  /** Reclaim the dead prefix once it is worth the copy. Never changes what is live. */
  const compact = (): void => {
    if (head === 0) return;
    if (head * 2 < items.length) return;
    items = items.slice(head);
    head = 0;
  };

  /**
   * Drop the front while either bound excludes it. `true` when anything went.
   *
   * The time bound is measured against `nowMs` — the instant the window *ends* — and not against
   * the newest reading held. Against the newest reading, a publisher that died would freeze its
   * last window on screen forever; against now, the series walks off the left edge exactly as the
   * axis says it should, and a chart with nothing left in its window says so rather than showing a
   * trend from some earlier hour.
   */
  const trim = (nowMs: number): boolean => {
    const oldestAllowed = nowMs - window;
    let dropped = false;

    while (head < items.length) {
      const front = items[head];
      if (front === undefined) break;
      const overCount = live() > capacity;
      const tooOld = front.at < oldestAllowed;
      if (!overCount && !tooOld) break;
      head += 1;
      dropped = true;
    }

    if (dropped) compact();
    return dropped;
  };

  return {
    get windowMs() {
      return window;
    },
    get capacity() {
      return capacity;
    },
    get size() {
      return live();
    },
    get revision() {
      return revision;
    },

    push(reading, nowMs) {
      // Already outside the window, so it has no x coordinate on any chart that would draw it.
      // Rejected here rather than inserted-and-trimmed, because inserting would bump `revision` and
      // cost every chart on the topic a republish for a reading none of them can paint. A broker
      // replaying an hour-old backlog into a one-minute window is the case that makes this matter.
      if (reading.at < nowMs - window) return;

      const newest = items[items.length - 1];
      // `>=` keeps a same-instant reading, which is a legitimate republish; `>` alone would drop it.
      if (newest !== undefined && reading.at < newest.at) return;

      items.push(reading);
      revision += 1;
      trim(nowMs);
    },

    evict(nowMs) {
      if (trim(nowMs)) revision += 1;
    },

    setWindow(nextWindowMs, nowMs) {
      if (nextWindowMs === window) return;
      window = nextWindowMs;
      capacity = historyCapacity(window);
      // Only a shrink can make the held readings wrong; a grow simply admits more from here on.
      if (trim(nowMs)) revision += 1;
    },

    samples() {
      return head === 0 ? [...items] : items.slice(head);
    },
  };
}

/**
 * The windows currently being asked for, and the longest of them.
 *
 * Counted rather than collected, because two charts on one topic asking for the same window are two
 * retentions of one number: a set would let the first release drop a window the second still wants.
 * The count is what makes "the last chart on this topic unmounted" a fact the ledger knows.
 *
 * `windowMs` is `0` when nothing is retained, which is the store's signal to drop the ring entirely
 * rather than keep an empty one warming up for a chart that may never come back.
 */
export interface WindowDemand {
  /** The longest window retained, or `0` when none is. */
  readonly windowMs: number;
  /** How many distinct windows are retained. For tests, and for nothing else. */
  readonly windows: number;
  /**
   * Ask for `windowMs` of history until the returned function is called.
   *
   * The release is idempotent: calling it twice releases one retention, so a React cleanup that
   * runs twice under StrictMode cannot free a window another chart is still holding.
   */
  retain(windowMs: number): () => void;
}

export function createWindowDemand(): WindowDemand {
  const counts = new Map<number, number>();
  let longest = 0;

  /**
   * Recompute the maximum from scratch.
   *
   * A scan, not a decrement: the maximum after releasing the longest window is the next longest,
   * which nothing tracks incrementally. The map holds one entry per *distinct* window asked for on
   * one topic — one or two in every layout anybody will write — so the scan is cheaper than the
   * bookkeeping that would avoid it.
   */
  const recompute = (): void => {
    let next = 0;
    for (const windowMs of counts.keys()) {
      if (windowMs > next) next = windowMs;
    }
    longest = next;
  };

  return {
    get windowMs() {
      return longest;
    },
    get windows() {
      return counts.size;
    },

    retain(windowMs) {
      if (!Number.isFinite(windowMs) || windowMs <= 0) {
        throw new RangeError(`a retained window must be a positive number of ms, got ${windowMs}`);
      }

      counts.set(windowMs, (counts.get(windowMs) ?? 0) + 1);
      if (windowMs > longest) longest = windowMs;

      let held = true;
      return () => {
        if (!held) return;
        held = false;
        const count = counts.get(windowMs) ?? 0;
        if (count <= 1) {
          counts.delete(windowMs);
          recompute();
          return;
        }
        counts.set(windowMs, count - 1);
      };
    },
  };
}
