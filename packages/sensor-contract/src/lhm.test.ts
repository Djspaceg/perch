import { describe, expect, it } from 'vitest';
import {
  LHM_RAW_VALUE_FIELDS,
  isSensorTopic,
  lhmSensorIdToTopic,
  lhmVendor,
  parseSensorTopic,
} from '@perch/sensor-contract';

describe('lhmSensorIdToTopic', () => {
  it('maps the SPEC/LHM worked example', () => {
    expect(lhmSensorIdToTopic('/intelcpu/0/temperature/0')).toBe('sensors/cpu/0/temperature/0');
  });

  it('carries both indices through unchanged', () => {
    expect(lhmSensorIdToTopic('/intelcpu/0/temperature/3')).toBe('sensors/cpu/0/temperature/3');
    expect(lhmSensorIdToTopic('/amdcpu/1/load/5')).toBe('sensors/cpu/1/load/5');
  });

  it('normalises GPU vendor out of the topic, per the SPEC', () => {
    for (const id of ['/gpu-nvidia/0/temperature/0', '/nvidiagpu/0/temperature/0']) {
      expect(lhmSensorIdToTopic(id)).toBe('sensors/gpu/0/temperature/0');
    }
    expect(lhmSensorIdToTopic('/gpu-amd/1/fan/0')).toBe('sensors/gpu/1/fan/0');
    expect(lhmSensorIdToTopic('/gpu-intel/0/power/0')).toBe('sensors/gpu/0/power/0');
    expect(lhmSensorIdToTopic('/atigpu/0/fan/0')).toBe('sensors/gpu/0/fan/0');
  });

  it("renames LHM's unhyphenated sensor types to the contract's metric names", () => {
    expect(lhmSensorIdToTopic('/ram/smalldata/0')).toBe('sensors/memory/0/small-data/0');
    expect(lhmSensorIdToTopic('/intelcpu/0/timespan/0')).toBe('sensors/cpu/0/time-span/0');
  });

  it('defaults deviceIndex to 0 for an unindexed hardware identifier', () => {
    // `/ram` and `/mainboard` carry no hardware index in LHM's own Identifier.
    expect(lhmSensorIdToTopic('/ram/data/0')).toBe('sensors/memory/0/data/0');
    expect(lhmSensorIdToTopic('/mainboard/temperature/1')).toBe(
      'sensors/motherboard/0/temperature/1',
    );
  });

  it('maps a multi-segment hardware identifier by its leading segment', () => {
    // LHM names a Super I/O chip by chip model, which normalises away like a vendor. Both
    // spellings occur: with an instance index, as the live capture has it, and without.
    expect(lhmSensorIdToTopic('/lpc/nct6798d/0/voltage/0')).toBe('sensors/superio/0/voltage/0');
    expect(lhmSensorIdToTopic('/lpc/nct6687d/temperature/2')).toBe(
      'sensors/superio/0/temperature/2',
    );
  });

  it('maps /lpc/ec to the embedded controller, not to superio', () => {
    // `lpc` is ambiguous: the first identifier segment alone cannot tell the board's Super
    // I/O chip from its embedded controller, and the EC carries no instance segment at all.
    // Proven by fixtures/lhm-data.sample.json, where 7 sensors hang off `/lpc/ec`.
    expect(lhmSensorIdToTopic('/lpc/ec/temperature/0')).toBe(
      'sensors/embedded-controller/0/temperature/0',
    );
    expect(lhmSensorIdToTopic('/lpc/ec/fan/1')).toBe('sensors/embedded-controller/0/fan/1');
    expect(lhmSensorIdToTopic('/lpc/ec/voltage/0')).toBe('sensors/embedded-controller/0/voltage/0');
  });

  it('carries a network adapter GUID through as an opaque device-instance token', () => {
    // LHM identifies a NIC by adapter GUID and gives it no ordinal, so the GUID is the only
    // thing telling two adapters apart. Per the human's decision it becomes an opaque token
    // in the device-instance position: percent-decoded, braces stripped, lower-cased. The
    // GUID here is synthetic — the real ones live in the fixture, which is where machine
    // identity belongs. See DECISIONS.md, "Opaque device-instance tokens".
    expect(lhmSensorIdToTopic('/nic/%7B2C1E0C4A-8A9F-4F8B-9E7D-000000000000%7D/throughput/1')).toBe(
      'sensors/network/2c1e0c4a-8a9f-4f8b-9e7d-000000000000/throughput/1',
    );
    // LHM's own `Identifier.ToString()` does not URL-encode; the HTTP layer does. Both spell
    // the same adapter, so both must normalise to the same token — a topic is an identity key.
    expect(lhmSensorIdToTopic('/nic/{2C1E0C4A-8A9F-4F8B-9E7D-000000000000}/throughput/1')).toBe(
      'sensors/network/2c1e0c4a-8a9f-4f8b-9e7d-000000000000/throughput/1',
    );
  });

  it('still takes an integer NIC instance as an ordinal', () => {
    // Nothing about the token spelling changes the ordinary case.
    expect(lhmSensorIdToTopic('/nic/1/throughput/0')).toBe('sensors/network/1/throughput/0');
  });

  it.each([
    [
      'an instance identity that decodes to a topic-hostile character',
      '/nic/%2Fetc%2Fpasswd/load/0',
    ],
    ['an MQTT single-level wildcard smuggled into the instance', '/nic/%2B/load/0'],
    ['an MQTT multi-level wildcard', '/nic/%23/load/0'],
    ['a malformed percent escape', '/nic/%zz/load/0'],
    ['an empty instance segment', '/nic//load/0'],
  ])('fails closed on %s', (_why, sensorId) => {
    expect(lhmSensorIdToTopic(sensorId)).toBeNull();
  });

  it.each([
    ['/nvme/0/temperature/0', 'sensors/storage/0/temperature/0'],
    ['/hdd/2/level/0', 'sensors/storage/2/level/0'],
    ['/ssd/1/load/0', 'sensors/storage/1/load/0'],
    ['/battery/0/level/0', 'sensors/battery/0/level/0'],
    ['/psu/0/voltage/2', 'sensors/psu/0/voltage/2'],
    ['/cooler/0/control/0', 'sensors/cooler/0/control/0'],
    ['/embeddedcontroller/0/fan/1', 'sensors/embedded-controller/0/fan/1'],
  ])('maps %s', (sensorId, topic) => {
    expect(lhmSensorIdToTopic(sensorId)).toBe(topic);
  });

  it('always produces a topic the contract itself accepts', () => {
    for (const id of [
      '/intelcpu/0/temperature/0',
      '/gpu-amd/1/fan/0',
      '/ram/data/0',
      '/lpc/nct6687d/voltage/9',
    ]) {
      const topic = lhmSensorIdToTopic(id);
      expect(topic).not.toBeNull();
      expect(isSensorTopic(topic as string)).toBe(true);
      expect(parseSensorTopic(topic as string)).not.toBeNull();
    }
  });

  it.each([
    ['an unknown hardware type, so a mis-bucketed device is impossible', '/quantumcpu/0/load/0'],
    ['an unknown sensor type', '/intelcpu/0/luminance/0'],
    ['no leading slash', 'intelcpu/0/temperature/0'],
    ['too few segments', '/intelcpu/0'],
    ['a hardware identifier only', '/intelcpu'],
    ['an empty string', ''],
    ['a bare slash', '/'],
    ['a non-numeric sensor index', '/intelcpu/0/temperature/first'],
    ['a negative sensor index', '/intelcpu/0/temperature/-1'],
    ['a fractional sensor index', '/intelcpu/0/temperature/1.5'],
    ['a perch topic, which is not an LHM identifier', 'sensors/cpu/0/temperature/0'],
  ])('fails closed on %s', (_why, sensorId) => {
    expect(lhmSensorIdToTopic(sensorId)).toBeNull();
  });
});

describe('lhmVendor', () => {
  it('recovers the vendor the topic dropped, for SensorMeta', () => {
    expect(lhmVendor('/gpu-nvidia/0/temperature/0')).toBe('nvidia');
    expect(lhmVendor('/nvidiagpu/0/temperature/0')).toBe('nvidia');
    expect(lhmVendor('/gpu-amd/0/fan/0')).toBe('amd');
    expect(lhmVendor('/atigpu/0/fan/0')).toBe('amd');
    expect(lhmVendor('/gpu-intel/0/power/0')).toBe('intel');
    expect(lhmVendor('/intelcpu/0/temperature/0')).toBe('intel');
    expect(lhmVendor('/amdcpu/0/load/0')).toBe('amd');
  });

  it('is undefined where LHM names no vendor', () => {
    expect(lhmVendor('/ram/data/0')).toBeUndefined();
    expect(lhmVendor('/nvme/0/temperature/0')).toBeUndefined();
    expect(lhmVendor('/mainboard/temperature/0')).toBeUndefined();
  });

  it('is undefined for an identifier that does not map at all', () => {
    expect(lhmVendor('')).toBeUndefined();
    expect(lhmVendor('/quantumcpu/0/load/0')).toBeUndefined();
  });
});

describe('LHM_RAW_VALUE_FIELDS', () => {
  it("names the raw fields, because LHM's formatted ones change unit with magnitude", () => {
    expect([...LHM_RAW_VALUE_FIELDS]).toEqual(['RawValue', 'RawMin', 'RawMax']);
  });

  it('does not name the formatted fields', () => {
    for (const formatted of ['Value', 'Min', 'Max']) {
      expect(LHM_RAW_VALUE_FIELDS).not.toContain(formatted);
    }
  });
});
