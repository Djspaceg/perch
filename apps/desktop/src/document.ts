/**
 * The open document: read it for the page, and watch it so an editor's save shows up.
 *
 * ## The text goes to the page unparsed
 *
 * The main process never parses or validates a layout. The page runs the file's bytes through
 * `loadLayoutJson`, exactly as it does for a bundled layout, so a malformed document is refused by
 * the runtime's own error view with the runtime's own wording, and this process stays out of the
 * layout format entirely.
 *
 * ## The folder is watched, not the file
 *
 * Editors save atomically: write a temporary file, rename it over the original. That replaces the
 * file, and a watch on the old file then follows an inode nobody will write again — on macOS it goes
 * silent after the first save. Watching the directory and filtering by name survives any number of
 * replacements, a deletion, and the file coming back.
 */

import { readFileSync, watch } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { DOCUMENT_ASSET_ORIGIN } from './app-protocol.js';
import type { LayoutDocument } from './layouts-folder.js';

/** What the page is handed. Serialisable, because it crosses the IPC boundary. */
export interface DocumentPayload {
  readonly name: string;
  /** The file's text, or `null` if there is no such file right now. */
  readonly text: string | null;
  /**
   * Each media file beside the document, as the `src` a layout writes mapped to the URL that serves
   * it. A `src` missing from here renders as the canvas's missing-asset box, as it does in a bundle.
   */
  readonly assets: Readonly<Record<string, string>>;
}

/** The media extensions the runtime's bundled catalogue picks up; see `layout-catalogue.ts`. */
const MEDIA_EXTENSIONS = ['.svg', '.png'];

/** How deep below the document's folder media is looked for, and how much of it. */
const MEDIA_DEPTH = 3;
const MEDIA_LIMIT = 2000;

export async function readLayoutDocument(document: LayoutDocument): Promise<DocumentPayload> {
  let text: string | null;
  try {
    text = await readFile(document.path, 'utf8');
  } catch (error) {
    if (!isMissing(error)) throw error;
    text = null;
  }

  const assets: Record<string, string> = {};
  if (text !== null) {
    for (const src of await mediaUnder(dirname(document.path), '', MEDIA_DEPTH)) {
      assets[src] = `${DOCUMENT_ASSET_ORIGIN}/${src.split('/').map(encodeURIComponent).join('/')}`;
    }
  }

  return { name: document.name, text, assets };
}

/**
 * Call `onChange` whenever the document's text changes on disk, including to "not there".
 *
 * Events are debounced, because one save is several events, and a change is reported only when the
 * text differs from the last text seen, so a touch or a save of identical bytes re-renders nothing.
 * Returns a function that stops watching.
 */
export function watchDocument(
  path: string,
  onChange: (payload: DocumentPayload) => void,
  debounceMs = 100,
  onError: (error: Error) => void = () => undefined,
): () => void {
  const document: LayoutDocument = { name: basename(path, '.json'), path };
  const filename = basename(path);
  let last = readTextSync(path);
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const check = (): void => {
    readLayoutDocument(document).then(
      (payload) => {
        if (stopped || payload.text === last) return;
        last = payload.text;
        onChange(payload);
      },
      (error: unknown) => {
        onError(error instanceof Error ? error : new Error(String(error)));
      },
    );
  };

  const watcher = watch(dirname(path), (_event, changed) => {
    // `changed` is null on platforms that cannot say; then the file is simply re-read.
    if (changed !== null && changed !== filename) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(check, debounceMs);
  });
  watcher.on('error', onError);

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    watcher.close();
  };
}

/** Media files below `directory`, as `/`-separated paths relative to the document's folder. */
async function mediaUnder(directory: string, prefix: string, depth: number): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    if (found.length >= MEDIA_LIMIT) break;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isFile() && MEDIA_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      found.push(relative);
    }
    if (entry.isDirectory() && depth > 0) {
      found.push(...(await mediaUnder(join(directory, entry.name), relative, depth - 1)));
    }
  }

  return found.sort();
}

/** The baseline for change detection, taken synchronously so a write straight after is not missed. */
function readTextSync(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
