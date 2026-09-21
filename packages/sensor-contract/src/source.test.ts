import { describe, expect, it } from 'vitest';
import {
  SENSOR_SOURCE_STATUSES,
  SENSOR_TOPIC_WILDCARD,
  sensorTopic,
  type SensorMeta,
  type SensorReading,
  type SensorSource,
  type SensorSourceStatus,
  type SensorTopic,
  type Unsubscribe,
} from '@perch/sensor-contract';

/**
 * A source written against nothing but the exported interface. If this compiles and its
 * calls behave, an implementation in `sensor-sources` needs no other type from anywhere.
 */
function stubSource(): SensorSource & { emit(topic: SensorTopic, reading: SensorReading): void } {
  const handlers = new Set<(topic: SensorTopic, reading: SensorReading) => void>();
  const labels = new Map<SensorTopic, SensorMeta>([
    [sensorTopic('cpu', 'temperature'), { label: 'CPU Package' }],
  ]);

  return {
    status: 'connecting',
    subscribe(_pattern, onReading): Unsubscribe {
      handlers.add(onReading);
      return () => handlers.delete(onReading);
    },
    meta(topic) {
      return labels.get(topic);
    },
    emit(topic, reading) {
      for (const handler of handlers) handler(topic, reading);
    },
  };
}

describe('SENSOR_SOURCE_STATUSES', () => {
  it('is the four states a dashboard has to tell apart', () => {
    expect(SENSOR_SOURCE_STATUSES).toEqual(['connecting', 'live', 'stale', 'error']);
  });

  it('is frozen, because a consumer may iterate it to build a status indicator', () => {
    expect(Object.isFrozen(SENSOR_SOURCE_STATUSES)).toBe(true);
  });

  it('derives the type from the one list', () => {
    const everyStatus: SensorSourceStatus[] = [...SENSOR_SOURCE_STATUSES];
    expect(everyStatus).toHaveLength(4);
  });
});

describe('SensorSource', () => {
  it('delivers readings to a subscriber until it unsubscribes', () => {
    const source = stubSource();
    const seen: [SensorTopic, SensorReading][] = [];
    const topic = sensorTopic('cpu', 'temperature');

    const unsubscribe = source.subscribe(SENSOR_TOPIC_WILDCARD, (t, r) => seen.push([t, r]));
    source.emit(topic, { value: 61, at: 1000 });
    unsubscribe();
    source.emit(topic, { value: 62, at: 2000 });

    expect(seen).toEqual([[topic, { value: 61, at: 1000 }]]);
  });

  it('returns metadata for a known topic and undefined for an unknown one', () => {
    const source = stubSource();

    expect(source.meta(sensorTopic('cpu', 'temperature'))).toEqual({ label: 'CPU Package' });
    expect(source.meta(sensorTopic('gpu', 'fan'))).toBeUndefined();
  });

  it('exposes a status from the vocabulary', () => {
    expect(SENSOR_SOURCE_STATUSES).toContain(stubSource().status);
  });
});
