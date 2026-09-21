/**
 * `isTopicShaped`: the vocabulary-free default.
 *
 * The point of these cases is that none of them names a device or a metric. Every rule here is
 * about a topic being one unambiguous key, which is why this package can hold it without breaking
 * `sensor-contract`'s "names live in exactly one place".
 */

import { describe, expect, it } from 'vitest';
import { isTopicShaped } from '@perch/layout-schema';

describe('isTopicShaped', () => {
  it.each([
    ['a full sensor topic', 'sensors/cpu/0/temperature/0'],
    ['a single segment', 'cpu'],
    ['segments with hyphens and dots', 'sensors/gpu-0/fan.speed/1'],
    ['upper case, which is a vocabulary question and not a shape one', 'Sensors/CPU/0'],
  ])('accepts %s', (_why, topic) => {
    expect(isTopicShaped(topic)).toBe(true);
  });

  it.each([
    ['an empty topic', ''],
    ['a single-level wildcard', 'sensors/+/temperature/0'],
    ['a multi-level wildcard', 'sensors/cpu/#'],
    ['a leading separator', '/sensors/cpu'],
    ['a trailing separator', 'sensors/cpu/'],
    ['a doubled separator', 'sensors//cpu'],
    ['just a separator', '/'],
    ['a space', 'sensors/cpu 0'],
    ['a trailing space', 'sensors/cpu '],
    ['a newline', 'sensors/cpu\n'],
    ['a tab', 'sensors\t/cpu'],
    ['a null byte', 'sensors/cpu\u0000'],
    ['a DEL', 'sensors/cpu\u007f'],
  ])('rejects %s', (_why, topic) => {
    expect(isTopicShaped(topic)).toBe(false);
  });
});
