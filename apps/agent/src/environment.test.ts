import { describe, expect, it } from 'vitest';
import { sensorTopic } from '@perch/sensor-contract';

describe('@perch/agent', () => {
  it('runs under node, per ARCHITECTURE.md', () => {
    expect('document' in globalThis).toBe(false);
    expect('window' in globalThis).toBe(false);
  });

  it('resolves its one declared edge, @perch/sensor-contract', () => {
    expect(sensorTopic('cpu', 'power')).toBe('sensors/cpu/0/power/0');
  });
});
