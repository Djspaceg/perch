/**
 * The LHM host the relay is polling, as the editor window is told it at start.
 *
 * The runner's relay has one poll target at a time, and it is the runner's settings that remember it
 * (`settings.ts`, written by `runner.ts` whenever a client retargets the relay). The editor's
 * connection control asks the relay for a host as soon as it mounts, so it has to start on the host
 * already being polled: otherwise opening the editor would retarget the runner to whatever the editor
 * last had in its own settings. `defaultPort` lets the editor tell the relay's own default (its
 * localhost radio, which sends no port) from a host that happens to be `localhost` on another port.
 */

import type { RelayService } from '@perch/agent';

export interface RelayTarget {
  readonly host: string;
  readonly port: number;
  /** The port a bare `{ "host": "localhost" }` request means: the relay's configured LHM port. */
  readonly defaultPort: number;
}

export function relayTarget(service: Pick<RelayService, 'control' | 'config'>): RelayTarget {
  const { host, port } = service.control.endpoint;

  return { host, port, defaultPort: service.config.lhm.port };
}
