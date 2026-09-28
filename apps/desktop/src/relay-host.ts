/**
 * The relay, in this process: its configuration, its start, and the URL the page dials.
 *
 * ## Configuration, in precedence order
 *
 * ```text
 * PERCH_* environment variable  >  remembered LHM host (settings)  >  desktop default  >  relay default
 * ```
 *
 * Resolved by the relay's own `resolveRelayConfig`, so every `PERCH_*` variable the CLI reads works
 * here, is validated the same way, and is rejected with the same message. The one desktop default
 * is the bind: **loopback**, where the CLI binds every interface. The runner's only reader is its
 * own window, the broker has no authentication, and a listener on every interface is also what
 * makes macOS ask, on first launch, whether this app may accept incoming connections.
 * `PERCH_BIND_HOST=0.0.0.0` restores the CLI's posture for a panel on another machine.
 *
 * ## Ports
 *
 * The relay's defaults, 1883 and 9001, when free. When something else holds one — a Homebrew
 * Mosquitto, or the dev stack's own relay — the listener takes a free port instead and the page is
 * handed whichever was bound. Nothing here ever dials a broker it did not start.
 */

import {
  RELAY_ENV_VARS,
  resolveRelayConfig,
  startRelayService,
  type LhmEndpoint,
  type RelayConfig,
  type RelayLogger,
  type RelayService,
} from '@perch/agent';
import type { LhmHostSetting } from './settings.js';

/** The desktop's bind default; see the module comment. */
const DESKTOP_BIND_HOST = '127.0.0.1';

/** The relay configuration for this launch. Throws on a malformed `PERCH_*` override. */
export function desktopRelayConfig(
  env: Readonly<Record<string, string | undefined>>,
  remembered: LhmHostSetting | null,
): RelayConfig {
  const layered: Record<string, string | undefined> = {
    [RELAY_ENV_VARS.bindHost]: DESKTOP_BIND_HOST,
    ...(remembered === null
      ? {}
      : {
          [RELAY_ENV_VARS.lhmHost]: remembered.host,
          [RELAY_ENV_VARS.lhmPort]: String(remembered.port),
        }),
  };
  for (const variable of Object.values(RELAY_ENV_VARS)) {
    const value = env[variable];
    if (value !== undefined) layered[variable] = value;
  }

  const resolved = resolveRelayConfig({ env: layered });
  if (resolved.kind !== 'config') {
    throw new Error(
      `the relay configuration was refused: ${resolved.kind === 'invalid' ? resolved.errors.join('; ') : 'help requested'}`,
    );
  }

  return resolved.config;
}

/** The WebSocket URL the page dials for a relay bound to `bindHost`. */
export function pageBrokerUrl(bindHost: string, wsPort: number): string {
  const dial = bindHost === '0.0.0.0' || bindHost === '::' ? '127.0.0.1' : bindHost;
  const host = dial.includes(':') && !dial.startsWith('[') ? `[${dial}]` : dial;

  return `ws://${host}:${String(wsPort)}`;
}

export interface DesktopRelay {
  readonly service: RelayService;
  /** What the page is given. */
  readonly brokerUrl: string;
}

/** Start the relay, stepping around held ports, and report each client retarget. */
export async function startDesktopRelay(
  config: RelayConfig,
  logger: RelayLogger,
  onRetarget: (endpoint: LhmEndpoint) => void,
): Promise<DesktopRelay> {
  const service = await startRelayService({ config, logger, freePortWhenHeld: true, onRetarget });

  return { service, brokerUrl: pageBrokerUrl(config.broker.bindHost, service.wsPort) };
}
