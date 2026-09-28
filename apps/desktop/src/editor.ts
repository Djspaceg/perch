/**
 * THE EDITOR RUNNER: the editor window over the runner, in the same process, on the same relay.
 *
 * ```text
 * layouts folder (the runner's)  ->  the registry: each document's key, text and media
 * editor page                    <-  load, documents; save, Save As, Open through the main process
 * the page's document state      ->  the window's title, its edited mark, the close prompt
 * the page's keymap              ->  the application menu's accelerators (main.ts rebuilds it)
 * the menu                       ->  the page's commands, through its keybinding registry
 * ```
 *
 * Opening the editor starts nothing: the relay, the folder watch and the settings are the runner's,
 * and the page dials the runner's relay. Closing the window closes the window; the runner carries on.
 * A save rewrites a file in the runner's folder, and the runner's own watch re-renders it if it is
 * the document the runner shows. A host the editor's connection control switches the relay to is
 * saved by the runner (`runner.ts`, on the relay's retarget), so the runner resumes with it.
 */

import { dirname, join } from 'node:path';
import {
  type BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { isEditorPage } from './app-protocol.js';
import {
  DEFAULT_MENU_BINDINGS,
  menuBindingsFrom,
  type MenuBindings,
  type MenuCommandId,
} from './app-menu.js';
import { EDITOR_CHANNELS } from './editor-channels.js';
import { closeChoice, mustAsk, unsavedPrompt } from './editor-close.js';
import {
  createDocumentRegistry,
  handleSaveRequest,
  withJsonExtension,
  type EditorDocumentEntry,
} from './editor-documents.js';
import { createEditorWindow } from './editor-window.js';
import { editorPreloadPath } from './paths.js';
import type { Runner } from './runner.js';

export interface EditorOptions {
  readonly runner: Runner;
  readonly log: (line: string) => void;
  /** The window opened or closed, or its bindings changed: the menu is rebuilt. */
  readonly onChange: () => void;
}

export interface Editor {
  /** Open the editor window, or bring it forward if it is open. */
  open(): void;
  isOpen(): boolean;
  /** Whether `window` is the editor's. */
  owns(window: BrowserWindow): boolean;
  /** Run a menu command in the page. New and Open open the window first when it is closed. */
  sendCommand(id: MenuCommandId): void;
  /** The bindings the menu should show. */
  bindings(): MenuBindings;
  /** The folder of the editor document with this key, for `app://editor-document/`. */
  documentFolder(key: string): string | null;
  /** Whether a quit must ask first. */
  needsQuitConfirmation(): boolean;
  /** Ask about unsaved changes before a quit. Resolves whether the quit may go ahead. */
  confirmQuit(): Promise<boolean>;
  stop(): void;
}

/** How long a Save chosen in the close prompt may take before the window stays open. */
const SAVE_REQUEST_TIMEOUT_MS = 60_000;

export function createEditor(options: EditorOptions): Editor {
  const { runner, log } = options;
  const registry = createDocumentRegistry(runner.folder);
  const platformBindings =
    process.platform === 'darwin' ? DEFAULT_MENU_BINDINGS.mac : DEFAULT_MENU_BINDINGS.other;

  let window: BrowserWindow | null = null;
  /** The page has mounted (it sends its bindings then); commands before that wait in `queued`. */
  let ready = false;
  let queued: MenuCommandId[] = [];
  let bindings: MenuBindings = platformBindings;
  let documentState: { name: string; dirty: boolean } | null = null;
  /** This close, or this quit, has been answered: do not ask again. */
  let answered = false;
  let asking: Promise<boolean> | null = null;
  let saveRequests = 0;
  const pendingSaves = new Map<number, (saved: boolean) => void>();
  let stopFolder: (() => void) | null = null;

  const fromEditor = (event: IpcMainInvokeEvent | IpcMainEvent): boolean =>
    window !== null &&
    event.sender === window.webContents &&
    event.senderFrame !== null &&
    isEditorPage(event.senderFrame.url);

  const pushDocuments = (entries?: EditorDocumentEntry[]): void => {
    const target = window;
    if (target === null) return;
    (entries === undefined ? registry.entries() : Promise.resolve(entries)).then(
      (listed) => {
        if (!target.isDestroyed()) target.webContents.send(EDITOR_CHANNELS.documents, listed);
      },
      (error: unknown) => {
        log(`editor: could not list ${runner.folder}: ${describe(error)}`);
      },
    );
  };

  // ---- what the page asks ------------------------------------------------------------------
  ipcMain.handle(EDITOR_CHANNELS.load, async (event) => {
    if (!fromEditor(event)) refuse('load');
    const current = runner.currentDocument();
    const key = current === null ? null : registry.keyOf(current);
    const documents = await registry.entries();
    const initial = documents.some((document) => document.name === key) ? key : null;
    log(
      `editor: loaded; ${String(documents.length)} documents, opening ${initial ?? 'the first'}; ` +
        `relay ${runner.brokerUrl}`,
    );
    return { brokerUrl: runner.brokerUrl, relay: runner.relayTarget(), documents, initial };
  });

  ipcMain.handle(EDITOR_CHANNELS.save, async (event, url: unknown, body: unknown) => {
    if (!fromEditor(event)) refuse('save');
    const reply = await handleSaveRequest(registry, url, body);
    const name =
      typeof url === 'string' ? decodeURIComponentSafe(url.split('/').at(-1) ?? '') : '?';
    const path = registry.pathOf(name);
    if (reply.ok) {
      log(`editor: saved ${path ?? name}`);
      pushDocuments();
    } else {
      log(`editor: refused a save of ${name} (${String(reply.status)}): ${reply.text}`);
    }
    return reply;
  });

  ipcMain.handle(EDITOR_CHANNELS.saveAs, async (event, suggested: unknown) => {
    if (!fromEditor(event) || window === null) refuse('save as');
    const stem = typeof suggested === 'string' && suggested !== '' ? suggested : 'untitled';
    const current = documentState === null ? undefined : registry.pathOf(documentState.name);
    const directory = current === undefined ? runner.folder : dirname(current);
    const chosen = await dialog.showSaveDialog(window, {
      title: 'Save layout as',
      defaultPath: join(directory, `${stem}.json`),
      filters: [{ name: 'Layout documents', extensions: ['json'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (chosen.canceled || chosen.filePath === '') return null;
    const path = withJsonExtension(chosen.filePath);
    const name = registry.keyOf(path);
    log(`editor: save as ${path} (key ${name})`);
    return { name, path };
  });

  ipcMain.handle(EDITOR_CHANNELS.open, async (event) => {
    if (!fromEditor(event) || window === null) refuse('open');
    const chosen = await dialog.showOpenDialog(window, {
      title: 'Open layout',
      defaultPath: runner.folder,
      filters: [{ name: 'Layout documents', extensions: ['json'] }],
      properties: ['openFile'],
    });
    const path = chosen.filePaths[0];
    if (chosen.canceled || path === undefined) return null;
    const name = registry.keyOf(path);
    const entries = await registry.entries();
    pushDocuments(entries);
    const found = entries.find((entry) => entry.name === name) ?? null;
    log(`editor: open ${path}${found === null ? ', which could not be read' : ` (key ${name})`}`);
    return found;
  });

  // ---- what the page reports ---------------------------------------------------------------
  ipcMain.on(EDITOR_CHANNELS.documentState, (event, state: unknown) => {
    if (!fromEditor(event) || window === null) return;
    if (typeof state !== 'object' || state === null) return;
    const { name, dirty } = state as { name?: unknown; dirty?: unknown };
    if (typeof name !== 'string' || typeof dirty !== 'boolean') return;
    const changed = documentState?.name !== name || documentState.dirty !== dirty;
    documentState = { name, dirty };
    if (!changed) return;
    log(`editor: ${name}${dirty ? ' has unsaved changes' : ' is saved'}`);
    const path = registry.pathOf(name);
    window.setTitle(`${name}${dirty && process.platform !== 'darwin' ? ' *' : ''} - perch editor`);
    window.setDocumentEdited(dirty);
    if (process.platform === 'darwin') window.setRepresentedFilename(path ?? '');
  });

  ipcMain.on(EDITOR_CHANNELS.menuBindings, (event, input: unknown) => {
    if (!fromEditor(event)) return;
    bindings = menuBindingsFrom(input, platformBindings);
    options.onChange();
    if (!ready) {
      ready = true;
      const flush = queued;
      queued = [];
      for (const id of flush) window?.webContents.send(EDITOR_CHANNELS.command, id);
    }
  });

  ipcMain.on(EDITOR_CHANNELS.nativeEdit, (event, which: unknown) => {
    if (!fromEditor(event) || window === null) return;
    if (which === 'undo') window.webContents.undo();
    else if (which === 'redo') window.webContents.redo();
  });

  ipcMain.on(EDITOR_CHANNELS.saveDone, (event, id: unknown, saved: unknown) => {
    if (!fromEditor(event) || typeof id !== 'number') return;
    pendingSaves.get(id)?.(saved === true);
    pendingSaves.delete(id);
  });

  // ---- closing with unsaved changes ------------------------------------------------------------
  const requestSave = (): Promise<boolean> => {
    const target = window;
    if (target === null) return Promise.resolve(false);
    saveRequests += 1;
    const id = saveRequests;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        pendingSaves.delete(id);
        log('editor: the save before closing did not answer; keeping the window open');
        resolve(false);
      }, SAVE_REQUEST_TIMEOUT_MS);
      pendingSaves.set(id, (saved) => {
        clearTimeout(timer);
        resolve(saved);
      });
      target.webContents.send(EDITOR_CHANNELS.saveRequest, id);
    });
  };

  /** Ask, once at a time. Resolves whether the close or quit may go ahead. */
  const ask = (reason: 'close' | 'quit'): Promise<boolean> => {
    if (asking !== null) return asking;
    const target = window;
    if (target === null) return Promise.resolve(true);
    const prompt = unsavedPrompt(documentState?.name ?? 'this layout', reason);
    asking = dialog
      .showMessageBox(target, { ...prompt, buttons: [...prompt.buttons] })
      .then(async ({ response }) => {
        const choice = closeChoice(response);
        log(`editor: unsaved changes on ${reason}: ${choice}`);
        if (choice === 'cancel') return false;
        if (choice === 'discard') return true;
        return requestSave();
      })
      .finally(() => {
        asking = null;
      });
    return asking;
  };

  const needsAsking = (): boolean =>
    window !== null && mustAsk({ dirty: documentState?.dirty === true, answered });

  const open = (): void => {
    if (window !== null) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      return;
    }

    log('editor: opening the editor window');
    const created = createEditorWindow({ preload: editorPreloadPath(), log });
    window = created;
    ready = false;
    documentState = null;
    answered = false;
    created.on('close', (event) => {
      if (!needsAsking()) return;
      event.preventDefault();
      void ask('close').then((go) => {
        if (!go || created.isDestroyed()) return;
        answered = true;
        created.close();
      });
    });
    created.on('closed', () => {
      window = null;
      ready = false;
      queued = [];
      documentState = null;
      for (const resolve of pendingSaves.values()) resolve(false);
      pendingSaves.clear();
      stopFolder?.();
      stopFolder = null;
      log('editor: window closed; the runner keeps running');
      runner.updateDock();
      options.onChange();
    });
    stopFolder = runner.onFolderChange(() => {
      pushDocuments();
    });
    runner.updateDock();
    options.onChange();
  };

  return {
    open,
    isOpen: () => window !== null,
    owns: (candidate) => window !== null && candidate === window,
    sendCommand: (id) => {
      if (window === null) {
        if (id !== 'document.new' && id !== 'document.open') return;
        queued.push(id);
        open();
        return;
      }
      if (!ready) {
        queued.push(id);
        return;
      }
      window.webContents.send(EDITOR_CHANNELS.command, id);
    },
    bindings: () => bindings,
    documentFolder: (key) => registry.folderOf(key),
    needsQuitConfirmation: needsAsking,
    confirmQuit: async () => {
      if (!needsAsking()) return true;
      const go = await ask('quit');
      if (go) answered = true;
      return go;
    },
    stop: () => {
      stopFolder?.();
      for (const channel of [
        EDITOR_CHANNELS.load,
        EDITOR_CHANNELS.save,
        EDITOR_CHANNELS.saveAs,
        EDITOR_CHANNELS.open,
      ]) {
        ipcMain.removeHandler(channel);
      }
      for (const channel of [
        EDITOR_CHANNELS.documentState,
        EDITOR_CHANNELS.menuBindings,
        EDITOR_CHANNELS.nativeEdit,
        EDITOR_CHANNELS.saveDone,
      ]) {
        ipcMain.removeAllListeners(channel);
      }
    },
  };
}

function refuse(channel: string): never {
  throw new Error(`perch: refused ${channel} from outside the editor page`);
}

function decodeURIComponentSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
