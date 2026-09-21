/**
 * Sensor metadata: what a topic cannot tell you about the sensor behind it.
 *
 * Published once to the retained companion topic
 * `sensors/<device>/<i>/<metric>/<j>/meta` — see `sensorMetaTopic()`.
 */
export interface SensorMeta {
  /** LHM's `Name`: 'CPU Core #3', 'CPU Package'. Human-readable labels cannot be derived from a topic, so they live here. */
  label: string;
  /** 'nvidia' | 'amd' | 'intel' — normalised out of the topic so a dashboard survives a card swap. */
  vendor?: string;
  /** LHM's `IsDefaultHidden`: noisy by default, so a picker should offer it but not show it. */
  hidden?: boolean;
}

/**
 * Runtime validation for a decoded metadata body.
 *
 * Deliberately absent: a gauge range. LHM exposes `Min`/`Max`, but those are observed
 * running extremes, resettable at any time via `ResetMin()`/`ResetMax()`, not the sensor's
 * design range — a gauge whose scale drifts with the day's peak is unreadable. Gauge range
 * is authored in the layout, and `layout-schema` owns it.
 */
export function isSensorMeta(candidate: unknown): candidate is SensorMeta {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return false;
  }

  const { label, vendor, hidden } = candidate as Partial<SensorMeta>;

  return (
    typeof label === 'string' &&
    (vendor === undefined || typeof vendor === 'string') &&
    (hidden === undefined || typeof hidden === 'boolean')
  );
}
