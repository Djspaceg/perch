/**
 * `@perch/agent` — the relay. Polls LibreHardwareMonitor, publishes readings, and *is* the
 * MQTT broker.
 *
 * One app imports this one: `apps/desktop`, which runs the relay inside its Electron main process
 * through `startRelayService` (ARCHITECTURE.md records the exception to "apps are leaves"). The
 * barrel is also what the tests import. `main.ts` is the entry point a human runs. See `README.md` for the dev-run port override
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
  type EmbeddedBrokerOptions,
  type PublishOptions,
} from './broker.js';

export { startRelayService, type RelayService, type RelayServiceOptions } from './service.js';

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
