import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RELAY_BROKER_URL_ENV_VAR,
  RELAY_CONFIG_FILENAME,
  RELAY_CONFIG_URL,
  RELAY_WEBSOCKET_PORT,
  isRelayBrokerConfig,
  isRelayBrokerUrl,
  loadRelayBrokerConfig,
  readProcessEnv,
  relayWebSocketUrl,
  resolveBrokerUrl,
  resolveBrokerUrlAsync,
  type FetchLike,
} from '@perch/sensor-sources';

/** A `fetch` that answers one URL and 404s everything else. Four lines, no jsdom. */
function stubFetch(
  answers: Readonly<Record<string, { status?: number; body?: unknown; throws?: boolean }>>,
): FetchLike {
  return (url) => {
    const answer = answers[url];
    if (answer === undefined) return Promise.resolve({ ok: false, status: 404, json: notJson });
    if (answer.throws === true) return Promise.reject(new TypeError('fetch failed'));

    const status = answer.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(answer.body),
    });
  };
}

function notJson(): Promise<unknown> {
  return Promise.reject(new SyntaxError('no body'));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isRelayBrokerUrl', () => {
  it('accepts ws and wss, with or without a path', () => {
    expect(isRelayBrokerUrl('ws://localhost:9001')).toBe(true);
    expect(isRelayBrokerUrl('wss://panel.lan:443/mqtt')).toBe(true);
    expect(isRelayBrokerUrl('ws://127.0.0.1:1884/')).toBe(true);
  });

  it('rejects mqtt://, which is a real MQTT URL but not a browser one', () => {
    // The whole point of this source is MQTT-over-WebSockets. Accepting `mqtt://` would give a
    // URL that connects under Node in a test and cannot connect at all on the panel.
    expect(isRelayBrokerUrl('mqtt://localhost:1883')).toBe(false);
    expect(isRelayBrokerUrl('mqtts://localhost:8883')).toBe(false);
  });

  it('rejects http, garbage, and a bare host', () => {
    expect(isRelayBrokerUrl('http://localhost:9001')).toBe(false);
    expect(isRelayBrokerUrl('localhost:9001')).toBe(false);
    expect(isRelayBrokerUrl('')).toBe(false);
    expect(isRelayBrokerUrl('ws://')).toBe(false);
  });
});

describe('isRelayBrokerConfig', () => {
  it('accepts a config with no brokerUrl: the field is optional, absence is normal', () => {
    expect(isRelayBrokerConfig({})).toBe(true);
    expect(isRelayBrokerConfig({ brokerUrl: 'ws://host:1884' })).toBe(true);
  });

  it('ignores fields other packages own', () => {
    expect(isRelayBrokerConfig({ brokerUrl: 'ws://host:1884', layout: 'desk.json' })).toBe(true);
  });

  it('rejects a non-object and a non-string brokerUrl', () => {
    expect(isRelayBrokerConfig(null)).toBe(false);
    expect(isRelayBrokerConfig([])).toBe(false);
    expect(isRelayBrokerConfig('ws://host:1884')).toBe(false);
    expect(isRelayBrokerConfig({ brokerUrl: 9001 })).toBe(false);
  });
});

describe('resolveBrokerUrl: env then config file then default', () => {
  it('takes the environment variable first, over a config file that disagrees', () => {
    const resolved = resolveBrokerUrl({
      env: { [RELAY_BROKER_URL_ENV_VAR]: 'ws://sensors.lan:1884' },
      config: { brokerUrl: 'ws://stale.lan:9001' },
    });

    expect(resolved).toEqual({ url: 'ws://sensors.lan:1884', origin: 'env' });
  });

  it('takes the config file when the environment is silent', () => {
    expect(resolveBrokerUrl({ env: {}, config: { brokerUrl: 'ws://sensors.lan:1884' } })).toEqual({
      url: 'ws://sensors.lan:1884',
      origin: 'config',
    });
  });

  it('falls through to the default, and says so', () => {
    // `origin: 'default'` is the load-bearing half. 9001 on localhost is frequently a system
    // mosquitto rather than perch's relay, so "nobody chose this" has to be reportable.
    expect(resolveBrokerUrl()).toEqual({ url: relayWebSocketUrl(), origin: 'default' });
    expect(relayWebSocketUrl()).toContain(`:${RELAY_WEBSOCKET_PORT}`);
  });

  it('treats an empty or whitespace variable as unset, the way a shell does', () => {
    expect(resolveBrokerUrl({ env: { [RELAY_BROKER_URL_ENV_VAR]: '' } }).origin).toBe('default');
    expect(resolveBrokerUrl({ env: { [RELAY_BROKER_URL_ENV_VAR]: '   ' } }).origin).toBe('default');
    expect(resolveBrokerUrl({ config: { brokerUrl: '  ' } }).origin).toBe('default');
  });

  it('trims a variable that survived a copy-paste', () => {
    expect(resolveBrokerUrl({ env: { [RELAY_BROKER_URL_ENV_VAR]: ' ws://a.lan:1884\n' } })).toEqual(
      {
        url: 'ws://a.lan:1884',
        origin: 'env',
      },
    );
  });

  it('throws on a malformed override rather than silently using the default', () => {
    // Falling through here would reproduce the exact failure this module exists to prevent:
    // the operator believes they aimed the dashboard somewhere and it went somewhere else.
    expect(() =>
      resolveBrokerUrl({ env: { [RELAY_BROKER_URL_ENV_VAR]: 'sensors.lan:1884' } }),
    ).toThrow(/PERCH_BROKER_URL/);
    expect(() => resolveBrokerUrl({ config: { brokerUrl: 'mqtt://sensors.lan:1883' } })).toThrow(
      /brokerUrl/,
    );
  });
});

describe('loadRelayBrokerConfig', () => {
  it('reads the file beside the bundle', async () => {
    const config = await loadRelayBrokerConfig(
      stubFetch({ [RELAY_CONFIG_URL]: { body: { brokerUrl: 'ws://sensors.lan:1884' } } }),
    );

    expect(config).toEqual({ brokerUrl: 'ws://sensors.lan:1884' });
  });

  it('returns undefined for a 404: an unconfigured bundle is normal, not broken', async () => {
    await expect(loadRelayBrokerConfig(stubFetch({}))).resolves.toBeUndefined();
  });

  it('returns undefined when fetch itself rejects, as it does over file://', async () => {
    await expect(
      loadRelayBrokerConfig(stubFetch({ [RELAY_CONFIG_URL]: { throws: true } })),
    ).resolves.toBeUndefined();
  });

  it('throws on a file that is there and wrong', async () => {
    await expect(
      loadRelayBrokerConfig(stubFetch({ [RELAY_CONFIG_URL]: { body: { brokerUrl: 42 } } })),
    ).rejects.toThrow(new RegExp(RELAY_CONFIG_FILENAME));
  });

  it('throws on a non-404 error status, which is a misconfigured server not an absent file', async () => {
    await expect(
      loadRelayBrokerConfig(stubFetch({ [RELAY_CONFIG_URL]: { status: 500 } })),
    ).rejects.toThrow(/500/);
  });
});

describe('resolveBrokerUrlAsync', () => {
  it('does not fetch when the environment already decided', async () => {
    let fetched = 0;
    const counting: FetchLike = (url) => {
      fetched += 1;
      return stubFetch({})(url);
    };

    // `vi.stubEnv` rather than assigning and deleting: `delete process.env[x]` on a computed
    // key is banned by the lint config, and a leaked variable would silently decide the next
    // test's resolution order.
    vi.stubEnv(RELAY_BROKER_URL_ENV_VAR, 'ws://sensors.lan:1884');

    await expect(resolveBrokerUrlAsync(counting)).resolves.toEqual({
      url: 'ws://sensors.lan:1884',
      origin: 'env',
    });
    expect(fetched).toBe(0);
  });

  it('falls back through the config file to the default', async () => {
    await expect(resolveBrokerUrlAsync(stubFetch({}))).resolves.toEqual({
      url: relayWebSocketUrl(),
      origin: 'default',
    });
  });
});

describe('readProcessEnv', () => {
  it('reads the real environment under node without importing node types', () => {
    vi.stubEnv('PERCH_BROKER_URL_PROBE', 'present');

    expect(readProcessEnv()['PERCH_BROKER_URL_PROBE']).toBe('present');
  });

  it('is empty rather than throwing where there is no process, as in a browser', () => {
    // The module reaches `globalThis.process` structurally for exactly this reason: the same
    // function has to be correct in the bundle, where `process` does not exist.
    const host = globalThis as { process?: unknown };
    const real = host.process;
    try {
      delete host.process;
      expect(readProcessEnv()).toEqual({});
    } finally {
      host.process = real;
    }
  });
});
