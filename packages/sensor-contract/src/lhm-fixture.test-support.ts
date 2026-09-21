/**
 * Loads `fixtures/lhm-data.sample.json` and flattens it to its sensor nodes.
 *
 * The fixture is a live `GET /data.json` from a LibreHardwareMonitor instance — 214 sensor
 * nodes across six hardware families — and it is the ground truth for everything `lhm.ts`
 * claims. See `fixtures/README.md` for what it proved that reading LHM's C# source did not.
 *
 * Test-only, and named `.test-support.ts` rather than `.ts` so that the package project
 * excludes it from `dist`: the shipped contract has zero runtime dependencies (SPEC rule 1)
 * and must not carry a `node:fs` import. `lhm-fixture.test.ts` and `lhm-value.test.ts` share
 * it because both need the same 214 nodes, and a second copy of the walk would let the two
 * drift over what counts as a sensor node.
 */

import { readFileSync } from 'node:fs';

/** The fields a sensor node carries. LHM sends more (`id`, `ImageURL`); this is what is read. */
export interface LhmSensorNode {
  SensorId: string;
  /** LHM's own sensor-type name, capitalised: `Temperature`, `SmallData`. */
  Type: string;
  /** LHM's display name for the sensor, e.g. `CPU Core #3`. */
  Text: string;
  Value: string;
  Min: string;
  Max: string;
  RawValue: string;
  RawMin: string;
  RawMax: string;
}

interface LhmTreeNode {
  SensorId?: string;
  Children?: LhmTreeNode[];
}

export const LHM_FIXTURE_URL = new URL('../../../fixtures/lhm-data.sample.json', import.meta.url);

/**
 * Every node in the capture that carries a `SensorId`, in document order.
 *
 * The hardware and category nodes above them (`Sensor`, the hostname, the board, `Voltages`)
 * carry no `SensorId`, which is the only structural marker distinguishing a sensor from a
 * grouping node — LHM does not tag the levels.
 */
export function loadLhmFixtureSensors(): LhmSensorNode[] {
  const root = JSON.parse(readFileSync(LHM_FIXTURE_URL, 'utf8')) as LhmTreeNode;
  const sensors: LhmSensorNode[] = [];

  const walk = (node: LhmTreeNode): void => {
    if (typeof node.SensorId === 'string') sensors.push(node as unknown as LhmSensorNode);
    for (const child of node.Children ?? []) walk(child);
  };
  walk(root);

  return sensors;
}

/** The hardware portion of an LHM `SensorId`: everything before `<sensorType>/<sensorIndex>`. */
export function lhmHardwarePortion(sensorId: string): string {
  return sensorId.replace(/^\//, '').split('/').slice(0, -2).join('/');
}
