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
 * launch with its own userData never hands off to, or collides with, a perch already running. The page and the seed are found relative to this
 * file's compiled location, `apps/desktop/dist/`, which holds while the app runs from the
 * repository; packaging will move both into the app's resources and replace these two defaults.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Env = Readonly<Record<string, string | undefined>>;

const HERE = dirname(fileURLToPath(import.meta.url));

/** `apps/desktop/dist`'s place in the repository, for the two repository-relative defaults. */
const REPO_ROOT = resolve(HERE, '../../..');

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

export function runtimePageFolder(env: Env): string {
  return (
    nonEmpty(env['PERCH_RUNTIME_PAGE_DIR']) ?? join(REPO_ROOT, 'apps', 'runtime', 'dist', 'page')
  );
}

export function editorPageFolder(env: Env): string {
  return (
    nonEmpty(env['PERCH_EDITOR_PAGE_DIR']) ?? join(REPO_ROOT, 'apps', 'editor', 'dist', 'page')
  );
}

/** The repository's `layouts/`, which a first run copies from. */
export function seedLayoutsFolder(): string {
  return join(REPO_ROOT, 'layouts');
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
