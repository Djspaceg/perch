/**
 * The Settings window's preload: the whole of what its page can ask of this app, which is one thing.
 *
 * ```ts
 * window.perchSettingsHost.load()   // -> { brokerUrl, relay }: the relay to dial, what it polls
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

contextBridge.exposeInMainWorld(BRIDGE_GLOBAL, {
  load: (): Promise<unknown> => ipcRenderer.invoke(LOAD_CHANNEL),
});
