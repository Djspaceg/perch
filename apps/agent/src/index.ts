/**
 * `@perch/agent` — the relay. Polls LibreHardwareMonitor, publishes readings, and *is* the
 * MQTT broker.
 *
 * Nothing in this repo imports this app (ARCHITECTURE.md: apps are leaves), so this barrel
 * exists for the tests and for a future embedding of the relay in a single-file executable.
 * `main.ts` is the entry point a human runs. See `README.md` for the dev-run port override
 * that this machine requires.
 */

export {
  RELAY_CLI_FLAGS,
  RELAY_DEFAULTS,
  RELAY_ENV_VARS,
  describeRelayConfig,
  lhmDataUrl,
  relayUsage,
  resolveRelayConfig,
  type BrokerAddress,
  type LhmEndpoint,
  type RelayConfig,
  type RelayConfigInput,
  type RelayConfigOrigin,
  type RelayConfigOrigins,
  type RelayConfigResult,
  type RelaySetting,
} from './config.js';

export {
  collectLhmSensorNodes,
  mapLhmSensors,
  readLhmPayload,
  type LhmMappedSensor,
  type LhmMapping,
  type LhmSensorNode,
  type LhmTopicCollision,
} from './lhm-tree.js';

export { LhmRequestError, createLhmDataFetcher, type LhmDataFetcher } from './lhm-client.js';

export {
  startEmbeddedBroker,
  type BrokerPublisher,
  type EmbeddedBroker,
  type PublishOptions,
} from './broker.js';

export {
  FIRST_SUMMARY_MS,
  MAX_SUMMARY_INTERVAL_MS,
  createFailureRun,
  formatDuration,
  noteFailure,
  noteSuccess,
  type FailureKind,
  type FailureLogger,
  type FailureRun,
} from './failure-log.js';

export {
  createRelayState,
  runOnePoll,
  startRelay,
  type PollReport,
  type RelayDeps,
  type RelayHandle,
  type RelayLogger,
  type RelayState,
} from './relay.js';

export {
  runRelayCli,
  type CliStreams,
  type RelayCliOptions,
  type RelayCliResult,
  type RunningRelay,
} from './cli.js';

export {
  LHM_REQUEST_TOPIC,
  LHM_STATUS_TOPIC,
  parseLhmRequest,
  startLhmControl,
  type ControlBroker,
  type LhmControl,
  type LhmControlDeps,
} from './lhm-control.js';
