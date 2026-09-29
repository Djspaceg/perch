/**
 * THE SETTINGS WINDOW: one small window holding the sensor host control, opened from the app menu's
 * Settings... (macOS), File > Settings (Windows, Linux), the tray, and the editor (its Mod+Comma, its
 * header indicator). There is only ever one (`single-window.ts`); opening it again brings it forward.
 *
 * Its page is `app://editor/settings.html`, a second page of the editor's build, locked down as the
 * editor's is: sandboxed, context isolated, a one-method preload, and IPC that answers only a sender
 * at that page. The page dials the runner's relay itself and moves it over the relay's control path,
 * like the editor's connection control; the runner saves each host the relay is moved to
 * (`runner.ts`), so the runner resumes with it and needs nothing from this window.
 */

import { BrowserWindow, app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { SETTINGS_PAGE_URL, isSettingsPage } from './app-protocol.js';
import { settingsPreloadPath } from './paths.js';
import type { Runner } from './runner.js';
import { SETTINGS_CHANNELS } from './settings-channels.js';
import { singleWindow } from './single-window.js';

export interface SettingsWindowOptions {
  readonly runner: Runner;
  readonly log: (line: string) => void;
  /** The window opened or closed: the dock icon follows. */
  readonly onChange: () => void;
}

export interface SettingsWindow {
  /** Open the window, or bring the one there is forward. */
  open(): void;
  isOpen(): boolean;
  stop(): void;
}

export function createSettingsWindow(options: SettingsWindowOptions): SettingsWindow {
  const { runner, log } = options;

  const settings = singleWindow(
    () => {
      log('settings: opening the Settings window');
      const window = createWindow(log);
      // A tray click on macOS does not make the app active, and a window of an inactive app opens
      // behind whatever is in front.
      if (process.platform === 'darwin') app.focus({ steal: true });
      return window;
    },
    (open) => {
      if (!open) log('settings: window closed');
      options.onChange();
    },
  );

  ipcMain.handle(SETTINGS_CHANNELS.load, (event: IpcMainInvokeEvent) => {
    const window = settings.current();
    if (
      window?.webContents !== event.sender ||
      event.senderFrame === null ||
      !isSettingsPage(event.senderFrame.url)
    ) {
      throw new Error('perch: refused a settings load from outside the Settings window');
    }
    const relay = runner.relayTarget();
    log(`settings: loaded; relay ${runner.brokerUrl} polling ${relay.host}:${String(relay.port)}`);
    return { brokerUrl: runner.brokerUrl, relay };
  });

  return {
    open: () => {
      settings.open();
    },
    isOpen: () => settings.current() !== null,
    stop: () => {
      ipcMain.removeHandler(SETTINGS_CHANNELS.load);
    },
  };
}

function createWindow(log: (line: string) => void): BrowserWindow {
  const window = new BrowserWindow({
    width: 560,
    height: 250,
    minWidth: 460,
    minHeight: 220,
    title: 'perch settings',
    show: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#0d1016',
    autoHideMenuBar: true,
    webPreferences: {
      preload: settingsPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  window.on('page-title-updated', (event) => {
    event.preventDefault();
  });
  window.once('ready-to-show', () => {
    window.show();
    window.focus();
  });
  window.webContents.on('console-message', (event) => {
    log(`[settings page] ${event.level}: ${event.message}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    log(`[settings page] renderer gone: ${details.reason}`);
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    log(`[settings page] failed to load ${url}: ${description} (${String(code)})`);
  });
  window.webContents.on('did-finish-load', () => {
    log(`[settings page] loaded ${SETTINGS_PAGE_URL}`);
  });

  window.loadURL(SETTINGS_PAGE_URL).catch((error: unknown) => {
    log(
      `[settings page] could not load ${SETTINGS_PAGE_URL}: ${error instanceof Error ? error.message : String(error)}` +
        '; is the editor built? npm run editor builds it',
    );
  });

  return window;
}
