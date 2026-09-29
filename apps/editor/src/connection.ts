/**
 * Which sensor host the editor reads, as data: the typed host, what a remembered one must look like,
 * and which of connecting / connected / disconnected the editor is in. Remembering it is the editor
 * store's (`store.ts`).
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

/**
 * The request a window that only follows the relay compares against: whatever the relay reports
 * polling, once it has reported, else `fallback`. The desktop editor's header indicator follows, so a
 * host chosen in the Settings window, or by any other client, is what it describes.
 */
export function followedRequest(
  status: RelayLhmStatus | undefined,
  fallback: RelayLhmRequest,
): RelayLhmRequest {
  return status === undefined ? fallback : { host: status.host, port: status.port };
}

/** What is remembered: the choice in effect, and whatever is in the host field. */
export interface SavedConnection {
  readonly choice: ConnectionChoice;
  readonly draft: string;
}

/**
 * Where the connection control kept its choice before the editor store (`store.ts`) held it. The
 * store reads it once, on the first load that finds no store of its own, and never writes it.
 */
export const CONNECTION_STORAGE_KEY = 'perch.editor.connection';

/**
 * A remembered connection read back from storage, or `undefined` when `body` is not one: a choice
 * of localhost, or of a host and port `parseHostInput` accepts, and the field's text.
 */
export function readSavedConnection(body: unknown): SavedConnection | undefined {
  if (typeof body !== 'object' || body === null) return undefined;

  const { choice, draft } = body as { choice?: unknown; draft?: unknown };
  const saved = typeof draft === 'string' ? draft : '';
  if (typeof choice !== 'object' || choice === null) return undefined;
  const { kind, host, port } = choice as { kind?: unknown; host?: unknown; port?: unknown };

  if (kind === 'localhost') return { choice: { kind: 'localhost' }, draft: saved };
  if (kind === 'remote' && typeof host === 'string' && typeof port === 'number') {
    const parsed = parseHostInput(`${host}:${String(port)}`);
    if (parsed.ok) return { choice: { kind: 'remote', host, port }, draft: saved };
  }

  return undefined;
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
