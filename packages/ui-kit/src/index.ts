/**
 * Public surface of `@perch/ui-kit`.
 *
 * One widget so far — the numeric readout — plus the provider that feeds it. The gauge and
 * the sparkline from README.md are deliberately not here yet; DECISIONS.md says why.
 *
 * The exports are grouped by the direction data flows through them:
 *
 * ```
 * source → SensorProvider → context → useSensor(topic) → <Readout topic=… />
 * ```
 *
 * Nothing here exposes a way to reach back up that chain. There is no installed singleton and no
 * ambient state: a provider's store belongs to that provider, so two dashboards, two tests or a
 * server render never share one. `createSensorStore` is exported for the rare case that wants a
 * store without React — a capture harness, say — not as a back door for widgets.
 */

export { assertNever } from './exhaustive.js';

export {
  DEFAULT_STALE_AFTER_MS,
  createSensorStore,
  type SensorSnapshot,
  type SensorStore,
  type SensorStoreOptions,
} from './sensor-store.js';

export {
  SensorProvider,
  useSensor,
  useSensorMeta,
  useSensorStatus,
  useSensorStore,
  type SensorProviderProps,
} from './sensor-context.js';

export {
  DEFAULT_DECIMALS,
  READOUT_DECIMALS,
  READOUT_NO_READING_TEXT,
  READOUT_STATE_KINDS,
  READOUT_WAITING_TEXT,
  readoutState,
  readoutView,
  staleNote,
  type ReadoutState,
  type ReadoutStateKind,
  type ReadoutViewInput,
  type ReadoutViewModel,
} from './readout-view.js';

export {
  READOUT_STYLES,
  READOUT_VALUE_FIELD_CHARS,
  Readout,
  type ReadoutProps,
} from './readout.js';
