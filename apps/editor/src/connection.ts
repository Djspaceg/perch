/**
 * Which sensor host the editor reads, as data: the typed host, what is remembered between visits,
 * and which of connecting / connected / disconnected the editor is in.
 *
 * "Host" is the machine running LibreHardwareMonitor. The relay stays on this machine (the dev stack
 * starts it) and is told which LHM host to poll over its one control path
 * (`@perch/sensor-sources`' `relay-control.ts`). A relay elsewhere is out of scope on purpose.
 *
 * ## Connected means readings, not a socket
 *
 * The WebSocket to the relay being open says nothing about the sensor PC. So `connected` needs all
 * three: the link to the relay is up, the relay reports `ok` for the host this editor asked for,
 * and the live source is `live` — readings are arriving here. Anything short of that is
 * `connecting` while it may still come good, or `disconnected` with the reason when it will not.
 */

import type { SensorSourceStatus } from '@perch/sensor-contract';
import {
  isLhmHost,
  relayStatusMatches,
  type RelayLhmRequest,
  type RelayLhmStatus,
} from '@perch/sensor-sources';

/** LibreHardwareMonitor's own default web-server port. */
export const DEFAULT_LHM_PORT = 8085;

/** What the host field holds, read. */
export type HostInput =
  | { readonly ok: true; readonly host: string; readonly port: number }
  | { readonly ok: false; readonly reason: string };

/**
 * `host` or `host:port`, IPv6 in brackets. Empty or whitespace is refused rather than read as
 * localhost: the localhost radio is how to say that.
 */
export function parseHostInput(text: string): HostInput {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'type a host, or host:port' };

  const bracketed = /^(\[[^\]]*\])(?::(.*))?$/.exec(trimmed);
  let host: string;
  let portText: string | undefined;
  if (bracketed !== null) {
    host = bracketed[1] ?? '';
    portText = bracketed[2];
  } else {
    const parts = trimmed.split(':');
    if (parts.length > 2) {
      return { ok: false, reason: 'an IPv6 address goes in brackets, as [::1]:8085' };
    }
    host = parts[0] ?? '';
    portText = parts[1];
  }

  if (!isLhmHost(host)) {
    return { ok: false, reason: 'a host name or address only, with no scheme, path or spaces' };
  }
  if (portText === undefined) return { ok: true, host, port: DEFAULT_LHM_PORT };

  const port = /^\d{1,5}$/.test(portText) ? Number(portText) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return { ok: false, reason: 'the port must be a number from 1 to 65535' };
  }

  return { ok: true, host, port };
}

/** The host in effect: LHM on this machine, or a typed one. */
export type ConnectionChoice =
  | { readonly kind: 'localhost' }
  | { readonly kind: 'remote'; readonly host: string; readonly port: number };

/**
 * The relay request for a choice. Localhost is sent without a port, so the relay uses the LHM port
 * it was configured with (`PERCH_LHM_PORT`, default 8085) rather than one this page guesses.
 */
export function choiceRequest(choice: ConnectionChoice): RelayLhmRequest {
  return choice.kind === 'localhost'
    ? { host: 'localhost' }
    : { host: choice.host, port: choice.port };
}

/** What is remembered: the choice in effect, and whatever is in the host field. */
export interface SavedConnection {
  readonly choice: ConnectionChoice;
  readonly draft: string;
}

export const CONNECTION_STORAGE_KEY = 'perch.editor.connection';

/** The part of `localStorage` this uses, so a test supplies a record. */
export interface ConnectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const FIRST_VISIT: SavedConnection = Object.freeze({
  choice: Object.freeze({ kind: 'localhost' }),
  draft: '',
});

/** The remembered connection, or localhost with an empty field. Never throws. */
export function loadConnection(storage: ConnectionStorage | undefined): SavedConnection {
  let text: string | null;
  try {
    text = storage?.getItem(CONNECTION_STORAGE_KEY) ?? null;
  } catch {
    return FIRST_VISIT;
  }
  if (text === null) return FIRST_VISIT;

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return FIRST_VISIT;
  }
  if (typeof body !== 'object' || body === null) return FIRST_VISIT;

  const { choice, draft } = body as { choice?: unknown; draft?: unknown };
  const saved = typeof draft === 'string' ? draft : '';
  if (typeof choice !== 'object' || choice === null) return FIRST_VISIT;
  const { kind, host, port } = choice as { kind?: unknown; host?: unknown; port?: unknown };

  if (kind === 'localhost') return { choice: { kind: 'localhost' }, draft: saved };
  if (kind === 'remote' && typeof host === 'string' && typeof port === 'number') {
    const parsed = parseHostInput(`${host}:${String(port)}`);
    if (parsed.ok) return { choice: { kind: 'remote', host, port }, draft: saved };
  }

  return FIRST_VISIT;
}

/** Remember a connection. A storage that refuses (a private window, a full quota) is ignored. */
export function saveConnection(
  storage: ConnectionStorage | undefined,
  saved: SavedConnection,
): void {
  try {
    storage?.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Remembering is a convenience; failing to must not break the control.
  }
}

export type ConnectionPhase = 'connecting' | 'connected' | 'disconnected';

export interface ConnectionState {
  readonly phase: ConnectionPhase;
  /** `host:port`, as the relay reported it when it has, else as requested. */
  readonly target: string;
  readonly reason?: string;
}

export interface ConnectionInputs {
  /** The relay's URL, or `undefined` when the stack started none. */
  readonly relayUrl: string | undefined;
  readonly link: 'opening' | 'up' | 'down';
  readonly status: RelayLhmStatus | undefined;
  readonly request: RelayLhmRequest;
  /** The live source's status: whether readings are arriving here. */
  readonly sourceStatus: SensorSourceStatus;
}

export function deriveConnection(inputs: ConnectionInputs): ConnectionState {
  const { relayUrl, link, status, request, sourceStatus } = inputs;
  const requested =
    request.port === undefined ? request.host : `${request.host}:${String(request.port)}`;

  if (relayUrl === undefined) {
    return {
      phase: 'disconnected',
      target: requested,
      reason: 'no relay: npm run dev starts one, unless --no-relay',
    };
  }
  if (link === 'opening') return { phase: 'connecting', target: requested };
  if (link === 'down') {
    return { phase: 'disconnected', target: requested, reason: `relay unreachable at ${relayUrl}` };
  }
  if (status === undefined || !relayStatusMatches(request, status)) {
    return { phase: 'connecting', target: requested };
  }

  const target = `${status.host}:${String(status.port)}`;
  if (status.state === 'failed') {
    return { phase: 'disconnected', target, reason: status.reason ?? 'the poll failed' };
  }
  if (status.state === 'ok' && sourceStatus === 'live') return { phase: 'connected', target };

  return { phase: 'connecting', target };
}
