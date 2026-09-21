/**
 * Reading LibreHardwareMonitor's `/data.json` tree, and mapping it onto the contract.
 *
 * ## The payload is a tree, and nothing tags the levels
 *
 * `GET /data.json` returns one nested object whose `Children` arrays hold hardware nodes,
 * then category nodes (`Voltages`, `Temperatures`), then sensors. LHM does not label which
 * level is which. **A node carries a `SensorId` if and only if it is a sensor** — that is the
 * only structural marker, verified against `fixtures/lhm-data.sample.json`, where the root,
 * the hostname node, the board and the category nodes all lack it.
 *
 * ## Read `RawValue`, never `Value`
 *
 * `Value` is display-formatted and **its unit moves with the magnitude**: the same GPU PCIe
 * sensor reads `"6.4 MB/s"` in `Value` and `"6699008.0 B/s"` in `RawValue`. This contract
 * fixes one unit per metric (`throughput` is B/s), so a relay reading `Value` would publish a
 * number 2^20 times too small — but only while the throughput happened to be in the megabyte
 * range, which is the worst kind of wrong, because it is right often enough to look fine.
 * `LHM_RAW_VALUE_FIELDS` names the fields for exactly this reason, and
 * `lhm-tree.rawvalue.test.ts` is the test that fails if this module ever reads the other one.
 *
 * ## Everything unparseable becomes `null`, never `0`
 *
 * `parseLhmValue` owns that, and it is the contract's function rather than a local copy:
 * `"-"`/`" °C"` (a header with no probe on it), a `Factor`'s bare `"48.500"`, and a missing
 * field all resolve through one parser the contract tests against this same fixture.
 */

import {
  lhmSensorIdToTopic,
  lhmVendor,
  parseLhmValue,
  type SensorMeta,
  type SensorReading,
  type SensorTopic,
} from '@perch/sensor-contract';

/**
 * A sensor node, narrowed out of the untrusted payload.
 *
 * `rawValue` stays `unknown` on purpose: the payload is whatever the other process sent, and
 * `parseLhmValue` already accepts `unknown` and answers `null` for anything it cannot read.
 * Narrowing it to `string` here would mean either rejecting a sensor whose value field is
 * missing — losing a sensor that does exist — or inventing a placeholder string.
 */
export interface LhmSensorNode {
  /** LHM's `SensorId`, i.e. `sensor.Identifier.ToString()` — `/amdcpu/0/temperature/2`. */
  readonly sensorId: string;
  /** LHM's `Text`, its display name — `CPU Core #3`. `''` when the field is absent. */
  readonly label: string;
  /** LHM's `RawValue`, unparsed and untrusted. */
  readonly rawValue: unknown;
}

/** One sensor, fully mapped: its topic, its reading, and its retained metadata. */
export interface LhmMappedSensor {
  readonly topic: SensorTopic;
  readonly reading: SensorReading;
  readonly meta: SensorMeta;
  /** The identifier it came from, so a log line can name the source and not just the topic. */
  readonly sensorId: string;
}

/**
 * Two sensors that share one `SensorId` at the source, and so cannot be told apart by any
 * mapping. See `mapLhmSensors` for what the relay does about it.
 */
export interface LhmTopicCollision {
  readonly topic: SensorTopic;
  readonly sensorId: string;
  /** The label of the sensor whose reading is published. */
  readonly keptLabel: string;
  /** The label of the sensor whose reading is dropped. */
  readonly droppedLabel: string;
}

export interface LhmMapping {
  /** One entry per distinct topic, in the order the sensors appear in the payload. */
  readonly sensors: readonly LhmMappedSensor[];
  /** Identifiers the contract has no topic for. Reported, never guessed at. */
  readonly unmapped: readonly string[];
  /** Duplicate-identifier collisions, in payload order. */
  readonly collisions: readonly LhmTopicCollision[];
}

/** How deep the walk will follow `Children` before giving up on a pathological payload. */
const MAX_TREE_DEPTH = 32;

/**
 * Every sensor node in a `/data.json` payload, in document order.
 *
 * Structural only: it does not look at the sensor type, the vocabulary, or the value. A node
 * that is not an object, or whose `Children` is not an array, contributes nothing rather than
 * throwing — the relay's job when LHM sends something unexpected is to publish what it *can*
 * read and report the rest, not to die on one malformed branch.
 *
 * Document order is load-bearing. It is what makes the duplicate-identifier outcome in
 * `mapLhmSensors` deterministic across polls rather than dependent on iteration luck.
 */
export function collectLhmSensorNodes(payload: unknown): readonly LhmSensorNode[] {
  const sensors: LhmSensorNode[] = [];

  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_TREE_DEPTH || !isRecord(node)) return;

    const sensorId = node['SensorId'];
    if (typeof sensorId === 'string' && sensorId.length > 0) {
      const label = node['Text'];
      sensors.push({
        sensorId,
        label: typeof label === 'string' ? label : '',
        rawValue: node['RawValue'],
      });
    }

    const children = node['Children'];
    if (Array.isArray(children)) {
      for (const child of children) walk(child, depth + 1);
    }
  };

  walk(payload, 0);

  return sensors;
}

/**
 * Map sensor nodes onto topics, readings and metadata, stamping every reading with `at`.
 *
 * `at` is passed in rather than read from the clock here, because SPEC rule 3 says it is the
 * time the source was **read** — one timestamp for the whole payload, taken when the HTTP
 * response arrived, not a per-sensor `Date.now()` that would spread one snapshot across
 * several milliseconds and make two sensors from the same poll look differently stale.
 *
 * ## The duplicate identifier: first-wins, and reported once
 *
 * LHM emits `/gpu-nvidia/0/load/3` **twice** in the live capture — once as "GPU Memory" and
 * once as "GPU Bus". Two distinct sensors share one identity *at the source*, so this is not
 * a mapping bug and no mapping can fix it: the contract's topic grammar is
 * `sensors/<device>/<i>/<metric>/<j>` and has nowhere to put a label. LHM's own tree does
 * carry a distinguishing `id` (168 and 169), but that is a per-response node ordinal, not a
 * sensor identity, and keying a topic on it would produce a different topic every time LHM
 * restarted.
 *
 * So the choice is between publishing both (the second overwrites the first on a shared
 * topic, and the dashboard alternates between two unrelated readings every poll, at 1 Hz,
 * with nothing on the wire to indicate it), publishing neither (throwing away a real reading),
 * and publishing the **first in document order** (one topic, one stable meaning, one reading
 * lost and *named*). The third is what this does, and the collision is returned so the relay
 * warns about it — see DECISIONS.md. It is not silent, which is the part SPEC rule 4 cares
 * about.
 */
export function mapLhmSensors(nodes: readonly LhmSensorNode[], at: number): LhmMapping {
  const sensors: LhmMappedSensor[] = [];
  const unmapped: string[] = [];
  const collisions: LhmTopicCollision[] = [];
  const byTopic = new Map<SensorTopic, LhmMappedSensor>();

  for (const node of nodes) {
    const topic = lhmSensorIdToTopic(node.sensorId);
    if (topic === null) {
      unmapped.push(node.sensorId);
      continue;
    }

    const existing = byTopic.get(topic);
    if (existing !== undefined) {
      collisions.push({
        topic,
        sensorId: node.sensorId,
        keptLabel: existing.meta.label,
        droppedLabel: node.label,
      });
      continue;
    }

    const mapped: LhmMappedSensor = {
      topic,
      reading: { value: parseLhmValue(node.rawValue), at },
      meta: buildMeta(node),
      sensorId: node.sensorId,
    };

    byTopic.set(topic, mapped);
    sensors.push(mapped);
  }

  return { sensors, unmapped, collisions };
}

/** Collect and map in one step, which is what a poll does. */
export function readLhmPayload(payload: unknown, at: number): LhmMapping {
  return mapLhmSensors(collectLhmSensorNodes(payload), at);
}

/**
 * The retained metadata for a sensor.
 *
 * `vendor` is set only when LHM's identifier names one, and the property is *omitted* rather
 * than set to `undefined`: `exactOptionalPropertyTypes` is on, and `{ vendor: undefined }`
 * survives `JSON.stringify` as an absent key anyway, so the two spellings would be one value
 * with two representations.
 *
 * `hidden` is absent from every node this relay can see. LHM's `ISensor` has
 * `IsDefaultHidden` and `SensorMeta` has a field for it, but `/data.json` does not send it —
 * verified against all 214 nodes in the capture, whose keys are `id`, `Text`, `Min`, `Value`,
 * `Max`, `SensorId`, `Type`, `RawMin`, `RawValue`, `RawMax`, `ImageURL`, `Children`. An
 * invented `hidden: false` would be a claim this source cannot make, and a picker would trust
 * it; omitting it leaves the field honestly unknown.
 */
function buildMeta(node: LhmSensorNode): SensorMeta {
  const vendor = lhmVendor(node.sensorId);

  return vendor === undefined ? { label: node.label } : { label: node.label, vendor };
}

/** A JSON object, as opposed to an array, a primitive or `null`. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
