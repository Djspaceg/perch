/**
 * The editor's window: the built editor page, locked down as the runner's is.
 *
 * - `contextIsolation`, `sandbox`, no `nodeIntegration`: the page is web content with no Node, and
 *   the editor preload's functions are its whole reach into this process.
 * - Navigation is refused everywhere but the app's two pages (`main.ts`, for every web contents),
 *   and the editor's IPC answers only a sender at the editor page (`editor.ts`).
 *
 * Its console goes to the log, as the runner page's does.
 */

import { BrowserWindow } from 'electron';
import { EDITOR_PAGE_URL } from './app-protocol.js';

export interface EditorWindowOptions {
  readonly preload: string;
  readonly log: (line: string) => void;
}

export function createEditorWindow(options: EditorWindowOptions): BrowserWindow {
  const { log } = options;
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    title: 'perch editor',
    show: false,
    backgroundColor: '#07080a',
    webPreferences: {
      preload: options.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  // The main process names the window after the open document.
  window.on('page-title-updated', (event) => {
    event.preventDefault();
  });
  window.once('ready-to-show', () => {
    window.show();
    window.focus();
  });

  window.webContents.on('console-message', (event) => {
    log(`[editor page] ${event.level}: ${event.message}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    log(`[editor page] renderer gone: ${details.reason}`);
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    log(`[editor page] failed to load ${url}: ${description} (${String(code)})`);
  });
  window.webContents.on('did-finish-load', () => {
    log(`[editor page] loaded ${EDITOR_PAGE_URL}`);
  });

  window.loadURL(EDITOR_PAGE_URL).catch((error: unknown) => {
    log(
      `[editor page] could not load ${EDITOR_PAGE_URL}: ${error instanceof Error ? error.message : String(error)}` +
        '; is the editor built? npm run editor builds it',
    );
  });

  return window;
}
