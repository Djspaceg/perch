/**
 * Loads `fixtures/lhm-data.sample.json` for this app's tests.
 *
 * A live `GET /data.json` — 214 sensor nodes across six hardware families — used here as the
 * poll response the relay would have received, so the whole read-map-publish path is tested
 * against real hardware output with no network and no LHM process.
 *
 * It deliberately returns the **raw parsed payload** rather than a flattened sensor list, which
 * is the opposite of `packages/sensor-contract/src/lhm-fixture.test-support.ts`. The contract's
 * copy flattens because its subject is the identifier mapping and the tree is incidental; here
 * the tree walk is part of the subject, so handing the tests a pre-walked list would test the
 * fixture loader instead of `collectLhmSensorNodes`.
 *
 * Named `.test-support.ts` rather than `.ts` so `apps/agent/tsconfig.json` excludes it from
 * `dist`: the relay reads LHM over HTTP and must not carry a `node:fs` import into its build.
 */

import { readFileSync } from 'node:fs';

export const LHM_FIXTURE_URL = new URL('../../../fixtures/lhm-data.sample.json', import.meta.url);

/** Sensor nodes in the capture. Pinned so a reseeded fixture fails loudly rather than quietly. */
export const LHM_FIXTURE_SENSOR_COUNT = 214;

/**
 * Distinct topics those sensors map to.
 *
 * One fewer than the sensor count, because LHM emits `/gpu-nvidia/0/load/3` twice — as "GPU
 * Memory" and as "GPU Bus". Two sensors, one identity at the source. See
 * `packages/sensor-contract/src/lhm-fixture.test.ts`, which pins the same fact from the
 * mapping's side, and DECISIONS.md for what the relay does about it.
 */
export const LHM_FIXTURE_TOPIC_COUNT = 213;

/** The identifier LHM duplicates, and the two labels it duplicates it under. */
export const LHM_FIXTURE_DUPLICATE_ID = '/gpu-nvidia/0/load/3';
export const LHM_FIXTURE_DUPLICATE_LABELS = ['GPU Memory', 'GPU Bus'] as const;

/** The whole `/data.json` payload, exactly as the relay's fetcher would hand it over. */
export function loadLhmFixturePayload(): unknown {
  return JSON.parse(readFileSync(LHM_FIXTURE_URL, 'utf8'));
}
