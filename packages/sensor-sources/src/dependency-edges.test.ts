import { describe, expect, it } from 'vitest';
import { sensorTopic } from '@perch/sensor-contract';

describe('@perch/sensor-sources dependency edges', () => {
  it('resolves its one declared edge, @perch/sensor-contract', () => {
    expect(sensorTopic('gpu', 'temperature')).toBe('sensors/gpu/0/temperature/0');
  });
});
