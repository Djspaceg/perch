/**
 * The connection control in the header: `( ) localhost  ( ) host [ 192.168.1.3 ] [connect]`, and a
 * status label saying connecting, connected or disconnected — with the relay's reason when it has
 * one, `EHOSTUNREACH` being the usual.
 *
 * - **localhost** is the default and takes effect the moment it is picked: there is nothing to type,
 *   so there is no button. The field and Connect are disabled while it is selected.
 * - **host** enables the field. Connect is enabled for a valid `host` or `host:port` (default port
 *   8085), disabled while connecting to or connected to that same host, and enabled again once the
 *   connection is lost — so "Connect is available" and "not connected to what you typed" are one fact.
 * - The radio, the choice in effect and the typed text are the editor store's settings (`store.ts`),
 *   so they are remembered in `localStorage`, and the remembered choice is asked for again on the next
 *   load.
 *
 * `useConnection` reads them above the sensor provider, because the connection decides which source
 * the preview reads: the relay's once connected, the mock until then (see `app.tsx`).
 *
 * ## In the desktop app
 *
 * The control lives in the Settings window (`settings-page.tsx`), and the editor's header shows
 * `ConnectionIndicator` instead: a dot and a few words that open Settings. The editor window then
 * *follows* the relay (`useConnection(relay, { follow: true })`): it asks the relay for nothing and
 * describes whatever the relay reports polling, so a host picked in Settings is what its header says.
 */

import type { SensorSource } from '@perch/sensor-contract';
import type { RelayControl } from '@perch/sensor-sources';
import { useEffect, useReducer, type ReactNode } from 'react';
import {
  choiceRequest,
  deriveConnection,
  followedRequest,
  parseHostInput,
  type ConnectionState,
  type HostInput,
} from './connection.js';
import { useEditorStore, type ConnectionMode } from './store.js';

/** The relay this editor was started against: its URL, its live source and its control path. */
export interface RelayLink {
  readonly url: string;
  /** The relay's readings, as a sensor source. What the preview paints once connected. */
  readonly source: SensorSource;
  readonly control: Pick<RelayControl, 'link' | 'status' | 'request' | 'onChange'>;
}

/**
 * How often the label re-reads the live source's status. `SensorSource.status` is a getter with no
 * change event — "read it; never cache it" — so the only way to notice readings starting or stopping
 * is to look. Twice a second is well inside the relay's 1 Hz poll.
 */
const STATUS_RECHECK_MS = 500;

export interface Connection {
  readonly mode: ConnectionMode;
  readonly draft: string;
  readonly parsed: HostInput;
  readonly state: ConnectionState;
  readonly canConnect: boolean;
  selectLocalhost(): void;
  selectRemote(): void;
  setDraft(text: string): void;
  connect(): void;
}

export interface ConnectionOptions {
  /** Ask the relay for nothing, and describe what it reports polling (`followedRequest`). */
  readonly follow?: boolean;
}

export function useConnection(
  relay: RelayLink | undefined,
  options: ConnectionOptions = {},
): Connection {
  const follow = options.follow === true;
  const saved = useEditorStore((state) => state.settings.connection);
  const selectLocalhost = useEditorStore((state) => state.selectLocalhost);
  const selectRemote = useEditorStore((state) => state.selectRemote);
  const setConnectionHost = useEditorStore((state) => state.setConnectionHost);
  const connectTo = useEditorStore((state) => state.connectTo);
  const [, recheck] = useReducer((count: number) => count + 1, 0);
  const { mode } = saved;

  useEffect(() => {
    if (relay === undefined) return undefined;
    const stop = relay.control.onChange(recheck);
    const timer = setInterval(recheck, STATUS_RECHECK_MS);

    return () => {
      stop();
      clearInterval(timer);
    };
  }, [relay]);

  // Asked for whenever the choice in effect changes, on first render included: that is how
  // localhost connects on selection and how a remembered host reconnects on load.
  const { choice } = saved;
  useEffect(() => {
    if (!follow) relay?.control.request(choiceRequest(choice));
  }, [relay, choice, follow]);

  const status = relay?.control.status;
  const state = deriveConnection({
    relayUrl: relay?.url,
    link: relay?.control.link ?? 'down',
    status,
    request: follow ? followedRequest(status, choiceRequest(choice)) : choiceRequest(choice),
    sourceStatus: relay?.source.status ?? 'error',
  });

  const parsed = parseHostInput(saved.draft);
  const alreadyThere =
    parsed.ok &&
    choice.kind === 'remote' &&
    choice.host === parsed.host &&
    choice.port === parsed.port &&
    state.phase !== 'disconnected';

  return {
    mode,
    draft: saved.draft,
    parsed,
    state,
    canConnect: mode === 'remote' && parsed.ok && !alreadyThere,
    selectLocalhost,
    selectRemote,
    setDraft: setConnectionHost,
    connect: () => {
      if (!parsed.ok) return;
      connectTo(parsed.host, parsed.port);
    },
  };
}

/** The words the label shows for a state. */
function describeState(state: ConnectionState): string {
  return [state.phase, state.target, state.reason].filter((part) => part !== undefined).join(' · ');
}

export function ConnectionControl({ connection }: { readonly connection: Connection }): ReactNode {
  const { mode, draft, parsed, state, canConnect } = connection;
  const invalid = mode === 'remote' && draft.trim().length > 0 && !parsed.ok;
  const words = describeState(state);

  return (
    <div
      className="perch-connection"
      role="group"
      aria-label="sensor host connection"
      data-testid="perch-editor-connection"
    >
      <label className="perch-connection__option">
        <input
          type="radio"
          name="perch-sensor-host"
          className="perch-connection__radio"
          checked={mode === 'localhost'}
          onChange={() => {
            connection.selectLocalhost();
          }}
        />
        localhost
      </label>
      <label className="perch-connection__option">
        <input
          type="radio"
          name="perch-sensor-host"
          className="perch-connection__radio"
          checked={mode === 'remote'}
          onChange={() => {
            connection.selectRemote();
          }}
        />
        host
      </label>
      <input
        type="text"
        className="perch-input perch-input--mono perch-connection__host"
        aria-label="sensor host"
        placeholder="192.168.1.3:8085"
        spellCheck={false}
        autoComplete="off"
        disabled={mode !== 'remote'}
        value={draft}
        aria-invalid={invalid ? 'true' : 'false'}
        title={!parsed.ok && invalid ? parsed.reason : 'a host, or host:port (8085 if omitted)'}
        onChange={(event) => {
          connection.setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && canConnect) connection.connect();
        }}
      />
      <button
        type="button"
        className="perch-editor-button perch-connection__connect"
        disabled={!canConnect}
        onClick={() => {
          connection.connect();
        }}
      >
        connect
      </button>
      <span
        className="perch-connection__status"
        data-testid="perch-editor-connection-status"
        data-perch-connection={state.phase}
        role="status"
        title={words}
      >
        <span className="perch-connection__dot" aria-hidden="true" />
        {words}
      </span>
    </div>
  );
}

/**
 * The desktop editor's header: the connection as a dot and its phase and host, the relay's reason in
 * the tooltip, and a click away from the Settings window that changes it.
 */
export function ConnectionIndicator({
  connection,
  onOpenSettings,
}: {
  readonly connection: Connection;
  readonly onOpenSettings: () => void;
}): ReactNode {
  const { state } = connection;

  return (
    <button
      type="button"
      className="perch-connection__status perch-connection__indicator"
      data-testid="perch-editor-connection-indicator"
      data-perch-connection={state.phase}
      title={`${describeState(state)}. Change the sensor host in Settings.`}
      onClick={onOpenSettings}
    >
      <span className="perch-connection__dot" aria-hidden="true" />
      {`${state.phase} · ${state.target}`}
    </button>
  );
}

/** The control's chrome: the header's own look, the sidebar's field and focus ring. */
export const CONNECTION_STYLES = `
.perch-connection { display: flex; align-items: center; gap: 6px; min-width: 0; }
.perch-connection__option { display: flex; align-items: center; gap: 4px; white-space: nowrap; cursor: pointer; }
.perch-connection__radio { margin: 0; accent-color: var(--ed-accent); cursor: pointer; }
.perch-connection__radio:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 1px; }
.perch-connection__host { flex: none; width: 150px; }
.perch-connection__host:disabled { color: var(--ed-faint); border-color: var(--ed-bar-edge); cursor: not-allowed; }
.perch-connection__host[aria-invalid='true'] { border-color: var(--ed-danger); }
.perch-connection__connect:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 0; }
.perch-connection__connect:not(:disabled) { border-color: var(--ed-accent-fill); color: var(--ed-accent); }
.perch-connection__status {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ed-text-2);
}
.perch-connection__dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--ed-faint); }
[data-perch-connection='connecting'] > .perch-connection__dot { background: var(--ed-inherited); }
[data-perch-connection='connected'] > .perch-connection__dot { background: #7ee2a8; }
[data-perch-connection='disconnected'] > .perch-connection__dot { background: var(--ed-danger); }
[data-perch-connection='disconnected'] { color: var(--ed-danger); }
.perch-connection__indicator {
  border: 1px solid transparent;
  border-radius: 3px;
  background: none;
  font: inherit;
  padding: 2px 6px;
  cursor: pointer;
}
.perch-connection__indicator:hover { border-color: var(--ed-bar-edge); }
.perch-connection__indicator:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 0; }
.perch-editor-sample {
  white-space: nowrap;
  border-radius: 999px;
  border: 1px solid #5e4a23;
  background: #261e10;
  color: #e8c98f;
  padding: 1px 8px;
  font-weight: 600;
}
.perch-editor-live { white-space: nowrap; color: #7ee2a8; }
`;
