/**
 * `parseLhmValue`, against the four value shapes the capture contains and against all 214
 * `RawValue`s at once.
 *
 * The thing under test is a transport fact that reading LHM's C# source hides: `RawValue` is
 * documented as `float?`, but `/data.json` sends it as a **formatted string with a unit
 * suffix** — and, for `Factor`, with no unit at all.
 */

import { assert, describe, expect, it } from 'vitest';
import { parseLhmValue } from '@perch/sensor-contract';
import { loadLhmFixtureSensors } from './lhm-fixture.test-support.js';

const sensors = loadLhmFixtureSensors();

describe('parseLhmValue on the shapes the capture contains', () => {
  it.each([
    ['a voltage', '2.848 V', 2.848],
    ['an integer fan speed', '448 RPM', 448],
    ['a temperature, non-ASCII unit', '44.0 °C', 44],
    ['a Factor, which has no unit at all', '48.500', 48.5],
    ['a throughput in the raw unit', '6699008.0 B/s', 6699008],
    ['a percentage', '11.9 %', 11.9],
    ['a unit with no separating space', '2.848V', 2.848],
    ['a data size', '23.5 GB', 23.5],
    ['zero', '0.0 B/s', 0],
    ['a negative reading', '-12.5 W', -12.5],
    ['an explicit plus', '+3.3 V', 3.3],
    ['leading and trailing whitespace', '  57.0 °C  ', 57],
    ['a compound unit', '1.5 µS/cm', 1.5],
  ])('parses %s', (_why, raw, expected) => {
    expect(parseLhmValue(raw)).toBe(expected);
  });

  it.each([
    ['a sensor reporting nothing — LHM sends the unit alone', ' °C'],
    ['the formatted spelling of the same', '-'],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['a unit with no number', 'RPM'],
    ['LHM prose rather than a reading', 'n/a'],
    ['NaN spelled out', 'NaN'],
    ['Infinity spelled out', 'Infinity'],
    ['a bare sign', '+'],
    ['a bare decimal point', '.'],
  ])('returns null for %s', (_why, raw) => {
    expect(parseLhmValue(raw)).toBeNull();
  });

  it.each([
    ['exponent notation, which LHM never emits and which a unit could disguise', '1e3 V'],
    ['two decimal points', '1.5.2 V'],
    ['a digit inside what should be the unit', '10 20 V'],
  ])('fails closed rather than reading a prefix of %s', (_why, raw) => {
    expect(parseLhmValue(raw)).toBeNull();
  });

  it('is invariant-culture only: a comma is never a decimal separator or a group separator', () => {
    // `48,500` is 48.5 in a comma-decimal locale and 48500 in an English one. LHM formats
    // with the invariant culture, so a comma should never arrive; guessing which reading was
    // meant would be wrong by 1000x, so it fails closed instead.
    expect(parseLhmValue('48,500')).toBeNull();
    expect(parseLhmValue('1,024 MB')).toBeNull();
  });

  it('returns null for anything that is not a string, because the wire is untrusted', () => {
    expect(parseLhmValue(null)).toBeNull();
    expect(parseLhmValue(undefined)).toBeNull();
    expect(parseLhmValue(42)).toBeNull();
    expect(parseLhmValue({ Value: '1 V' })).toBeNull();
  });

  it('never returns a value isSensorReading would reject', () => {
    for (const raw of ['NaN', 'Infinity', '-Infinity', ' °C', '', '1e999 V']) {
      const parsed = parseLhmValue(raw);
      expect(parsed === null || Number.isFinite(parsed)).toBe(true);
    }
  });

  it('distinguishes "reporting nothing" from a real zero', () => {
    // The distinction `SensorReading.value` exists for: `null` is "no reading", `0` is zero.
    expect(parseLhmValue(' °C')).toBeNull();
    expect(parseLhmValue('0.0 °C')).toBe(0);
  });
});

describe('parseLhmValue over all 214 RawValues in the capture', () => {
  it('parses every RawValue to a finite number, except the one sensor reporting nothing', () => {
    const unparsed = sensors.filter((sensor) => parseLhmValue(sensor.RawValue) === null);

    // `/lpc/ec/temperature/1` is the board's unpopulated "T Sensor": LHM enumerates it and
    // sends `RawValue: " °C"` — the unit with no number. That is exactly `value: null`.
    expect(unparsed.map((sensor) => sensor.SensorId)).toEqual(['/lpc/ec/temperature/1']);

    for (const sensor of sensors) {
      const parsed = parseLhmValue(sensor.RawValue);
      expect(parsed === null || Number.isFinite(parsed), sensor.SensorId).toBe(true);
    }
  });

  it('parses RawMin and RawMax too — the same strings, same unit suffixes', () => {
    for (const sensor of sensors) {
      for (const field of ['RawMin', 'RawMax'] as const) {
        const parsed = parseLhmValue(sensor[field]);
        expect(parsed === null || Number.isFinite(parsed), `${sensor.SensorId} ${field}`).toBe(
          true,
        );
      }
    }
  });

  it('parses all 14 unit-less Factor readings, which a unit-requiring parser would drop', () => {
    const factors = sensors.filter((sensor) => sensor.Type === 'Factor');

    expect(factors).toHaveLength(14);
    for (const factor of factors) {
      expect(factor.RawValue, factor.SensorId).toMatch(/^[0-9]+\.[0-9]+$/); // bare, no unit
      expect(parseLhmValue(factor.RawValue), factor.SensorId).not.toBeNull();
    }
  });

  it('is why RawValue is preferred: Throughput is the one type whose unit moves', () => {
    const differing = new Set(
      sensors.filter((sensor) => sensor.Value !== sensor.RawValue).map((sensor) => sensor.Type),
    );

    // Two types differ in this capture, for two different reasons: `Throughput`, where
    // `Value` rescales to KB/s or MB/s while `RawValue` stays B/s — the whole justification
    // for reading Raw — and the one disconnected `Temperature`, where the difference is only
    // how "nothing" is spelled (`-` against ` °C`). Both parse to what the contract wants.
    expect([...differing].sort()).toEqual(['Temperature', 'Throughput']);

    for (const sensor of sensors.filter((s) => s.Type === 'Throughput')) {
      const raw = parseLhmValue(sensor.RawValue);
      const formatted = parseLhmValue(sensor.Value);

      // `assert` rather than `!`: it narrows both to `number` for the comparison below, and a
      // `Throughput` sensor that parses to `null` then fails *here*, naming itself, instead of
      // being coerced past the check by an assertion that only silenced the compiler.
      assert(raw !== null && formatted !== null, sensor.SensorId);

      expect(sensor.RawValue, sensor.SensorId).toContain('B/s');
      // The rescale only ever makes the formatted number smaller (B/s is the finest unit).
      expect(raw, sensor.SensorId).toBeGreaterThanOrEqual(formatted);
    }
  });

  it('pins the worked example from fixtures/README.md', () => {
    const gpuThroughput = sensors.find(
      (sensor) => sensor.SensorId === '/gpu-nvidia/0/throughput/0',
    );

    expect(gpuThroughput?.Value).toBe('6.4 MB/s');
    expect(gpuThroughput?.RawValue).toBe('6699008.0 B/s');
    expect(parseLhmValue(gpuThroughput?.Value)).toBe(6.4);
    expect(parseLhmValue(gpuThroughput?.RawValue)).toBe(6699008);
    // 1046720x apart. Reading `Value` into a topic the contract declares as B/s is the
    // "wrong by a factor, but only sometimes" failure the Raw fields exist to prevent.
    expect(parseLhmValue(gpuThroughput?.RawValue)).not.toBe(parseLhmValue(gpuThroughput?.Value));
  });
});
