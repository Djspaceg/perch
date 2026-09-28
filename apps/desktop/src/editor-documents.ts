/**
 * The editor's documents, on the main process side: which files the editor window may read and
 * write, what each is called, and the write itself.
 *
 * ## The page names documents, never paths
 *
 * Every document the editor can see gets a **key**: its file name without `.json`, made into a name
 * the editor's save path accepts, and numbered when two files would share one (`desk`, `desk-2`).
 * The key is what the picker shows and what a save's URL carries. Only this registry maps a key to a
 * path, and a key exists only for a file in the layouts folder or one the author chose in a native
 * Open or Save As dialog. So the page can write exactly those files, and no request from it — however
 * it is built — reaches anything else.
 *
 * ## A save is the dev server's, answered the same way
 *
 * The page saves through the editor's own `saveDraft`, which refuses an invalid layout before any
 * request is made. What arrives here is the same `PUT /__perch/layout/<name>` body the Vite
 * endpoint gets (`apps/editor/vite.config.ts`), checked the same way — the name, a size cap, that the
 * body is JSON — and answered with the same statuses and sentences. The one difference is the target:
 * a registered document rather than `layouts/<name>.json` in the checkout, and it may be a new file,
 * for Save As.
 *
 * ## Atomic
 *
 * A temporary file beside the target, then a rename over it: the runner, which watches the folder,
 * sees the old document or the new one and never half of one.
 */

import { randomBytes } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { editorAssetUrl } from './app-protocol.js';
import { mediaBeside } from './document.js';
import { listLayoutDocuments } from './layouts-folder.js';

/** The URL prefix a save arrives on. Restated from `apps/editor/src/save.ts`'s `SAVE_ENDPOINT_PREFIX`. */
export const SAVE_URL_PREFIX = '/__perch/layout/';

/** The dev server's cap, for the same reason: a request body is held in memory. */
export const MAX_DOCUMENT_BYTES = 1_000_000;

/** A document as the editor page is handed it. Serialisable: it crosses the IPC boundary. */
export interface EditorDocumentEntry {
  readonly name: string;
  readonly path: string;
  readonly text: string;
  readonly assets: Readonly<Record<string, string>>;
}

/** The characters the editor's `resolveSaveTarget` allows, and its length limit, with room for `-n`. */
const KEY_CHARACTERS = /[^A-Za-z0-9._-]+/g;
const KEY_MAX_LENGTH = 120;

/**
 * The key for `path`: its own if `taken` already maps a key to it, else its file name made into a
 * saveable name, numbered past any key already taken by another path.
 */
export function documentKey(path: string, taken: ReadonlyMap<string, string>): string {
  for (const [key, held] of taken) if (held === path) return key;

  const stem = basename(path).replace(/\.json$/i, '');
  const cleaned = stem
    .replace(KEY_CHARACTERS, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/-+$/, '')
    .slice(0, KEY_MAX_LENGTH);
  const base = cleaned === '' ? 'layout' : cleaned;
  if (!taken.has(base)) return base;

  let n = 2;
  while (taken.has(`${base}-${String(n)}`)) n += 1;
  return `${base}-${String(n)}`;
}

/** A Save As path with `.json` on the end, whatever the dialog was given. */
export function withJsonExtension(path: string): string {
  return /\.json$/i.test(path) ? path : `${path}.json`;
}

export interface DocumentRegistry {
  readonly folder: string;
  /** The key for `path`, registering it if this is the first time it is seen. */
  keyOf(path: string): string;
  /** The path a key names, or `undefined` for a key never given out. */
  pathOf(key: string): string | undefined;
  /** The folder a key's document sits in, for its media; `null` for a key never given out. */
  folderOf(key: string): string | null;
  /**
   * The folder's documents, sorted, then each document registered from elsewhere, in the order it
   * was registered; each read now. A registered file that is not on disk (yet) is left out.
   */
  entries(): Promise<EditorDocumentEntry[]>;
}

export function createDocumentRegistry(folder: string): DocumentRegistry {
  const keys = new Map<string, string>();
  const registered: string[] = [];

  const keyOf = (path: string): string => {
    const absolute = resolve(path);
    const key = documentKey(absolute, keys);
    if (!keys.has(key)) {
      keys.set(key, absolute);
      registered.push(absolute);
    }
    return key;
  };

  return {
    folder,
    keyOf,
    pathOf: (key) => keys.get(key),
    folderOf: (key) => {
      const path = keys.get(key);
      return path === undefined ? null : dirname(path);
    },
    entries: async () => {
      const listed = (await listLayoutDocuments(folder)).map((document) => resolve(document.path));
      const inFolder = new Set(listed);
      const paths = [...listed, ...registered.filter((path) => !inFolder.has(path))];
      const media = new Map<string, Promise<string[]>>();

      const entries: EditorDocumentEntry[] = [];
      for (const path of paths) {
        let text: string;
        try {
          text = await readFile(path, 'utf8');
        } catch {
          continue;
        }
        const key = keyOf(path);
        const directory = dirname(path);
        let found = media.get(directory);
        if (found === undefined) {
          found = mediaBeside(directory);
          media.set(directory, found);
        }
        const assets = Object.fromEntries(
          (await found).map((src) => [src, editorAssetUrl(key, src)]),
        );
        entries.push({ name: key, path, text, assets });
      }

      return entries;
    },
  };
}

/** Why `text` may not be written as a layout document, or `null` when it may. */
function layoutTextProblem(
  text: string,
): { readonly status: number; readonly reason: string } | null {
  if (Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT_BYTES) {
    return { status: 413, reason: `a layout must be under ${String(MAX_DOCUMENT_BYTES)} bytes` };
  }
  try {
    JSON.parse(text);
  } catch (error) {
    return { status: 400, reason: `the body is not JSON: ${describe(error)}` };
  }

  return null;
}

/**
 * Write `text` to `path` atomically, creating the file if it is not there. Rejects, writing
 * nothing, for text that is not JSON or is over the cap.
 */
export async function writeLayoutDocument(path: string, text: string): Promise<void> {
  const problem = layoutTextProblem(text);
  if (problem !== null) throw new Error(problem.reason);

  // Random rather than a counter, so two saves racing never share a scratch file.
  const temporary = `${path}.tmp-${randomBytes(6).toString('hex')}`;
  await writeFile(temporary, text, 'utf8');
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/** A save's answer: what `SaveTransport` turns into a `fetch`-shaped response. */
export interface SaveReply {
  readonly ok: boolean;
  readonly status: number;
  readonly text: string;
}

/** Answer one save from the editor page. Never throws: every failure is a status and a sentence. */
export async function handleSaveRequest(
  registry: DocumentRegistry,
  url: unknown,
  body: unknown,
): Promise<SaveReply> {
  if (typeof url !== 'string' || !url.startsWith(SAVE_URL_PREFIX) || typeof body !== 'string') {
    return refuse(400, `a save is ${SAVE_URL_PREFIX}<name> with a text body`);
  }

  let name: string;
  try {
    name = decodeURIComponent(url.slice(SAVE_URL_PREFIX.length).split(/[?#]/)[0] ?? '');
  } catch {
    return refuse(400, 'the layout name is not valid percent-encoding');
  }

  const path = registry.pathOf(name);
  if (path === undefined) {
    return refuse(
      404,
      `no document named ${JSON.stringify(name)} is open in this editor. it writes the layouts folder's documents and ones chosen in Open or Save As`,
    );
  }

  const problem = layoutTextProblem(body);
  if (problem !== null) return refuse(problem.status, problem.reason);

  try {
    await writeLayoutDocument(path, body);
  } catch (error) {
    return refuse(500, `the write to ${path} failed: ${describe(error)}`);
  }

  return { ok: true, status: 204, text: '' };
}

function refuse(status: number, text: string): SaveReply {
  return { ok: false, status, text };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
