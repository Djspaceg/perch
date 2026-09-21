import { describe, expect, it } from 'vitest';
import {
  SENSOR_DEVICES,
  SENSOR_METRICS,
  SENSOR_METRIC_UNITS,
  SENSOR_META_SUFFIX,
  SENSOR_TOPIC_ROOT,
  SENSOR_TOPIC_WILDCARD,
  isSensorDevice,
  isSensorDeviceToken,
  isSensorMetric,
  isSensorTopic,
  normalizeSensorTopic,
  parseSensorTopic,
  sensorMetaTopic,
  sensorTopic,
  type SensorTopic,
  type SensorTopicShorthand,
} from '@perch/sensor-contract';

describe('sensorTopic', () => {
  it('builds the SPEC worked examples', () => {
    expect(sensorTopic('cpu', 'temperature')).toBe('sensors/cpu/0/temperature/0');
    expect(sensorTopic('cpu', 'temperature', { sensorIndex: 3 })).toBe(
      'sensors/cpu/0/temperature/3',
    );
    expect(sensorTopic('gpu', 'fan', { deviceIndex: 1 })).toBe('sensors/gpu/1/fan/0');
    expect(sensorTopic('storage', 'level', { deviceIndex: 2 })).toBe('sensors/storage/2/level/0');
  });

  it('defaults both indices to 0, so the common case stays readable', () => {
    expect(sensorTopic('memory', 'load')).toBe(sensorTopic('memory', 'load', {}));
    expect(sensorTopic('memory', 'load')).toBe(
      sensorTopic('memory', 'load', { deviceIndex: 0, sensorIndex: 0 }),
    );
  });

  it('builds every device x metric pair under the root', () => {
    for (const device of SENSOR_DEVICES) {
      for (const metric of SENSOR_METRICS) {
        expect(sensorTopic(device, metric)).toBe(`${SENSOR_TOPIC_ROOT}/${device}/0/${metric}/0`);
      }
    }
  });

  it.each([
    ['a fractional deviceIndex', { deviceIndex: 1.5 }],
    ['a fractional sensorIndex', { sensorIndex: 0.5 }],
    ['a negative deviceIndex', { deviceIndex: -1 }],
    ['a negative sensorIndex', { sensorIndex: -1 }],
    ['NaN as an index', { sensorIndex: Number.NaN }],
    ['Infinity as an index', { deviceIndex: Number.POSITIVE_INFINITY }],
  ])('throws on %s, rather than building an unparseable topic', (_why, indices) => {
    expect(() => sensorTopic('cpu', 'temperature', indices)).toThrow(RangeError);
  });
});

describe('sensorMetaTopic', () => {
  it('is the reading topic plus the retained meta suffix', () => {
    expect(sensorMetaTopic('cpu', 'temperature')).toBe('sensors/cpu/0/temperature/0/meta');
    expect(sensorMetaTopic('gpu', 'fan', { deviceIndex: 1 })).toBe('sensors/gpu/1/fan/0/meta');
    expect(sensorMetaTopic('cpu', 'temperature')).toBe(
      `${sensorTopic('cpu', 'temperature')}/${SENSOR_META_SUFFIX}`,
    );
  });

  it('is not itself a reading topic, so a subscriber cannot confuse the two', () => {
    expect(isSensorTopic(sensorMetaTopic('cpu', 'temperature'))).toBe(false);
    expect(parseSensorTopic(sensorMetaTopic('cpu', 'temperature'))).toBeNull();
  });
});

describe('parseSensorTopic', () => {
  it('round-trips every topic the builder can produce', () => {
    for (const device of SENSOR_DEVICES) {
      for (const metric of SENSOR_METRICS) {
        expect(parseSensorTopic(sensorTopic(device, metric))).toEqual({
          device,
          deviceIndex: 0,
          metric,
          sensorIndex: 0,
        });
      }
    }
  });

  it('reads both indices', () => {
    expect(parseSensorTopic('sensors/cpu/0/temperature/3')).toEqual({
      device: 'cpu',
      deviceIndex: 0,
      metric: 'temperature',
      sensorIndex: 3,
    });
    expect(parseSensorTopic('sensors/gpu/1/fan/0')).toEqual({
      device: 'gpu',
      deviceIndex: 1,
      metric: 'fan',
      sensorIndex: 0,
    });
    expect(parseSensorTopic('sensors/storage/12/temperature/7')).toEqual({
      device: 'storage',
      deviceIndex: 12,
      metric: 'temperature',
      sensorIndex: 7,
    });
  });

  it('accepts the shorthand form and defaults both indices to 0', () => {
    expect(parseSensorTopic('sensors/cpu/temperature')).toEqual({
      device: 'cpu',
      deviceIndex: 0,
      metric: 'temperature',
      sensorIndex: 0,
    });
    expect(parseSensorTopic('sensors/psu/voltage')).toEqual({
      device: 'psu',
      deviceIndex: 0,
      metric: 'voltage',
      sensorIndex: 0,
    });
  });

  it('accepts the hyphenated devices and metrics, which the old vocabulary had no names for', () => {
    expect(parseSensorTopic('sensors/embedded-controller/0/temperature/1')).toEqual({
      device: 'embedded-controller',
      deviceIndex: 0,
      metric: 'temperature',
      sensorIndex: 1,
    });
    expect(parseSensorTopic('sensors/power-monitor/0/power/0')?.device).toBe('power-monitor');
    expect(parseSensorTopic('sensors/memory/0/small-data/0')?.metric).toBe('small-data');
    expect(parseSensorTopic('sensors/cpu/0/time-span/0')?.metric).toBe('time-span');
  });

  it.each([
    ['a foreign root', 'metrics/cpu/0/temperature/0'],
    ['no root at all', 'cpu/0/temperature/0'],
    ['a root on its own', 'sensors'],
    ['an empty string', ''],
    ['a trailing slash', 'sensors/cpu/0/temperature/0/'],
    ['a leading slash', '/sensors/cpu/0/temperature/0'],
    ['a four-segment topic', 'sensors/cpu/0/temperature'],
    ['a six-segment topic that is not the meta companion', 'sensors/cpu/0/temperature/0/extra'],
    ['the subscription wildcard', SENSOR_TOPIC_WILDCARD],
    ['a single-level wildcard', 'sensors/cpu/+/temperature/0'],
  ])('rejects %s', (_why, topic) => {
    expect(parseSensorTopic(topic)).toBeNull();
    expect(isSensorTopic(topic)).toBe(false);
  });

  it.each([
    ['an unknown device', 'sensors/nic/0/throughput/0'],
    ['a device from the old narrow vocabulary', 'sensors/ram/0/load/0'],
    ['another old device name', 'sensors/disk/0/temperature/0'],
    ['an LHM vendor-qualified device, which normalises to gpu', 'sensors/gpunvidia/0/fan/0'],
    ['an unknown device in shorthand', 'sensors/nic/throughput'],
    ['upper-case device', 'sensors/CPU/0/temperature/0'],
    ['an empty device segment', 'sensors//0/temperature/0'],
  ])('rejects %s', (_why, topic) => {
    expect(parseSensorTopic(topic)).toBeNull();
    expect(isSensorTopic(topic)).toBe(false);
  });

  it.each([
    ['an unknown metric', 'sensors/cpu/0/celsius/0'],
    ['a metric from the old narrow vocabulary', 'sensors/cpu/0/temp/0'],
    ['another old metric name', 'sensors/gpu/0/usage/0'],
    ['an LHM spelling of a hyphenated metric', 'sensors/memory/0/smalldata/0'],
    ['an unknown metric in shorthand', 'sensors/cpu/temp'],
    ['upper-case metric', 'sensors/cpu/0/TEMPERATURE/0'],
    ['an empty metric segment', 'sensors/cpu/0//0'],
  ])('rejects %s', (_why, topic) => {
    expect(parseSensorTopic(topic)).toBeNull();
    expect(isSensorTopic(topic)).toBe(false);
  });

  it.each([
    ['a non-numeric sensorIndex', 'sensors/cpu/0/temperature/core3'],
    ['a negative index', 'sensors/cpu/-1/temperature/0'],
    ['a fractional sensorIndex', 'sensors/cpu/0/temperature/1.5'],
    ['a fractional deviceIndex', 'sensors/cpu/1.5/temperature/0'],
    ['an empty index segment', 'sensors/cpu//temperature/0'],
    ['whitespace around an index', 'sensors/cpu/ 0/temperature/0'],
    [
      'a leading-zero index, because a sensor must have exactly one topic',
      'sensors/cpu/00/temperature/0',
    ],
    ['an exponent-notation sensorIndex', 'sensors/cpu/0/temperature/1e3'],
    ['a plus-signed index', 'sensors/cpu/+1/temperature/0'],
    [
      'an upper-case deviceIndex, which has a lower-case canonical spelling',
      'sensors/network/AA60F32E-DEAD/throughput/0',
    ],
    ['a percent-encoded deviceIndex, likewise', 'sensors/network/%7Baa60f32e%7D/throughput/0'],
    ['braces around a deviceIndex', 'sensors/network/{aa60f32e}/throughput/0'],
    ['a doubled hyphen in a deviceIndex', 'sensors/network/aa60f32e--dead/throughput/0'],
    ['a trailing hyphen in a deviceIndex', 'sensors/network/aa60f32e-/throughput/0'],
    ['a deviceIndex over 64 characters', `sensors/network/${'a'.repeat(65)}/throughput/0`],
  ])('rejects %s', (_why, topic) => {
    expect(parseSensorTopic(topic)).toBeNull();
    expect(isSensorTopic(topic)).toBe(false);
  });

  it('reads an opaque device-instance token as a string, and an ordinal as a number', () => {
    // The device-instance segment is an ordinal where the source has one and an opaque token
    // where it does not — a NIC has no ordinal, only its adapter GUID. See DECISIONS.md,
    // "Opaque device-instance tokens".
    expect(
      parseSensorTopic('sensors/network/684d7057-f1c7-4928-8500-6160b637cc46/throughput/1'),
    ).toEqual({
      device: 'network',
      deviceIndex: '684d7057-f1c7-4928-8500-6160b637cc46',
      metric: 'throughput',
      sensorIndex: 1,
    });
    // An ordinal stays a number, so a consumer that does arithmetic on it keeps working.
    expect(parseSensorTopic('sensors/gpu/1/fan/0')?.deviceIndex).toBe(1);
  });

  it.each([
    ['a word', 'sensors/cpu/first/temperature/0', 'first'],
    ['something that merely looks numeric', 'sensors/cpu/1e3/temperature/0', '1e3'],
    ['a short adapter name', 'sensors/network/eth0/throughput/0', 'eth0'],
  ])(
    'accepts %s in the device-instance position, which it did not before the widening',
    (_why, topic, instance) => {
      // The cost of the widening, recorded rather than hidden: the grammar cannot tell an
      // opaque instance token from a misspelled one, so `sensors/cpu/first/...` is now a valid
      // topic that nothing publishes to. `isSensorTopic` is that much weaker as a typo check
      // for free-text entry, and an editor picker should offer discovered topics rather than
      // lean on the grammar to catch this. The sensorIndex position is unaffected.
      expect(parseSensorTopic(topic)?.deviceIndex).toBe(instance);
      expect(isSensorTopic(topic)).toBe(true);
    },
  );
});

describe('normalizeSensorTopic', () => {
  it('expands the shorthand to the canonical five-segment form', () => {
    expect(normalizeSensorTopic('sensors/cpu/temperature')).toBe('sensors/cpu/0/temperature/0');
    expect(normalizeSensorTopic('sensors/gpu/fan')).toBe('sensors/gpu/0/fan/0');
  });

  it('leaves an already-canonical topic alone', () => {
    expect(normalizeSensorTopic('sensors/gpu/1/fan/0')).toBe('sensors/gpu/1/fan/0');
    expect(normalizeSensorTopic('sensors/storage/2/level/0')).toBe('sensors/storage/2/level/0');
  });

  it('is idempotent', () => {
    const once = normalizeSensorTopic('sensors/cpu/temperature');
    expect(once).not.toBeNull();
    expect(normalizeSensorTopic(once as string)).toBe(once);
  });

  it('returns null for anything the parser rejects', () => {
    expect(normalizeSensorTopic('sensors/cpu/temp')).toBeNull();
    expect(normalizeSensorTopic('sensors/cpu/0/temperature/0/meta')).toBeNull();
    expect(normalizeSensorTopic('')).toBeNull();
  });
});

describe('isSensorTopic', () => {
  it('accepts a built topic and narrows it to the template-literal type', () => {
    const candidate: string = sensorTopic('storage', 'temperature', { deviceIndex: 2 });
    expect(isSensorTopic(candidate)).toBe(true);

    if (isSensorTopic(candidate)) {
      // Assigning proves the guard's return type, not just its boolean.
      const narrowed: SensorTopic = candidate;
      expect(narrowed).toBe('sensors/storage/2/temperature/0');
    }
  });

  it('does not accept the shorthand, because that is not the canonical type', () => {
    expect(isSensorTopic('sensors/cpu/temperature')).toBe(false);
  });
});

describe('the template-literal types', () => {
  it('accepts a hand-written canonical topic', () => {
    const authored: SensorTopic = 'sensors/cpu/0/temperature/3';
    // @ts-expect-error an unknown metric is a compile error, per the SPEC's rule 5
    const badMetric: SensorTopic = 'sensors/cpu/0/celsius/0';
    // @ts-expect-error an unknown device is a compile error too
    const badDevice: SensorTopic = 'sensors/nic/0/throughput/0';

    expect([authored, badMetric, badDevice]).toHaveLength(3);
  });

  it('accepts a hand-written shorthand topic', () => {
    const authored: SensorTopicShorthand = 'sensors/gpu/temperature';
    // @ts-expect-error the shorthand union is closed on the same vocabulary
    const bad: SensorTopicShorthand = 'sensors/gpu/temp';

    expect([authored, bad]).toHaveLength(2);
  });
});

describe('device and metric guards', () => {
  it('accepts every name in the vocabulary', () => {
    for (const device of SENSOR_DEVICES) expect(isSensorDevice(device)).toBe(true);
    for (const metric of SENSOR_METRICS) expect(isSensorMetric(metric)).toBe(true);
  });

  it.each(['ram', 'disk', 'gpunvidia', 'CPU', '', 'temperature'])(
    'rejects %o as a device',
    (candidate) => {
      expect(isSensorDevice(candidate)).toBe(false);
    },
  );

  it.each(['temp', 'usage', 'smalldata', 'TEMPERATURE', '', 'cpu'])(
    'rejects %o as a metric',
    (candidate) => {
      expect(isSensorMetric(candidate)).toBe(false);
    },
  );
});

describe('vocabulary', () => {
  it('is the twelve devices the SPEC lists, vendor normalised out', () => {
    expect([...SENSOR_DEVICES]).toEqual([
      'motherboard',
      'superio',
      'cpu',
      'memory',
      'gpu',
      'storage',
      'network',
      'cooler',
      'embedded-controller',
      'psu',
      'battery',
      'power-monitor',
    ]);
    expect(SENSOR_DEVICES).toHaveLength(12);
  });

  it("is the twenty-one metrics of LHM's sensor types", () => {
    expect([...SENSOR_METRICS]).toEqual([
      'voltage',
      'current',
      'power',
      'clock',
      'temperature',
      'load',
      'frequency',
      'fan',
      'flow',
      'control',
      'level',
      'data',
      'small-data',
      'throughput',
      'time-span',
      'timing',
      'energy',
      'noise',
      'conductivity',
      'humidity',
      'factor',
    ]);
    expect(SENSOR_METRICS).toHaveLength(21);
  });

  it('has no duplicate names', () => {
    expect(new Set(SENSOR_DEVICES).size).toBe(SENSOR_DEVICES.length);
    expect(new Set(SENSOR_METRICS).size).toBe(SENSOR_METRICS.length);
  });

  it('keeps every name topic-safe: lower case, no slash, no MQTT wildcard', () => {
    for (const name of [...SENSOR_DEVICES, ...SENSOR_METRICS]) {
      expect(name).toBe(name.toLowerCase());
      expect(name).toMatch(/^[a-z][a-z-]*[a-z]$/);
    }
  });
});

describe('SENSOR_METRIC_UNITS', () => {
  it('gives every metric exactly one unit', () => {
    for (const metric of SENSOR_METRICS) {
      expect(SENSOR_METRIC_UNITS).toHaveProperty(metric);
      expect(typeof SENSOR_METRIC_UNITS[metric]).toBe('string');
    }
    expect(Object.keys(SENSOR_METRIC_UNITS)).toHaveLength(SENSOR_METRICS.length);
  });

  it('matches the SPEC table', () => {
    expect(SENSOR_METRIC_UNITS).toEqual({
      voltage: 'V',
      current: 'A',
      power: 'W',
      clock: 'MHz',
      temperature: '°C',
      load: '%',
      frequency: 'Hz',
      fan: 'RPM',
      flow: 'L/h',
      control: '%',
      level: '%',
      data: 'GB',
      'small-data': 'MB',
      throughput: 'B/s',
      'time-span': 's',
      timing: 'ns',
      energy: 'mWh',
      noise: 'dBA',
      conductivity: 'µS/cm',
      humidity: '%',
      factor: '',
    });
  });

  it('is the only source of units, and is frozen against a consumer redefining one', () => {
    expect(Object.isFrozen(SENSOR_METRIC_UNITS)).toBe(true);
  });

  it('leaves the dimensionless metric with no unit rather than inventing one', () => {
    expect(SENSOR_METRIC_UNITS.factor).toBe('');
  });
});

describe('constants', () => {
  it('exposes a subscription pattern covering every sensor topic', () => {
    expect(SENSOR_TOPIC_WILDCARD).toBe('sensors/#');
    expect(SENSOR_TOPIC_WILDCARD.startsWith(`${SENSOR_TOPIC_ROOT}/`)).toBe(true);
  });

  it('names the retained metadata companion suffix here rather than in a consumer', () => {
    expect(SENSOR_META_SUFFIX).toBe('meta');
  });
});

describe('opaque device-instance tokens', () => {
  const ADAPTER = '684d7057-f1c7-4928-8500-6160b637cc46';

  it('builds a topic from a token, and round-trips it', () => {
    const topic = sensorTopic('network', 'throughput', { deviceIndex: ADAPTER, sensorIndex: 1 });

    expect(topic).toBe(`sensors/network/${ADAPTER}/throughput/1`);
    expect(isSensorTopic(topic)).toBe(true);
    expect(normalizeSensorTopic(topic)).toBe(topic);
    expect(parseSensorTopic(topic)?.deviceIndex).toBe(ADAPTER);
  });

  it('builds the retained meta companion topic from a token too', () => {
    expect(sensorMetaTopic('network', 'data', { deviceIndex: ADAPTER })).toBe(
      `sensors/network/${ADAPTER}/data/0/meta`,
    );
  });

  it('is idempotent through the authoring seam', () => {
    const once = normalizeSensorTopic(`sensors/network/${ADAPTER}/throughput/1`);
    expect(once).toBe(`sensors/network/${ADAPTER}/throughput/1`);
    expect(normalizeSensorTopic(once as string)).toBe(once);
  });

  it.each([
    ['an MQTT single-level wildcard, which would match other devices', '+'],
    ['an MQTT multi-level wildcard', '#'],
    ['a slash, which would add a topic segment', 'aa/bb'],
    ['upper case, which has a canonical lower-case spelling', 'AA60F32E'],
    ['percent-encoding', '%7Baa60f32e%7D'],
    ['braces', '{aa60f32e}'],
    ['an empty token', ''],
    ['whitespace', 'aa 60'],
    ['an underscore', 'aa_60'],
    ['a leading hyphen', '-aa60'],
    ['a doubled hyphen', 'aa--60'],
    ['65 characters', 'a'.repeat(65)],
    ['a non-canonical ordinal spelling', '00'],
  ])('throws RangeError rather than emit a topic with %s', (_why, token) => {
    expect(isSensorDeviceToken(token)).toBe(false);
    expect(() => sensorTopic('network', 'throughput', { deviceIndex: token })).toThrow(RangeError);
  });

  it.each([ADAPTER, 'eth0', 'a', '0', '7', 'a'.repeat(64)])('accepts %o as a token', (token) => {
    expect(isSensorDeviceToken(token)).toBe(true);
  });

  it('accepts a digits-only token only in the ordinal spelling, so one device has one topic', () => {
    expect(isSensorDeviceToken('0')).toBe(true);
    expect(isSensorDeviceToken('12')).toBe(true);
    expect(isSensorDeviceToken('00')).toBe(false);
    expect(isSensorDeviceToken('007')).toBe(false);
    // The string and the number spell the same segment, so they build the same topic.
    expect(sensorTopic('gpu', 'fan', { deviceIndex: '1' })).toBe(
      sensorTopic('gpu', 'fan', { deviceIndex: 1 }),
    );
  });

  it('carries nothing a consumer can decode: a token is not an ordinal', () => {
    // Opaque means opaque. There is no ordering, no ordinal behind it, and no registry to
    // consult — all the contract promises is that one device always produces one token.
    const parts = parseSensorTopic(`sensors/network/${ADAPTER}/throughput/1`);

    expect(typeof parts?.deviceIndex).toBe('string');
    expect(Number(parts?.deviceIndex)).toBeNaN();
  });
});
