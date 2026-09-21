/**
 * Where the relay gets its settings, and in what order.
 *
 * ## Three layers, and why each exists
 *
 * ```text
 * CLI switch   >   environment variable   >   built-in default
 * ```
 *
 * The **default** is what the relay does with no configuration at all, and it is written for
 * the machine this eventually ships on: LibreHardwareMonitor on the same Windows host, so
 * `localhost:8085`. The **environment variable** is how a service wrapper configures a
 * long-lived background process, which is the deployment shape SPEC.md calls the hard part —
 * a systemd unit or a Windows service has an environment, not an argv it is comfortable
 * editing. The **CLI switch** is how a human overrides one setting for one run without
 * touching the service definition, which is exactly the present case: the live LHM instance
 * is on another machine at `192.168.1.3:8085`.
 *
 * All three paths reach the same `RelayConfig`, and `RelayConfigOrigins` records which layer
 * each setting actually came from. That is not decoration: it is what the startup report
 * prints, so a human reading a log can tell "it used the default" from "the environment set
 * it", which is the failure a misconfigured service actually presents as.
 *
 * ## Resolution returns a result, it does not throw or exit
 *
 * `resolveRelayConfig` is a pure function of `(argv, env)` returning one of three outcomes.
 * Nothing here reads `process`, prints, or calls `process.exit`, so the precedence rules are
 * directly testable and the CLI layer owns all of the I/O. Every rejection names the setting,
 * the offending value and where it came from, because the alternative — a silent fallback to
 * the default on a typo'd port — is precisely the "frozen numbers, no explanation" failure
 * SPEC rule 4 forbids.
 */

/** Which LibreHardwareMonitor instance to poll. */
export interface LhmEndpoint {
  readonly host: string;
  readonly port: number;
}

/** Where the embedded broker listens. */
export interface BrokerAddress {
  /** Interface to bind both listeners to. */
  readonly bindHost: string;
  /** Native MQTT over TCP, for a relay-to-relay or CLI subscriber. */
  readonly mqttPort: number;
  /** MQTT over WebSockets, which is the only transport a browser can use. */
  readonly wsPort: number;
}

export interface RelayConfig {
  readonly lhm: LhmEndpoint;
  readonly broker: BrokerAddress;
  /** Milliseconds between the *start* of one poll and the start of the next. */
  readonly pollIntervalMs: number;
  /** How long a single `GET /data.json` may take before it is abandoned. */
  readonly requestTimeoutMs: number;
}

/** The settings a caller can override, one name per layer-resolved value. */
export type RelaySetting =
  | 'lhmHost'
  | 'lhmPort'
  | 'bindHost'
  | 'mqttPort'
  | 'wsPort'
  | 'pollIntervalMs'
  | 'requestTimeoutMs';

/** Which layer a setting's final value came from. Printed at startup. */
export type RelayConfigOrigin = 'default' | 'env' | 'cli';

export type RelayConfigOrigins = Readonly<Record<RelaySetting, RelayConfigOrigin>>;

/**
 * The built-in defaults.
 *
 * `lhmHost`/`lhmPort` are LHM's own defaults on the host being monitored. `mqttPort` is the
 * IANA-registered MQTT port.
 *
 * `wsPort` is 9001 because `packages/sensor-sources/src/relay-endpoint.ts` already contracts
 * that number for the browser side, and the dashboard and the relay have to agree on it
 * without either one guessing. It is restated here rather than imported: ARCHITECTURE.md
 * gives `apps/agent` exactly one edge, `sensor-contract`, and `sensor-contract` SPEC rule 3
 * forbids it from holding a port at all. See DECISIONS.md — this is a knowingly-paid cost,
 * not an oversight.
 *
 * `pollIntervalMs` is 1000 because that is the rate a dashboard reads as live, and it is what
 * the SPEC's staleness discussion assumes. `requestTimeoutMs` is deliberately shorter than
 * two poll intervals, so a hung request is abandoned rather than stacking up behind the next
 * one.
 */
export const RELAY_DEFAULTS: RelayConfig = Object.freeze({
  lhm: Object.freeze({ host: 'localhost', port: 8085 }),
  broker: Object.freeze({ bindHost: '0.0.0.0', mqttPort: 1883, wsPort: 9001 }),
  pollIntervalMs: 1000,
  requestTimeoutMs: 1500,
});

/** The environment variable read for each setting. */
export const RELAY_ENV_VARS: Readonly<Record<RelaySetting, string>> = Object.freeze({
  lhmHost: 'PERCH_LHM_HOST',
  lhmPort: 'PERCH_LHM_PORT',
  bindHost: 'PERCH_BIND_HOST',
  mqttPort: 'PERCH_MQTT_PORT',
  wsPort: 'PERCH_WS_PORT',
  pollIntervalMs: 'PERCH_POLL_INTERVAL_MS',
  requestTimeoutMs: 'PERCH_REQUEST_TIMEOUT_MS',
});

/**
 * The variable the *dashboard* reads its broker URL from.
 *
 * Not a relay setting — the relay never reads it — but the relay has to be able to name it,
 * because the one situation where a human must change it is a situation only the relay detects:
 * `--ws-port` moved, so the page is now dialling a port nothing is listening on. Restated here
 * for the same reason `wsPort`'s 9001 is (see `RELAY_DEFAULTS`): ARCHITECTURE.md gives
 * `apps/agent` a single edge, `sensor-contract`, and `RELAY_BROKER_URL_ENV_VAR` lives in
 * `sensor-sources`, which is the browser's package. A string that two packages agree on is a
 * cheaper coupling than a dependency edge that exists only to carry it.
 */
export const DASHBOARD_BROKER_URL_ENV_VAR = 'PERCH_BROKER_URL';

/** The CLI switch read for each setting, without its leading `--`. */
export const RELAY_CLI_FLAGS: Readonly<Record<RelaySetting, string>> = Object.freeze({
  lhmHost: 'lhm-host',
  lhmPort: 'lhm-port',
  bindHost: 'bind-host',
  mqttPort: 'mqtt-port',
  wsPort: 'ws-port',
  pollIntervalMs: 'poll-interval-ms',
  requestTimeoutMs: 'request-timeout-ms',
});

/** Every setting, in the order the startup report prints them. */
const RELAY_SETTINGS: readonly RelaySetting[] = [
  'lhmHost',
  'lhmPort',
  'bindHost',
  'mqttPort',
  'wsPort',
  'pollIntervalMs',
  'requestTimeoutMs',
];

export interface RelayConfigInput {
  /** Argument list *without* `node` and the script path — i.e. `process.argv.slice(2)`. */
  readonly argv?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * The outcome of resolving configuration: a config, a help request, or a list of rejections.
 *
 * A discriminated union rather than an exception because all three are ordinary outcomes of
 * reading a command line, and because the CLI has a different exit code for each.
 */
export type RelayConfigResult =
  | {
      readonly kind: 'config';
      readonly config: RelayConfig;
      readonly origins: RelayConfigOrigins;
    }
  | { readonly kind: 'help' }
  | { readonly kind: 'invalid'; readonly errors: readonly string[] };

/** A parsed CLI switch and where in argv it was written, for error messages. */
interface CliValues {
  readonly values: Readonly<Partial<Record<RelaySetting, string>>>;
  readonly help: boolean;
  readonly errors: readonly string[];
}

/**
 * Resolve the relay's configuration from a command line and an environment.
 *
 * Pure: it reads neither `process.argv` nor `process.env` itself, so a test can hand it any
 * combination of the two and assert the precedence rather than mutating global state.
 */
export function resolveRelayConfig(input: RelayConfigInput = {}): RelayConfigResult {
  const env = input.env ?? {};
  const cli = parseCliValues(input.argv ?? []);

  if (cli.help) return { kind: 'help' };

  const errors: string[] = [...cli.errors];
  const origins: Partial<Record<RelaySetting, RelayConfigOrigin>> = {};

  /**
   * Resolve one setting across the three layers.
   *
   * The layer is chosen *before* parsing and does not fall through on a parse failure: a
   * `--lhm-port banana` is an error, never a quiet demotion to the environment's value or to
   * 8085. A silently-default port is a relay that polls nothing and says nothing about why.
   */
  const resolve = <T>(
    setting: RelaySetting,
    fallback: T,
    parse: (raw: string) => T | null,
    expectation: string,
  ): T => {
    const layer = layerFor(setting, cli.values, env);
    if (layer === null) {
      origins[setting] = 'default';
      return fallback;
    }

    const parsed = parse(layer.raw);
    if (parsed === null) {
      errors.push(`${layer.source} ${expectation}, got ${JSON.stringify(layer.raw)}`);
      // The value is unusable, so the origin is a placeholder that no successful result will
      // ever be built from: an `invalid` outcome carries no config at all.
      origins[setting] = layer.origin;
      return fallback;
    }

    origins[setting] = layer.origin;
    return parsed;
  };

  const config: RelayConfig = {
    lhm: {
      host: resolve('lhmHost', RELAY_DEFAULTS.lhm.host, parseHost, 'must be a non-empty host name'),
      port: resolve('lhmPort', RELAY_DEFAULTS.lhm.port, parsePort, 'must be a port in 1-65535'),
    },
    broker: {
      bindHost: resolve(
        'bindHost',
        RELAY_DEFAULTS.broker.bindHost,
        parseHost,
        'must be a non-empty interface address',
      ),
      mqttPort: resolve(
        'mqttPort',
        RELAY_DEFAULTS.broker.mqttPort,
        parseListenPort,
        'must be a port in 0-65535 (0 asks the OS for a free one)',
      ),
      wsPort: resolve(
        'wsPort',
        RELAY_DEFAULTS.broker.wsPort,
        parseListenPort,
        'must be a port in 0-65535 (0 asks the OS for a free one)',
      ),
    },
    pollIntervalMs: resolve(
      'pollIntervalMs',
      RELAY_DEFAULTS.pollIntervalMs,
      parseInterval,
      `must be a whole number of milliseconds, at least ${MIN_POLL_INTERVAL_MS}`,
    ),
    requestTimeoutMs: resolve(
      'requestTimeoutMs',
      RELAY_DEFAULTS.requestTimeoutMs,
      parseInterval,
      `must be a whole number of milliseconds, at least ${MIN_POLL_INTERVAL_MS}`,
    ),
  };

  // Only meaningful once every setting parsed: a rejected port has fallen back to its default,
  // and comparing that default against a real one would invent a second, misleading rejection
  // for a command line that has exactly one thing wrong with it. Port 0 is exempt, because
  // "any free port" twice is two different ports.
  if (
    errors.length === 0 &&
    config.broker.mqttPort !== 0 &&
    config.broker.mqttPort === config.broker.wsPort
  ) {
    errors.push(
      `--${RELAY_CLI_FLAGS.mqttPort} and --${RELAY_CLI_FLAGS.wsPort} must differ, both are ${config.broker.mqttPort}`,
    );
  }

  if (errors.length > 0) return { kind: 'invalid', errors };

  return { kind: 'config', config, origins: completeOrigins(origins) };
}

/** The lowest interval the relay accepts, so a typo'd `0` cannot become a busy loop. */
const MIN_POLL_INTERVAL_MS = 50;

/** Which layer supplies a setting, and the human-readable name of that layer for an error. */
function layerFor(
  setting: RelaySetting,
  cliValues: Readonly<Partial<Record<RelaySetting, string>>>,
  env: Readonly<Record<string, string | undefined>>,
): { readonly raw: string; readonly origin: RelayConfigOrigin; readonly source: string } | null {
  const fromCli = cliValues[setting];
  if (fromCli !== undefined) {
    return { raw: fromCli, origin: 'cli', source: `--${RELAY_CLI_FLAGS[setting]}` };
  }

  // An environment variable set to the empty string is treated as set, not unset, so
  // `PERCH_LHM_PORT= relay` is a rejection naming the variable rather than a silent default.
  const fromEnv = env[RELAY_ENV_VARS[setting]];
  if (fromEnv !== undefined) {
    return { raw: fromEnv, origin: 'env', source: RELAY_ENV_VARS[setting] };
  }

  return null;
}

/**
 * Read `--flag value` and `--flag=value`, plus `-h`/`--help`.
 *
 * A repeated flag takes its **last** occurrence, which is what a shell user expects when
 * appending an override to a stored command line. An unknown flag and a bare positional
 * argument are both errors rather than being ignored: a mistyped `--ws-prot 19001` that the
 * relay skipped would leave it on 9001, answering next to a Mosquitto that is also on 9001,
 * and nothing downstream could tell which one it reached.
 */
function parseCliValues(argv: readonly string[]): CliValues {
  const values: Partial<Record<RelaySetting, string>> = {};
  const errors: string[] = [];
  const settingByFlag = new Map<string, RelaySetting>(
    RELAY_SETTINGS.map((setting) => [RELAY_CLI_FLAGS[setting], setting]),
  );

  for (let index = 0; index < argv.length; index += 1) {
    // `?? ''` rather than a cast: the loop bound guarantees the element exists, and `''`
    // fails the `--` test below and so lands in the same rejection path as a positional.
    const argument = argv[index] ?? '';

    if (argument === '-h' || argument === '--help') return { values, help: true, errors };

    if (!argument.startsWith('--')) {
      errors.push(`unexpected argument ${JSON.stringify(argument)}; every setting takes a --flag`);
      continue;
    }

    const separator = argument.indexOf('=');
    const flag = separator === -1 ? argument.slice(2) : argument.slice(2, separator);
    const setting = settingByFlag.get(flag);

    if (setting === undefined) {
      errors.push(`unknown flag --${flag}`);
      if (separator === -1) index += 1; // Skip what was probably its value, not a second flag.
      continue;
    }

    if (separator !== -1) {
      values[setting] = argument.slice(separator + 1);
      continue;
    }

    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      errors.push(`--${flag} needs a value`);
      continue;
    }

    values[setting] = next;
    index += 1;
  }

  return { values, help: false, errors };
}

/** A host name or interface address: non-empty and with no whitespace. */
function parseHost(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed)) return null;

  return trimmed;
}

/**
 * A port to *connect* to: 1-65535. `0` is excluded because it is not an address anything
 * listens on, so it can only be a mistake here.
 */
function parsePort(raw: string): number | null {
  const port = parseWholeNumber(raw);
  if (port === null || port < 1 || port > 65535) return null;

  return port;
}

/**
 * A port to *listen* on, where `0` additionally means "ask the OS for a free one".
 *
 * That is not a testing affordance bolted on: it is how two relays, or a relay and this
 * machine's Mosquitto, coexist without a human picking numbers. The actual port is reported
 * at startup.
 */
function parseListenPort(raw: string): number | null {
  const port = parseWholeNumber(raw);
  if (port === null || port < 0 || port > 65535) return null;

  return port;
}

function parseInterval(raw: string): number | null {
  const interval = parseWholeNumber(raw);
  if (interval === null || interval < MIN_POLL_INTERVAL_MS) return null;

  return interval;
}

/**
 * A non-negative whole number in decimal, and nothing else.
 *
 * Deliberately not `Number()` or `parseInt()`: `Number(' 12 ')` is 12, `Number('0x10')` is 16,
 * `Number('1e3')` is 1000 and `parseInt('80abc')` is 80. A port read out of a typo'd string is
 * the kind of plausible wrong value nothing downstream can detect, which is the same argument
 * `parseLhmValue` makes about reading a numeric prefix out of a malformed reading.
 */
function parseWholeNumber(raw: string): number | null {
  if (!/^[0-9]+$/.test(raw.trim())) return null;

  const value = Number(raw.trim());

  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Fill in the origin table.
 *
 * Every setting is assigned an origin on the path above, but the compiler cannot see that
 * through a `Partial`, and a cast would hide a genuinely missing entry behind a lie. Reading
 * with an explicit `'default'` fallback is honest: a setting nothing assigned is one nothing
 * overrode.
 */
function completeOrigins(
  origins: Partial<Record<RelaySetting, RelayConfigOrigin>>,
): RelayConfigOrigins {
  const complete: Record<RelaySetting, RelayConfigOrigin> = {
    lhmHost: 'default',
    lhmPort: 'default',
    bindHost: 'default',
    mqttPort: 'default',
    wsPort: 'default',
    pollIntervalMs: 'default',
    requestTimeoutMs: 'default',
  };

  for (const setting of RELAY_SETTINGS) {
    complete[setting] = origins[setting] ?? 'default';
  }

  return Object.freeze(complete);
}

/** The value each setting resolved to, as a string, for the startup report. */
export function describeRelayConfig(
  config: RelayConfig,
  origins: RelayConfigOrigins,
): readonly string[] {
  const values: Readonly<Record<RelaySetting, string>> = {
    lhmHost: config.lhm.host,
    lhmPort: String(config.lhm.port),
    bindHost: config.broker.bindHost,
    mqttPort: String(config.broker.mqttPort),
    wsPort: String(config.broker.wsPort),
    pollIntervalMs: String(config.pollIntervalMs),
    requestTimeoutMs: String(config.requestTimeoutMs),
  };

  return RELAY_SETTINGS.map(
    (setting) =>
      `${RELAY_CLI_FLAGS[setting]} = ${values[setting]} (${origins[setting]}, env ${RELAY_ENV_VARS[setting]})`,
  );
}

/** `http://host:port/data.json` — the one URL the relay polls. */
export function lhmDataUrl(endpoint: LhmEndpoint): string {
  return `http://${endpoint.host}:${endpoint.port}/data.json`;
}

/** Usage text. Built from the same tables the parser uses, so it cannot drift from them. */
export function relayUsage(): string {
  const lines = RELAY_SETTINGS.map(
    (setting) => `  --${RELAY_CLI_FLAGS[setting].padEnd(20)} ${RELAY_ENV_VARS[setting]}`,
  );

  return [
    'perch-agent - poll LibreHardwareMonitor and publish readings over embedded MQTT.',
    '',
    'Settings, in precedence order: CLI switch, then environment variable, then default.',
    '',
    `  ${'flag'.padEnd(22)} environment variable`,
    ...lines,
    '  --help                 this text',
    '',
    'A listen port of 0 asks the OS for a free one; the chosen port is reported at startup.',
  ].join('\n');
}
