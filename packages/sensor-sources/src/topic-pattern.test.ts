import { describe, expect, it } from 'vitest';
import { SENSOR_TOPIC_WILDCARD, sensorMetaTopic, sensorTopic } from '@perch/sensor-contract';
import { topicMatchesPattern } from '@perch/sensor-sources';

const cpuTemp = sensorTopic('cpu', 'temperature');
const coreThree = sensorTopic('cpu', 'temperature', { sensorIndex: 3 });

describe('topicMatchesPattern', () => {
  it('matches a topic against itself', () => {
    expect(topicMatchesPattern(cpuTemp, cpuTemp)).toBe(true);
    expect(topicMatchesPattern(cpuTemp, coreThree)).toBe(false);
  });

  it('matches everything under the contract wildcard', () => {
    expect(topicMatchesPattern(cpuTemp, SENSOR_TOPIC_WILDCARD)).toBe(true);
    expect(topicMatchesPattern(coreThree, SENSOR_TOPIC_WILDCARD)).toBe(true);
    expect(topicMatchesPattern(sensorMetaTopic('gpu', 'fan'), SENSOR_TOPIC_WILDCARD)).toBe(true);
  });

  it('treats + as exactly one level', () => {
    expect(topicMatchesPattern(cpuTemp, 'sensors/+/0/temperature/0')).toBe(true);
    expect(topicMatchesPattern(cpuTemp, 'sensors/cpu/+/temperature/+')).toBe(true);
    expect(topicMatchesPattern(coreThree, 'sensors/cpu/0/temperature/+')).toBe(true);
    // One level, never two: the meta companion topic is one level longer.
    expect(topicMatchesPattern(sensorMetaTopic('cpu', 'temperature'), 'sensors/cpu/+/+/+')).toBe(
      false,
    );
  });

  it('treats # as the rest of the levels, including none', () => {
    expect(topicMatchesPattern(cpuTemp, 'sensors/cpu/#')).toBe(true);
    expect(topicMatchesPattern(cpuTemp, 'sensors/cpu/0/temperature/0/#')).toBe(true);
    expect(topicMatchesPattern(sensorMetaTopic('cpu', 'temperature'), 'sensors/cpu/#')).toBe(true);
    expect(topicMatchesPattern(sensorTopic('gpu', 'fan'), 'sensors/cpu/#')).toBe(false);
  });

  it('does not match a shorter or longer topic against a fixed pattern', () => {
    expect(topicMatchesPattern('sensors/cpu/temperature', 'sensors/cpu/0/temperature/0')).toBe(
      false,
    );
    expect(topicMatchesPattern(sensorMetaTopic('cpu', 'temperature'), cpuTemp)).toBe(false);
  });

  it('rejects a # that is not the last level, because MQTT does', () => {
    expect(topicMatchesPattern(cpuTemp, 'sensors/#/temperature/0')).toBe(false);
  });
});
