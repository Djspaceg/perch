import { describe, expect, it } from 'vitest';
import { SENSOR_METRIC_UNITS } from '@perch/sensor-contract';
import {
  READOUT_NO_READING_TEXT,
  READOUT_STATE_KINDS,
  READOUT_WAITING_TEXT,
  readoutState,
  readoutView,
  type ReadoutStateKind,
  type SensorSnapshot,
} from '@perch/ui-kit';

const live = (value: number | null, at = 10_000): SensorSnapshot => ({
  state: 'live',
  reading: { value, at },
  ageMs: 0,
});

const stale = (value: number | null, ageMs: number): SensorSnapshot => ({
  state: 'stale',
  reading: { value, at: 10_000 },
  ageMs,
});

describe('readoutState: the four states, as a union', () => {
  it('maps a topic nothing has arrived for to waiting', () => {
    expect(readoutState({ state: 'waiting' })).toEqual({ kind: 'waiting' });
  });

  it('maps a live number to value, carrying the number and not a string', () => {
    const state = readoutState(live(61.25));

    expect(state).toEqual({ kind: 'value', value: 61.25 });
  });

  it('maps a live null to no-reading, which is not waiting and not a zero', () => {
    const state = readoutState(live(null));

    expect(state).toEqual({ kind: 'no-reading' });
    expect(state.kind).not.toBe('waiting');
    expect(state.kind).not.toBe('value');
  });

  it('maps a stale reading to stale, carrying both the held value and its age', () => {
    expect(readoutState(stale(61, 8_400))).toEqual({ kind: 'stale', value: 61, ageMs: 8_400 });
  });

  it('prefers stale over no-reading when both are true', () => {
    expect(readoutState(stale(null, 12_000))).toEqual({
      kind: 'stale',
      value: null,
      ageMs: 12_000,
    });
  });

  it('enumerates exactly the four kinds it can produce', () => {
    // `READOUT_STATE_KINDS` is typed as covering every member of the union, so a fifth
    // member that is not added here is a compile error rather than an untested branch.
    expect([...READOUT_STATE_KINDS].sort()).toEqual(
      ['no-reading', 'stale', 'value', 'waiting'].sort(),
    );
  });

  it('produces a kind in that enumeration for every snapshot shape', () => {
    const kinds: ReadoutStateKind[] = [
      readoutState({ state: 'waiting' }).kind,
      readoutState(live(1)).kind,
      readoutState(live(null)).kind,
      readoutState(stale(1, 6_000)).kind,
      readoutState(stale(null, 6_000)).kind,
    ];

    for (const kind of kinds) expect(READOUT_STATE_KINDS).toContain(kind);
  });
});

describe('readoutView: strings, with no DOM in sight', () => {
  it('waits, distinctly from having nothing to report', () => {
    const view = readoutView({ snapshot: { state: 'waiting' }, metric: 'temperature' });

    expect(view).toMatchObject({
      state: 'waiting',
      value: READOUT_WAITING_TEXT,
      unit: '',
      note: 'waiting',
    });
    expect(READOUT_WAITING_TEXT).not.toBe(READOUT_NO_READING_TEXT);
  });

  it('renders a null value as "no reading", never as 0 or blank', () => {
    const view = readoutView({ snapshot: live(null), metric: 'temperature' });

    expect(view).toMatchObject({
      state: 'no-reading',
      value: READOUT_NO_READING_TEXT,
      unit: '',
      note: 'no reading',
    });
    expect(view.value).not.toBe('0');
    expect(view.value).not.toBe('');
  });

  it('renders a real zero as a number, not as "no reading"', () => {
    expect(readoutView({ snapshot: live(0), metric: 'load' })).toMatchObject({
      state: 'value',
      value: '0.0',
      unit: '%',
      note: '',
    });
  });

  it('takes the unit from the metric, never from the reading', () => {
    expect(readoutView({ snapshot: live(61.28), metric: 'temperature' })).toMatchObject({
      state: 'value',
      value: '61.3',
      unit: SENSOR_METRIC_UNITS.temperature,
    });
  });

  it('keeps the last value when it has aged out, and says how old it is', () => {
    expect(readoutView({ snapshot: stale(61, 8_400), metric: 'temperature' })).toMatchObject({
      state: 'stale',
      value: '61.0',
      unit: '°C',
      note: 'stale 8s',
    });
  });

  it('prefers the stale state over "no reading" when both are true', () => {
    expect(readoutView({ snapshot: stale(null, 12_000), metric: 'temperature' })).toMatchObject({
      state: 'stale',
      value: READOUT_NO_READING_TEXT,
      unit: '',
      note: 'stale 12s',
    });
  });

  it('rounds whole-number metrics to no decimals', () => {
    expect(readoutView({ snapshot: live(1487.6), metric: 'fan' }).value).toBe('1488');
    expect(readoutView({ snapshot: live(4201.4), metric: 'clock' }).value).toBe('4201');
  });

  it('accepts an explicit decimal count', () => {
    expect(readoutView({ snapshot: live(1.23456), metric: 'voltage', decimals: 3 }).value).toBe(
      '1.235',
    );
  });

  it('handles the dimensionless metric, whose unit is the empty string', () => {
    const view = readoutView({ snapshot: live(43.5), metric: 'factor' });

    expect(SENSOR_METRIC_UNITS.factor).toBe('');
    expect(view).toMatchObject({ state: 'value', value: '43.5', unit: '' });
    expect(view.text).toBe('43.5');
  });

  it('joins value and unit with one space when there is a unit', () => {
    expect(readoutView({ snapshot: live(61), metric: 'temperature' }).text).toBe('61.0 °C');
  });

  it('carries the label through untouched', () => {
    expect(
      readoutView({ snapshot: live(61), metric: 'temperature', label: 'CPU Package' }).label,
    ).toBe('CPU Package');
  });

  it('gives the same strings for the same input, every time', () => {
    const input = { snapshot: live(61.25), metric: 'temperature' } as const;

    expect(readoutView(input)).toEqual(readoutView(input));
  });
});
