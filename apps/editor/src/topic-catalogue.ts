/**
 * The sensor picker's data, without the picker: which topics exist, what a person calls them, and how
 * they are grouped and searched.
 *
 * A topic grammar cannot list the sensors that exist, and a relay publishes several hundred of them,
 * so the list is the topics the *connected* source has actually published (`ui-kit`'s
 * `useSensorTopics`) — plus any the caller declares — each named from the retained `.../meta`
 * companion every source publishes (`SensorMeta.label`) and carrying the unit its metric defines.
 * A topic with no meta yet is kept and shown by its topic alone: a missing label is not a missing
 * sensor.
 *
 * Grouped by device instance ("cpu 0", "storage 1"), then by metric with its unit, in the
 * contract's own vocabulary order rather than arrival order, so the list does not reshuffle while a
 * relay is still delivering its first second of readings. Searched with the same AND-over-words rule
 * as the token panes (`controls/filter.ts`). Sensors the meta marks `hidden` — LHM's noisy-by-default
 * ones — are held back and counted, never dropped.
 */

import {
  SENSOR_DEVICES,
  SENSOR_METRICS,
  SENSOR_METRIC_UNITS,
  isSensorTopic,
  parseSensorTopic,
  type SensorDevice,
  type SensorDeviceInstance,
  type SensorMeta,
  type SensorMetric,
  type SensorTopic,
} from '@perch/sensor-contract';
import { matchesQuery } from './controls/index.js';

/** One sensor the picker can offer. */
export interface TopicEntry {
  readonly topic: SensorTopic;
  readonly device: SensorDevice;
  readonly deviceIndex: SensorDeviceInstance;
  readonly metric: SensorMetric;
  readonly sensorIndex: number;
  /** The meta's name for it, or `undefined` when the source has published none. */
  readonly label: string | undefined;
  readonly unit: string;
  readonly hidden: boolean;
}

/** Every entry, parsed, deduplicated, named and in catalogue order. Non-topics are dropped. */
export function catalogueTopics(
  topics: Iterable<string>,
  meta: (topic: SensorTopic) => SensorMeta | undefined,
): readonly TopicEntry[] {
  const seen = new Set<string>();
  const entries: TopicEntry[] = [];

  for (const topic of topics) {
    if (seen.has(topic) || !isSensorTopic(topic)) continue;
    seen.add(topic);
    const parts = parseSensorTopic(topic);
    if (parts === null) continue;
    const about = meta(topic);

    entries.push({
      topic,
      ...parts,
      label: about?.label,
      unit: SENSOR_METRIC_UNITS[parts.metric],
      hidden: about?.hidden === true,
    });
  }

  return entries.sort(compareEntries);
}

function compareEntries(a: TopicEntry, b: TopicEntry): number {
  const order = [
    SENSOR_DEVICES.indexOf(a.device) - SENSOR_DEVICES.indexOf(b.device),
    compareInstance(a.deviceIndex, b.deviceIndex),
    SENSOR_METRICS.indexOf(a.metric) - SENSOR_METRICS.indexOf(b.metric),
    a.sensorIndex - b.sensorIndex,
  ];

  return order.find((difference) => difference !== 0) ?? 0;
}

/** Ordinals in number order, then tokens in string order. */
function compareInstance(a: SensorDeviceInstance, b: SensorDeviceInstance): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;

  return a.localeCompare(b);
}

/** One device instance's sensors, by metric. */
export interface TopicGroup {
  readonly key: string;
  /** `cpu 0`, `storage 1`. */
  readonly title: string;
  readonly metrics: readonly {
    readonly metric: SensorMetric;
    readonly unit: string;
    readonly entries: readonly TopicEntry[];
  }[];
}

export interface CatalogueFilter {
  readonly query: string;
  /** A device to narrow to, or `all`. */
  readonly device: SensorDevice | 'all';
  readonly showHidden: boolean;
}

export interface FilteredCatalogue {
  readonly groups: readonly TopicGroup[];
  /** How many entries the groups hold. */
  readonly count: number;
  /** How many matched but are held back as hidden. */
  readonly hiddenCount: number;
  /** Every device present in the whole catalogue, for the chips. */
  readonly devices: readonly SensorDevice[];
}

/** The catalogue as the picker shows it for a query, a device chip and the hidden toggle. */
export function filterCatalogue(
  entries: readonly TopicEntry[],
  { query, device, showHidden }: CatalogueFilter,
): FilteredCatalogue {
  const devices = [...new Set(entries.map((entry) => entry.device))];
  const matching = entries.filter(
    (entry) =>
      (device === 'all' || entry.device === device) &&
      matchesQuery(query, entry.label, entry.topic, entry.device, entry.metric, entry.unit),
  );
  const shown = showHidden ? matching : matching.filter((entry) => !entry.hidden);

  const groups: {
    key: string;
    title: string;
    metrics: { metric: SensorMetric; unit: string; entries: TopicEntry[] }[];
  }[] = [];
  for (const entry of shown) {
    const key = `${entry.device}/${String(entry.deviceIndex)}`;
    let group = groups.at(-1);
    if (group?.key !== key) {
      group = { key, title: `${entry.device} ${String(entry.deviceIndex)}`, metrics: [] };
      groups.push(group);
    }
    let metric = group.metrics.at(-1);
    if (metric?.metric !== entry.metric) {
      metric = { metric: entry.metric, unit: entry.unit, entries: [] };
      group.metrics.push(metric);
    }
    metric.entries.push(entry);
  }

  return {
    groups,
    count: shown.length,
    hiddenCount: matching.length - shown.length,
    devices,
  };
}

/** What the search box holds, read as a topic typed in full. */
export type TypedTopic =
  | { readonly kind: 'none' }
  | { readonly kind: 'valid'; readonly topic: SensorTopic }
  | { readonly kind: 'invalid'; readonly reason: string };

/**
 * Whether the search text is a topic to bind directly — for a sensor that is not publishing now, so
 * the list cannot offer it. Only text that starts like a topic is read as one; anything else is a
 * search. Canonical form only (`isSensorTopic`): the picker writes the one spelling a topic is stored
 * and subscribed under, so the shorthand is refused with the reason rather than silently expanded.
 */
export function typedTopic(text: string): TypedTopic {
  const trimmed = text.trim();
  if (!trimmed.startsWith('sensors/')) return { kind: 'none' };
  if (isSensorTopic(trimmed)) return { kind: 'valid', topic: trimmed };

  const segments = trimmed.split('/').length;

  return {
    kind: 'invalid',
    reason:
      segments === 5
        ? 'not a sensor topic: a device, metric or index is outside the contract'
        : 'not a sensor topic: write all five parts, sensors/<device>/<n>/<metric>/<n>',
  };
}
