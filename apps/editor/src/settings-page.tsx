/**
 * THE SETTINGS WINDOW: the desktop app's sensor host and colour scheme, picked where each platform
 * keeps settings (the app menu's Settings... on macOS, File > Settings elsewhere, and the tray).
 *
 * The scheme is handed to the main process (`onScheme`), which applies it to Electron's
 * `nativeTheme`: every window's `prefers-color-scheme` follows, and the chrome's palette with it
 * (`controls/chrome.ts`), this window included, without either page storing anything.
 *
 * It is the editor header's connection control, moved and nothing else: the same `ConnectionControl`,
 * the same `useConnection` over the same editor store actions, the same relay control path. What
 * differs is where the choice lives. The store here is in memory, seeded with the host the relay is
 * already polling, so opening Settings moves nothing, and a Connect is remembered by the runner,
 * which saves every host the relay is moved to and resumes with it. Nothing is written to this
 * page's storage, which it shares with the editor window's (both are `app://editor`) and must not
 * overwrite.
 */

import { useState, type ReactNode } from 'react';
import {
  CONNECTION_STYLES,
  ConnectionControl,
  useConnection,
  type RelayLink,
} from './connection-control.js';
import type { ChromeScheme } from './controls/chrome.js';
import { CONTROLS_STYLES, TooltipLayer } from './controls/index.js';
import { EDITOR_STYLES } from './app.js';
import { choiceForRelay, type RelayTarget } from './editor-host.js';
import { SchemeControl } from './header-bar.js';
import { EditorStoreProvider, createEditorStore } from './store.js';

export interface SettingsPageProps {
  /** The in-process relay, or `undefined` if its URL could not be read. */
  readonly relay: RelayLink | undefined;
  /** What the relay polls now. */
  readonly target: RelayTarget;
  /** The windows' colour scheme now. */
  readonly scheme: ChromeScheme;
  /** A scheme picked here, for the app to apply to every window. */
  readonly onScheme: (scheme: ChromeScheme) => void;
}

export function SettingsPage({ relay, target, scheme, onScheme }: SettingsPageProps): ReactNode {
  const [store] = useState(() => {
    const made = createEditorStore();
    made.getState().adoptConnection(choiceForRelay(target));
    return made;
  });

  return (
    <EditorStoreProvider store={store}>
      <div id="perch-settings">
        <style href="perch-editor-controls" precedence="default">
          {CONTROLS_STYLES}
        </style>
        <style href="perch-editor" precedence="default">
          {EDITOR_STYLES}
        </style>
        <style href="perch-editor-connection" precedence="default">
          {CONNECTION_STYLES}
        </style>
        <style href="perch-settings" precedence="default">
          {SETTINGS_STYLES}
        </style>
        <SensorHost relay={relay} />
        <Appearance scheme={scheme} onScheme={onScheme} />
        <TooltipLayer />
      </div>
    </EditorStoreProvider>
  );
}

function SensorHost({ relay }: { readonly relay: RelayLink | undefined }): ReactNode {
  const connection = useConnection(relay);

  return (
    <section className="perch-settings__section" aria-labelledby="perch-settings-sensor-host">
      <h2 className="perch-settings__heading" id="perch-settings-sensor-host">
        Sensor host
      </h2>
      <p className="perch-settings__note">
        The machine running LibreHardwareMonitor. The relay polls it for the preview and the editor,
        and perch remembers it.
      </p>
      <ConnectionControl connection={connection} />
    </section>
  );
}

/**
 * The colour scheme, for every window. Shown at once and handed on: the app applies it, and this
 * window's own chrome changes with the rest.
 */
function Appearance({
  scheme,
  onScheme,
}: {
  readonly scheme: ChromeScheme;
  readonly onScheme: (scheme: ChromeScheme) => void;
}): ReactNode {
  const [shown, setShown] = useState(scheme);

  return (
    <section className="perch-settings__section" aria-labelledby="perch-settings-appearance">
      <h2 className="perch-settings__heading" id="perch-settings-appearance">
        Appearance
      </h2>
      <p className="perch-settings__note">
        The colours of every perch window. System follows the operating system. The colours a layout
        sets never change with it.
      </p>
      <div className="perch-settings__scheme">
        <SchemeControl
          value={shown}
          onValue={(value) => {
            setShown(value);
            onScheme(value);
          }}
        />
      </div>
    </section>
  );
}

/** The window's own chrome: the editor header's palette, a little room, the status on its own line. */
export const SETTINGS_STYLES = `
#perch-settings {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 16px 18px;
  background: var(--ed-header);
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 0.75rem;
  color: var(--ed-header-text);
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.perch-settings__section { display: flex; flex-direction: column; gap: 8px; }
.perch-settings__scheme { display: flex; width: 220px; }
.perch-settings__heading { margin: 0; font-size: 0.8125rem; font-weight: 600; color: var(--ed-text); }
.perch-settings__note { margin: 0 0 4px; line-height: 1.4; }
#perch-settings .perch-connection { flex-wrap: wrap; row-gap: 10px; }
#perch-settings .perch-connection__host { flex: 1 1 150px; }
#perch-settings .perch-connection__status { flex-basis: 100%; max-width: none; white-space: normal; }
`;
