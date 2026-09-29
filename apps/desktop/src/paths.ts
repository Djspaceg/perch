/**
 * Where the runner finds things, and the environment variables that move each one.
 *
 * ```text
 * PERCH_LAYOUTS_DIR        the layouts folder             default ~/Documents/perch/layouts
 * PERCH_USER_DATA_DIR      Electron's userData            default the OS's, per app name
 *   or --user-data-dir     (the command line wins)
 * PERCH_RUNTIME_PAGE_DIR   the built runtime page         default apps/runtime/dist/page
 * PERCH_EDITOR_PAGE_DIR    the built editor page          default apps/editor/dist/page
 * ```
 *
 * The first two exist so a test launch never touches the human's real folder or settings, and a
 * first real launch is a genuine first run. userData also scopes the single-instance lock, so a
 * launch with its own userData never hands off to, or collides with, a perch already running.
 *
 * The two pages and the seed layouts are found in one of two places, and `resources` says which:
 * `null` in a run from the repository, where they sit relative to this file's compiled location,
 * `apps/desktop/dist/`; `process.resourcesPath` in a packaged app, where the packaging config
 * (`packaging.ts`) copied them, under the names in `RESOURCE_FOLDERS`. A packaged app never
 * reaches back into a repository.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Env = Readonly<Record<string, string | undefined>>;

const HERE = dirname(fileURLToPath(import.meta.url));

/** `apps/desktop/dist`'s place in the repository, for the repository-relative defaults. */
const REPO_ROOT = resolve(HERE, '../../..');

/** Where a packaged app keeps the pages and the seed: folders in its resources folder. */
export const RESOURCE_FOLDERS = {
  runtimePage: 'runtime-page',
  editorPage: 'editor-page',
  seedLayouts: 'layouts',
} as const;

/** The resources folder of a packaged app, or `null` for a run from the repository. */
export function appResources(app: {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
}): string | null {
  return app.isPackaged ? app.resourcesPath : null;
}

export function layoutsFolder(env: Env, documentsPath: string): string {
  return nonEmpty(env['PERCH_LAYOUTS_DIR']) ?? join(documentsPath, 'perch', 'layouts');
}

/** The `--user-data-dir` switch's value, as `--user-data-dir=<dir>` or `--user-data-dir <dir>`. */
const USER_DATA_SWITCH = '--user-data-dir';

export function userDataOverride(env: Env, argv: readonly string[] = []): string | null {
  let fromArgv: string | undefined;
  argv.forEach((arg, index) => {
    if (arg.startsWith(`${USER_DATA_SWITCH}=`)) fromArgv = arg.slice(USER_DATA_SWITCH.length + 1);
    else if (arg === USER_DATA_SWITCH) fromArgv = argv[index + 1];
  });

  return nonEmpty(fromArgv) ?? nonEmpty(env['PERCH_USER_DATA_DIR']) ?? null;
}

export function runtimePageFolder(env: Env, resources: string | null): string {
  return (
    nonEmpty(env['PERCH_RUNTIME_PAGE_DIR']) ??
    (resources === null
      ? join(REPO_ROOT, 'apps', 'runtime', 'dist', 'page')
      : join(resources, RESOURCE_FOLDERS.runtimePage))
  );
}

export function editorPageFolder(env: Env, resources: string | null): string {
  return (
    nonEmpty(env['PERCH_EDITOR_PAGE_DIR']) ??
    (resources === null
      ? join(REPO_ROOT, 'apps', 'editor', 'dist', 'page')
      : join(resources, RESOURCE_FOLDERS.editorPage))
  );
}

/** The layouts a first run copies from: the repository's `layouts/`, or the packaged copy. */
export function seedLayoutsFolder(resources: string | null): string {
  return resources === null
    ? join(REPO_ROOT, 'layouts')
    : join(resources, RESOURCE_FOLDERS.seedLayouts);
}

/** The compiled preload. `.cjs`, because a sandboxed preload is a CommonJS script. */
export function runtimePreloadPath(): string {
  return join(HERE, 'runtime-preload.cjs');
}

/** The editor window's compiled preload. */
export function editorPreloadPath(): string {
  return join(HERE, 'editor-preload.cjs');
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : resolve(trimmed);
}
