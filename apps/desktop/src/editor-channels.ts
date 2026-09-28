/**
 * The names the editor window's main process side and its preload agree on.
 *
 * Restated in `editor-preload.cts`, which cannot import this file for the reason the runner's
 * preload cannot (see `runner-channels.ts`), and pinned there by `editor-preload.test.ts`. The page
 * restates the global's name in `apps/editor/src/desktop-host.ts`.
 */

/** The `window` property the editor preload exposes. Not the runner's, so neither page mistakes the other's. */
export const EDITOR_BRIDGE_GLOBAL = 'perchEditorHost';

export const EDITOR_CHANNELS = {
  /** Invoked once at start: the relay, its poll target, the documents, the one to open first. */
  load: 'perch:editor:load',
  /** Invoked with a save URL and a body; answered like the dev server's endpoint. */
  save: 'perch:editor:save',
  /** Invoked with a suggested name; shows the Save As dialog, answers the registered document. */
  saveAs: 'perch:editor:save-as',
  /** Invoked; shows the Open dialog, answers the chosen document. */
  open: 'perch:editor:open',
  /** Sent by the page: the open document's name and whether it is dirty. */
  documentState: 'perch:editor:document-state',
  /** Sent by the page: the bindings the menu should show. */
  menuBindings: 'perch:editor:menu-bindings',
  /** Sent by the page: do the platform's undo or redo in the focused field. */
  nativeEdit: 'perch:editor:native-edit',
  /** Sent by the page: a save request's answer. */
  saveDone: 'perch:editor:save-done',
  /** Sent to the page: the documents, whenever they change. */
  documents: 'perch:editor:documents',
  /** Sent to the page: the menu ran a command. */
  command: 'perch:editor:command',
  /** Sent to the page: save before closing, then answer. */
  saveRequest: 'perch:editor:save-request',
} as const;
