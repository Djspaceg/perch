import { describe, expect, it } from 'vitest';
import { sensorTopic } from '@perch/sensor-contract';
import { relayWebSocketUrl } from '@perch/sensor-sources';
import * as layoutSchema from '@perch/layout-schema';
import * as uiKit from '@perch/ui-kit';

describe('@perch/editor dependency edges', () => {
  it('resolves the same four packages the runtime renders through', () => {
    expect(sensorTopic('memory', 'load')).toBe('sensors/memory/0/load/0');
    expect(relayWebSocketUrl('desk.local')).toBe('ws://desk.local:9001');
    expect(uiKit).toBeTypeOf('object');
    expect(layoutSchema).toBeTypeOf('object');
  });
});
