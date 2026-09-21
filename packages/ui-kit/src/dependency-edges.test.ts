import { describe, expect, it } from 'vitest';
import { isSensorReading, sensorTopic } from '@perch/sensor-contract';
import { LAYOUT_SCHEMA_VERSION, createWidgetRegistry } from '@perch/layout-schema';
import * as uiKit from './index.js';

describe('@perch/ui-kit dependency edges', () => {
  it('resolves @perch/sensor-contract', () => {
    expect(sensorTopic('cpu', 'temperature')).toBe('sensors/cpu/0/temperature/0');
    expect(isSensorReading({ value: 61, at: Date.now() })).toBe(true);
  });

  it('resolves @perch/layout-schema, the edge the canvas brought with it', () => {
    // Both halves of why this edge exists: the canvas renders a validated `Layout` at its declared
    // schema version, and the catalogue builds the registry the validator is handed.
    expect(LAYOUT_SCHEMA_VERSION).toBeGreaterThan(0);
    expect(createWidgetRegistry({ readout: { drawsScale: false } }).names).toEqual(['readout']);
  });

  it('resolves its own entry point', () => {
    expect(uiKit).toBeTypeOf('object');
  });
});
