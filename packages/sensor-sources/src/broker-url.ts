/**
 * Where the broker is: environment variable, then a config file beside the bundle, then the
 * default in `relay-endpoint.ts`. That order is settled — see DECISIONS.md, "The mqtt source".
 *
 * ## Why the order is what it is
 *
 * The default is the weakest claim in the system. `relay-endpoint.ts` hard-codes
 * `ws://localhost:9001`, and on a developer machine that port is frequently already taken by
 * *some* broker — a Homebrew mosquitto listening on `0.0.0.0:9001` with anonymous access is
 * the observed case, not a hypothetical. Connecting to it succeeds, subscribes succeed, and
 * nothing ever arrives, because it is not the broker perch's relay is publishing to. A source
 * that cannot say which of the three inputs it used cannot tell you that has happened, so
 * `resolveBrokerUrl` returns the `origin` alongside the URL and the source logs a warning
 * whenever it fell all the way through to the default.
 *
 * ## Why an explicit override that is malformed throws
 *
 * Falling through to the default on a bad env var would reproduce exactly the failure this
 * module exists to prevent: the operator believes they pointed the dashboard at one broker,
 * and it silently connected to another. An override is a statement of intent, so a malformed
 * one is an error with the variable's name in it. An *absent* config file is not an error —
 * absence is the normal case for a bundle that has not been configured yet.
 *
 * Nothing here imports a Node built-in: the resolution runs in the browser, where the config
 * file is fetched and there is no `process`. `readProcessEnv` reaches for `globalThis.process`
 * structurally so that the same function is correct in both places.
 */

import { relayWebSocketUrl } from './relay-endpoint.js';

/** The environment variable read first, matching `apps/agent`'s `PERCH_*` convention. */
export const RELAY_BROKER_URL_ENV_VAR = 'PERCH_BROKER_URL';

/**
 * The config file's name. ARCHITECTURE.md's assumption is a runtime config file *beside the
 * bundle*, read at load time rather than baked in at build time, so one bundle runs against
 * several machines. The name lives here because this is the module that reads it.
 */
export const RELAY_CONFIG_FILENAME = 'perch-relay.json';

/** The default relative URL the config file is fetched from: beside the bundle. */
export const RELAY_CONFIG_URL = `./${RELAY_CONFIG_FILENAME}`;

/**
 * The one field of the runtime config this package cares about.
 *
 * Deliberately not a closed shape: the same file is the natural home for other runtime
 * settings owned by other packages, and a guard here that rejected unknown keys would make
 * adding one a change in two places. This module reads its own field and ignores the rest.
 */
export interface RelayBrokerConfig {
  brokerUrl?: string;
}

/** The three inputs, so a caller can report which one actually decided. */
export type BrokerUrlOrigin = 'env' | 'config' | 'default';

export interface ResolvedBrokerUrl {
  readonly url: string;
  readonly origin: BrokerUrlOrigin;
}

/**
 * An options bag, so every member is `?: T | undefined` and reads through a destructuring
 * default — the same convention `MockSourceOptions` follows, and for the same reason.
 */
export interface BrokerUrlSources {
  /** Usually `readProcessEnv()`. Injected so a test needs no real environment. */
  env?: Readonly<Record<string, string | undefined>> | undefined;
  /** The parsed config file beside the bundle, or `undefined` if there is none. */
  config?: RelayBrokerConfig | undefined;
}

/**
 * The minimum of `fetch` this module uses, rather than the DOM's `fetch` type.
 *
 * Structural on purpose: a test satisfies it with four lines and no `jsdom`, and `apps/agent`
 * could satisfy it with Node's `fetch` without either side importing the other's lib.
 */
export type FetchLike = (
  url: string,
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

/**
 * Whether `value` is a broker URL this source can actually dial.
 *
 * `ws:` and `wss:` only. A `mqtt://` URL is a real MQTT URL but not a *browser* one, and
 * accepting it here would produce a connection that works in a test under Node and fails on
 * the panel — so it is rejected with the rest. A path is allowed: Mosquitto's websockets
 * listener serves `/`, and other brokers serve `/mqtt`.
 */
export function isRelayBrokerUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return false;

  return parsed.hostname.length > 0;
}

/** Whether a decoded config body carries a usable `brokerUrl`, or none at all. */
export function isRelayBrokerConfig(candidate: unknown): candidate is RelayBrokerConfig {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return false;
  }

  const { brokerUrl } = candidate as Partial<RelayBrokerConfig>;

  return brokerUrl === undefined || typeof brokerUrl === 'string';
}

/**
 * Resolve the broker URL, and say which input decided it.
 *
 * Throws `TypeError` on a *present* override that is not a `ws:`/`wss:` URL. See the module
 * comment: silently ignoring one is the failure this module exists to prevent.
 */
export function resolveBrokerUrl(sources: BrokerUrlSources = {}): ResolvedBrokerUrl {
  const { env, config } = sources;

  const fromEnv = trimmedOrUndefined(env?.[RELAY_BROKER_URL_ENV_VAR]);
  if (fromEnv !== undefined) {
    return {
      url: checkOverride(fromEnv, `${RELAY_BROKER_URL_ENV_VAR} (environment)`),
      origin: 'env',
    };
  }

  const fromConfig = trimmedOrUndefined(config?.brokerUrl);
  if (fromConfig !== undefined) {
    return {
      url: checkOverride(fromConfig, `brokerUrl (${RELAY_CONFIG_FILENAME})`),
      origin: 'config',
    };
  }

  return { url: relayWebSocketUrl(), origin: 'default' };
}

/**
 * The process environment where there is one, an empty record where there is not.
 *
 * Reached structurally rather than through `@types/node`, because this package's tsconfig
 * withholds the Node types on purpose: the shared path runs in a browser. A browser has no
 * `process`, and this returns `{}` there rather than throwing.
 */
export function readProcessEnv(): Readonly<Record<string, string | undefined>> {
  const host = globalThis as { process?: { env?: Record<string, string | undefined> } };
  const env = host.process?.env;

  return env ?? {};
}

/**
 * Fetch and validate the config file beside the bundle.
 *
 * `undefined` means "there is no config file" — a 404, or a `file://` fetch that rejects.
 * That is a normal state, not an error: the default and the env var both still apply.
 *
 * Throws `SyntaxError` (from `JSON.parse`) or `TypeError` when the file *is* there and is
 * unusable. A config file someone wrote and got wrong must not be silently skipped.
 */
export async function loadRelayBrokerConfig(
  fetchLike: FetchLike,
  url: string = RELAY_CONFIG_URL,
): Promise<RelayBrokerConfig | undefined> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchLike(url);
  } catch {
    // No server, or `file://` where fetch is not permitted. Absence, not misconfiguration.
    return undefined;
  }

  if (!response.ok) {
    if (response.status === 404) return undefined;
    throw new TypeError(`${url} responded ${response.status}; expected a ${RELAY_CONFIG_FILENAME}`);
  }

  const body: unknown = await response.json();
  if (!isRelayBrokerConfig(body)) {
    throw new TypeError(
      `${url} is not a valid ${RELAY_CONFIG_FILENAME}: brokerUrl must be a string`,
    );
  }

  return body;
}

/**
 * Resolve the broker URL the way a browser bundle does: env first (there is none in a
 * browser, but there is under Node and in the dev harness), then the file beside the bundle,
 * then the default.
 *
 * Kept separate from `resolveBrokerUrl` because that one is synchronous and pure, which is
 * what makes it testable without a fetch. This is the four-line composition on top.
 */
export async function resolveBrokerUrlAsync(
  fetchLike: FetchLike,
  url: string = RELAY_CONFIG_URL,
): Promise<ResolvedBrokerUrl> {
  const env = readProcessEnv();
  const fromEnv = trimmedOrUndefined(env[RELAY_BROKER_URL_ENV_VAR]);

  // Do not fetch when the environment already decided: a request that cannot change the
  // answer is a request that can only fail confusingly.
  if (fromEnv !== undefined) return resolveBrokerUrl({ env });

  const config = await loadRelayBrokerConfig(fetchLike, url);

  return resolveBrokerUrl({ env, config });
}

function checkOverride(value: string, source: string): string {
  if (!isRelayBrokerUrl(value)) {
    throw new TypeError(
      `${source} is not a ws:// or wss:// broker URL: ${JSON.stringify(value)}. ` +
        `Leaving it unset falls back to ${relayWebSocketUrl()}, which on a developer machine ` +
        `is frequently a different broker than the relay's.`,
    );
  }

  return value;
}

/** `''` and `'   '` are not overrides. An empty variable is how a shell spells "unset". */
function trimmedOrUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();

  return trimmed.length === 0 ? undefined : trimmed;
}
