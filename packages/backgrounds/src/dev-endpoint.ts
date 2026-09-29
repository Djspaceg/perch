/**
 * The Vite dev servers' background endpoint: `npm run dev` gets the desktop app's cache, behind
 * HTTP instead of IPC and a custom scheme (docs/backgrounds.md, "Browser dev mode").
 *
 * ```text
 * GET /__perch/backgrounds/ensure?ref=&w=&h=      { ok, url } | { ok: false, code, reason }
 * GET /__perch/backgrounds/preview?ref=&w=&h=     { ok, kind, url } | the same failure
 * GET /__perch/backgrounds/file/<cache name>      the file, with byte ranges
 * ```
 *
 * The cache checks the reference and the target, as it does for the desktop's pages, and only
 * cache names are served. Answers never carry a path or a server. A connect-style middleware, so
 * both configs mount it with `server.middlewares.use` and nothing here imports Vite.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { BackgroundCache, EnsureResult, PreviewResult } from './cache.js';
import { DEV_BACKGROUNDS_PREFIX, DEV_FILE_PREFIX } from './dev-client.js';
import { serveCachedFile } from './serve.js';

/** A cache name as the dev server serves it. */
export function devCacheUrlFor(relative: string): string {
  return `${DEV_FILE_PREFIX}${relative.split('/').map(encodeURIComponent).join('/')}`;
}

/** The dev cache: `PERCH_BACKGROUNDS_DIR`, else under the repository's `node_modules/.cache`. */
export function devBackgroundsRoot(
  env: Readonly<Record<string, string | undefined>>,
  repoRoot: string,
): string {
  const chosen = env['PERCH_BACKGROUNDS_DIR']?.trim();
  return chosen === undefined || chosen === ''
    ? join(repoRoot, 'node_modules', '.cache', 'perch', 'backgrounds')
    : resolve(chosen);
}

/** What a page is told about a result: the URL or the failure, never a path or a server. */
export type PageAnswer =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: true; readonly kind: 'image' | 'video'; readonly url: string }
  | { readonly ok: false; readonly code: string; readonly reason: string };

export function toPageAnswer(result: EnsureResult | PreviewResult): PageAnswer {
  if (!result.ok) return { ok: false, code: result.code, reason: result.reason };
  return 'kind' in result
    ? { ok: true, kind: result.kind, url: result.url }
    : { ok: true, url: result.url };
}

export function devBackgroundsMiddleware(
  cache: BackgroundCache,
): (request: IncomingMessage, response: ServerResponse, next: () => void) => void {
  return (request, response, next) => {
    const url = request.url ?? '';
    if (!url.startsWith(DEV_BACKGROUNDS_PREFIX)) {
      next();
      return;
    }
    answer(cache, request, response, url).catch((error: unknown) => {
      if (!response.headersSent) response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  };
}

async function answer(
  cache: BackgroundCache,
  request: IncomingMessage,
  response: ServerResponse,
  url: string,
): Promise<void> {
  const parsed = new URL(url, 'http://dev.invalid');
  const route = parsed.pathname.slice(DEV_BACKGROUNDS_PREFIX.length);

  if (route === 'ensure' || route === 'preview') {
    const ref = parsed.searchParams.get('ref') ?? '';
    // Anything but digits is not a number of pixels; `Number('')` would be zero, `Number(' 4')` four.
    const pixels = (value: string | null): number =>
      value !== null && /^[0-9]{1,6}$/.test(value) ? Number(value) : Number.NaN;
    const target = {
      width: pixels(parsed.searchParams.get('w')),
      height: pixels(parsed.searchParams.get('h')),
    };
    const result =
      route === 'ensure' ? await cache.ensure(ref, target) : await cache.preview(ref, target);
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    response.end(JSON.stringify(toPageAnswer(result)));
    return;
  }

  if (route.startsWith('file/')) {
    let name: string | null;
    try {
      name = decodeURIComponent(route.slice('file/'.length));
    } catch {
      name = null;
    }
    const path = name === null ? null : cache.fileFor(name);
    const served =
      path === null
        ? new Response('not found', { status: 404 })
        : await serveCachedFile(path, request.method ?? 'GET', headerOf(request, 'range'));
    await copy(served, response);
    return;
  }

  response.statusCode = 404;
  response.end('not found');
}

function headerOf(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return typeof value === 'string' ? value : null;
}

/** A web `Response` onto a Node reply. */
async function copy(from: Response, to: ServerResponse): Promise<void> {
  to.statusCode = from.status;
  from.headers.forEach((value, key) => {
    to.setHeader(key, value);
  });
  if (from.body === null) {
    to.end();
    return;
  }
  await new Promise<void>((done, fail) => {
    Readable.fromWeb(from.body as NodeReadableStream<Uint8Array>)
      .on('error', fail)
      .pipe(to)
      .on('finish', done)
      .on('error', fail);
  });
}
