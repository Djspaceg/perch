/**
 * The runner window's preload: the whole of what the runtime page can ask of this app.
 *
 * ```ts
 * window.perchDesktop.load()            // -> { brokerUrl, document }
 * window.perchDesktop.onDocument(fn)    // fn(document) on every change on disk; returns unsubscribe
 * window.perchDesktop.ensureBackground(ref, target)  // -> { ok, url } | { ok: false, code, reason }
 * ```
 *
 * Three functions. The first two take nothing from the page; the third takes a background reference
 * and a target size, which the main process checks, so the page still cannot name a file, a
 * channel or a URL. The IPC event object never reaches it either — only the payload — so no `sender` or
 * `ports` leak through the bridge.
 *
 * ## Why this file is `.cts`, and self-contained
 *
 * The window is sandboxed, and a sandboxed preload runs as a plain CommonJS script whose `require`
 * knows `electron` (and a few polyfills) and nothing else: no relative files, no ES modules. So
 * this compiles to `runtime-preload.cjs`, requires nothing but `electron`, and restates the strings in
 * `runner-channels.ts`; `runtime-preload.test.ts` runs it against those constants so they cannot
 * drift.
 */

import type { ContextBridge, IpcRenderer } from 'electron';

// A sandboxed preload has no `import` at run time, and `import x = require()` is not erasable
// syntax, which this repo's compiler settings forbid. So the module is required, and typed by the
// type-only import above, which compiles to nothing.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron') as {
  readonly contextBridge: ContextBridge;
  readonly ipcRenderer: IpcRenderer;
};

const BRIDGE_GLOBAL = 'perchDesktop';
const LOAD_CHANNEL = 'perch:runner:load';
const DOCUMENT_CHANNEL = 'perch:runner:document';
const BACKGROUND_CHANNEL = 'perch:runner:background';

contextBridge.exposeInMainWorld(BRIDGE_GLOBAL, {
  load: (): Promise<unknown> => ipcRenderer.invoke(LOAD_CHANNEL),
  ensureBackground: (ref: unknown, target: unknown): Promise<unknown> =>
    ipcRenderer.invoke(BACKGROUND_CHANNEL, ref, target),
  onDocument: (listener: (document: unknown) => void): (() => void) => {
    const forward = (_event: unknown, document: unknown): void => {
      listener(document);
    };
    ipcRenderer.on(DOCUMENT_CHANNEL, forward);
    return () => {
      ipcRenderer.removeListener(DOCUMENT_CHANNEL, forward);
    };
  },
});
