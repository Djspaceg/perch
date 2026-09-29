/**
 * The connection control's model, without the control: what a typed host means, what a remembered
 * one must look like, and which of connecting / connected / disconnected the editor is in.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LHM_PORT,
  choiceRequest,
  deriveConnection,
  followedRequest,
  parseHostInput,
  readSavedConnection,
} from './connection.js';

describe('parseHostInput', () => {
  it('takes a host alone and gives it LibreHardwareMonitor’s default port', () => {
    expect(DEFAULT_LHM_PORT).toBe(8085);
    expect(parseHostInput('192.168.1.3')).toEqual({ ok: true, host: '192.168.1.3', port: 8085 });
    expect(parseHostInput('  sensor-pc.local ')).toEqual({
      ok: true,
      host: 'sensor-pc.local',
      port: 8085,
    });
  });

  it('takes host:port, including a bracketed IPv6 address', () => {
    expect(parseHostInput('192.168.1.3:9000')).toEqual({
      ok: true,
      host: '192.168.1.3',
      port: 9000,
    });
    expect(parseHostInput('[::1]:8085')).toEqual({ ok: true, host: '[::1]', port: 8085 });
    expect(parseHostInput('[fe80::1]')).toEqual({ ok: true, host: '[fe80::1]', port: 8085 });
  });

  it('rejects empty and whitespace-only input', () => {
    expect(parseHostInput('')).toMatchObject({ ok: false });
    expect(parseHostInput('   ')).toMatchObject({ ok: false });
  });

  it('rejects a bad port, a URL, and a host with spaces, each with a reason', () => {
    for (const text of ['h:0', 'h:65536', 'h:80a', 'h:', 'http://h', 'a b', 'h/x', '::1']) {
      const parsed = parseHostInput(text);
      expect(parsed.ok, text).toBe(false);
      if (!parsed.ok) expect(parsed.reason.length, text).toBeGreaterThan(0);
    }
  });
});

describe('choiceRequest', () => {
  it('sends localhost without a port, so the relay uses its own configured one', () => {
    expect(choiceRequest({ kind: 'localhost' })).toEqual({ host: 'localhost' });
  });

  it('sends a remote host with its port', () => {
    expect(choiceRequest({ kind: 'remote', host: '192.168.1.3', port: 8085 })).toEqual({
      host: '192.168.1.3',
      port: 8085,
    });
  });
});

describe('readSavedConnection', () => {
  it('reads back a remembered choice and the typed host', () => {
    const saved = {
      choice: { kind: 'remote', host: '192.168.1.3', port: 8085 },
      draft: '192.168.1.3',
    } as const;

    expect(readSavedConnection(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(readSavedConnection({ choice: { kind: 'localhost' } })).toEqual({
      choice: { kind: 'localhost' },
      draft: '',
    });
  });

  it('refuses what is not a connection', () => {
    for (const junk of [
      undefined,
      'not json',
      {},
      { choice: { kind: 'remote', host: 'a b', port: 1 } },
      { choice: { kind: 'remote', host: 'h', port: 70_000 } },
    ]) {
      expect(readSavedConnection(junk), JSON.stringify(junk)).toBeUndefined();
    }
  });
});

describe('deriveConnection', () => {
  const localhost = { host: 'localhost' };
  const ok = { host: 'localhost', port: 28085, state: 'ok' } as const;

  it('is disconnected with a reason when there is no relay at all', () => {
    const state = deriveConnection({
      relayUrl: undefined,
      link: 'down',
      status: undefined,
      request: localhost,
      sourceStatus: 'connecting',
    });
    expect(state.phase).toBe('disconnected');
    expect(state.reason).toMatch(/no relay/);
  });

  it('is connecting while the link to the relay opens', () => {
    expect(
      deriveConnection({
        relayUrl: 'ws://localhost:53123',
        link: 'opening',
        status: undefined,
        request: localhost,
        sourceStatus: 'connecting',
      }).phase,
    ).toBe('connecting');
  });

  it('is disconnected, naming the relay, when the link to it is down', () => {
    const state = deriveConnection({
      relayUrl: 'ws://localhost:53123',
      link: 'down',
      status: ok,
      request: localhost,
      sourceStatus: 'error',
    });
    expect(state.phase).toBe('disconnected');
    expect(state.reason).toContain('ws://localhost:53123');
  });

  it('is connecting while the relay has not yet reported on the host asked for', () => {
    const base = { relayUrl: 'ws://r', link: 'up', sourceStatus: 'live' } as const;
    expect(deriveConnection({ ...base, status: undefined, request: localhost }).phase).toBe(
      'connecting',
    );
    expect(
      deriveConnection({ ...base, status: ok, request: { host: '192.168.1.3', port: 8085 } }).phase,
    ).toBe('connecting');
    expect(
      deriveConnection({ ...base, status: { ...ok, state: 'polling' }, request: localhost }).phase,
    ).toBe('connecting');
  });

  it('is disconnected with the relay’s own reason when its poll is failing', () => {
    const state = deriveConnection({
      relayUrl: 'ws://r',
      link: 'up',
      status: { host: '192.168.1.3', port: 8085, state: 'failed', reason: 'EHOSTUNREACH' },
      request: { host: '192.168.1.3', port: 8085 },
      sourceStatus: 'stale',
    });
    expect(state).toEqual({
      phase: 'disconnected',
      target: '192.168.1.3:8085',
      reason: 'EHOSTUNREACH',
    });
  });

  it('is connected only when the relay polls the host and readings are arriving here', () => {
    const base = { relayUrl: 'ws://r', link: 'up', status: ok, request: localhost } as const;

    expect(deriveConnection({ ...base, sourceStatus: 'connecting' }).phase).toBe('connecting');
    expect(deriveConnection({ ...base, sourceStatus: 'live' })).toEqual({
      phase: 'connected',
      target: 'localhost:28085',
    });
  });
});

describe('followedRequest', () => {
  it('is whatever the relay reports polling, once it has reported', () => {
    expect(
      followedRequest({ host: '192.168.1.3', port: 8086, state: 'ok' }, { host: 'localhost' }),
    ).toEqual({ host: '192.168.1.3', port: 8086 });
  });

  it('is the fallback until then', () => {
    expect(followedRequest(undefined, { host: 'localhost' })).toEqual({ host: 'localhost' });
  });
});
