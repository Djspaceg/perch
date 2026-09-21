import { describe, expect, it } from 'vitest';
import { isSensorReading, sensorTopic } from '@perch/sensor-contract';
import { relayWebSocketUrl } from '@perch/sensor-sources';
import * as layoutSchema from '@perch/layout-schema';
import * as uiKit from '@perch/ui-kit';

describe('@perch/runtime dependency edges', () => {
  it('resolves @perch/sensor-contract', () => {
    expect(sensorTopic('cpu', 'temperature')).toBe('sensors/cpu/0/temperature/0');
    expect(isSensorReading({ value: 61, at: 0 })).toBe(true);
  });

  it('resolves @perch/sensor-sources', () => {
    expect(relayWebSocketUrl()).toBe('ws://localhost:9001');
  });

  it('resolves both core packages it renders through', () => {
    expect(uiKit).toBeTypeOf('object');
    expect(layoutSchema).toBeTypeOf('object');
  });
});
