/**
 * The editor window's preload: the whole of what the editor page can ask of this app.
 *
 * ```ts
 * window.perchEditorHost.load()                   // -> relay, poll target, documents, first one
 * window.perchEditorHost.save(url, body)          // -> { ok, status, text }, as the dev server answers
 * window.perchEditorHost.saveAs(suggested)        // -> { name, path } | null, after a native dialog
 * window.perchEditorHost.open()                   // -> a document | null, after a native dialog
 * window.perchEditorHost.setDocumentState(state)  // { name, dirty }: title, edited mark, close prompt
 * window.perchEditorHost.setMenuBindings(record)  // what the menu shows
 * window.perchEditorHost.nativeEdit(which)        // 'undo' | 'redo' in the focused field
 * window.perchEditorHost.saveDone(id, saved)      // a save request's answer
 * window.perchEditorHost.setMenuState(state)      // { undo, redo, save, saveAs }: what the menu enables
 * window.perchEditorHost.openSettings()           // the Settings window
 * window.perchEditorHost.onDocuments(fn) / onCommand(fn) / onSaveRequest(fn) / onOpenDocument(fn)
 *                                                 // -> unsubscribe
 * ```
 *
 * The page never names a file. A save names a document by the key the main process gave it, and
 * the main process maps the key to a path; the dialogs are the main process's own. Every argument is
 * passed on as given and checked there. The IPC event object never reaches the page, only payloads.
 *
 * `.cts` and self-contained for the reason `runtime-preload.cts` gives: a sandboxed preload is a
 * CommonJS script whose `require` knows `electron` and nothing else. The channel names restate
 * `editor-channels.ts`; `editor-preload.test.ts` pins them.
 */

import type { ContextBridge, IpcRenderer } from 'electron';

// See `runtime-preload.cts` for why this is a typed `require` rather than an import.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron') as {
  readonly contextBridge: ContextBridge;
  readonly ipcRenderer: IpcRenderer;
};

const BRIDGE_GLOBAL = 'perchEditorHost';
const CHANNELS = {
  load: 'perch:editor:load',
  save: 'perch:editor:save',
  saveAs: 'perch:editor:save-as',
  open: 'perch:editor:open',
  documentState: 'perch:editor:document-state',
  menuBindings: 'perch:editor:menu-bindings',
  nativeEdit: 'perch:editor:native-edit',
  saveDone: 'perch:editor:save-done',
  menuState: 'perch:editor:menu-state',
  openSettings: 'perch:editor:open-settings',
  documents: 'perch:editor:documents',
  command: 'perch:editor:command',
  saveRequest: 'perch:editor:save-request',
  openDocument: 'perch:editor:open-document',
} as const;

/** Subscribe `listener` to `channel`'s payload, without the event; returns the unsubscribe. */
function subscribe(channel: string, listener: (payload: unknown) => void): () => void {
  const forward = (_event: unknown, payload: unknown): void => {
    listener(payload);
  };
  ipcRenderer.on(channel, forward);
  return () => {
    ipcRenderer.removeListener(channel, forward);
  };
}

contextBridge.exposeInMainWorld(BRIDGE_GLOBAL, {
  load: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.load),
  save: (url: unknown, body: unknown): Promise<unknown> =>
    ipcRenderer.invoke(CHANNELS.save, url, body),
  saveAs: (suggested: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.saveAs, suggested),
  open: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.open),
  setDocumentState: (state: unknown): void => {
    ipcRenderer.send(CHANNELS.documentState, state);
  },
  setMenuBindings: (bindings: unknown): void => {
    ipcRenderer.send(CHANNELS.menuBindings, bindings);
  },
  nativeEdit: (which: unknown): void => {
    ipcRenderer.send(CHANNELS.nativeEdit, which);
  },
  saveDone: (id: unknown, saved: unknown): void => {
    ipcRenderer.send(CHANNELS.saveDone, id, saved);
  },
  setMenuState: (state: unknown): void => {
    ipcRenderer.send(CHANNELS.menuState, state);
  },
  openSettings: (): void => {
    ipcRenderer.send(CHANNELS.openSettings);
  },
  onDocuments: (listener: (documents: unknown) => void): (() => void) =>
    subscribe(CHANNELS.documents, listener),
  onCommand: (listener: (id: unknown) => void): (() => void) =>
    subscribe(CHANNELS.command, listener),
  onSaveRequest: (listener: (id: unknown) => void): (() => void) =>
    subscribe(CHANNELS.saveRequest, listener),
  onOpenDocument: (listener: (document: unknown) => void): (() => void) =>
    subscribe(CHANNELS.openDocument, listener),
});
