import { describe, expect, it } from 'vitest';
import { isSensorMeta, type SensorMeta } from '@perch/sensor-contract';

const valid: SensorMeta = { label: 'CPU Core #3' };

describe('isSensorMeta', () => {
  it('accepts the minimal shape: a label and nothing else', () => {
    expect(isSensorMeta(valid)).toBe(true);
  });

  it('accepts every optional field', () => {
    expect(isSensorMeta({ label: 'GPU Core', vendor: 'nvidia' })).toBe(true);
    expect(isSensorMeta({ label: 'Voltage #7', hidden: true })).toBe(true);
    expect(isSensorMeta({ label: 'Voltage #7', hidden: false })).toBe(true);
    expect(isSensorMeta({ label: 'GPU Hot Spot', vendor: 'amd', hidden: true })).toBe(true);
  });

  it('accepts an absent optional field, but not a wrong-typed one', () => {
    expect(isSensorMeta({ label: 'CPU Package', vendor: undefined })).toBe(true);
    expect(isSensorMeta({ label: 'CPU Package', hidden: undefined })).toBe(true);
    expect(isSensorMeta({ label: 'CPU Package', vendor: 1 })).toBe(false);
    expect(isSensorMeta({ label: 'CPU Package', vendor: null })).toBe(false);
    expect(isSensorMeta({ label: 'CPU Package', hidden: 'true' })).toBe(false);
    expect(isSensorMeta({ label: 'CPU Package', hidden: 1 })).toBe(false);
  });

  it('accepts an unrecognised extra field, because the check is structural', () => {
    expect(isSensorMeta({ ...valid, lhmSensorId: '/intelcpu/0/temperature/3' })).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'CPU Core #3'],
    ['a number', 3],
    ['an array', []],
    ['an empty object, because the label is required', {}],
    ['a missing label', { vendor: 'intel' }],
    ['a non-string label', { label: 3 }],
    ['a null label', { label: null }],
  ])('rejects %s', (_why, candidate) => {
    expect(isSensorMeta(candidate)).toBe(false);
  });

  it('survives a JSON round trip unchanged, per the JSON-safe hard rule', () => {
    const meta: SensorMeta = { label: 'GPU Fan #1', vendor: 'nvidia', hidden: false };
    const roundTripped: unknown = JSON.parse(JSON.stringify(meta));
    expect(roundTripped).toEqual(meta);
    expect(isSensorMeta(roundTripped)).toBe(true);
  });

  it('does not carry a gauge range, which the layout authors instead', () => {
    // LHM's Min/Max are observed running extremes, resettable at any time. Asserting
    // their absence keeps a future author from reintroducing them here.
    expect(Object.keys({ label: 'x', vendor: 'y', hidden: false } satisfies SensorMeta)).toEqual([
      'label',
      'vendor',
      'hidden',
    ]);
    expect(isSensorMeta({ label: 'CPU Package', min: 0, max: 100 })).toBe(true);
  });
});
