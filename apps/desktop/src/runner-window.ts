/**
 * The runner's window: the built runtime page, locked down.
 *
 * - `contextIsolation`, `sandbox`, no `nodeIntegration`: the page is web content with no Node, and
 *   the preload's two functions are its whole reach into this process.
 * - Navigation is refused everywhere except the runtime page itself (see `main.ts`, which applies
 *   that to every web contents the app creates), and no window may be opened from it.
 *
 * Also the runner's own eyes on the page: its console is forwarded to the log, and once it has
 * loaded, `data-perch-ready` — the page's "a reading has arrived" signal — is read until it flips,
 * so the log says whether data reached the screen rather than only that the relay published it.
 */

import { BrowserWindow } from 'electron';
import { RUNTIME_PAGE_URL } from './app-protocol.js';

export interface RunnerWindowOptions {
  readonly preload: string;
  readonly log: (line: string) => void;
}

/** How long, after a load, to keep asking whether the first reading has arrived. */
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 1000;

/** Read from the page's own main world; returns what its chrome shows. */
const READY_PROBE = `(() => {
  const page = document.getElementById('perch-page');
  if (page === null) return null;
  return {
    ready: page.dataset.perchReady ?? null,
    layout: page.dataset.perchLayout ?? null,
    problem: document.querySelector('[data-perch-problem]')?.getAttribute('data-perch-problem') ?? null,
    status: document.querySelector('[data-testid="perch-status"]')?.textContent ?? null,
    source: document.querySelector('[data-testid="perch-source"]')?.textContent ?? null,
  };
})()`;

interface ReadyProbe {
  readonly ready: string | null;
  readonly layout: string | null;
  readonly problem: string | null;
  readonly status: string | null;
  readonly source: string | null;
}

export interface RunnerWindow {
  readonly window: BrowserWindow;
  /**
   * Log what the page shows now, and keep logging changes until a reading has arrived. A property
   * rather than a method, because the runner holds it detached from this object.
   */
  readonly reportPage: () => void;
}

export function createRunnerWindow(options: RunnerWindowOptions): RunnerWindow {
  const { log } = options;
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    title: 'perch',
    show: false,
    // The page's own background, so a resize or a reload never flashes white.
    backgroundColor: '#07080a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: options.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  // The page names its layout; the runner names the window.
  window.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  window.webContents.on('console-message', (event) => {
    log(`[page] ${event.level}: ${event.message}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    log(`[page] renderer gone: ${details.reason}`);
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    log(`[page] failed to load ${url}: ${description} (${String(code)})`);
  });

  let generation = 0;
  const reportPage = (): void => {
    generation += 1;
    const mine = generation;
    const started = Date.now();
    let reported = '';

    const probe = (): void => {
      if (mine !== generation || window.isDestroyed()) return;
      window.webContents.executeJavaScript(READY_PROBE, true).then(
        (result: unknown) => {
          const seen = result as ReadyProbe | null;
          const line =
            seen === null
              ? 'loaded, no #perch-page yet'
              : `loaded ${seen.layout ?? '(no layout)'}` +
                (seen.problem === null ? '' : `, showing its ${seen.problem} refusal`) +
                `; ${seen.source ?? ''}; ${seen.status ?? ''}; data-perch-ready=${seen.ready ?? 'null'}`;
          if (line !== reported) {
            reported = line;
            log(`[page] ${line}`);
          }
          if (seen?.ready === 'true' || Date.now() - started > READY_TIMEOUT_MS) return;
          setTimeout(probe, READY_POLL_MS);
        },
        (error: unknown) => {
          log(
            `[page] could not read the page: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      );
    };
    probe();
  };
  window.webContents.on('did-finish-load', reportPage);

  window.loadURL(RUNTIME_PAGE_URL).catch((error: unknown) => {
    log(
      `[page] could not load ${RUNTIME_PAGE_URL}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  return { window, reportPage };
}
