/**
 * The React seam: one provider, and hooks that read from it.
 *
 * This is what replaced the module-global singleton. There is **no mutable state at module scope
 * in this file** — the store lives in a provider's own instance, reached through context, which is
 * what makes two dashboards in one page (or two tests in one file, or a server render) independent
 * instead of quietly fighting over one global.
 *
 * The dataflow runs one way and only one way:
 *
 * ```
 * source → SensorProvider (owns the store) → context → useSensor(topic) → <Readout>
 * ```
 *
 * No component below the provider can see the source. The hooks hand out snapshots, metadata and
 * a status string; none of them hands out a way to subscribe, publish or reconnect. A widget that
 * wanted to open its own subscription would have to import `createSensorStore` and build a second
 * store, which is a visible act in a diff rather than an accident.
 *
 * ## Why `useSyncExternalStore`
 *
 * Sensor readings are exactly what it exists for: state that lives outside React, changes without
 * React's knowledge, and must not tear between two components rendering in the same pass. It also
 * enforces the discipline the frame budget needs — `getSnapshot` must be referentially stable —
 * which is why `SensorStore` publishes snapshots instead of computing them per read.
 *
 * The alternative, a `useEffect` per widget subscribing to its own topic, is the pattern this is
 * written to prevent: forty widgets, forty effects, forty `setState` calls per tick, and a
 * subscription count that grows with the layout.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { SensorMeta, SensorSource, SensorSourceStatus } from '@perch/sensor-contract';
import {
  createSensorStore,
  type SensorHistorySnapshot,
  type SensorSnapshot,
  type SensorStore,
} from './sensor-store.js';

/**
 * `null` rather than a default store, deliberately.
 *
 * A default would let `useSensor` "work" outside a provider — reading forever from a store nobody
 * feeds, which renders as a panel full of `--` with no clue why. The `null` makes the mistake
 * throw at the first render, naming the fix.
 */
const SensorStoreContext = createContext<SensorStore | null>(null);

export interface SensorProviderProps {
  /**
   * The source. **Injected, never constructed here.**
   *
   * This is the one line that changes when the mock gives way to MQTT. `ui-kit` has no transport
   * dependency and no knowledge of one, so nothing in this package needs editing — not this file,
   * not the store, not a widget.
   */
  source: SensorSource;
  /** Subscription pattern. Defaults to every sensor topic. */
  pattern?: string | undefined;
  /** Age at which a reading is reported stale. Defaults to `DEFAULT_STALE_AFTER_MS`. */
  staleAfterMs?: number | undefined;
  /** Clock used to age readings. Defaults to `Date.now`. */
  now?: (() => number) | undefined;
  /** Staleness re-check interval in ms; `0` leaves `refresh()` as the only trigger. */
  recheckIntervalMs?: number | undefined;
  children?: ReactNode;
}

/**
 * Owns the store, and therefore owns the **single** subscription to the source.
 *
 * Three things have to be true at once here, and each one is a hazard if it is not:
 *
 * 1. **The store is built in render, but opened only in an effect.** React may render a component
 *    and throw the result away; an effect is the only place it promises a matching cleanup. So
 *    `createSensorStore` touches nothing, and `open()` — which takes the subscription — runs from
 *    `useEffect`. Subscribing in render would leak a subscription per discarded render.
 * 2. **StrictMode double-invokes effects.** Mount → cleanup → mount runs `open()`, `close()`,
 *    `open()` on the *same* store, so both are idempotent and `close()` is reversible. A store
 *    that died on close would leave development showing a dead panel that production does not.
 * 3. **A changed prop must swap the store, not mutate it.** The identity key below rebuilds the
 *    store when the source (or any option) changes; the effect's cleanup then closes the old one
 *    before the new one opens. That is what makes swapping a source at runtime safe.
 */
export function SensorProvider(props: SensorProviderProps): ReactNode {
  const { source, pattern, staleAfterMs, now, recheckIntervalMs, children } = props;

  /**
   * The store, rebuilt only when something it was configured with actually changes.
   *
   * `useMemo` keyed on the options, not a ref holding a hand-rolled key comparison: reading a
   * ref during render is exactly what `react-hooks/refs` forbids, and for a reason that applies
   * here — a render that reads `ref.current` is a render whose output depends on something React
   * cannot track, which is what breaks under the compiler and under re-entrant rendering.
   *
   * The known caveat is that React reserves the right to discard a memo. If it ever does, the
   * consequence is bounded and self-healing rather than broken: `open()`/`close()` are keyed on
   * the store's identity, so a rebuilt store is cleanly closed and reopened, and the page shows
   * `waiting` for one publish interval — under a second at 1 Hz — until the next reading lands.
   * A store must not be built in a ref to avoid that, because a ref costs correctness to save a
   * flicker.
   */
  const store = useMemo(
    () => createSensorStore({ source, pattern, staleAfterMs, now, recheckIntervalMs }),
    [source, pattern, staleAfterMs, now, recheckIntervalMs],
  );

  useEffect(() => {
    store.open();
    return () => {
      store.close();
    };
  }, [store]);

  return <SensorStoreContext.Provider value={store}>{children}</SensorStoreContext.Provider>;
}

/**
 * The store for the enclosing provider.
 *
 * Exported because the readout needs `meta` and a test needs `refresh`, not as an invitation to
 * reach past the hooks: it hands out no source and no way to publish.
 */
export function useSensorStore(): SensorStore {
  const store = useContext(SensorStoreContext);
  if (store === null) {
    throw new Error('useSensorStore must be called inside a <SensorProvider>');
  }
  return store;
}

/**
 * One topic's snapshot, re-rendering this component when — and only when — it changes.
 *
 * Accepts the authored shorthand as well as a canonical topic, and throws on anything outside the
 * grammar rather than reporting `waiting` forever for a typo.
 */
export function useSensor(topic: string): SensorSnapshot {
  const store = useSensorStore();

  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(topic, onChange),
    [store, topic],
  );
  const getSnapshot = useCallback(() => store.snapshot(topic), [store, topic]);

  // The same function for the server snapshot: the store is deterministic given its readings, and
  // before hydration it has none — so both sides agree on `waiting` without a special case.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * A topic's metadata, or `undefined`.
 *
 * Not a subscription: metadata is published once per topic and read on render, so treating it as
 * reactive state would cost a store subscription per widget to observe something that does not
 * move. A later metadata arrival lands with the next reading's re-render.
 */
export function useSensorMeta(topic: string): SensorMeta | undefined {
  const store = useSensorStore();
  return store.meta(topic);
}

/**
 * One topic's recent history, retained for exactly as long as this component is mounted.
 *
 * The hook *is* the retention: mounting a chart is what asks the store to keep a window, and
 * unmounting it is what lets the store stop. Nothing else in the package retains anything, so there
 * is no way to leave a buffer alive after the last chart that wanted it has gone — which is the
 * property the whole derived-size design rests on.
 *
 * ## Why retention lives in `subscribe`
 *
 * `useSyncExternalStore` calls `subscribe` on mount and calls its cleanup on unmount, keyed on the
 * function's identity — the same lifecycle a retention needs, already correct under StrictMode's
 * double-invoke and already re-run when the topic or window changes. Retaining from a separate
 * `useEffect` instead would order the two wrong: the effect runs *after* the first render, so frame
 * one would read `NO_HISTORY` from a store that had not been asked to keep anything yet, and the
 * chart would paint an empty box and then immediately repaint with data. Retaining inside
 * `subscribe` means the retention is in place before the first `getSnapshot`, which is also what
 * lets `retainHistory` seed the ring from the reading already in hand.
 *
 * The order within the callback matters too: subscribe first, then retain. `retainHistory` publishes
 * a snapshot as it seeds, and a listener registered afterwards would miss that notification.
 */
export function useSensorHistory(topic: string, windowMs: number): SensorHistorySnapshot {
  const store = useSensorStore();

  const subscribe = useCallback(
    (onChange: () => void) => {
      const unsubscribe = store.subscribeHistory(topic, onChange);
      const release = store.retainHistory(topic, windowMs);
      return () => {
        release();
        unsubscribe();
      };
    },
    [store, topic, windowMs],
  );

  const getSnapshot = useCallback(() => store.history(topic), [store, topic]);

  // Server snapshot is the same read, which before hydration is `NO_HISTORY` — an empty chart that
  // says it is waiting, rather than a mismatch between what the server drew and what the client does.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * The source's connection status, without any component holding the source.
 *
 * This is the whole reason a status hook exists: a widget that wants to show "connecting" would
 * otherwise need the source itself, and then the one-way dataflow is gone.
 */
export function useSensorStatus(): SensorSourceStatus {
  const store = useSensorStore();

  const subscribe = useCallback((onChange: () => void) => store.subscribeStatus(onChange), [store]);
  const getSnapshot = useCallback(() => store.sourceStatus, [store]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
