import { describe, expect, it } from 'vitest';
import { isSensorReading, sensorTopic } from '@perch/sensor-contract';
import * as uiKit from './index.js';

describe('@perch/ui-kit dependency edges', () => {
  it('resolves its one declared edge, @perch/sensor-contract', () => {
    expect(sensorTopic('cpu', 'temperature')).toBe('sensors/cpu/0/temperature/0');
    expect(isSensorReading({ value: 61, at: Date.now() })).toBe(true);
  });

  it('resolves its own entry point', () => {
    expect(uiKit).toBeTypeOf('object');
  });
});
