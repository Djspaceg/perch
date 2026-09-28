/**
 * The page, hosted by the desktop app's editor window: the documents in its layouts folder instead of
 * the bundled library, the in-process relay instead of `PERCH_RELAY_URL`, and the main process as the
 * thing a save is written by.
 *
 * The window's preload puts a bridge on `window.perchEditorHost`. In a browser there is none and
 * `main.tsx` takes exactly the path it always took. When there is, the bridge is turned into the
 * inputs `Editor` already takes — a `LayoutLibrary`, a `SaveTransport`, a relay URL — plus the
 * `EditorHost` (`editor-host.ts`) for what a browser cannot do. The page never names a file: a save
 * names a document by the key the main process gave it, and the main process maps the key to a path.
 *
 * The bridge's shape is restated here rather than imported: `apps/desktop` is an app, and nothing
 * imports an app. `EDITOR_BRIDGE_GLOBAL` and the method names are pinned on the desktop side by its
 * preload test.
 */

import type { EditorHost, MenuBindings, RelayTarget } from './editor-host.js';
import {
  createLayoutLibrary,
  type LayoutLibrary,
  type LayoutLibraryEntry,
} from './layout-library.js';
import type { SaveTransport } from './save.js';

/** The `window` property the editor window's preload exposes. Not the runner's `perchDesktop`. */
export const EDITOR_BRIDGE_GLOBAL = 'perchEditorHost';

/** One layout document as the main process hands it over. */
export interface DesktopEditorDocument {
  /** The key the page calls it by: its name in the picker and in a save's URL. */
  readonly name: string;
  readonly path: string;
  readonly text: string;
  /** Each media `src` beside the document, mapped to the URL that serves it. */
  readonly assets: Readonly<Record<string, string>>;
}

export interface DesktopEditorStart {
  /** The in-process relay's WebSocket URL. */
  readonly brokerUrl: string;
  /** What the relay is polling, so the connection control starts there. */
  readonly relay: RelayTarget;
  readonly documents: readonly DesktopEditorDocument[];
  /** The runner's open document, which the editor opens first, or `null`. */
  readonly initial: string | null;
}

export interface EditorBridge {
  load(): Promise<DesktopEditorStart>;
  onDocuments(listener: (documents: readonly DesktopEditorDocument[]) => void): () => void;
  save(
    url: string,
    body: string,
  ): Promise<{ readonly ok: boolean; readonly status: number; readonly text: string }>;
  saveAs(suggested: string): Promise<{ readonly name: string; readonly path: string } | null>;
  open(): Promise<DesktopEditorDocument | null>;
  setDocumentState(state: { readonly name: string; readonly dirty: boolean }): void;
  setMenuBindings(bindings: MenuBindings): void;
  onCommand(listener: (id: string) => void): () => void;
  onSaveRequest(listener: (id: number) => void): () => void;
  saveDone(id: number, saved: boolean): void;
  nativeEdit(which: 'undo' | 'redo'): void;
}

const BRIDGE_METHODS = [
  'load',
  'onDocuments',
  'save',
  'saveAs',
  'open',
  'setDocumentState',
  'setMenuBindings',
  'onCommand',
  'onSaveRequest',
  'saveDone',
  'nativeEdit',
] as const satisfies readonly (keyof EditorBridge)[];

/** The bridge, if this page is in the editor window. Checked structurally, since it arrives untyped. */
export function findEditorBridge(host: object): EditorBridge | null {
  const candidate: unknown = (host as Record<string, unknown>)[EDITOR_BRIDGE_GLOBAL];
  if (typeof candidate !== 'object' || candidate === null) return null;

  const methods = candidate as Partial<Record<keyof EditorBridge, unknown>>;
  return BRIDGE_METHODS.every((name) => typeof methods[name] === 'function')
    ? (candidate as EditorBridge)
    : null;
}

function entryOf(document: DesktopEditorDocument): LayoutLibraryEntry {
  return { name: document.name, text: document.text, offered: true, path: document.path };
}

/** The layouts folder's documents, and any opened from elsewhere, as the editor's library. */
export function desktopLibrary(documents: readonly DesktopEditorDocument[]): LayoutLibrary {
  const base = createLayoutLibrary({
    layouts: Object.fromEntries(documents.map((document) => [document.name, document.text])),
  });
  const byName = new Map(documents.map((document) => [document.name, document]));

  return Object.freeze({
    names: base.names,
    entry: (name: string) => {
      const found = byName.get(name);
      return found === undefined ? undefined : entryOf(found);
    },
    resolveAsset: (src: string, name?: string) =>
      name === undefined ? undefined : byName.get(name)?.assets[src],
  });
}

/** A save, written by the main process: the same URL and body the dev server would have had. */
export function desktopSaveTransport(bridge: Pick<EditorBridge, 'save'>): SaveTransport {
  return async (url, init) => {
    const reply = await bridge.save(url, init.body);

    return { ok: reply.ok, status: reply.status, text: () => Promise.resolve(reply.text) };
  };
}

/** The bridge as the editor's host. */
export function editorHostFrom(bridge: EditorBridge): EditorHost {
  return {
    saveAs: (suggested) => bridge.saveAs(suggested),
    open: async () => {
      const opened = await bridge.open();
      return opened === null ? null : entryOf(opened);
    },
    setDocumentState: (state) => {
      bridge.setDocumentState(state);
    },
    setMenuBindings: (bindings) => {
      bridge.setMenuBindings(bindings);
    },
    onCommand: (listener) => bridge.onCommand(listener),
    onSaveRequest: (listener) => bridge.onSaveRequest(listener),
    saveDone: (id, saved) => {
      bridge.saveDone(id, saved);
    },
    nativeEdit: (which) => {
      bridge.nativeEdit(which);
    },
  };
}
