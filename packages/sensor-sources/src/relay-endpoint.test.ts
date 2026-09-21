import { describe, expect, it } from 'vitest';
import { RELAY_DEFAULT_HOST, RELAY_WEBSOCKET_PORT, relayWebSocketUrl } from '@perch/sensor-sources';

describe('relayWebSocketUrl', () => {
  it('defaults to the development relay', () => {
    expect(relayWebSocketUrl()).toBe('ws://localhost:9001');
  });

  it('takes a host override', () => {
    expect(relayWebSocketUrl('desk.local')).toBe('ws://desk.local:9001');
  });

  it('takes a host and port override', () => {
    expect(relayWebSocketUrl('192.168.1.40', 8083)).toBe('ws://192.168.1.40:8083');
  });

  it('builds from the exported constants, so the port lives in one place', () => {
    expect(relayWebSocketUrl(RELAY_DEFAULT_HOST, RELAY_WEBSOCKET_PORT)).toBe(relayWebSocketUrl());
    expect(RELAY_WEBSOCKET_PORT).toBe(9001);
    expect(RELAY_DEFAULT_HOST).toBe('localhost');
  });

  it('parses as a URL', () => {
    const url = new URL(relayWebSocketUrl('broker.example', 9001));
    expect(url.protocol).toBe('ws:');
    expect(url.hostname).toBe('broker.example');
    expect(url.port).toBe('9001');
  });
});
