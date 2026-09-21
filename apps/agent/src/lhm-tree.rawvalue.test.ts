/**
 * The one trap this relay exists to not fall into: reading `Value` instead of `RawValue`.
 *
 * Its own file because it is the single assertion most worth being able to point at. LHM sends
 * both fields, and for **five** of the 214 sensors in the live capture they carry different
 * numbers, because `Value` rescales its unit with the magnitude (`"6.4 MB/s"`) while `RawValue`
 * holds it steady (`"6699008.0 B/s"`). This contract fixes `throughput` at B/s, so a relay
 * reading `Value` publishes a number 2^20 or 2^10 times too small — and only sometimes, only
 * while the throughput happens to be in that range, which makes it the kind of wrong nothing
 * downstream can detect.
 *
 * Every expectation is derived from the fixture here, not written out as a literal. Two reasons:
 * the divergent set includes four sensors whose identifiers are real network-adapter GUIDs from
 * the capturing machine, which `fixtures/README.md` asks to keep out of test files; and an
 * expectation computed from the payload cannot go stale against a reseeded fixture without
 * saying so.
 */

import { describe, expect, it } from 'vitest';
import { parseLhmValue } from '@perch/sensor-contract';
import { collectLhmSensorNodes, readLhmPayload } from './lhm-tree.js';
import { loadLhmFixturePayload } from './lhm-fixture.test-support.js';

const payload = loadLhmFixturePayload();
const AT = 1_758_000_000_000;

/** The raw node objects, re-walked here so the formatted `Value` field is still reachable. */
interface FormattedNode {
  readonly sensorId: string;
  readonly formatted: unknown;
  readonly raw: unknown;
}

function formattedNodes(): readonly FormattedNode[] {
  const nodes: FormattedNode[] = [];

  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;
    const sensorId = record['SensorId'];
    if (typeof sensorId === 'string') {
      nodes.push({ sensorId, formatted: record['Value'], raw: record['RawValue'] });
    }
    const children = record['Children'];
    if (Array.isArray(children)) for (const child of children) walk(child);
  };
  walk(payload);

  return nodes;
}

/** Sensors where the two fields disagree — the ones that would expose a relay reading `Value`. */
const divergent = formattedNodes().filter(
  (node) => parseLhmValue(node.formatted) !== parseLhmValue(node.raw),
);

describe('the fixture still contains the trap', () => {
  it('has sensors whose Value and RawValue are different numbers', () => {
    // If a reseeded capture ever had none, the test below would pass vacuously and prove
    // nothing. This is the guard that says so out loud.
    expect(divergent.length).toBe(5);
  });

  it('and they are all throughput, the one type LHM rescales', () => {
    for (const node of divergent) {
      expect(node.sensorId, node.sensorId).toContain('/throughput/');
    }
  });
});

describe('the relay reads RawValue', () => {
  const mapping = readLhmPayload(payload, AT);
  const byId = new Map(mapping.sensors.map((sensor) => [sensor.sensorId, sensor]));

  it('publishes the RawValue number for every divergent sensor, not the formatted one', () => {
    for (const node of divergent) {
      const published = byId.get(node.sensorId)?.reading.value;

      expect(published, node.sensorId).toBe(parseLhmValue(node.raw));
      expect(published, node.sensorId).not.toBe(parseLhmValue(node.formatted));
    }
  });

  it('is off by the unit factor if it were reading Value — which is the size of the bug', () => {
    // Spelled out so the failure message is a magnitude rather than two opaque numbers: the GPU
    // PCIe sensor reads 6.4 in `Value` and 6699008 in `RawValue`, a factor of 2^20.
    const pcie = byId.get('/gpu-nvidia/0/throughput/0');
    const formatted = formattedNodes().find(
      (node) => node.sensorId === '/gpu-nvidia/0/throughput/0',
    );

    expect(pcie?.reading.value).toBe(6699008);
    expect(parseLhmValue(formatted?.formatted)).toBe(6.4);
  });

  it('reads RawValue and not RawMin or RawMax either', () => {
    // `RawMin`/`RawMax` are observed running extremes, resettable at any time. A relay reading
    // one would publish a number that is real, plausible, and not the current reading.
    const pcieNode = formattedNodes().find(
      (node) => node.sensorId === '/gpu-nvidia/0/throughput/0',
    );
    const published = byId.get('/gpu-nvidia/0/throughput/0')?.reading.value;

    expect(published).toBe(parseLhmValue(pcieNode?.raw));
    // 1099776.0 B/s and 882599900.0 B/s in the capture — both distinct from the reading.
    expect(published).not.toBe(1099776);
    expect(published).not.toBe(882599900);
  });

  it('carries the collected node value straight from RawValue', () => {
    // One layer down: the walk itself must pick the right field, before any parsing.
    const node = collectLhmSensorNodes(payload).find(
      (candidate) => candidate.sensorId === '/gpu-nvidia/0/throughput/0',
    );

    expect(node?.rawValue).toBe('6699008.0 B/s');
  });
});
