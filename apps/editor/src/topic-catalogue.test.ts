/**
 * The topic picker's data: what the connected source has published, named from its meta, grouped the
 * way a person looks for a sensor — by device, then by what it measures — and searchable, because a
 * relay publishes several hundred.
 */

import { sensorTopic, type SensorMeta } from '@perch/sensor-contract';
import { describe, expect, it } from 'vitest';
import { catalogueTopics, filterCatalogue, typedTopic } from './topic-catalogue.js';

const META: Readonly<Record<string, SensorMeta>> = {
  [sensorTopic('cpu', 'temperature')]: { label: 'CPU Package' },
  [sensorTopic('cpu', 'temperature', { sensorIndex: 3 })]: { label: 'CPU Core #3' },
  [sensorTopic('cpu', 'load')]: { label: 'CPU Total' },
  [sensorTopic('gpu', 'fan')]: { label: 'GPU Fan', vendor: 'nvidia' },
  [sensorTopic('storage', 'temperature', { deviceIndex: 1 })]: { label: 'Drive 2 Temperature' },
  [sensorTopic('cooler', 'fan')]: { label: 'Pump Header', hidden: true },
};

function meta(topic: string): SensorMeta | undefined {
  return META[topic];
}

/** Arrival order, deliberately not catalogue order. */
const SEEN = [
  sensorTopic('storage', 'temperature', { deviceIndex: 1 }),
  sensorTopic('gpu', 'fan'),
  sensorTopic('cpu', 'temperature', { sensorIndex: 3 }),
  sensorTopic('cpu', 'load'),
  sensorTopic('cpu', 'temperature'),
  sensorTopic('cooler', 'fan'),
  sensorTopic('psu', 'voltage'),
];

describe('catalogueTopics', () => {
  it('names each topic from its meta, with the unit its metric carries', () => {
    const entries = catalogueTopics(SEEN, meta);
    const core = entries.find((entry) => entry.label === 'CPU Core #3');

    expect(core).toMatchObject({
      topic: 'sensors/cpu/0/temperature/3',
      device: 'cpu',
      metric: 'temperature',
      unit: '°C',
      hidden: false,
    });
  });

  it('orders by device, then instance, then metric, then sensor — not by arrival', () => {
    expect(catalogueTopics(SEEN, meta).map((entry) => entry.topic)).toEqual([
      'sensors/cpu/0/temperature/0',
      'sensors/cpu/0/temperature/3',
      'sensors/cpu/0/load/0',
      'sensors/gpu/0/fan/0',
      'sensors/storage/1/temperature/0',
      'sensors/cooler/0/fan/0',
      'sensors/psu/0/voltage/0',
    ]);
  });

  it('keeps a topic with no meta, named by nothing rather than invented, and drops non-topics and repeats', () => {
    const entries = catalogueTopics([...SEEN, 'not/a/topic', sensorTopic('cpu', 'load')], meta);
    const psu = entries.find((entry) => entry.device === 'psu');

    expect(entries).toHaveLength(SEEN.length);
    expect(psu?.label).toBeUndefined();
  });

  it('marks what the meta says is noisy by default', () => {
    expect(catalogueTopics(SEEN, meta).find((entry) => entry.device === 'cooler')?.hidden).toBe(
      true,
    );
  });
});

describe('filterCatalogue', () => {
  const entries = catalogueTopics(SEEN, meta);

  it('groups by device instance, then metric, each metric with its unit', () => {
    const { groups } = filterCatalogue(entries, { query: '', device: 'all', showHidden: false });

    expect(groups.map((group) => group.title)).toEqual(['cpu 0', 'gpu 0', 'storage 1', 'psu 0']);
    expect(groups[0]?.metrics.map((metric) => [metric.metric, metric.unit])).toEqual([
      ['temperature', '°C'],
      ['load', '%'],
    ]);
  });

  it('holds hidden sensors back until asked, and counts them so none hides silently', () => {
    const shut = filterCatalogue(entries, { query: '', device: 'all', showHidden: false });
    const open = filterCatalogue(entries, { query: '', device: 'all', showHidden: true });

    expect(shut.hiddenCount).toBe(1);
    expect(shut.count).toBe(6);
    expect(open.count).toBe(7);
    expect(open.groups.map((group) => group.title)).toContain('cooler 0');
  });

  it('matches every word of a query against the name, the topic, the device and the metric', () => {
    const labels = (query: string): readonly (string | undefined)[] =>
      filterCatalogue(entries, { query, device: 'all', showHidden: false }).groups.flatMap(
        (group) => group.metrics.flatMap((metric) => metric.entries.map((entry) => entry.label)),
      );

    expect(labels('core')).toEqual(['CPU Core #3']);
    expect(labels('cpu temp')).toEqual(['CPU Package', 'CPU Core #3']);
    expect(labels('storage/1')).toEqual(['Drive 2 Temperature']);
    expect(labels('voltage')).toEqual([undefined]);
  });

  it('narrows to one device, and offers a chip for every device present', () => {
    const result = filterCatalogue(entries, { query: '', device: 'gpu', showHidden: false });

    expect(result.groups.map((group) => group.title)).toEqual(['gpu 0']);
    expect(result.devices).toEqual(['cpu', 'gpu', 'storage', 'cooler', 'psu']);
  });
});

describe('typedTopic', () => {
  it('accepts a canonical topic typed in full, for a sensor that is not publishing now', () => {
    expect(typedTopic(' sensors/psu/1/voltage/2 ')).toEqual({
      kind: 'valid',
      topic: 'sensors/psu/1/voltage/2',
    });
  });

  it('says why something that looks like a topic is not one', () => {
    expect(typedTopic('sensors/psu/voltage')).toMatchObject({ kind: 'invalid' });
    expect(typedTopic('sensors/cpu/0/tempreature/0')).toMatchObject({ kind: 'invalid' });
  });

  it('is nothing at all for a plain search word', () => {
    expect(typedTopic('core')).toEqual({ kind: 'none' });
    expect(typedTopic('')).toEqual({ kind: 'none' });
  });
});
