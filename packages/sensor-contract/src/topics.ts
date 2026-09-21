/**
 * The topic grammar, the device and metric vocabularies, and each metric's unit.
 *
 * Per SPEC.md the grammar is:
 *
 * ```text
 * sensors/<device>/<deviceIndex>/<metric>/<sensorIndex>
 * ```
 *
 * Both indices are optional in an *authored* topic and default to `0`, so the common
 * case stays readable (`sensors/cpu/temperature`) while the hard case stays expressible
 * (`sensors/cpu/0/temperature/3` — CPU 0, core #3). `parseSensorTopic` accepts either
 * form; everything this module *builds* is the canonical five-segment form, so a sensor
 * has exactly one topic on the wire.
 *
 * The `<deviceIndex>` segment is a **device instance**: an ordinal where the source has one,
 * or an opaque token where it does not. LibreHardwareMonitor identifies a network adapter by
 * GUID and never by ordinal, so `sensors/network/684d7057-…-6160b637cc46/throughput/1` is a
 * real topic. `<sensorIndex>` stays an ordinal — no source seen so far names a sensor within
 * a device by anything else. See `isSensorDeviceToken` for the token's spelling rules, and
 * DECISIONS.md, "Opaque device-instance tokens", for why they are what they are.
 *
 * The vocabularies are LibreHardwareMonitor's 14 hardware types (normalised on vendor,
 * hence 12 devices) and its 21 sensor types. That is physics rather than vendor
 * concepts, which is why it generalises past LHM. See `lhm.ts` for the mapping from
 * LHM's own identifiers onto this grammar.
 */

export const SENSOR_TOPIC_ROOT = 'sensors';

/** Subscription pattern covering every sensor topic (MQTT multi-level wildcard). */
export const SENSOR_TOPIC_WILDCARD = `${SENSOR_TOPIC_ROOT}/#`;

/**
 * Suffix of the retained companion topic carrying `SensorMeta`.
 *
 * Note that `SENSOR_TOPIC_WILDCARD` also matches these, so a subscriber on it receives
 * metadata interleaved with readings and must route on the suffix. `isSensorTopic`
 * deliberately rejects a meta topic, so that routing cannot silently pass a `SensorMeta`
 * body to a reading consumer.
 */
export const SENSOR_META_SUFFIX = 'meta';

/**
 * LHM's hardware types, normalised on vendor: `GpuNvidia | GpuAmd | GpuIntel` collapse
 * to `gpu`, with the vendor moved into `SensorMeta`. A dashboard bound to
 * `sensors/gpu/0/temperature` must not break when the card is replaced.
 */
export const SENSOR_DEVICES = [
  'motherboard',
  'superio',
  'cpu',
  'memory',
  'gpu',
  'storage',
  'network',
  'cooler',
  'embedded-controller',
  'psu',
  'battery',
  'power-monitor',
] as const;

/** LHM's 21 sensor types. Each has exactly one unit, in `SENSOR_METRIC_UNITS`. */
export const SENSOR_METRICS = [
  'voltage',
  'current',
  'power',
  'clock',
  'temperature',
  'load',
  'frequency',
  'fan',
  'flow',
  'control',
  'level',
  'data',
  'small-data',
  'throughput',
  'time-span',
  'timing',
  'energy',
  'noise',
  'conductivity',
  'humidity',
  'factor',
] as const;

export type SensorDevice = (typeof SENSOR_DEVICES)[number];
export type SensorMetric = (typeof SENSOR_METRICS)[number];

/**
 * The unit is a property of the *metric*, defined here once and never carried in a
 * reading. Repeating it per message at 1 Hz is redundant and creates a second source of
 * truth that can disagree with this one.
 *
 * `factor` is dimensionless and its unit is deliberately the empty string rather than an
 * invented placeholder: a renderer concatenating value and unit then produces the right
 * output with no special case.
 */
export const SENSOR_METRIC_UNITS: Readonly<Record<SensorMetric, string>> = Object.freeze({
  voltage: 'V',
  current: 'A',
  power: 'W',
  clock: 'MHz',
  temperature: '°C',
  load: '%',
  frequency: 'Hz',
  fan: 'RPM',
  flow: 'L/h',
  control: '%',
  level: '%',
  data: 'GB', // 2^30 B
  'small-data': 'MB', // 2^20 B
  throughput: 'B/s',
  'time-span': 's',
  timing: 'ns',
  energy: 'mWh',
  noise: 'dBA',
  conductivity: 'µS/cm',
  humidity: '%',
  factor: '',
});

/**
 * A fully-qualified topic, e.g. `sensors/cpu/0/temperature/3`.
 *
 * The template-literal form is what makes SPEC rule 5 ("names live here or nowhere") a
 * compile error rather than a review comment, on both the publishing and the consuming
 * side. The device and metric holes are closed unions, so a typo in either does not
 * type-check. The instance and index holes are *patterns* rather than closed unions: that
 * keeps this type at 12 x 21 members instead of multiplying by an arbitrary index bound, at
 * the cost of also admitting spellings the runtime rejects (`1.5`, `-1`, `1e3`, and for the
 * device instance any string at all). Neither is a name, so nothing in rule 5 is lost; the
 * runtime guard is what settles their spelling.
 *
 * The device-instance hole is `${string}` rather than `${number}` because an opaque token has
 * no type-level pattern — an adapter GUID is not a number. `${number}` would make
 * `sensorTopic('network', 'throughput', { deviceIndex: someToken })` a compile error on a
 * topic the grammar now considers canonical.
 */
export type SensorTopic =
  `${typeof SENSOR_TOPIC_ROOT}/${SensorDevice}/${string}/${SensorMetric}/${number}`;

/**
 * The authored short form, both indices omitted. Accepted by `parseSensorTopic` and
 * expanded by `normalizeSensorTopic`; never produced by a builder here.
 */
export type SensorTopicShorthand = `${typeof SENSOR_TOPIC_ROOT}/${SensorDevice}/${SensorMetric}`;

/** The retained companion topic carrying `SensorMeta`. */
export type SensorMetaTopic = `${SensorTopic}/${typeof SENSOR_META_SUFFIX}`;

/**
 * Which instance of a device a topic names: an ordinal (`1` — the second GPU) where the
 * source has one, or an opaque token (an adapter GUID) where it does not.
 *
 * A `number` when the segment is an ordinal and a `string` when it is a token, so the common
 * case stays a number and a consumer that assumed arithmetic is told by the compiler.
 */
export type SensorDeviceInstance = number | string;

export interface SensorTopicParts {
  device: SensorDevice;
  /** Which instance of the device: the second GPU is `1`, a NIC is its token. */
  deviceIndex: SensorDeviceInstance;
  metric: SensorMetric;
  /** Which sensor of that metric on that device: CPU core #3's temperature is `3`. */
  sensorIndex: number;
}

/** Both indices, each defaulting to `0`. Named rather than positional because two bare numbers at a call site are indistinguishable. */
export interface SensorTopicIndices {
  deviceIndex?: SensorDeviceInstance;
  sensorIndex?: number;
}

/**
 * An index segment: a non-negative integer in its one canonical spelling. `00`, `+1`,
 * `1e3` and `1.5` are rejected so that a sensor maps to exactly one topic string — a
 * topic is an identity key, and two spellings of it would be two subscriptions.
 */
const INDEX_SEGMENT = /^(?:0|[1-9][0-9]*)$/;

/**
 * Lower-case alphanumeric groups joined by single hyphens: `684d7057-f1c7-4928-…`, `eth0`.
 *
 * Deliberately the narrow, safe intersection rather than "any non-empty string":
 *
 * - **MQTT-safe.** A topic level cannot contain `/`, `+` or `#` — `/` would add a segment and
 *   the other two would turn one device's topic into a wildcard that matches others. None of
 *   the three can appear here.
 * - **One canonical spelling.** No upper case, no percent-encoding, no braces, no leading,
 *   trailing or doubled hyphen. So `%7B684D…%7D`, `{684d…}` and `684D…` are all rejected
 *   rather than becoming second spellings of the same adapter. A source normalises once, at
 *   the edge, and everything downstream compares strings.
 * - **Bounded.** 64 characters, which a decoded GUID (36) fits with room to spare.
 */
const DEVICE_TOKEN_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEVICE_TOKEN_MAX_LENGTH = 64;

/**
 * Build a topic. The return type makes a typo a compile error on both sides.
 *
 * Throws `RangeError` on an index that is not a non-negative integer, rather than
 * returning a topic that `parseSensorTopic` would reject — `SensorTopic`'s `${number}`
 * holes cannot catch that at compile time, so this is where it is caught.
 */
export function sensorTopic(
  device: SensorDevice,
  metric: SensorMetric,
  indices: SensorTopicIndices = {},
): SensorTopic {
  const deviceIndex = checkDeviceInstance(indices.deviceIndex ?? 0);
  const sensorIndex = checkIndex(indices.sensorIndex ?? 0, 'sensorIndex');

  return `${SENSOR_TOPIC_ROOT}/${device}/${deviceIndex}/${metric}/${sensorIndex}`;
}

/** Build the retained metadata companion topic for the same sensor. */
export function sensorMetaTopic(
  device: SensorDevice,
  metric: SensorMetric,
  indices: SensorTopicIndices = {},
): SensorMetaTopic {
  return `${sensorTopic(device, metric, indices)}/${SENSOR_META_SUFFIX}`;
}

/**
 * Split a topic into its parts, or `null` if it is not a valid sensor topic.
 *
 * Accepts the canonical five-segment form and the three-segment shorthand, whose
 * omitted indices default to `0`. Rejects the `…/meta` companion topic, wildcards, and
 * any name outside the vocabulary.
 */
export function parseSensorTopic(topic: string): SensorTopicParts | null {
  const parts = topic.split('/');
  if (parts[0] !== SENSOR_TOPIC_ROOT) return null;

  // The `= ''` defaults are load-bearing rather than decorative: `split` never yields an
  // `undefined` element inside the array's own length, but the compiler cannot know the
  // length from a runtime check, and `''` is in neither vocabulary and fails
  // `INDEX_SEGMENT`. A missing segment is therefore rejected by exactly the checks below
  // that reject a misspelled one, with no cast and no unreachable branch.
  if (parts.length === 3) {
    const [, device = '', metric = ''] = parts;
    if (!isSensorDevice(device) || !isSensorMetric(metric)) return null;
    return { device, deviceIndex: 0, metric, sensorIndex: 0 };
  }

  if (parts.length !== 5) return null;

  const [, device = '', deviceIndex = '', metric = '', sensorIndex = ''] = parts;
  if (!isSensorDevice(device) || !isSensorMetric(metric)) return null;
  if (!INDEX_SEGMENT.test(sensorIndex)) return null;

  const deviceInstance = parseDeviceInstance(deviceIndex);
  if (deviceInstance === null) return null;

  return {
    device,
    deviceIndex: deviceInstance,
    metric,
    sensorIndex: Number(sensorIndex),
  };
}

/**
 * The device-instance segment as an ordinal where it is one, a token where it is not, `null`
 * where it is neither. The ordinal test comes first, so `0` is the number `0` and never the
 * string `'0'` — a parsed ordinal stays arithmetic.
 */
function parseDeviceInstance(segment: string): SensorDeviceInstance | null {
  if (INDEX_SEGMENT.test(segment)) return Number(segment);
  if (isSensorDeviceToken(segment)) return segment;

  return null;
}

/**
 * Whether `topic` is a canonical, fully-indexed sensor topic.
 *
 * Deliberately `false` for the shorthand: the predicate narrows to `SensorTopic`, which
 * is the five-segment type, and a guard that narrowed a three-segment string to it would
 * be lying to every caller downstream. Use `normalizeSensorTopic` to validate an
 * authored topic that may be short.
 */
export function isSensorTopic(topic: string): topic is SensorTopic {
  return topic.split('/').length === 5 && parseSensorTopic(topic) !== null;
}

/**
 * Expand an authored topic to its canonical form, or `null` if it is not valid.
 *
 * This is the seam for free-text entry: it both validates and returns the one spelling
 * that should be stored and subscribed to. Idempotent.
 */
export function normalizeSensorTopic(topic: string): SensorTopic | null {
  const parts = parseSensorTopic(topic);
  if (parts === null) return null;

  return sensorTopic(parts.device, parts.metric, {
    deviceIndex: parts.deviceIndex,
    sensorIndex: parts.sensorIndex,
  });
}

export function isSensorDevice(value: string): value is SensorDevice {
  return (SENSOR_DEVICES as readonly string[]).includes(value);
}

export function isSensorMetric(value: string): value is SensorMetric {
  return (SENSOR_METRICS as readonly string[]).includes(value);
}

/**
 * Whether `value` is a canonical opaque device-instance token.
 *
 * Exported because a source that has to normalise a foreign instance identity — LHM's
 * URL-encoded adapter GUID, say — must be able to check its result against the grammar rather
 * than carry its own copy of these rules. That is SPEC rule 5 applied to a spelling: one
 * place decides, everywhere else asks.
 *
 * The token is **opaque by construction**: nothing here, and nothing downstream, reads meaning
 * out of it. It is not an ordinal, there is no registry mapping it to one, and two tokens have
 * no order. All that is required of it is that the same device produce the same token every
 * time. A digits-only token must be the ordinal's one canonical spelling, so `00` is rejected
 * and cannot become a second spelling of device `0`.
 */
export function isSensorDeviceToken(value: string): boolean {
  if (value.length === 0 || value.length > DEVICE_TOKEN_MAX_LENGTH) return false;
  if (!DEVICE_TOKEN_SEGMENT.test(value)) return false;
  if (/^[0-9]+$/.test(value)) return INDEX_SEGMENT.test(value);

  return true;
}

/**
 * Validate a device instance and return its canonical segment spelling.
 *
 * Throws `RangeError` rather than returning a topic `parseSensorTopic` would reject, for the
 * same reason `checkIndex` does: a builder that emitted an unparseable topic would push the
 * failure to whichever subscriber never receives anything.
 */
function checkDeviceInstance(instance: SensorDeviceInstance): string {
  if (typeof instance === 'number') return String(checkIndex(instance, 'deviceIndex'));
  if (!isSensorDeviceToken(instance)) {
    throw new RangeError(
      `deviceIndex must be a non-negative integer or an opaque device token, got ${JSON.stringify(instance)}`,
    );
  }

  return instance;
}

function checkIndex(index: number, name: keyof SensorTopicIndices): number {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${index}`);
  }
  return index;
}
