/**
 * The Electron main process: the app-wide rules, then the runner.
 *
 * What belongs here is what every window this app will ever have shares — the `app://` scheme, the
 * navigation lock, the permission policy, single-instance and quit handling. What one window does
 * belongs to that window's module: `runner.ts` today, and an editor module beside it next, which
 * adds a host to `app-protocol.ts` and a preload of its own and changes nothing here but a call.
 *
 * The one file in this app that imports `electron` at the top level and has side effects on load.
 */

import { pathToFileURL } from 'node:url';
import { app, net, protocol, session } from 'electron';
import {
  APP_SCHEME,
  contentSecurityPolicy,
  isRuntimePage,
  resolveAppRequest,
} from './app-protocol.js';
import { runtimePageFolder, userDataOverride } from './paths.js';
import { startRunner, type Runner } from './runner.js';

const log = (line: string): void => {
  process.stdout.write(`[runner] ${line}\n`);
};

// Before `ready`, and before anything reads `userData`: a test launch must never touch the real one.
const userData = userDataOverride(process.env);
if (userData !== null) app.setPath('userData', userData);

// A privileged standard scheme, so the page has a real origin: module scripts load, `fetch` works,
// and `'self'` in its policy means `app://runtime`. See `app-protocol.ts` for why not `file://`.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Every web contents the app creates, present and future: it may be at its own page and nowhere
// else, may open no windows, and may attach no webviews.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!isRuntimePage(url)) {
      event.preventDefault();
      log(`refused navigation to ${url}`);
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (!isRuntimePage(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    log(`refused to open a window for ${url}`);
    return { action: 'deny' };
  });
});

// The runner needs no camera, microphone, notification or anything else a page can ask for.
function denyPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}

async function serveApp(request: Request, runner: Runner): Promise<Response> {
  const path = resolveAppRequest(request.url, {
    runtime: runtimePageFolder(process.env),
    document: runner.documentFolder(),
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
  headers.set('Content-Security-Policy', contentSecurityPolicy(runner.brokerUrl));
  return new Response(response.body, { status: response.status, headers });
}

let runner: Runner | null = null;
let stopped = false;

if (!app.requestSingleInstanceLock()) {
  // Another runner already has this userData; it shows its window (below) and this one leaves.
  app.quit();
} else {
  app.on('second-instance', () => {
    runner?.show();
  });
  // macOS: clicking the dock icon brings the window back.
  app.on('activate', () => {
    runner?.show();
  });
  // Closing the window hides it; the runner is quit from its tray, not by closing a window.
  app.on('window-all-closed', () => undefined);

  // Stop the relay before exiting, so both ports are released and a relaunch can have them.
  app.on('will-quit', (event) => {
    if (stopped || runner === null) return;
    event.preventDefault();
    const stopping = runner;
    runner = null;
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

  app
    .whenReady()
    .then(async () => {
      denyPermissions();
      log(`userData: ${app.getPath('userData')}`);
      const started = await startRunner({
        env: process.env,
        documentsPath: app.getPath('documents'),
        userDataPath: app.getPath('userData'),
        log,
      });
      runner = started;
      protocol.handle(APP_SCHEME, (request) => serveApp(request, started));
      started.open();
    })
    .catch((error: unknown) => {
      log(
        `could not start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
      app.exit(1);
    });
}
