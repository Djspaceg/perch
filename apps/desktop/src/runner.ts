/**
 * THE RUNNER: the relay, one layout document, the window that renders it, and the tray that picks
 * it. Runs without the editor; the editor, when it arrives, is a second window beside this one and
 * talks to the same relay through its control topics.
 *
 * ```text
 * settings (userData)  ->  which document, which LHM host
 * layouts folder       ->  listed for the tray, the open document read and watched
 * relay, in process    ->  its WebSocket URL handed to the page
 * window               ->  app://runtime/index.html, fed through the preload
 * ```
 *
 * A layout document is to this runner what a file is to a viewer: it is opened, re-read when it
 * changes on disk, and remembered at quit. Switching documents reloads the page, the runtime's own
 * rule for switching layouts (see `main.tsx`), so nothing from one document's store leaks into the
 * next; an edit to the open document re-renders in place.
 */

import { stat, watch as watchFolder } from 'node:fs';
import { join } from 'node:path';
import {
  Menu,
  Tray,
  app,
  ipcMain,
  nativeImage,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import { isRuntimePage } from './app-protocol.js';
import { readLayoutDocument, watchDocument, type DocumentPayload } from './document.js';
import {
  listLayoutDocuments,
  prepareLayoutsFolder,
  type LayoutDocument,
} from './layouts-folder.js';
import { layoutsFolder, runtimePreloadPath, seedLayoutsFolder } from './paths.js';
import { desktopRelayConfig, startDesktopRelay } from './relay-host.js';
import { chooseDocument } from './resume.js';
import { RUNNER_DOCUMENT_CHANNEL, RUNNER_LOAD_CHANNEL } from './runner-channels.js';
import { createRunnerWindow } from './runner-window.js';
import { SETTINGS_FILENAME, createSettingsStore } from './settings.js';
import { trayIconBitmap } from './tray-icon.js';
import { trayMenuTemplate, type TrayState } from './tray-menu.js';

type Env = Readonly<Record<string, string | undefined>>;

export interface RunnerOptions {
  readonly env: Env;
  readonly documentsPath: string;
  readonly userDataPath: string;
  readonly log: (line: string) => void;
}

export interface Runner {
  /** The relay URL the page dials, for the page's content security policy. */
  readonly brokerUrl: string;
  /** The open document's folder, which `app://document/` serves, or `null`. */
  documentFolder(): string | null;
  /** Create the window and the tray. Call once `app://` is being served. */
  open(): void;
  show(): void;
  /** Stop watching and stop the relay. Resolves once both listeners are closed. */
  stop(): Promise<void>;
}

export async function startRunner(options: RunnerOptions): Promise<Runner> {
  const { env, log } = options;

  const settingsFile = join(options.userDataPath, SETTINGS_FILENAME);
  const settings = createSettingsStore(settingsFile);
  const read = await settings.load();
  log(`settings: ${settingsFile}`);
  if (read.problem !== null) log(`settings: ${read.problem}; using defaults for it`);
  const remember = (patch: Parameters<typeof settings.update>[0]): void => {
    settings.update(patch).catch((error: unknown) => {
      log(`settings: could not save ${settingsFile}: ${describe(error)}`);
    });
  };

  const folder = layoutsFolder(env, options.documentsPath);
  const prepared = await prepareLayoutsFolder(folder, seedLayoutsFolder());
  log(
    `layouts folder: ${folder}${prepared.created ? ' (created)' : ''}` +
      (prepared.seeded.length > 0
        ? `; seeded ${String(prepared.seeded.length)} files from ${seedLayoutsFolder()}`
        : ''),
  );

  const config = desktopRelayConfig(env, settings.current.lhm);
  const relay = await startDesktopRelay(
    config,
    {
      info: (message) => {
        log(`[relay] ${message}`);
      },
      warn: (message) => {
        log(`[relay] warn: ${message}`);
      },
      error: (message) => {
        log(`[relay] error: ${message}`);
      },
    },
    (endpoint) => {
      remember({ lhm: endpoint });
    },
  );
  const { service, brokerUrl } = relay;
  log(
    `relay listening: mqtt://${config.broker.bindHost}:${String(service.mqttPort)}, ` +
      `ws://${config.broker.bindHost}:${String(service.wsPort)}; the page dials ${brokerUrl}; ` +
      `polling http://${config.lhm.host}:${String(config.lhm.port)}/data.json`,
  );

  // ---- the open document ---------------------------------------------------------------
  let documents = await listLayoutDocuments(folder);
  const saved = settings.current.lastDocument;
  const choice = chooseDocument({
    saved,
    savedExists: saved !== null && (await isFile(saved)),
    listing: documents,
    folder,
  });
  let notice = choice.notice;
  if (notice !== null) log(`document: ${notice}`);

  let current: LayoutDocument | null = null;
  let payload: DocumentPayload | null = null;
  let stopWatching: () => void = () => undefined;
  let window: BrowserWindow | null = null;
  let reportPage: (() => void) | null = null;
  let tray: Tray | null = null;

  const openDocument = async (document: LayoutDocument | null, reload: boolean): Promise<void> => {
    stopWatching();
    current = document;
    payload = document === null ? null : await readLayoutDocument(document);
    if (document !== null) {
      log(`document: ${document.path}${payload?.text === null ? ' (not on disk)' : ''}`);
      remember({ lastDocument: document.path });
      stopWatching = watchDocument(
        document.path,
        (changed) => {
          payload = changed;
          log(
            `document changed on disk: ${document.path}${changed.text === null ? ' (removed)' : ''}`,
          );
          window?.webContents.send(RUNNER_DOCUMENT_CHANNEL, changed);
          // After the page has had a moment to re-render, so the log shows the new document.
          setTimeout(() => reportPage?.(), 300);
        },
        100,
        (error) => {
          log(`document: stopped watching ${document.path}: ${error.message}`);
        },
      );
    }
    window?.setTitle(document === null ? 'perch' : `perch - ${document.name}`);
    refreshTray();
    if (reload) window?.webContents.reload();
  };

  await openDocument(choice.document, false);

  // The tray's list follows the folder: an editor's "save as" appears without a relaunch.
  let folderTimer: NodeJS.Timeout | undefined;
  const folderWatcher = watchFolder(folder, () => {
    if (folderTimer !== undefined) clearTimeout(folderTimer);
    folderTimer = setTimeout(() => {
      listLayoutDocuments(folder).then(
        (listed) => {
          documents = listed;
          refreshTray();
        },
        (error: unknown) => {
          log(`layouts folder: could not list ${folder}: ${describe(error)}`);
        },
      );
    }, 200);
  });
  folderWatcher.on('error', (error) => {
    log(`layouts folder: stopped watching ${folder}: ${error.message}`);
  });

  // ---- the page's one request ----------------------------------------------------------
  ipcMain.handle(RUNNER_LOAD_CHANNEL, (event: IpcMainInvokeEvent) => {
    // Only the runtime page may ask; anything else in any frame gets nothing.
    if (event.senderFrame === null || !isRuntimePage(event.senderFrame.url)) {
      throw new Error('perch: refused a load request from outside the runtime page');
    }
    return { brokerUrl, document: payload };
  });

  // ---- window and tray -----------------------------------------------------------------
  function trayState(): TrayState {
    return {
      documents,
      current: current?.path ?? null,
      notice,
      windowVisible: window?.isVisible() ?? false,
      startAtLogin: app.getLoginItemSettings().openAtLogin,
    };
  }

  function refreshTray(): void {
    if (tray === null) return;
    tray.setContextMenu(
      Menu.buildFromTemplate(
        trayMenuTemplate(trayState(), {
          open: (document) => {
            notice = null;
            openDocument(document, true).catch((error: unknown) => {
              log(`document: could not open ${document.path}: ${describe(error)}`);
            });
          },
          openFolder: () => {
            shell.openPath(folder).then(
              (problem) => {
                if (problem !== '') log(`layouts folder: could not open ${folder}: ${problem}`);
              },
              (error: unknown) => {
                log(`layouts folder: could not open ${folder}: ${describe(error)}`);
              },
            );
          },
          toggleWindow: () => {
            if (window?.isVisible() === true) hideWindow();
            else showWindow();
          },
          setStartAtLogin: (enabled) => {
            app.setLoginItemSettings({ openAtLogin: enabled });
            log(`start at login: ${enabled ? 'on' : 'off'}`);
            refreshTray();
          },
          quit: () => {
            app.quit();
          },
        }),
      ),
    );
  }

  /**
   * macOS: a dock icon while the window is showing, none while it is not. The runner lives in the
   * menu bar; a dock icon for a hidden window would be an app you cannot see, a click away from
   * nothing.
   */
  function showWindow(): void {
    if (window === null) return;
    window.show();
    window.focus();
    app.dock?.show().catch(() => undefined);
    refreshTray();
  }

  function hideWindow(): void {
    window?.hide();
    app.dock?.hide();
    refreshTray();
  }

  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
  });

  return {
    brokerUrl,
    documentFolder: () => (current === null ? null : join(current.path, '..')),
    open: () => {
      const bitmapColour =
        process.platform === 'darwin' ? { r: 0, g: 0, b: 0 } : { r: 154, g: 164, b: 178 };
      const icon = nativeImage.createFromBitmap(trayIconBitmap(16, bitmapColour), {
        width: 16,
        height: 16,
        scaleFactor: 1,
      });
      icon.addRepresentation({
        buffer: trayIconBitmap(32, bitmapColour),
        width: 32,
        height: 32,
        scaleFactor: 2,
      });
      if (process.platform === 'darwin') icon.setTemplateImage(true);
      tray = new Tray(icon);
      tray.setToolTip('perch');

      const created = createRunnerWindow({ preload: runtimePreloadPath(), log });
      window = created.window;
      reportPage = created.reportPage;
      window.setTitle(current === null ? 'perch' : `perch - ${current.name}`);
      // Closing the window hides it; the runner keeps running in the tray until Quit.
      window.on('close', (event) => {
        if (quitting) return;
        event.preventDefault();
        hideWindow();
      });
      window.on('show', refreshTray);
      window.on('hide', refreshTray);
      window.once('ready-to-show', showWindow);
      refreshTray();
    },
    show: showWindow,
    stop: async () => {
      stopWatching();
      if (folderTimer !== undefined) clearTimeout(folderTimer);
      folderWatcher.close();
      ipcMain.removeHandler(RUNNER_LOAD_CHANNEL);
      await service.stop();
      log('relay stopped');
    },
  };
}

function isFile(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    stat(path, (error, stats) => {
      resolve(error === null && stats.isFile());
    });
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
