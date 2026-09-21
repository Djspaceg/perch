/**
 * The payload published to every sensor topic: one reading per message, JSON-encoded.
 *
 * An input adapter owns producing these; `ui-kit` only ever reads them.
 */
export interface SensorReading {
  /**
   * The numeric reading, or `null` for "sensor present but reporting nothing".
   *
   * Nullable because LHM's `ISensor.Value` is `float?` — a sensor can be enumerated and
   * still have no reading, and a dashboard must show "no data" distinctly from a stale
   * number or a zero. A source that gets `NaN` must publish `null`, not `NaN`: JSON has
   * no NaN literal, so `JSON.stringify` would silently emit `null` anyway, and `0` would
   * be indistinguishable from a real zero.
   */
  value: number | null;
  /**
   * Epoch milliseconds at which the source READ the value, not when it arrived.
   *
   * Not optional: the runtime has to tell "42 °C" from "42 °C, six minutes stale because
   * the publisher died".
   */
  at: number;
}

/**
 * Runtime validation for a decoded message body. Anything arriving over the wire is
 * untrusted, so the dashboard checks before it renders.
 *
 * `value` must be `null` or a finite number; `NaN` and `±Infinity` are rejected rather
 * than coerced, because a source that let one through has a bug worth surfacing at the
 * boundary instead of rendering "NaN °C". There is no `unit` field to check — the unit is
 * a pure function of the metric, in `SENSOR_METRIC_UNITS`.
 */
export function isSensorReading(candidate: unknown): candidate is SensorReading {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return false;
  }

  const { value, at } = candidate as Partial<SensorReading>;
  const valueOk = value === null || (typeof value === 'number' && Number.isFinite(value));

  return valueOk && typeof at === 'number' && Number.isFinite(at);
}
