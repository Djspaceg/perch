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
 * - The choice in effect and the typed text are remembered in `localStorage`, and the remembered
 *   choice is asked for again on the next load.
 *
 * The state lives in `useConnection`, above the sensor provider, because it decides which source the
 * preview reads: the relay's once connected, the mock until then (see `app.tsx`).
 */

import type { SensorSource } from '@perch/sensor-contract';
import type { RelayControl } from '@perch/sensor-sources';
import { useEffect, useReducer, useState, type ReactNode } from 'react';
import {
  choiceRequest,
  deriveConnection,
  loadConnection,
  parseHostInput,
  saveConnection,
  type ConnectionState,
  type ConnectionStorage,
  type HostInput,
  type SavedConnection,
} from './connection.js';

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
  readonly mode: 'localhost' | 'remote';
  readonly draft: string;
  readonly parsed: HostInput;
  readonly state: ConnectionState;
  readonly canConnect: boolean;
  selectLocalhost(): void;
  selectRemote(): void;
  setDraft(text: string): void;
  connect(): void;
}

export function useConnection(
  relay: RelayLink | undefined,
  storage: ConnectionStorage | undefined,
): Connection {
  const [saved, setSaved] = useState<SavedConnection>(() => loadConnection(storage));
  const [mode, setMode] = useState<'localhost' | 'remote'>(() => saved.choice.kind);
  const [, recheck] = useReducer((count: number) => count + 1, 0);

  const remember = (next: SavedConnection): void => {
    setSaved(next);
    saveConnection(storage, next);
  };

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
    relay?.control.request(choiceRequest(choice));
  }, [relay, choice]);

  const state = deriveConnection({
    relayUrl: relay?.url,
    link: relay?.control.link ?? 'down',
    status: relay?.control.status,
    request: choiceRequest(choice),
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
    selectLocalhost: () => {
      setMode('localhost');
      remember({ choice: { kind: 'localhost' }, draft: saved.draft });
    },
    selectRemote: () => {
      setMode('remote');
    },
    setDraft: (text) => {
      remember({ choice, draft: text });
    },
    connect: () => {
      if (!parsed.ok) return;
      remember({
        choice: { kind: 'remote', host: parsed.host, port: parsed.port },
        draft: saved.draft,
      });
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
