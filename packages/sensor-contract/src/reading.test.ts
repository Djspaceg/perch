import { describe, expect, it } from 'vitest';
import { isSensorReading, type SensorReading } from '@perch/sensor-contract';

const valid: SensorReading = { value: 42, at: 1_758_000_000_000 };

describe('isSensorReading', () => {
  it('accepts a well-formed reading', () => {
    expect(isSensorReading(valid)).toBe(true);
  });

  it.each([
    ['zero', 0],
    ['a negative value', -12.5],
    ['a fractional value', 61.25],
    ['a very large value', 1.7e30],
  ])('accepts %s', (_why, value) => {
    expect(isSensorReading({ ...valid, value })).toBe(true);
  });

  it('accepts a null value, because a sensor can be present and reporting nothing', () => {
    expect(isSensorReading({ ...valid, value: null })).toBe(true);
  });

  it('accepts an unrecognised extra field, because the check is structural', () => {
    expect(isSensorReading({ ...valid, source: 'librehardwaremonitor' })).toBe(true);
  });

  it('accepts a reading with no unit field, which the shape no longer has', () => {
    expect(isSensorReading({ value: 61.5, at: 1 })).toBe(true);
  });

  it('ignores a leftover unit field from the old shape rather than validating it', () => {
    // A stale publisher still sending `unit` is not a malformed reading; the field is
    // simply not part of the contract any more and carries no authority over the unit.
    expect(isSensorReading({ ...valid, unit: 'C' })).toBe(true);
    expect(isSensorReading({ ...valid, unit: 1 })).toBe(true);
    expect(isSensorReading({ ...valid, unit: null })).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '{"value":42}'],
    ['a bare number', 42],
    ['a boolean', true],
    ['an array', []],
    ['an array of readings', [valid]],
  ])('rejects %s', (_why, candidate) => {
    expect(isSensorReading(candidate)).toBe(false);
  });

  it.each([
    ['value missing', { at: 1 }],
    ['at missing', { value: 42 }],
    ['at missing alongside a null value', { value: null }],
    ['an empty object', {}],
    ['value present only as undefined', { value: undefined, at: 1 }],
    ['at present only as undefined', { value: 42, at: undefined }],
  ])('rejects a reading with %s', (_why, candidate) => {
    expect(isSensorReading(candidate)).toBe(false);
  });

  it.each([
    ['a numeric string value', { ...valid, value: '42' }],
    ['a boolean value', { ...valid, value: false }],
    ['an object value', { ...valid, value: { value: 42 } }],
    ['an array value, because a reading is a single scalar', { ...valid, value: [42] }],
  ])('rejects %s', (_why, candidate) => {
    expect(isSensorReading(candidate)).toBe(false);
  });

  it.each([
    ['NaN as the value', { ...valid, value: Number.NaN }],
    ['Infinity as the value', { ...valid, value: Number.POSITIVE_INFINITY }],
    ['-Infinity as the value', { ...valid, value: Number.NEGATIVE_INFINITY }],
  ])('rejects %s, which must be normalised to null upstream', (_why, candidate) => {
    expect(isSensorReading(candidate)).toBe(false);
  });

  it("rejects NaN rather than treating it as a value, because LHM's RawValue can be NaN", () => {
    // LHM's own Prometheus path skips float.IsNaN readings. A NaN that reached a
    // dashboard would render as "NaN °C"; normalised to null it renders as "no data".
    const fromLhm: unknown = { value: Number.NaN, at: 1_758_000_000_000 };
    expect(isSensorReading(fromLhm)).toBe(false);
    expect(isSensorReading({ value: null, at: 1_758_000_000_000 })).toBe(true);
  });

  it.each([
    ['a string timestamp', { ...valid, at: '2026-09-20T00:00:00Z' }],
    ['a null timestamp, because staleness has to be computable', { ...valid, at: null }],
    ['NaN as the timestamp', { ...valid, at: Number.NaN }],
    ['Infinity as the timestamp', { ...valid, at: Number.POSITIVE_INFINITY }],
    ['a Date as the timestamp', { ...valid, at: new Date(0) }],
    ['a numeric-string timestamp', { ...valid, at: '1758000000000' }],
  ])('rejects %s', (_why, candidate) => {
    expect(isSensorReading(candidate)).toBe(false);
  });

  it('narrows an unknown wire payload', () => {
    const wire: unknown = JSON.parse('{"value":61.5,"at":1758000000000}');
    expect(isSensorReading(wire)).toBe(true);

    if (isSensorReading(wire)) {
      // `value` is nullable, so the compiler forces the no-data case to be handled.
      expect(wire.value === null ? 'no data' : wire.value + 1).toBe(62.5);
      expect(wire.at).toBe(1_758_000_000_000);
    }
  });

  it('narrows a null-valued wire payload', () => {
    const wire: unknown = JSON.parse('{"value":null,"at":1758000000000}');
    expect(isSensorReading(wire)).toBe(true);

    if (isSensorReading(wire)) {
      expect(wire.value === null ? 'no data' : 'a number').toBe('no data');
    }
  });

  it.each([
    ['a reading', valid],
    ['a null-valued reading', { value: null, at: 1_758_000_000_000 } satisfies SensorReading],
  ])('survives a JSON round trip unchanged: %s, per the JSON-safe hard rule', (_why, reading) => {
    const roundTripped: unknown = JSON.parse(JSON.stringify(reading));
    expect(roundTripped).toEqual(reading);
    expect(isSensorReading(roundTripped)).toBe(true);
  });

  it('shows why NaN cannot be the wire representation of no data', () => {
    // JSON has no NaN literal; it stringifies to null and would not round-trip.
    expect(JSON.stringify({ value: Number.NaN, at: 1 })).toBe('{"value":null,"at":1}');
  });
});
