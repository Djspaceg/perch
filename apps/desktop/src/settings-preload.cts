/**
 * The Settings window's preload: the whole of what its page can ask of this app, which is two things.
 *
 * ```ts
 * window.perchSettingsHost.load()            // -> { brokerUrl, relay, scheme }
 * window.perchSettingsHost.setScheme(scheme)  // the windows' colour scheme; main checks the value
 * ```
 *
 * Everything else the page does, it does over the relay's own control path, as the editor's
 * connection control does; the runner saves the host the relay is moved to. `.cts` and
 * self-contained for the reason `runtime-preload.cts` gives. The channel restates
 * `settings-channels.ts`; `settings-preload.test.ts` pins it.
 */

import type { ContextBridge, IpcRenderer } from 'electron';

// See `runtime-preload.cts` for why this is a typed `require` rather than an import.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron') as {
  readonly contextBridge: ContextBridge;
  readonly ipcRenderer: IpcRenderer;
};

const BRIDGE_GLOBAL = 'perchSettingsHost';
const LOAD_CHANNEL = 'perch:settings:load';
const SCHEME_CHANNEL = 'perch:settings:scheme';

contextBridge.exposeInMainWorld(BRIDGE_GLOBAL, {
  load: (): Promise<unknown> => ipcRenderer.invoke(LOAD_CHANNEL),
  setScheme: (scheme: unknown): Promise<unknown> => ipcRenderer.invoke(SCHEME_CHANNEL, scheme),
});
