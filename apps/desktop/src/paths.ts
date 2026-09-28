/**
 * Where the runner finds things, and the environment variables that move each one.
 *
 * ```text
 * PERCH_LAYOUTS_DIR        the layouts folder             default ~/Documents/perch/layouts
 * PERCH_USER_DATA_DIR      Electron's userData            default the OS's, per app name
 * PERCH_RUNTIME_PAGE_DIR   the built runtime page         default apps/runtime/dist/page
 * ```
 *
 * The first two exist so a test launch never touches the human's real folder or settings, and a
 * first real launch is a genuine first run. The page and the seed are found relative to this
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

export function userDataOverride(env: Env): string | null {
  return nonEmpty(env['PERCH_USER_DATA_DIR']) ?? null;
}

export function runtimePageFolder(env: Env): string {
  return (
    nonEmpty(env['PERCH_RUNTIME_PAGE_DIR']) ?? join(REPO_ROOT, 'apps', 'runtime', 'dist', 'page')
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

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : resolve(trimmed);
}
