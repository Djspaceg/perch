/**
 * The read-and-map half of a poll, against the real 214-sensor capture.
 *
 * No network, no LHM process, no broker: `fixtures/lhm-data.sample.json` is handed to the same
 * functions the poll loop calls, so every claim here is a claim about what the relay would
 * publish against real hardware. `lhm-tree.rawvalue.test.ts` covers the `RawValue`-vs-`Value`
 * trap separately, because that one is worth failing on its own terms.
 */

import { describe, expect, it } from 'vitest';
import {
  SENSOR_METRICS,
  isSensorReading,
  isSensorMeta,
  isSensorTopic,
  parseSensorTopic,
} from '@perch/sensor-contract';
import { collectLhmSensorNodes, mapLhmSensors, readLhmPayload } from './lhm-tree.js';
import {
  LHM_FIXTURE_DUPLICATE_ID,
  LHM_FIXTURE_DUPLICATE_LABELS,
  LHM_FIXTURE_SENSOR_COUNT,
  LHM_FIXTURE_TOPIC_COUNT,
  loadLhmFixturePayload,
} from './lhm-fixture.test-support.js';

const payload = loadLhmFixturePayload();
const AT = 1_758_000_000_000;

describe('collectLhmSensorNodes', () => {
  it('finds all 214 sensor nodes in the nested tree', () => {
    expect(collectLhmSensorNodes(payload)).toHaveLength(LHM_FIXTURE_SENSOR_COUNT);
  });

  it('takes only the nodes carrying a SensorId, not the hardware and category nodes above them', () => {
    // The tree's root, the hostname node, the board and the category nodes (`Voltages`,
    // `Temperatures`) all have `Text` and `Value` but no `SensorId`. A walk keying on anything
    // else would publish `sensors/.../0` for "Voltages".
    for (const node of collectLhmSensorNodes(payload)) {
      expect(node.sensorId.startsWith('/'), node.sensorId).toBe(true);
    }
  });

  it('preserves document order, which is what makes the duplicate outcome deterministic', () => {
    const duplicated = collectLhmSensorNodes(payload).filter(
      (node) => node.sensorId === LHM_FIXTURE_DUPLICATE_ID,
    );

    expect(duplicated.map((node) => node.label)).toEqual([...LHM_FIXTURE_DUPLICATE_LABELS]);
  });

  it('reads the label from Text and leaves RawValue unparsed', () => {
    const nodes = collectLhmSensorNodes(payload);
    const throughput = nodes.find((node) => node.sensorId === '/gpu-nvidia/0/throughput/0');

    expect(throughput?.label).toBe('GPU PCIe Rx');
    expect(throughput?.rawValue).toBe('6699008.0 B/s');
  });

  it('survives a malformed payload instead of throwing', () => {
    // LHM is someone else's process. A branch that is not an object, a `Children` that is not
    // an array, a `SensorId` that is not a string: the relay publishes what it can read.
    expect(collectLhmSensorNodes(null)).toEqual([]);
    expect(collectLhmSensorNodes('not a tree')).toEqual([]);
    expect(collectLhmSensorNodes([])).toEqual([]);
    expect(collectLhmSensorNodes({ Children: 'nope' })).toEqual([]);
    expect(collectLhmSensorNodes({ SensorId: 42, Children: [] })).toEqual([]);
    expect(collectLhmSensorNodes({ SensorId: '', Children: [] })).toEqual([]);
    expect(
      collectLhmSensorNodes({ Children: [null, 7, { SensorId: '/ram/data/0' }] }),
    ).toHaveLength(1);
  });

  it('defaults a missing Text to the empty string rather than dropping the sensor', () => {
    // A sensor with no display name is still a real reading. Losing it to keep the metadata
    // tidy would be the wrong trade.
    const nodes = collectLhmSensorNodes({
      Children: [{ SensorId: '/ram/data/0', RawValue: '1 GB' }],
    });

    expect(nodes).toEqual([{ sensorId: '/ram/data/0', label: '', rawValue: '1 GB' }]);
  });

  it('stops descending a pathologically deep payload rather than overflowing the stack', () => {
    let deep: Record<string, unknown> = { SensorId: '/ram/data/0' };
    for (let depth = 0; depth < 200; depth += 1) deep = { Children: [deep] };

    expect(collectLhmSensorNodes(deep)).toEqual([]);
  });
});

describe('mapLhmSensors over the whole capture', () => {
  const mapping = readLhmPayload(payload, AT);

  it('publishes 213 topics for 214 sensors, which is the fixture and not a bug', () => {
    // LHM emits `/gpu-nvidia/0/load/3` twice, as "GPU Memory" and "GPU Bus": two sensors, one
    // identity at the source. The contract's own fixture test pins the same 214/213 fact from
    // the mapping's side.
    expect(mapping.sensors).toHaveLength(LHM_FIXTURE_TOPIC_COUNT);
    expect(new Set(mapping.sensors.map((sensor) => sensor.topic)).size).toBe(
      LHM_FIXTURE_TOPIC_COUNT,
    );
  });

  it('maps every sensor: nothing in this capture is unmappable', () => {
    expect(mapping.unmapped).toEqual([]);
  });

  it('accounts for all 214 nodes across published, collided and unmapped', () => {
    // No sensor may be silently lost. This is the arithmetic that says so.
    expect(mapping.sensors.length + mapping.collisions.length + mapping.unmapped.length).toBe(
      LHM_FIXTURE_SENSOR_COUNT,
    );
  });

  it('produces topics and payloads the contract itself accepts', () => {
    for (const sensor of mapping.sensors) {
      expect(isSensorTopic(sensor.topic), sensor.sensorId).toBe(true);
      expect(isSensorReading(sensor.reading), sensor.sensorId).toBe(true);
      expect(isSensorMeta(sensor.meta), sensor.sensorId).toBe(true);
      // Round-trips through JSON unchanged, per contract rule 4 — it crosses a network.
      expect(JSON.parse(JSON.stringify(sensor.reading))).toEqual(sensor.reading);
      expect(JSON.parse(JSON.stringify(sensor.meta))).toEqual(sensor.meta);
    }
  });

  it('stamps every reading with one timestamp for the whole snapshot', () => {
    // One `at` per poll, not a per-sensor `Date.now()`: two sensors from the same response must
    // not look differently stale to a dashboard.
    expect(new Set(mapping.sensors.map((sensor) => sensor.reading.at))).toEqual(new Set([AT]));
  });

  it('lands on the six devices the fixture README documents, in the documented counts', () => {
    const distribution: Record<string, number> = {};
    for (const sensor of mapping.sensors) {
      const device = parseSensorTopic(sensor.topic)?.device ?? 'UNPARSEABLE';
      distribution[device] = (distribution[device] ?? 0) + 1;
    }

    // gpu is 38 rather than the fixture's 39 because one of its 39 sensors is the duplicate.
    expect(distribution).toEqual({
      cpu: 102,
      gpu: 38,
      network: 25,
      superio: 22,
      storage: 19,
      'embedded-controller': 7,
    });
  });

  it('uses only metrics from the contract vocabulary', () => {
    const metrics = new Set(
      mapping.sensors.map((sensor) => parseSensorTopic(sensor.topic)?.metric),
    );

    for (const metric of metrics) {
      expect(SENSOR_METRICS as readonly (string | undefined)[]).toContain(metric);
    }
    expect(metrics.size).toBe(13);
  });
});

describe('values: null, never zero', () => {
  const mapping = readLhmPayload(payload, AT);

  it('publishes null for the header with no probe on it', () => {
    // `/lpc/ec/temperature/1` ("T Sensor") sends `Value: "-"` and `RawValue: " °C"` — a unit
    // with no number. This is the real `value: null` case in this capture, and 0 would render
    // as a plausible 0 °C on a dashboard.
    const tSensor = mapping.sensors.find(
      (sensor) => sensor.topic === 'sensors/embedded-controller/0/temperature/1',
    );

    expect(tSensor?.meta.label).toBe('T Sensor');
    expect(tSensor?.reading.value).toBeNull();
  });

  it('has exactly one null in the whole capture, and it is that one', () => {
    const nulls = mapping.sensors.filter((sensor) => sensor.reading.value === null);

    expect(nulls.map((sensor) => sensor.sensorId)).toEqual(['/lpc/ec/temperature/1']);
  });

  it('never publishes NaN or an infinity, which the contract rejects outright', () => {
    for (const sensor of mapping.sensors) {
      if (sensor.reading.value === null) continue;
      expect(Number.isFinite(sensor.reading.value), sensor.sensorId).toBe(true);
    }
  });

  it('parses a unit-less Factor rather than dropping it', () => {
    // 14 `Factor` sensors send a bare `"48.500"`. A parser requiring a trailing unit would
    // silently drop every one of them.
    const factors = mapping.sensors.filter(
      (sensor) => parseSensorTopic(sensor.topic)?.metric === 'factor',
    );

    expect(factors.length).toBeGreaterThan(0);
    for (const factor of factors) expect(typeof factor.reading.value).toBe('number');
  });

  it('turns an unreadable RawValue into null and keeps the sensor', () => {
    const mapped = mapLhmSensors(
      [
        { sensorId: '/amdcpu/0/temperature/0', label: 'Core', rawValue: 'not a number' },
        { sensorId: '/amdcpu/0/temperature/1', label: 'Core', rawValue: undefined },
        { sensorId: '/amdcpu/0/temperature/2', label: 'Core', rawValue: 42 },
      ],
      AT,
    );

    // A non-string is `null` too: `parseLhmValue` takes `unknown` precisely because the payload
    // is untrusted, and LHM's JSON stringifies even the Raw fields.
    expect(mapped.sensors.map((sensor) => sensor.reading.value)).toEqual([null, null, null]);
    expect(mapped.sensors).toHaveLength(3);
  });
});

describe('the duplicate identifier: first-wins, and reported', () => {
  const mapping = readLhmPayload(payload, AT);

  it('reports exactly one collision, naming both sensors', () => {
    expect(mapping.collisions).toEqual([
      {
        topic: 'sensors/gpu/0/load/3',
        sensorId: LHM_FIXTURE_DUPLICATE_ID,
        keptLabel: 'GPU Memory',
        droppedLabel: 'GPU Bus',
      },
    ]);
  });

  it('publishes the first in document order, so the topic has one stable meaning', () => {
    // Publishing both would put two unrelated readings on one topic once a second, and the
    // dashboard would alternate between them with nothing on the wire to say why. Publishing
    // neither would throw away a real reading. See DECISIONS.md.
    const gpuLoad3 = mapping.sensors.filter((sensor) => sensor.topic === 'sensors/gpu/0/load/3');

    expect(gpuLoad3).toHaveLength(1);
    expect(gpuLoad3[0]?.meta.label).toBe('GPU Memory');
    expect(gpuLoad3[0]?.reading.value).toBe(11.9);
  });

  it('keeps the same winner on every poll rather than depending on iteration luck', () => {
    const again = readLhmPayload(payload, AT + 1000);

    expect(again.sensors.map((sensor) => sensor.topic)).toEqual(
      mapping.sensors.map((sensor) => sensor.topic),
    );
    expect(again.collisions).toEqual(mapping.collisions);
  });

  it('does not let a collision suppress the surviving reading', () => {
    // The obvious wrong fix — drop the topic entirely on collision — would lose GPU Memory too.
    expect(mapping.sensors.some((sensor) => sensor.topic === 'sensors/gpu/0/load/3')).toBe(true);
  });
});

describe('metadata', () => {
  const mapping = readLhmPayload(payload, AT);

  it('carries LHM Text as the label', () => {
    // Index 2, not 0: LHM's temperature indices on this CPU start at 2, and a label is the one
    // thing a dashboard cannot reconstruct from the topic.
    const core = mapping.sensors.find((sensor) => sensor.sensorId === '/amdcpu/0/temperature/2');

    expect(core?.meta.label).toBe('Core (Tctl/Tdie)');
    expect(core?.topic).toBe('sensors/cpu/0/temperature/2');
  });

  it('gives every sensor a non-empty label, because this capture names them all', () => {
    for (const sensor of mapping.sensors) {
      expect(sensor.meta.label.length, sensor.sensorId).toBeGreaterThan(0);
    }
  });

  it('recovers the vendor the topic normalises away', () => {
    const gpu = mapping.sensors.find((sensor) => sensor.sensorId.startsWith('/gpu-nvidia/'));
    const cpu = mapping.sensors.find((sensor) => sensor.sensorId.startsWith('/amdcpu/'));

    // `sensors/gpu/0/...` must survive a card swap, so the brand lives here instead.
    expect(gpu?.meta.vendor).toBe('nvidia');
    expect(cpu?.meta.vendor).toBe('amd');
  });

  it('omits vendor entirely where LHM names none, rather than setting it undefined', () => {
    const nvme = mapping.sensors.find((sensor) => sensor.sensorId.startsWith('/nvme/'));

    expect(nvme?.meta.vendor).toBeUndefined();
    expect(Object.keys(nvme?.meta ?? {})).toEqual(['label']);
  });

  it('never claims hidden, because /data.json does not send IsDefaultHidden', () => {
    // LHM's `ISensor` has the flag and `SensorMeta` has the field, but this transport does not
    // carry it. `hidden: false` would be a claim a picker would trust.
    for (const sensor of mapping.sensors) {
      expect('hidden' in sensor.meta, sensor.sensorId).toBe(false);
    }
  });
});

describe('unmapped identifiers are reported, not guessed at', () => {
  it('lists an identifier whose hardware the contract has no name for', () => {
    const mapping = mapLhmSensors(
      [
        { sensorId: '/unobtanium/0/temperature/0', label: 'Mystery', rawValue: '40.0 °C' },
        { sensorId: '/amdcpu/0/temperature/0', label: 'Core', rawValue: '44.0 °C' },
      ],
      AT,
    );

    expect(mapping.unmapped).toEqual(['/unobtanium/0/temperature/0']);
    // The one it does understand still gets published.
    expect(mapping.sensors).toHaveLength(1);
  });

  it('lists a malformed identifier rather than publishing a malformed topic', () => {
    const mapping = mapLhmSensors([{ sensorId: 'no-leading-slash', label: '', rawValue: '1' }], AT);

    expect(mapping.unmapped).toEqual(['no-leading-slash']);
    expect(mapping.sensors).toEqual([]);
  });
});
