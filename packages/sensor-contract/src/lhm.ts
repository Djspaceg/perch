/**
 * LibreHardwareMonitor's identifiers, mapped onto this contract's topic grammar.
 *
 * ## Why this lives in the contract and not in an adapter
 *
 * This is a *name* mapping, and SPEC rule 5 says names live here or nowhere. It is not
 * transport, so rule 3 does not push it out. The deciding argument is the dependency
 * graph: per ARCHITECTURE.md `apps/agent` depends on `sensor-contract` alone, so putting
 * this in `sensor-sources` would force either a new edge from `agent` or a second copy of
 * the table — and a second copy of a name mapping is precisely the failure rule 5 exists
 * to prevent. It is kept in its own module so that a later decision to move it is a file
 * move rather than an untangling.
 *
 * ## Read the Raw fields, never the formatted ones — and parse them, because they are strings
 *
 * LHM's `/data.json` sensor nodes carry both. `Value`/`Min`/`Max` are display-formatted and
 * their **unit varies with the magnitude** — LHM's own comment says "Throughput will be
 * measured in KB/s or MB/s depending on the value". `RawValue`/`RawMin`/`RawMax` exist, per
 * that same comment, "for external systems to have consistent readings, e.g. Throughput will
 * always be measured in B/s". Since this contract fixes one unit per metric
 * (`SENSOR_METRIC_UNITS`), a source that read `Value` would publish MB/s into a topic
 * declared as B/s and be wrong by a factor *only sometimes* — the worst kind of wrong. Read
 * `RawValue`. See `LHM_RAW_VALUE_FIELDS`.
 *
 * What is easy to get wrong, because LHM's C# API says otherwise: `ISensor.Value` is
 * `float?`, but **`/data.json` sends every value as a formatted string**, `RawValue`
 * included. Verified against `fixtures/lhm-data.sample.json`, a live capture of 214 sensors:
 *
 * ```text
 * "Value":"2.848 V"    "RawValue":"2.848 V"       number + unit
 * "Value":"448 RPM"    "RawValue":"448 RPM"       integer + unit
 * "Value":"44.0 °C"    "RawValue":"44.0 °C"       non-ASCII unit
 * "Value":"48.500"     "RawValue":"48.500"        Factor: no unit at all
 * "Value":"-"          "RawValue":" °C"           enumerated, reporting nothing
 * "Value":"6.4 MB/s"   "RawValue":"6699008.0 B/s" the one type where they differ
 * ```
 *
 * So the unit suffix is optional, not merely tolerated: a parser that required one would
 * silently drop all 14 `Factor` sensors. `parseLhmValue` is that parser — it yields `null`,
 * never `0`, for anything it cannot read, which is what `SensorReading.value` wants for a
 * sensor that is present and reporting nothing.
 */

import {
  isSensorDevice,
  isSensorDeviceToken,
  isSensorMetric,
  sensorTopic,
  type SensorDevice,
  type SensorDeviceInstance,
  type SensorMetric,
  type SensorTopic,
} from './topics.js';

/**
 * The fields a source must read from an LHM sensor node, in place of the formatted
 * `Value`/`Min`/`Max`. Named here so an adapter author cannot reach for the wrong three.
 */
export const LHM_RAW_VALUE_FIELDS = ['RawValue', 'RawMin', 'RawMax'] as const;

/**
 * The leading numeric portion of an LHM formatted value.
 *
 * Anchored at the start, and the unit is *not* part of the pattern — a trailing unit is
 * simply whatever is left over, and it may be absent (`Factor` is bare). The digits and `.`
 * are spelled out rather than using anything culture-aware: LHM formats with the invariant
 * culture, so `.` is the decimal separator everywhere, and a locale-sensitive parse would
 * read `48.500` as 48500 on a machine whose locale groups with `.`.
 *
 * No exponent form, because LHM's `F`-format never emits one and `1e3` is indistinguishable
 * from a number followed by a unit beginning with `e`.
 */
const LHM_NUMERIC_PREFIX = /^[-+]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)/;

/**
 * Read one of LHM's formatted value strings as a number, or `null`.
 *
 * `'2.848 V'` is 2.848, `'448 RPM'` is 448, `'48.500'` (a unit-less `Factor`) is 48.5. `null`
 * for anything unreadable — `' °C'` and `'-'`, which is how LHM spells a sensor that is
 * enumerated but reporting nothing, as well as an empty string, a non-string, and any value
 * that would come out `NaN` or infinite. Never `0`: `SensorReading.value` distinguishes "no
 * reading" from a real zero, and `isSensorReading` rejects `NaN` and `±Infinity` outright,
 * so this must not hand one on.
 *
 * Fails closed rather than reading a numeric prefix out of something malformed: what follows
 * the number must be a unit, so if the remainder contains a digit (`'1e3 V'`, `'1.5.2 V'`) the
 * string is not a reading this understands and the answer is `null`. Publishing a plausible
 * wrong number is worse than publishing nothing, because nothing downstream can detect it.
 */
export function parseLhmValue(formatted: unknown): number | null {
  if (typeof formatted !== 'string') return null;

  const trimmed = formatted.trim();
  const match = LHM_NUMERIC_PREFIX.exec(trimmed);
  if (match === null) return null;

  const remainder = trimmed.slice(match[0].length);
  if (/[0-9]/.test(remainder)) return null;

  const value = Number(match[0]);

  return Number.isFinite(value) ? value : null;
}

/**
 * LHM hardware identifier to `SensorDevice`.
 *
 * Keys are matched against the whole hardware portion of the identifier first, then against
 * its leading segment. Both steps are load-bearing, because a hardware prefix is not one
 * segment and its first segment is not enough to identify the device — `/lpc` covers two
 * different devices, which the live capture is what proved:
 *
 * ```text
 * /lpc/nct6798d/0/...   a Super I/O chip     22 sensors   second segment is a chip model
 * /lpc/ec/...           embedded controller   7 sensors   no instance segment at all
 * ```
 *
 * So `lpc/ec` is an exact-match key, and the leading-segment fallback keeps every other chip
 * under `/lpc` on `superio`, which is LHM's convention: everything it hangs off `lpc` is
 * either the embedded controller or a Super I/O chip named by model.
 *
 * Verified against `fixtures/lhm-data.sample.json`: `amdcpu`, `gpu-nvidia`, `lpc/nct6798d`,
 * `lpc/ec`, `nvme`, `nic`. `/intelcpu/0/temperature/0` is verified from the SPEC and LHM's
 * `HttpServer.cs`. The remaining keys follow LHM's and OpenHardwareMonitor's identifier
 * conventions and include both spellings where the projects differ (`gpu-nvidia` vs
 * `nvidiagpu`). The table **fails closed**: an unrecognised hardware type yields `null`
 * rather than being bucketed into a plausible-looking device, so a gap is visible rather
 * than a silent mis-mapping. See DECISIONS.md.
 */
const LHM_HARDWARE_DEVICES: Readonly<Record<string, SensorDevice>> = Object.freeze({
  mainboard: 'motherboard',
  motherboard: 'motherboard',
  lpc: 'superio',
  'lpc/ec': 'embedded-controller',
  superio: 'superio',
  intelcpu: 'cpu',
  amdcpu: 'cpu',
  cpu: 'cpu',
  ram: 'memory',
  memory: 'memory',
  'gpu-nvidia': 'gpu',
  'gpu-amd': 'gpu',
  'gpu-intel': 'gpu',
  nvidiagpu: 'gpu',
  amdgpu: 'gpu',
  atigpu: 'gpu',
  intelgpu: 'gpu',
  gpu: 'gpu',
  hdd: 'storage',
  ssd: 'storage',
  nvme: 'storage',
  storage: 'storage',
  nic: 'network',
  network: 'network',
  cooler: 'cooler',
  embeddedcontroller: 'embedded-controller',
  'embedded-controller': 'embedded-controller',
  psu: 'psu',
  battery: 'battery',
  powermonitor: 'power-monitor',
  'power-monitor': 'power-monitor',
});

/**
 * LHM sensor type to `SensorMetric`. Identity for all but two spellings — LHM writes
 * `smalldata` and `timespan` unhyphenated — and written out in full rather than as
 * identity-plus-exceptions so that the whole 21-name mapping is readable in one place.
 */
const LHM_SENSOR_TYPE_METRICS: Readonly<Record<string, SensorMetric>> = Object.freeze({
  voltage: 'voltage',
  current: 'current',
  power: 'power',
  clock: 'clock',
  temperature: 'temperature',
  load: 'load',
  frequency: 'frequency',
  fan: 'fan',
  flow: 'flow',
  control: 'control',
  level: 'level',
  data: 'data',
  smalldata: 'small-data',
  throughput: 'throughput',
  timespan: 'time-span',
  timing: 'timing',
  energy: 'energy',
  noise: 'noise',
  conductivity: 'conductivity',
  humidity: 'humidity',
  factor: 'factor',
});

/** Vendor, recovered for `SensorMeta` from what the topic normalises away. */
const LHM_HARDWARE_VENDORS: Readonly<Record<string, string>> = Object.freeze({
  intelcpu: 'intel',
  amdcpu: 'amd',
  'gpu-nvidia': 'nvidia',
  'gpu-amd': 'amd',
  'gpu-intel': 'intel',
  nvidiagpu: 'nvidia',
  amdgpu: 'amd',
  atigpu: 'amd',
  intelgpu: 'intel',
});

/** A non-negative integer in its one canonical spelling. `''` must not read as `0`. */
const LHM_INDEX = /^(?:0|[1-9][0-9]*)$/;

/**
 * Hardware families whose extra identifier segment names the **instance**, not the model.
 *
 * `/nic/%7B684D7057-F1C7-4928-8500-6160B637CC46%7D` is a network adapter's GUID (`%7B` is `{`)
 * — an identity — where `/lpc/nct6798d/0`'s extra segment is a chip model that this contract
 * normalises away like a vendor. LHM gives a NIC no ordinal at all, so the GUID is the only
 * thing telling five adapters apart, and treating it as a model would collapse all of them
 * onto device 0. The two cases are indistinguishable structurally, so which is which is
 * stated here.
 */
const LHM_INSTANCE_IDENTITY_FAMILIES: ReadonlySet<string> = new Set(['nic']);

interface LhmIdentifierParts {
  /** The hardware portion, instance stripped — `intelcpu`, `ram`, `lpc/ec`, `nic`. */
  hardware: string;
  /** LHM's hardware index, or the opaque token its instance identity normalises to. */
  deviceIndex: SensorDeviceInstance;
  /** LHM's own sensor type name, e.g. `smalldata`. */
  sensorType: string;
  sensorIndex: number;
}

/**
 * Convert an LHM `SensorId` — which is `sensor.Identifier.ToString()`, e.g.
 * `/intelcpu/0/temperature/0` — into a perch topic. `null` if the identifier is malformed
 * or names hardware or a sensor type this contract has no name for.
 */
export function lhmSensorIdToTopic(sensorId: string): SensorTopic | null {
  const parts = splitLhmSensorId(sensorId);
  if (parts === null) return null;

  const device = resolveHardware(LHM_HARDWARE_DEVICES, parts.hardware);
  const metric = LHM_SENSOR_TYPE_METRICS[parts.sensorType];
  if (device === undefined || metric === undefined) return null;

  // Both lookups come from tables typed on the closed unions, so these guards are
  // belt-and-braces against a hand-edited table rather than load-bearing parsing.
  if (!isSensorDevice(device) || !isSensorMetric(metric)) return null;

  return sensorTopic(device, metric, {
    deviceIndex: parts.deviceIndex,
    sensorIndex: parts.sensorIndex,
  });
}

/**
 * The vendor an LHM identifier names, for `SensorMeta.vendor`. `undefined` where LHM
 * names none (`/ram`, `/nvme/0`) or where the hardware is unrecognised.
 */
export function lhmVendor(sensorId: string): string | undefined {
  const parts = splitLhmSensorId(sensorId);
  if (parts === null) return undefined;

  return resolveHardware(LHM_HARDWARE_VENDORS, parts.hardware);
}

/**
 * Structural split only — no vocabulary lookup.
 *
 * Read from the end, because the hardware portion is the variable-length part: LHM omits
 * the hardware index entirely for singletons (`/ram/data/0`) and uses more than one
 * segment to name a Super I/O chip or a NIC.
 */
function splitLhmSensorId(sensorId: string): LhmIdentifierParts | null {
  if (!sensorId.startsWith('/')) return null;

  const segments = sensorId.slice(1).split('/');
  // hardware + sensorType + sensorIndex is the shortest valid identifier.
  if (segments.length < 3) return null;

  // The `?? ''` fallbacks are how an indexed read stays honest without a cast or an
  // unreachable branch: the length check above guarantees the elements exist, but the
  // compiler cannot see that, and `''` is rejected by every test applied to these values —
  // it fails `LHM_INDEX`, it is in no vocabulary table, and it is not a device token. A
  // short identifier therefore fails through the same path as a malformed one.
  const sensorIndex = segments[segments.length - 1] ?? '';
  const sensorType = segments[segments.length - 2] ?? '';
  if (!LHM_INDEX.test(sensorIndex)) return null;

  const hardwareSegments = segments.slice(0, -2);
  let deviceIndex: SensorDeviceInstance = 0;
  if (
    hardwareSegments.length > 1 &&
    LHM_INDEX.test(hardwareSegments[hardwareSegments.length - 1] ?? '')
  ) {
    deviceIndex = Number(hardwareSegments.pop());
  }
  if (hardwareSegments.length === 0) return null;

  // A family whose extra segment is an instance identity rather than a model: the identity has
  // to come out of the hardware name, or five adapters share one topic. It becomes the
  // device instance, as an opaque token.
  if (
    hardwareSegments.length > 1 &&
    LHM_INSTANCE_IDENTITY_FAMILIES.has(hardwareSegments[0] ?? '')
  ) {
    const token = lhmInstanceToken(hardwareSegments.pop() ?? '');
    if (token === null) return null;
    // Only the family name is left; a nested identity (`/nic/a/b`) is not a shape LHM emits
    // and not one to guess at.
    if (hardwareSegments.length !== 1) return null;
    deviceIndex = token;
  }

  return {
    hardware: hardwareSegments.join('/'),
    deviceIndex,
    sensorType,
    sensorIndex: Number(sensorIndex),
  };
}

/**
 * Normalise an LHM instance identity to a canonical device-instance token.
 *
 * `%7B684D7057-F1C7-4928-8500-6160B637CC46%7D` becomes
 * `684d7057-f1c7-4928-8500-6160b637cc46`: percent-decoded, because LHM's HTTP layer encodes
 * the braces; braces stripped, because they carry no information and `{` in a topic is noise;
 * and lower-cased, because a GUID's case is not significant while a topic's is — a topic is an
 * identity key, so one adapter must produce one string.
 *
 * `null` if what comes out is not a token the grammar accepts in that position. That check is
 * not a formality: percent-decoding can produce `/`, `+` or `#`, any of which would turn one
 * device's topic into a wildcard or an extra segment. `isSensorDeviceToken` is the contract's
 * own rule, asked rather than re-stated here.
 *
 * `toLowerCase` rather than `toLocaleLowerCase`: the result must not depend on the host's
 * locale, and a Turkish locale would map `I` to `ı`.
 */
function lhmInstanceToken(segment: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // A malformed `%` escape. Fail closed rather than guess at what was meant.
    return null;
  }

  const token = decoded.replace(/^\{/, '').replace(/\}$/, '').toLowerCase();

  return isSensorDeviceToken(token) ? token : null;
}

/** Exact match on the whole hardware portion, else on its leading segment. */
function resolveHardware<T>(table: Readonly<Record<string, T>>, hardware: string): T | undefined {
  return table[hardware] ?? table[hardware.split('/')[0] ?? ''];
}
