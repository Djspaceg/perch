/**
 * Public surface of `@perch/sensor-sources`.
 *
 * The `SensorSource` interface itself lives in `@perch/sensor-contract` — it is a contract,
 * and `ui-kit` needs it without gaining an edge to this package. This package holds the
 * implementations of it, and the topic matching a broker-less one needs.
 *
 * Two implementations ship: `createMockSource` (no broker, deterministic when seeded) and
 * `createMqttSource` (MQTT over WebSockets, the real one). They are interchangeable through
 * `SensorSource`, which is the whole point of the seam — no consumer branches on which it has.
 */
export { RELAY_DEFAULT_HOST, RELAY_WEBSOCKET_PORT, relayWebSocketUrl } from './relay-endpoint.js';

export { topicMatchesPattern } from './topic-pattern.js';

export {
  MOCK_SENSOR_SPECS,
  createMockSource,
  type MockSensorSource,
  type MockSensorSpec,
  type MockSourceOptions,
} from './mock-source.js';

export {
  RELAY_BROKER_URL_ENV_VAR,
  RELAY_CONFIG_FILENAME,
  RELAY_CONFIG_URL,
  isRelayBrokerConfig,
  isRelayBrokerUrl,
  loadRelayBrokerConfig,
  readProcessEnv,
  resolveBrokerUrl,
  resolveBrokerUrlAsync,
  type BrokerUrlOrigin,
  type BrokerUrlSources,
  type FetchLike,
  type RelayBrokerConfig,
  type ResolvedBrokerUrl,
} from './broker-url.js';

export {
  DEFAULT_BROKER_URL_WARNING,
  SENSOR_MESSAGE_REJECTIONS,
  SENSOR_META_SUBSCRIPTION,
  SENSOR_READING_SUBSCRIPTION,
  createMqttSource,
  type MqttSensorSource,
  type MqttSourceOptions,
  type MqttSourceStats,
  type SensorMessageRejection,
  type SourceLogger,
} from './mqtt-source.js';

export {
  RELAY_LHM_REQUEST_TOPIC,
  RELAY_LHM_STATES,
  RELAY_LHM_STATUS_TOPIC,
  createRelayControl,
  isLhmHost,
  isRelayLhmRequest,
  isRelayLhmStatus,
  relayStatusMatches,
  type RelayControl,
  type RelayControlOptions,
  type RelayLhmRequest,
  type RelayLhmState,
  type RelayLhmStatus,
} from './relay-control.js';
