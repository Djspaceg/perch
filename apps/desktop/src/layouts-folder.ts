/**
 * The layouts folder: plain `.json` layout documents in one directory, which the runner lists,
 * opens and watches, and which the editor will write.
 *
 * ## Seeding, and why it can never overwrite
 *
 * A folder with no documents in it is seeded from the repository's `layouts/`, so a first launch
 * shows a dashboard rather than an empty window. What is copied is each top-level `.json` and every
 * file under a `<name>.assets/` directory, because a layout references its media by a path relative
 * to itself and a copied layout without its media would render missing-asset boxes. Not the README,
 * and not `invalid/`, which holds documents that exist only to be refused.
 *
 * Every copy is `COPYFILE_EXCL`: the OS refuses to replace a file that exists, so no race between
 * "is it there" and "copy it" can overwrite a user's file, and a user's file where a seed would go
 * is simply kept. A folder that already holds a document is not seeded at all, so deleting a seed
 * layout you do not want is not undone on the next launch.
 */

import { constants } from 'node:fs';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

/** One layout document in the folder. */
export interface LayoutDocument {
  /** The file name without `.json`: what the tray and the page call it. */
  readonly name: string;
  readonly path: string;
}

/**
 * The documents directly in `folder`, sorted by name as a person would sort them.
 *
 * Not recursive, and dotfiles are skipped: an editor's `.desk.json.swp` or a Finder `._desk.json`
 * is not a layout. A missing folder lists as empty.
 */
export async function listLayoutDocuments(folder: string): Promise<LayoutDocument[]> {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  return entries
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith('.json') && !entry.name.startsWith('.'),
    )
    .map((entry) => ({
      name: entry.name.slice(0, -'.json'.length),
      path: join(folder, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export interface PreparedFolder {
  /** Whether the folder did not exist and was made. */
  readonly created: boolean;
  /** What was copied in, as paths relative to the folder. Empty when nothing was seeded. */
  readonly seeded: readonly string[];
}

/** Make sure `folder` exists, and seed it from `seedFolder` if it holds no document. */
export async function prepareLayoutsFolder(
  folder: string,
  seedFolder: string,
): Promise<PreparedFolder> {
  const created = !(await exists(folder));
  await mkdir(folder, { recursive: true });

  if ((await listLayoutDocuments(folder)).length > 0) return { created, seeded: [] };

  const seeded: string[] = [];
  for (const source of await seedFiles(seedFolder)) {
    const target = join(folder, relative(seedFolder, source));
    try {
      await mkdir(join(target, '..'), { recursive: true });
      await copyFile(source, target, constants.COPYFILE_EXCL);
      seeded.push(relative(folder, target).split('\\').join('/'));
    } catch (error) {
      // Somebody's file is already there. Theirs wins, always.
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
  }

  return { created, seeded };
}

/** The seed's documents and the files of their `.assets` directories. Empty if there is no seed. */
async function seedFiles(seedFolder: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(seedFolder, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = join(seedFolder, entry.name);
    if (entry.isFile() && entry.name.endsWith('.json')) files.push(path);
    if (entry.isDirectory() && entry.name.endsWith('.assets'))
      files.push(...(await filesUnder(path)));
  }

  return files;
}

async function filesUnder(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isFile()) files.push(path);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
  }

  return files;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
