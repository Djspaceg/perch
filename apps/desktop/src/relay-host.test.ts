import { describe, expect, it } from 'vitest';
import { desktopRelayConfig, pageBrokerUrl } from './relay-host.js';

describe('desktopRelayConfig', () => {
  it('binds loopback by default and polls LHM on this machine', () => {
    const config = desktopRelayConfig({}, null);

    expect(config.broker).toEqual({ bindHost: '127.0.0.1', mqttPort: 1883, wsPort: 9001 });
    expect(config.lhm).toEqual({ host: 'localhost', port: 8085 });
  });

  it('polls the remembered LHM host', () => {
    expect(desktopRelayConfig({}, { host: '192.168.1.3', port: 8086 }).lhm).toEqual({
      host: '192.168.1.3',
      port: 8086,
    });
  });

  it('lets the relay environment variables override the remembered host and the bind', () => {
    const config = desktopRelayConfig(
      { PERCH_LHM_HOST: '127.0.0.1', PERCH_LHM_PORT: '18085', PERCH_BIND_HOST: '0.0.0.0' },
      { host: '192.168.1.3', port: 8085 },
    );

    expect(config.lhm).toEqual({ host: '127.0.0.1', port: 18085 });
    expect(config.broker.bindHost).toBe('0.0.0.0');
  });

  it('throws on a malformed override, naming it, rather than quietly using a default', () => {
    expect(() => desktopRelayConfig({ PERCH_LHM_PORT: 'banana' }, null)).toThrow(/PERCH_LHM_PORT/);
  });
});

describe('pageBrokerUrl', () => {
  it('dials loopback when the relay is bound to every interface or to loopback', () => {
    expect(pageBrokerUrl('0.0.0.0', 19001)).toBe('ws://127.0.0.1:19001');
    expect(pageBrokerUrl('127.0.0.1', 9001)).toBe('ws://127.0.0.1:9001');
  });

  it('dials the bound interface otherwise', () => {
    expect(pageBrokerUrl('192.168.1.20', 9001)).toBe('ws://192.168.1.20:9001');
  });
});
