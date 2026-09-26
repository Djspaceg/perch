/**
 * Vite for the editor page, plus the one thing a browser cannot do: write a file.
 *
 * The page half is `apps/runtime/vite.config.ts` with two differences, and they are the only two —
 * the same alias table, the same `dist/page` output for the same reason (`tsc -b` owns `dist/`, and
 * Vite empties its `outDir`), the same `strictPort`.
 *
 *  1. **Port 5402.** Three workers share this checkout and its ports; the runtime is on Vite's
 *     default. Fixed rather than automatic so a capture navigates somewhere known: a dev server that
 *     helpfully moves to the next free port turns a screenshot into a picture of whatever else was
 *     listening.
 *  2. **A save endpoint**, below.
 *  3. **`PERCH_` reaches the page**, as it does the runtime's, for `PERCH_RELAY_URL`: the relay URL the
 *     dev stack hands the editor. See `src/main.tsx`.
 *
 * ## The save endpoint
 *
 * `PUT /__perch/layout/<name>` writes `layouts/<name>.json` in this checkout. That is the whole
 * mechanism, and its limits are deliberate and documented in README.md:
 *
 * - **It exists only under `npm run dev`.** A built bundle has no server, so a save from one fails
 *   with a 404 rather than appearing to work. The editor is a development tool for this repository;
 *   the alternatives — the File System Access API, download-and-replace — are weighed in DECISIONS.md.
 * - **It only edits files that already exist.** This slice has no "new layout", so a `PUT` to a name
 *   with no file is a 404 rather than a creation. It is also the cheapest possible guard against a
 *   request writing somewhere surprising: the only reachable paths are ones that were already there.
 * - **Its validation is shallow, and the client's is not.** This middleware checks the *name*
 *   (`resolveSaveTarget`), that the body parses as JSON, and that the target exists. It does **not**
 *   check that the body is a valid layout. Semantic validation lives in the page, where
 *   `validateLayout` runs on every keystroke against `WIDGET_REGISTRY` — and it has to, because
 *   re-deriving the widget vocabulary here would mean importing a React package into the dev server's
 *   Node process and requiring a `tsc -b` before the config could load. That would couple the dev
 *   server to `ui-kit`'s ability to run outside a browser, and `ui-kit` has another writer. So the
 *   guarantee "no invalid layout reaches disk" is the editor's, stated here so nobody reads this
 *   endpoint as a second line of defence it is not.
 *
 * `resolveSaveTarget` *is* imported from `src/`, because a containment rule is exactly the thing that
 * must not be restated: an HTTP endpoint takes its name from a browser, so the rule is a tested
 * function rather than a comment beside a write. It is imported with an explicit `.ts` extension —
 * this file is bundled by Vite's config loader (Oxc in Vite 8), so an extensionless or `.js`
 * specifier would be relying on a TypeScript resolution behaviour that belongs to a different
 * transpiler. It imports nothing itself, so nothing else follows it into the server process.
 */

import { randomBytes } from 'node:crypto';
import { rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { perchAliases } from '../../vitest.aliases.js';
import { LAYOUTS_DIRECTORY, resolveSaveTarget } from './src/save-target.ts';

/** The repository root: two directories up from `apps/editor/`. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The only directory this endpoint may write into, with a trailing separator. */
const LAYOUTS_ROOT = join(REPO_ROOT, LAYOUTS_DIRECTORY) + sep;

/** Where the endpoint listens. Must match `SAVE_ENDPOINT_PREFIX` in `src/save.ts`. */
const SAVE_PREFIX = '/__perch/layout/';

/**
 * How large a layout may be, in bytes.
 *
 * `layouts/desk-1920x400.json` is about 4 KB, so this is three orders of magnitude of headroom and
 * still a bound: a request body is read into memory, and an unbounded read on a local endpoint is a
 * dev server that can be made to exhaust its own heap by a page bug.
 */
const MAX_BODY_BYTES = 1_000_000;

/** The dev-server middleware that writes a layout. */
function layoutSavePlugin(): Plugin {
  return {
    name: 'perch-layout-save',

    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (typeof request.url !== 'string' || !request.url.startsWith(SAVE_PREFIX)) {
          next();
          return;
        }

        // The handler is async and Connect's `next` is not, so the promise is explicitly discarded
        // after being given a terminal `catch`. A rejection here must answer the request: a save that
        // hangs looks to the editor like a server that is thinking about it.
        void handleSave(request, response).catch((error: unknown) => {
          refuse(response, 500, `the write failed: ${describeError(error)}`);
        });
      });
    },
  };
}

async function handleSave(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'PUT') {
    refuse(response, 405, `${SAVE_PREFIX}<name> accepts PUT, got ${String(request.method)}`);
    return;
  }

  const name = decodeName(String(request.url).slice(SAVE_PREFIX.length));
  if (name === null) {
    refuse(response, 400, 'the layout name is not valid percent-encoding');
    return;
  }

  const target = resolveSaveTarget(name);
  if (!target.ok) {
    refuse(response, 400, target.reason);
    return;
  }

  const absolute = join(REPO_ROOT, target.path);
  // `resolveSaveTarget` already excludes every separator, so this cannot currently fail. It is here
  // because it is the check that does not depend on that regex being right: a containment rule and a
  // containment assertion should not share an implementation.
  if (!absolute.startsWith(LAYOUTS_ROOT)) {
    refuse(response, 400, `${target.path} resolves outside ${LAYOUTS_DIRECTORY}/`);
    return;
  }

  if (!(await isExistingFile(absolute))) {
    refuse(
      response,
      404,
      `${target.path} does not exist. this editor edits the layouts that are there and does not create files`,
    );
    return;
  }

  const body = await readBody(request);
  if (body === null) {
    refuse(response, 413, `a layout must be under ${MAX_BODY_BYTES} bytes`);
    return;
  }

  try {
    JSON.parse(body);
  } catch (error) {
    refuse(response, 400, `the body is not JSON: ${describeError(error)}`);
    return;
  }

  await writeAtomically(absolute, body);

  response.statusCode = 204;
  response.end();
}

/**
 * Write via a temporary file in the same directory, then rename.
 *
 * `rename` within one filesystem is atomic, so a reader — the runtime's dev server, watching
 * `layouts/` — sees either the old file or the new one and never a half-written one. Writing in place
 * would publish a truncated layout for as long as the write took, and a truncated layout is a
 * validation failure on somebody else's screen.
 *
 * The temporary name carries random bytes rather than a counter or a pid, so two saves racing cannot
 * pick the same scratch file. It is cleaned up on a failed rename; a crash between the two leaves a
 * `.tmp-` file in `layouts/`, which is inert and visible rather than silent corruption.
 */
async function writeAtomically(path: string, contents: string): Promise<void> {
  const temporary = `${path}.tmp-${randomBytes(6).toString('hex')}`;

  await writeFile(temporary, contents, 'utf8');
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/** The name from the URL, or `null` if it is not decodable. Query and fragment are dropped. */
function decodeName(suffix: string): string | null {
  const raw = suffix.split('?')[0]?.split('#')[0] ?? '';

  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** Whether `path` is an existing regular file. A directory is not a layout. */
async function isExistingFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** The request body as text, or `null` if it exceeded the cap. */
async function readBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Answer with a status and a sentence.
 *
 * Plain text, and the sentence is the whole body: `saveDraft` puts it in front of the author verbatim,
 * so "layouts/x.json does not exist…" is more use than a JSON envelope they never see.
 */
function refuse(response: ServerResponse, status: number, reason: string): void {
  response.statusCode = status;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(reason);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default defineConfig({
  plugins: [react(), layoutSavePlugin()],

  /**
   * The same alias table Vitest uses, imported rather than restated, so the page and the tests
   * resolve `@perch/ui-kit` identically — to source. See the runtime's config for the full argument.
   */
  resolve: { alias: perchAliases },

  // `VITE_` kept beside it; see the runtime's config for why both.
  envPrefix: ['VITE_', 'PERCH_'],

  build: {
    // `dist/` belongs to `tsc -b` and Vite empties its `outDir`. Covered by the existing `dist` entry
    // in `.gitignore`.
    outDir: 'dist/page',
    sourcemap: true,
  },

  server: {
    // Contended: three workers, one checkout. 5402 is this one's.
    port: 5402,
    strictPort: true,
  },
});
