/**
 * What a readout says, as strings — and nothing about how it is drawn.
 *
 * Two pure functions and a union. `readoutState` turns the store's three-state snapshot into the
 * four states a *reader* can distinguish, and `readoutView` turns one of those into the exact
 * strings a widget prints. Neither touches the DOM, React, a clock or a source, so "same props,
 * same pixels" is a claim a plain assertion can check: call `readoutView` twice with the same
 * input and compare the strings.
 *
 * That split is the reason the component is as small as it is. Formatting rules — how many
 * decimals a metric gets, which glyph stands for "nothing yet", how an age is worded — are
 * decided here, in code with no environment, and `readout.tsx` only places the results.
 */

import { SENSOR_METRIC_UNITS, type SensorMetric } from '@perch/sensor-contract';
import { assertNever } from './exhaustive.js';
import type { SensorSnapshot } from './sensor-store.js';

/**
 * The four states a readout can be in, as a discriminated union.
 *
 * The store reports three (`waiting` / `live` / `stale`) because three is what it can tell apart.
 * A reader needs four, because `live` covers two facts that must never look alike:
 *
 * - `waiting` — nothing has arrived yet. The widget is not broken and the sensor is not silent;
 *   we simply have not heard.
 * - `no-reading` — a reading arrived and its value is `null`. The sensor is *there* and reporting
 *   nothing. A motherboard with no fan in a header reports exactly this, forever, and it is not
 *   an error.
 * - `value` — a number to print.
 * - `stale` — the last reading, too old to believe, kept with its age so the widget can say how
 *   old. `value` is `number | null` because a sensor can be reporting nothing *and* have stopped
 *   reporting at all, and staleness is the more urgent of the two.
 *
 * Every member carries exactly the data its rendering needs and nothing else: there is no
 * `ageMs` on `value` to accidentally print, and no `value` on `waiting` to accidentally read.
 * That is what makes the switches in `readoutView` and `<Readout>` safe without a single
 * non-null assertion.
 */
export type ReadoutState =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'no-reading' }
  | { readonly kind: 'value'; readonly value: number }
  | { readonly kind: 'stale'; readonly value: number | null; readonly ageMs: number };

/** The discriminant on its own, for the places that only need the tag. */
export type ReadoutStateKind = ReadoutState['kind'];

/**
 * Every kind, once — and provably every kind.
 *
 * `Readonly<Record<ReadoutStateKind, true>>` is the whole trick: the type requires a key for
 * each member of the union, so adding a fifth state to `ReadoutState` without adding it here is
 * a compile error at this line. Writing the array literal directly could not do that — an array
 * of four strings type-checks perfectly well against a five-member union.
 *
 * This is one of the four places the union's exhaustiveness is enforced; the other three are the
 * switches in `readoutState`, `readoutView` and `<Readout>`, each of which ends in
 * `assertNever`.
 */
const READOUT_STATE_KIND_PRESENCE: Readonly<Record<ReadoutStateKind, true>> = {
  waiting: true,
  'no-reading': true,
  value: true,
  stale: true,
};

/** Every readout state, for tests and for anything that has to style or enumerate them all. */
export const READOUT_STATE_KINDS: readonly ReadoutStateKind[] = Object.freeze(
  Object.keys(READOUT_STATE_KIND_PRESENCE) as ReadoutStateKind[],
);

/**
 * What a readout prints when nothing has arrived yet.
 *
 * Two dashes, not a zero and not blank: an empty widget reads as "broken layout", and a zero is
 * a lie about a measurement. It must differ from `READOUT_NO_READING_TEXT`, because "we have not
 * heard" and "there is nothing to hear" are different facts and a reader has to tell them apart
 * at a glance from across a room.
 */
export const READOUT_WAITING_TEXT = '--';

/** What a readout prints for a sensor that is present and reporting nothing. */
export const READOUT_NO_READING_TEXT = 'n/a';

/**
 * Decimals per metric, for the metrics where the default is wrong.
 *
 * Fan RPM, clocks in MHz, frequencies, throughput, timings and energy counters are all quantities
 * whose fractional part is noise at the precision the hardware reports — "1487.6 RPM" implies a
 * tachometer accuracy that does not exist, and a digit that jitters every tick draws the eye for
 * no information. Everything else keeps `DEFAULT_DECIMALS`.
 */
export const READOUT_DECIMALS: Readonly<Partial<Record<SensorMetric, number>>> = Object.freeze({
  clock: 0,
  fan: 0,
  frequency: 0,
  throughput: 0,
  timing: 0,
  energy: 0,
});

/**
 * One decimal, for everything else.
 *
 * Temperatures, voltages, loads and powers all move meaningfully in tenths, and a fixed decimal
 * count is what stops the printed width — and therefore the widget's width — from changing as a
 * value crosses 10 or 100.
 */
export const DEFAULT_DECIMALS = 1;

export interface ReadoutViewInput {
  /** The snapshot, straight from the store. */
  snapshot: SensorSnapshot;
  /**
   * The metric, which is where the unit comes from.
   *
   * Deliberately the metric and not the reading: a `SensorReading` has no `unit` field, because a
   * unit is a property of *what is being measured*, not of a particular measurement, and a
   * publisher that sent one could disagree with itself between two ticks.
   */
  metric: SensorMetric;
  /** What to call it. Passed through untouched. */
  label?: string | undefined;
  /** Override the metric's decimal count. */
  decimals?: number | undefined;
}

/** Everything a readout draws, already stringified. */
export interface ReadoutViewModel {
  /** Which of the four states this is, for `data-state` and for styling. */
  readonly state: ReadoutStateKind;
  /** The big text: a formatted number, or one of the two placeholder glyphs. */
  readonly value: string;
  /**
   * The unit, or `''`.
   *
   * Empty for the two placeholder states — "n/a °C" is nonsense — and also empty for a genuinely
   * dimensionless metric such as `factor`, whose unit in `SENSOR_METRIC_UNITS` *is* the empty
   * string. Nothing downstream may assume a unit is non-empty.
   */
  readonly unit: string;
  /** Value and unit joined, with a space only when there is a unit to separate. */
  readonly text: string;
  /** The small line under the value: `''` when a live number needs no explanation. */
  readonly note: string;
  /** The label, as given. */
  readonly label: string;
}

/**
 * Turn the store's snapshot into the reader's four-state view.
 *
 * Where three becomes four: a `live` snapshot splits on whether its value is `null`. `stale`
 * deliberately does *not* split — a stale null stays `stale`, because "we stopped hearing from
 * this" is the more urgent fact and the note has room for only one.
 */
export function readoutState(snapshot: SensorSnapshot): ReadoutState {
  switch (snapshot.state) {
    case 'waiting':
      return { kind: 'waiting' };
    case 'live':
      return snapshot.reading.value === null
        ? { kind: 'no-reading' }
        : { kind: 'value', value: snapshot.reading.value };
    case 'stale':
      return { kind: 'stale', value: snapshot.reading.value, ageMs: snapshot.ageMs };
    default:
      return assertNever(snapshot, 'sensor snapshot state');
  }
}

/**
 * The strings a readout prints.
 *
 * Pure, and pure on purpose: no DOM, no clock, no React. The age a stale note reports comes from
 * the snapshot, not from `Date.now()`, so the same snapshot renders the same words however long
 * ago it was published — which is what lets a capture be reproducible and a test be exact.
 */
export function readoutView(input: ReadoutViewInput): ReadoutViewModel {
  const { snapshot, metric, label = '', decimals } = input;
  const state = readoutState(snapshot);
  const places = decimals ?? READOUT_DECIMALS[metric] ?? DEFAULT_DECIMALS;

  const { value, unit, note } = describe(state, metric, places);

  return {
    state: state.kind,
    value,
    unit,
    // One space, and only when there is a unit — `factor` would otherwise print a trailing space
    // that no reader sees and every string assertion trips over.
    text: unit === '' ? value : `${value} ${unit}`,
    note,
    label,
  };
}

/**
 * The per-state rendering, as one exhaustive switch.
 *
 * The second of the union's four enforcement points. Every branch returns all three strings, so a
 * new state cannot be added half-rendered: there is no partial object to fall through and no
 * default to silently absorb it.
 */
function describe(
  state: ReadoutState,
  metric: SensorMetric,
  places: number,
): { value: string; unit: string; note: string } {
  switch (state.kind) {
    case 'waiting':
      return { value: READOUT_WAITING_TEXT, unit: '', note: 'waiting' };

    case 'no-reading':
      return { value: READOUT_NO_READING_TEXT, unit: '', note: 'no reading' };

    case 'value':
      return {
        value: state.value.toFixed(places),
        unit: SENSOR_METRIC_UNITS[metric],
        note: '',
      };

    case 'stale':
      // A held value keeps its unit; a held *nothing* has none to keep.
      return state.value === null
        ? { value: READOUT_NO_READING_TEXT, unit: '', note: staleNote(state.ageMs) }
        : {
            value: state.value.toFixed(places),
            unit: SENSOR_METRIC_UNITS[metric],
            note: staleNote(state.ageMs),
          };

    default:
      return assertNever(state, 'readout state');
  }
}

/**
 * How a stale reading's age is worded.
 *
 * Whole seconds, because that is the precision a person reads off a wall panel and because the
 * store only republishes a stale snapshot when this number changes — a finer unit would re-render
 * the page far more often to say the same thing.
 */
export function staleNote(ageMs: number): string {
  return `stale ${String(Math.round(ageMs / 1_000))}s`;
}
