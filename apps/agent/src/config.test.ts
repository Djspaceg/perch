/**
 * Configuration precedence: CLI beats environment beats default.
 *
 * The three-layer rule is the part of this app most likely to be got subtly wrong and least
 * likely to be noticed — a relay that ignored `--lhm-host` would poll `localhost`, find nothing
 * there, and report a connection refused against a host the human never asked for. So every
 * layer is asserted for every setting, and `origins` is asserted alongside the value, because
 * "the right value by luck" and "the right value from the right layer" are different states and
 * only one of them survives a change to the defaults.
 */

import { describe, expect, it } from 'vitest';
import {
  RELAY_CLI_FLAGS,
  RELAY_DEFAULTS,
  RELAY_ENV_VARS,
  describeRelayConfig,
  lhmDataUrl,
  relayUsage,
  resolveRelayConfig,
  type RelayConfig,
  type RelayConfigOrigins,
} from './config.js';

/** Resolve and fail the test with the rejections if it did not produce a config. */
function resolveOk(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = {},
): { config: RelayConfig; origins: RelayConfigOrigins } {
  const result = resolveRelayConfig({ argv, env });
  if (result.kind !== 'config') {
    throw new Error(`expected a config, got ${result.kind}: ${JSON.stringify(result)}`);
  }

  return { config: result.config, origins: result.origins };
}

/** Resolve and return the rejections, failing if it unexpectedly succeeded. */
function resolveErrors(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = {},
): readonly string[] {
  const result = resolveRelayConfig({ argv, env });
  if (result.kind !== 'invalid') {
    throw new Error(`expected rejection, got ${result.kind}`);
  }

  return result.errors;
}

describe('defaults', () => {
  it('needs no configuration at all, and points at LHM on this machine', () => {
    const { config, origins } = resolveOk([]);

    // localhost:8085 is right because the relay eventually runs on the Windows host beside
    // LibreHardwareMonitor. The live instance being on another machine today is what the
    // override exists for, not a reason to change this.
    expect(config.lhm).toEqual({ host: 'localhost', port: 8085 });
    expect(config).toEqual(RELAY_DEFAULTS);
    expect(Object.values(origins).every((origin) => origin === 'default')).toBe(true);
  });

  it('defaults the websocket listener to the port sensor-sources already contracts', () => {
    // packages/sensor-sources/src/relay-endpoint.ts exports RELAY_WEBSOCKET_PORT = 9001 for the
    // browser side. It is not imported here — ARCHITECTURE.md gives this app one edge — so this
    // assertion is the thing that keeps the restated number honest. See DECISIONS.md.
    expect(resolveOk([]).config.broker.wsPort).toBe(9001);
  });

  it('builds the one URL it polls', () => {
    expect(lhmDataUrl(RELAY_DEFAULTS.lhm)).toBe('http://localhost:8085/data.json');
  });
});

describe('environment variables override defaults', () => {
  it('reads the live instance out of the environment', () => {
    const { config, origins } = resolveOk([], {
      [RELAY_ENV_VARS.lhmHost]: '192.168.1.3',
      [RELAY_ENV_VARS.lhmPort]: '8085',
    });

    expect(config.lhm).toEqual({ host: '192.168.1.3', port: 8085 });
    expect(origins.lhmHost).toBe('env');
    // Set to the same value the default has: still the environment's, because it was set.
    expect(origins.lhmPort).toBe('env');
  });

  it('reads every setting', () => {
    const { config, origins } = resolveOk([], {
      [RELAY_ENV_VARS.lhmHost]: 'lhm.local',
      [RELAY_ENV_VARS.lhmPort]: '9090',
      [RELAY_ENV_VARS.bindHost]: '127.0.0.1',
      [RELAY_ENV_VARS.mqttPort]: '18830',
      [RELAY_ENV_VARS.wsPort]: '19001',
      [RELAY_ENV_VARS.pollIntervalMs]: '2500',
      [RELAY_ENV_VARS.requestTimeoutMs]: '4000',
    });

    expect(config).toEqual({
      lhm: { host: 'lhm.local', port: 9090 },
      broker: { bindHost: '127.0.0.1', mqttPort: 18830, wsPort: 19001 },
      pollIntervalMs: 2500,
      requestTimeoutMs: 4000,
    });
    expect(Object.values(origins).every((origin) => origin === 'env')).toBe(true);
  });

  it('leaves settings the environment does not mention on their defaults', () => {
    const { config, origins } = resolveOk([], { [RELAY_ENV_VARS.wsPort]: '19001' });

    expect(config.broker.wsPort).toBe(19001);
    expect(config.broker.mqttPort).toBe(RELAY_DEFAULTS.broker.mqttPort);
    expect(origins.wsPort).toBe('env');
    expect(origins.mqttPort).toBe('default');
  });
});

describe('CLI switches override the environment', () => {
  it('wins over an environment variable for the same setting', () => {
    const { config, origins } = resolveOk(['--lhm-host', '192.168.1.3'], {
      [RELAY_ENV_VARS.lhmHost]: 'wrong.local',
    });

    expect(config.lhm.host).toBe('192.168.1.3');
    expect(origins.lhmHost).toBe('cli');
  });

  it('wins per setting, leaving the environment in charge of the others', () => {
    const { config, origins } = resolveOk(['--ws-port', '19001'], {
      [RELAY_ENV_VARS.wsPort]: '9001',
      [RELAY_ENV_VARS.mqttPort]: '18830',
      [RELAY_ENV_VARS.lhmHost]: '192.168.1.3',
    });

    expect(config.broker).toEqual({ bindHost: '0.0.0.0', mqttPort: 18830, wsPort: 19001 });
    expect(config.lhm.host).toBe('192.168.1.3');
    expect(origins.wsPort).toBe('cli');
    expect(origins.mqttPort).toBe('env');
    expect(origins.bindHost).toBe('default');
  });

  it('spells all three layers at once, which is the whole precedence rule in one case', () => {
    const { config, origins } = resolveOk(['--lhm-host', 'from-cli'], {
      [RELAY_ENV_VARS.lhmPort]: '8086',
    });

    expect(config.lhm).toEqual({ host: 'from-cli', port: 8086 });
    expect(config.broker.wsPort).toBe(RELAY_DEFAULTS.broker.wsPort);
    expect(origins.lhmHost).toBe('cli');
    expect(origins.lhmPort).toBe('env');
    expect(origins.wsPort).toBe('default');
  });

  it('accepts --flag=value as well as --flag value', () => {
    expect(resolveOk(['--lhm-host=192.168.1.3', '--lhm-port=8085']).config.lhm).toEqual({
      host: '192.168.1.3',
      port: 8085,
    });
  });

  it('takes the last occurrence of a repeated flag', () => {
    // What a shell user expects when appending an override to a stored command line.
    expect(resolveOk(['--ws-port', '19001', '--ws-port', '19002']).config.broker.wsPort).toBe(
      19002,
    );
  });

  it('reports a help request instead of a config', () => {
    expect(resolveRelayConfig({ argv: ['--help'] }).kind).toBe('help');
    expect(resolveRelayConfig({ argv: ['-h'] }).kind).toBe('help');
    // Help wins over anything else on the line, including something otherwise invalid.
    expect(resolveRelayConfig({ argv: ['--ws-port', 'banana', '--help'] }).kind).toBe('help');
  });

  it('documents every flag and variable in its usage text', () => {
    const usage = relayUsage();
    for (const flag of Object.values(RELAY_CLI_FLAGS)) expect(usage).toContain(`--${flag}`);
    for (const variable of Object.values(RELAY_ENV_VARS)) expect(usage).toContain(variable);
  });
});

describe('rejections name the setting and where it came from', () => {
  it('rejects a non-numeric port rather than falling back to the default', () => {
    // The failure this forbids: `--lhm-port banana` quietly polling 8085, which on this machine
    // is a real LHM, so the relay would appear to work while ignoring what it was told.
    const errors = resolveErrors(['--lhm-port', 'banana']);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('--lhm-port');
    expect(errors[0]).toContain('"banana"');
  });

  it('does not fall through to the environment when the CLI value is bad', () => {
    expect(resolveErrors(['--lhm-port', 'banana'], { [RELAY_ENV_VARS.lhmPort]: '8085' })).toEqual([
      expect.stringContaining('--lhm-port'),
    ]);
  });

  it('names the environment variable when that is the bad layer', () => {
    const errors = resolveErrors([], { [RELAY_ENV_VARS.pollIntervalMs]: '0' });

    expect(errors[0]).toContain(RELAY_ENV_VARS.pollIntervalMs);
  });

  it('treats an empty environment variable as set-and-wrong, not unset', () => {
    // `PERCH_LHM_PORT= perch-agent` is a mistake, and silently using 8085 would hide it.
    expect(resolveErrors([], { [RELAY_ENV_VARS.lhmPort]: '' })[0]).toContain(
      RELAY_ENV_VARS.lhmPort,
    );
  });

  it('rejects the numeric spellings a lenient parser would accept', () => {
    for (const raw of ['0x1f90', '8085.0', '8.085e3', '80abc', ' ', '-1', '+8085']) {
      expect(resolveErrors(['--lhm-port', raw]), raw).toHaveLength(1);
    }
  });

  it('rejects a port outside the range, and port 0 where nothing can listen', () => {
    expect(resolveErrors(['--lhm-port', '65536'])).toHaveLength(1);
    // 0 is meaningless as a port to *connect* to, so it is a mistake rather than a request.
    expect(resolveErrors(['--lhm-port', '0'])).toHaveLength(1);
  });

  it('accepts port 0 on a listener, which is how it asks the OS for a free one', () => {
    const { config } = resolveOk(['--mqtt-port', '0', '--ws-port', '0']);

    expect(config.broker).toEqual({ bindHost: '0.0.0.0', mqttPort: 0, wsPort: 0 });
  });

  it('rejects an interval fast enough to be a busy loop', () => {
    expect(resolveErrors(['--poll-interval-ms', '0'])).toHaveLength(1);
    expect(resolveErrors(['--poll-interval-ms', '10'])).toHaveLength(1);
    expect(resolveOk(['--poll-interval-ms', '50']).config.pollIntervalMs).toBe(50);
  });

  it('rejects an empty or whitespace host', () => {
    expect(resolveErrors(['--lhm-host', ''])).toHaveLength(1);
    expect(resolveErrors(['--lhm-host', 'a b'])).toHaveLength(1);
    // A host that merely needs trimming is accepted, trimmed.
    expect(resolveOk(['--lhm-host', ' 192.168.1.3 ']).config.lhm.host).toBe('192.168.1.3');
  });

  it('rejects an unknown flag rather than ignoring it', () => {
    // The failure this forbids is specific and has already nearly happened: a mistyped
    // `--ws-prot 19001` that the parser skipped would leave the relay on 9001, where a Homebrew
    // Mosquitto is already listening on every interface, and the dashboard would connect to
    // that broker instead and see nothing.
    const errors = resolveErrors(['--ws-prot', '19001']);

    expect(errors).toEqual([expect.stringContaining('--ws-prot')]);
  });

  it('rejects a bare positional argument', () => {
    expect(resolveErrors(['19001'])).toEqual([expect.stringContaining('19001')]);
  });

  it('rejects a flag with no value', () => {
    expect(resolveErrors(['--ws-port'])).toEqual([expect.stringContaining('needs a value')]);
    // A following flag is not this flag's value.
    expect(resolveErrors(['--ws-port', '--mqtt-port', '18830'])).toEqual([
      expect.stringContaining('--ws-port needs a value'),
    ]);
  });

  it('reports every rejection at once rather than only the first', () => {
    // A human fixing a command line should need one round trip, not three.
    expect(resolveErrors(['--lhm-port', 'banana', '--ws-port', 'melon'])).toHaveLength(2);
  });

  it('rejects two listeners asking for the same port', () => {
    // Both would bind, one would fail, and which one is a race. Caught before either listens.
    expect(resolveErrors(['--mqtt-port', '19001', '--ws-port', '19001'])).toEqual([
      expect.stringContaining('must differ'),
    ]);
    // Except 0, which means "any free port" and so is two different ports.
    expect(resolveOk(['--mqtt-port', '0', '--ws-port', '0']).config.broker.mqttPort).toBe(0);
  });
});

describe('the startup report', () => {
  it('prints each setting with its value, origin and environment variable', () => {
    const { config, origins } = resolveOk(['--lhm-host', '192.168.1.3'], {
      [RELAY_ENV_VARS.wsPort]: '19001',
    });
    const lines = describeRelayConfig(config, origins);

    expect(lines).toContain('lhm-host = 192.168.1.3 (cli, env PERCH_LHM_HOST)');
    expect(lines).toContain('ws-port = 19001 (env, env PERCH_WS_PORT)');
    expect(lines).toContain('lhm-port = 8085 (default, env PERCH_LHM_PORT)');
    // Every setting is reported, so nothing is configurable-but-invisible.
    expect(lines).toHaveLength(Object.keys(RELAY_CLI_FLAGS).length);
  });
});

describe('purity', () => {
  it('reads neither process.argv nor process.env of its own accord', () => {
    // Called with no input at all: if it reached for `process.env`, this machine's own
    // PERCH_* variables (or a CI runner's) would change the answer.
    const result = resolveRelayConfig();

    expect(result.kind).toBe('config');
    expect(result.kind === 'config' ? result.config : null).toEqual(RELAY_DEFAULTS);
  });
});
