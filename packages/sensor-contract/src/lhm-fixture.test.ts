/**
 * The LHM mapping, asserted over a whole live capture rather than hand-picked examples.
 *
 * `lhm.test.ts` covers the mapping's rules one at a time with identifiers written by hand.
 * This file covers all **214** sensors in `fixtures/lhm-data.sample.json` at once, which is
 * what turns the alias table from convention-guessing into something proven: if a real
 * `/data.json` contains a hardware prefix, a sensor type or an instance spelling the table
 * does not handle, a test here fails by name.
 */

import { describe, expect, it } from 'vitest';
import { isSensorTopic, lhmSensorIdToTopic, parseSensorTopic } from '@perch/sensor-contract';
import {
  lhmHardwarePortion,
  loadLhmFixtureSensors,
  type LhmSensorNode,
} from './lhm-fixture.test-support.js';

const sensors = loadLhmFixtureSensors();

/**
 * The hardware prefixes the capture contains, and the device each must map to. Keyed by the
 * whole hardware portion, so `/lpc/nct6798d/0` (a Super I/O chip) and `/lpc/ec` (the embedded
 * controller) are separate expectations — they are the case the first identifier segment
 * alone gets wrong.
 */
const EXPECTED_DEVICE_BY_HARDWARE: Readonly<Record<string, string>> = {
  'amdcpu/0': 'cpu',
  'gpu-nvidia/0': 'gpu',
  'lpc/nct6798d/0': 'superio',
  'nvme/0': 'storage',
  'lpc/ec': 'embedded-controller',
};

/** Hardware whose instance is an identity rather than an ordinal: `/nic/%7B…GUID…%7D`. */
const NIC_PREFIX = 'nic/';

/** LHM's `Type` to the contract's metric, for the 13 types this capture exercises. */
const EXPECTED_METRIC_BY_TYPE: Readonly<Record<string, string>> = {
  Clock: 'clock',
  Control: 'control',
  Current: 'current',
  Data: 'data',
  Factor: 'factor',
  Fan: 'fan',
  Level: 'level',
  Load: 'load',
  Power: 'power',
  SmallData: 'small-data',
  Temperature: 'temperature',
  Throughput: 'throughput',
  Voltage: 'voltage',
};

/**
 * The device each sensor in the capture is expected to land on.
 *
 * Deliberately not `lhm.ts`'s own table: an expectation derived from the implementation would
 * pass whatever the implementation did.
 */
function expectedDevice(sensor: LhmSensorNode): string {
  const hardware = lhmHardwarePortion(sensor.SensorId);
  if (hardware.startsWith(NIC_PREFIX)) return 'network';
  return EXPECTED_DEVICE_BY_HARDWARE[hardware] ?? 'UNEXPECTED-HARDWARE';
}

function sensorIndexOf(sensorId: string): number {
  return Number(sensorId.slice(sensorId.lastIndexOf('/') + 1));
}

describe('the fixture itself', () => {
  it('is the capture the README describes: 214 sensors, 13 sensor types, 10 hardware prefixes', () => {
    expect(sensors).toHaveLength(214);
    expect(new Set(sensors.map((sensor) => sensor.Type)).size).toBe(13);
    expect(new Set(sensors.map((sensor) => lhmHardwarePortion(sensor.SensorId))).size).toBe(10);
    // Ten prefixes, five leading segments, six devices: five of the ten prefixes are NICs,
    // and `lpc` covers two different devices.
    const families = new Set(
      sensors.map((sensor) => lhmHardwarePortion(sensor.SensorId).split('/')[0]),
    );
    expect([...families].sort()).toEqual(['amdcpu', 'gpu-nvidia', 'lpc', 'nic', 'nvme']);
  });

  it('carries every sensor type this capture is supposed to cover', () => {
    expect([...new Set(sensors.map((sensor) => sensor.Type))].sort()).toEqual(
      Object.keys(EXPECTED_METRIC_BY_TYPE).sort(),
    );
  });
});

describe('lhmSensorIdToTopic over the whole capture', () => {
  it('maps every one of the 214 sensors to a canonical topic', () => {
    // There is no known-unmappable bucket left. The one that existed — NICs, whose instance
    // is a URL-encoded GUID rather than an ordinal — was a reserved topic-grammar decision;
    // the human settled it ("opaque token"), so the grammar now has a spelling for it. See
    // DECISIONS.md, "Opaque device-instance tokens".
    const unmappable = sensors
      .map((sensor) => sensor.SensorId)
      .filter((sensorId) => lhmSensorIdToTopic(sensorId) === null);

    expect(unmappable).toEqual([]);
  });

  it('produces topics the contract itself accepts and can parse back', () => {
    for (const sensor of sensors) {
      const topic = lhmSensorIdToTopic(sensor.SensorId);
      expect(topic, sensor.SensorId).not.toBeNull();
      expect(isSensorTopic(topic as string), sensor.SensorId).toBe(true);
      expect(parseSensorTopic(topic as string), sensor.SensorId).not.toBeNull();
    }
  });

  it('puts every sensor on the right device, metric and sensor index', () => {
    for (const sensor of sensors) {
      const parts = parseSensorTopic(lhmSensorIdToTopic(sensor.SensorId) as string);

      expect(parts?.device, sensor.SensorId).toBe(expectedDevice(sensor));
      expect(parts?.metric, sensor.SensorId).toBe(EXPECTED_METRIC_BY_TYPE[sensor.Type]);
      expect(parts?.sensorIndex, sensor.SensorId).toBe(sensorIndexOf(sensor.SensorId));
    }
  });

  it('matches the device distribution in fixtures/README.md', () => {
    const distribution: Record<string, number> = {};
    for (const sensor of sensors) {
      const device = parseSensorTopic(lhmSensorIdToTopic(sensor.SensorId) as string)
        ?.device as string;
      distribution[device] = (distribution[device] ?? 0) + 1;
    }

    expect(distribution).toEqual({
      cpu: 102,
      gpu: 39,
      network: 25,
      superio: 22,
      storage: 19,
      'embedded-controller': 7,
    });
    expect(Object.keys(distribution)).toHaveLength(6);
    expect(Object.values(distribution).reduce((a, b) => a + b, 0)).toBe(214);
  });

  it('keeps the seven /lpc/ec sensors off superio', () => {
    // The regression this file was written for: the alias table keyed on the first segment,
    // so `/lpc/ec/...` — the embedded controller — was bucketed with the Super I/O chip. It
    // is a *silent* mis-mapping: 7 real readings publish under a topic naming the wrong chip.
    const ecTopics = sensors
      .filter((sensor) => sensor.SensorId.startsWith('/lpc/ec/'))
      .map((sensor) => lhmSensorIdToTopic(sensor.SensorId));

    expect(ecTopics).toHaveLength(7);
    for (const topic of ecTopics) {
      expect(topic).toMatch(/^sensors\/embedded-controller\/0\//);
    }
    expect(new Set(ecTopics).size).toBe(7);
  });

  it('gives each of the five network adapters its own device instance', () => {
    const nicSensors = sensors.filter((sensor) => sensor.SensorId.startsWith('/nic/'));
    expect(nicSensors).toHaveLength(25);

    const instances = new Set(
      nicSensors.map(
        (sensor) => parseSensorTopic(lhmSensorIdToTopic(sensor.SensorId) as string)?.deviceIndex,
      ),
    );

    // Five adapters, five instances. Before the grammar had a spelling for a non-integer
    // instance, all 25 collapsed onto `sensors/network/0/...` — five adapters overwriting
    // each other on five topics, which is worse than failing closed.
    expect(instances.size).toBe(5);
    for (const instance of instances) {
      expect(typeof instance).toBe('string');
    }
  });

  it('normalises each adapter GUID to the same token every time, and only that token', () => {
    // Derived here rather than taken from `lhm.ts`: percent-decode, strip the braces LHM
    // encodes as %7B/%7D, lower-case. Written independently so that an implementation which
    // kept the braces, the case or the encoding fails this.
    for (const sensor of sensors.filter((s) => s.SensorId.startsWith('/nic/'))) {
      // `?? ''` rather than a cast: every `/nic/` identifier in the fixture has this segment,
      // and if one ever does not, `''` normalises to `''` and the assertion below fails with
      // the offending `SensorId` named — which is what a test should do with a broken input.
      const guidSegment = sensor.SensorId.split('/')[2] ?? '';
      const expectedToken = decodeURIComponent(guidSegment)
        .replace(/^\{/, '')
        .replace(/\}$/, '')
        .toLowerCase();

      const instance = parseSensorTopic(lhmSensorIdToTopic(sensor.SensorId) as string)?.deviceIndex;

      expect(instance, sensor.SensorId).toBe(expectedToken);
      // Safe in an MQTT topic level, and one canonical spelling: no `/`, `+`, `#`, `%`,
      // braces or upper case can survive normalisation.
      expect(instance as string).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('is stable: the same identifier maps to the same topic every call', () => {
    for (const sensor of sensors) {
      expect(lhmSensorIdToTopic(sensor.SensorId)).toBe(lhmSensorIdToTopic(sensor.SensorId));
    }
  });

  it('gives distinct sensors distinct topics — except where LHM itself duplicates an id', () => {
    const topics = sensors.map((sensor) => lhmSensorIdToTopic(sensor.SensorId) as string);
    const duplicatedIds = sensors
      .map((sensor) => sensor.SensorId)
      .filter((sensorId, index, all) => all.indexOf(sensorId) !== index);

    // LHM emits `/gpu-nvidia/0/load/3` twice in this capture — "GPU Memory" and "GPU Bus" —
    // so two different sensors share one identifier at the source. No mapping can separate
    // them, and a publisher will have the second overwrite the first. Pinned, not papered
    // over: if a future capture stops duplicating, this fails and the note comes out.
    expect(duplicatedIds).toEqual(['/gpu-nvidia/0/load/3']);
    expect(new Set(topics).size).toBe(sensors.length - duplicatedIds.length);
  });
});
