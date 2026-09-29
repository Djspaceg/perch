/**
 * The Electron main process: the app-wide rules, then the runner, then the editor if asked for.
 *
 * What belongs here is what every window this app has shares — the `app://` scheme, the navigation
 * lock, the permission policy, the application menu, single-instance and quit handling. What one
 * window does belongs to that window's module: `runner.ts` and `editor.ts`.
 *
 * One process, one lock per userData (`launch.ts`): `electron . --editor` while a runner is up hands
 * off to it, which opens or focuses the editor; with nothing running it starts the runner and opens
 * the editor over it.
 *
 * The one file in this app that imports `electron` at the top level and has side effects on load.
 */

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, Menu, app, net, protocol, session } from 'electron';
import { appMenuTemplate, historyMenuTarget, menuEnabled, type MenuCommandId } from './app-menu.js';
import {
  APP_SCHEME,
  contentSecurityPolicy,
  editorContentSecurityPolicy,
  isAppPage,
  resolveAppRequest,
} from './app-protocol.js';
import { createEditor, type Editor } from './editor.js';
import {
  handoffData,
  handoffIntent,
  launchIntent,
  launchPlan,
  secondInstanceAction,
  type LaunchIntent,
} from './launch.js';
import { appResources, editorPageFolder, runtimePageFolder, userDataOverride } from './paths.js';
import { recentEntries } from './recent.js';
import { startRunner, type Runner } from './runner.js';
import { createSettingsWindow, type SettingsWindow } from './settings-window.js';

const log = (line: string): void => {
  process.stdout.write(`[runner] ${line}\n`);
};

// Before `ready`, and before anything reads `userData`: a test launch must never touch the real one.
const userData = userDataOverride(process.env, process.argv);
if (userData !== null) app.setPath('userData', userData);

// The pages and the seed: the repository's in a dev run, the app's own resources when packaged.
const resources = appResources({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
});

// A privileged standard scheme, so the page has a real origin: module scripts load, `fetch` works,
// and `'self'` in its policy means `app://runtime`. See `app-protocol.ts` for why not `file://`.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Every web contents the app creates, present and future: it may be at one of the app's two pages
// and nowhere else, may open no windows, and may attach no webviews. Each window's IPC answers only
// its own page (`runner.ts`, `editor.ts`).
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!isAppPage(url)) {
      event.preventDefault();
      log(`refused navigation to ${url}`);
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAppPage(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    log(`refused to open a window for ${url}`);
    return { action: 'deny' };
  });
});

// Neither page needs a camera, microphone, notification or anything else a page can ask for.
function denyPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}

async function serveApp(request: Request, runner: Runner, editor: Editor): Promise<Response> {
  const path = resolveAppRequest(request.url, {
    runtime: runtimePageFolder(process.env, resources),
    document: runner.documentFolder(),
    editor: editorPageFolder(process.env, resources),
    editorDocument: (key) => editor.documentFolder(key),
  });
  if (path === null) return new Response('not found', { status: 404 });

  let response: Response;
  try {
    response = await net.fetch(pathToFileURL(path).toString());
  } catch {
    return new Response('not found', { status: 404 });
  }
  if (!path.endsWith('.html')) return response;

  const headers = new Headers(response.headers);
  const editorPage = new URL(request.url).host === 'editor';
  headers.set(
    'Content-Security-Policy',
    editorPage
      ? editorContentSecurityPolicy(runner.brokerUrl)
      : contentSecurityPolicy(runner.brokerUrl),
  );
  return new Response(response.body, { status: response.status, headers });
}

let runner: Runner | null = null;
let editor: Editor | null = null;
let settingsWindow: SettingsWindow | null = null;
let stopped = false;
/** Set once the editor's unsaved-changes prompt, if any, has let a quit go ahead. */
let quitConfirmed = false;

const intent = launchIntent(process.argv);

/**
 * The application menu, rebuilt whenever the editor opens, closes, or reports new bindings, a new
 * document or a new menu state; whenever the layouts folder or the recent list changes; and whenever
 * focus moves between windows, since Undo and Redo are enabled by the focused one.
 */
/** What the last rebuild's two submenus listed, so the log says when either changes. */
let listedInMenu = '';

function rebuildMenu(): void {
  if (editor === null || runner === null) return;
  const opened = editor;
  const running = runner;
  const focused = BrowserWindow.getFocusedWindow();
  const recent = recentEntries(running.recentDocuments(), existsSync);
  const names = (items: readonly { readonly name?: string; readonly label?: string }[]): string =>
    items.length === 0 ? '(none)' : items.map((item) => item.name ?? item.label).join(', ');
  const listed = `Open preset: ${names(running.documents())}; Open recent: ${names(recent)}`;
  if (listed !== listedInMenu) {
    listedInMenu = listed;
    log(`menu: ${listed}`);
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      appMenuTemplate(
        {
          platform: process.platform,
          appName: app.name,
          bindings: opened.bindings(),
          editorOpen: opened.isOpen(),
          devTools: !app.isPackaged,
          enabled: menuEnabled({
            editorOpen: opened.isOpen(),
            focused: focused === null ? null : opened.owns(focused) ? 'editor' : 'other',
            page: opened.pageMenuState(),
          }),
          presets: running.documents(),
          openDocument: opened.currentPath(),
          recent,
        },
        {
          command: (id) => {
            runMenuCommand(opened, id);
          },
          openEditor: () => {
            opened.open();
          },
          showRunner: () => {
            running.show();
          },
          openSettings: () => {
            settingsWindow?.open();
          },
          openPreset: (path) => {
            opened.openPath(path);
          },
          openRecent: (path) => {
            opened.openPath(path);
          },
          clearRecent: () => {
            running.clearRecentDocuments();
            rebuildMenu();
          },
        },
      ),
    ),
  );
}

/** Focus settles a moment after the event that reports it moving; rebuild once it has. */
let focusRebuild: NodeJS.Immediate | undefined;
function rebuildMenuSoon(): void {
  if (focusRebuild !== undefined) return;
  focusRebuild = setImmediate(() => {
    focusRebuild = undefined;
    rebuildMenu();
  });
}

/** A menu command: Undo and Redo go by focus (`historyMenuTarget`); the rest go to the editor. */
function runMenuCommand(opened: Editor, id: MenuCommandId): void {
  if (id !== 'history.undo' && id !== 'history.redo') {
    opened.sendCommand(id);
    return;
  }
  const focused = BrowserWindow.getFocusedWindow();
  const target = historyMenuTarget(
    focused === null ? null : opened.owns(focused) ? 'editor' : 'other',
  );
  if (target === 'editor-page') opened.sendCommand(id);
  else if (id === 'history.undo') focused?.webContents.undo();
  else focused?.webContents.redo();
}

/** What a launch, first or second, asked for, once the runner is up. */
function act(wanted: LaunchIntent): void {
  if (secondInstanceAction(wanted) === 'open-editor') editor?.open();
  else runner?.show();
}

let started: Promise<void> | null = null;

if (!app.requestSingleInstanceLock(handoffData(intent))) {
  // Another perch already has this userData. It was handed this launch's intent and acts on it
  // (below); this one leaves.
  app.quit();
} else {
  app.on('second-instance', (_event, argv, _cwd, data) => {
    const wanted = handoffIntent(data, argv);
    log(`a second launch asked for the ${wanted}`);
    void started?.then(() => {
      act(wanted);
    });
  });
  // macOS: clicking the dock icon brings a window back, the editor's when it is open.
  app.on('activate', () => {
    if (editor?.isOpen() === true) editor.open();
    else runner?.show();
  });
  // Closing a window never quits: the runner hides into its tray, the editor just closes. Quit is
  // the tray's and the app menu's.
  app.on('window-all-closed', () => undefined);
  app.on('browser-window-focus', rebuildMenuSoon);
  app.on('browser-window-blur', rebuildMenuSoon);
  // macOS: a document picked from the Dock's recent list, which `addRecentDocument` keeps.
  app.on('open-file', (event, path) => {
    event.preventDefault();
    log(`asked to open ${path}`);
    void started?.then(() => {
      editor?.openPath(path);
    });
  });

  // Unsaved edits in the editor are asked about before anything closes, and a Cancel calls the quit
  // off. Only a quit going ahead reaches the runner, so its window still hides on close after one.
  app.on('before-quit', (event) => {
    if (!quitConfirmed && editor?.needsQuitConfirmation() === true) {
      event.preventDefault();
      const asking = editor;
      void asking.confirmQuit().then((go) => {
        if (!go) return;
        quitConfirmed = true;
        app.quit();
      });
      return;
    }
    runner?.prepareQuit();
  });

  // Stop the relay before exiting, so both ports are released and a relaunch can have them.
  app.on('will-quit', (event) => {
    if (stopped || runner === null) return;
    event.preventDefault();
    const stopping = runner;
    runner = null;
    editor?.stop();
    settingsWindow?.stop();
    stopping
      .stop()
      .catch((error: unknown) => {
        log(`stop failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        stopped = true;
        log('quit');
        app.quit();
      });
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      log(`${signal} received, quitting`);
      app.quit();
    });
  }

  started = app
    .whenReady()
    .then(async () => {
      denyPermissions();
      log(`userData: ${app.getPath('userData')}`);
      log(`launched for the ${intent}`);
      const plan = launchPlan(intent);
      const up = await startRunner({
        env: process.env,
        documentsPath: app.getPath('documents'),
        userDataPath: app.getPath('userData'),
        resources,
        log,
        editorOpen: () => editor?.isOpen() ?? false,
        settingsOpen: () => settingsWindow?.isOpen() ?? false,
        openEditor: () => {
          editor?.open();
        },
        openSettings: () => {
          settingsWindow?.open();
        },
      });
      runner = up;
      settingsWindow = createSettingsWindow({
        runner: up,
        log,
        onChange: () => {
          up.updateDock();
        },
      });
      const made = createEditor({
        runner: up,
        log,
        onChange: rebuildMenu,
        openSettings: () => {
          settingsWindow?.open();
        },
      });
      editor = made;
      up.onFolderChange(rebuildMenu);
      protocol.handle(APP_SCHEME, (request) => serveApp(request, up, made));
      rebuildMenu();
      up.open();
      if (plan.editor) made.open();
    })
    .catch((error: unknown) => {
      log(
        `could not start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
      app.exit(1);
    });
}
