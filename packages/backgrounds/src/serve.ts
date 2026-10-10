/**
 * A cached file as an HTTP response, with byte ranges.
 *
 * A `<video>` reads its source by ranges, and Chromium will not seek, and so cannot loop smoothly,
 * a source that answers every request with the whole file. So a `Range: bytes=...` of one range is
 * answered 206 with that slice; one this cannot satisfy is 416, as HTTP says; anything more
 * elaborate (several ranges) gets the whole file, which HTTP allows a server to send instead.
 *
 * Returns a web `Response`, which Electron's `protocol.handle` takes as it is and a Node server can
 * copy onto its own reply (`dev-endpoint.ts`). The caller has already decided `path` may be served:
 * this module only reads it.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

const TYPES: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  png: 'image/png',
  webm: 'video/webm',
};

export async function serveCachedFile(
  path: string,
  method: string,
  range: string | null,
): Promise<Response> {
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }

  let size: number;
  try {
    const found = await stat(path);
    if (!found.isFile()) return notFound();
    size = found.size;
  } catch {
    return notFound();
  }

  const headers = new Headers({
    'content-type': TYPES[path.split('.').pop() ?? ''] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    // A cache name never changes what it holds: a new download is a new file renamed over it.
    'cache-control': 'private, max-age=3600',
  });

  const wanted = range === null ? null : parseRange(range, size);
  if (wanted === 'unsatisfiable') {
    headers.set('content-range', `bytes */${String(size)}`);
    return new Response(null, { status: 416, headers });
  }

  const [start, end] = wanted ?? [0, size - 1];
  headers.set('content-length', String(Math.max(0, end - start + 1)));
  if (wanted !== null)
    headers.set('content-range', `bytes ${String(start)}-${String(end)}/${String(size)}`);
  const status = wanted === null ? 200 : 206;

  if (method === 'HEAD' || size === 0) return new Response(null, { status, headers });
  const stream = Readable.toWeb(
    createReadStream(path, { start, end }),
  ) as ReadableStream<Uint8Array>;
  return new Response(stream, { status, headers });
}

/**
 * One `bytes=` range as inclusive `[start, end]`, clamped to the file; `'unsatisfiable'` for one
 * that names no byte of it; `null` for a header this does not handle, which means the whole file.
 */
function parseRange(
  header: string,
  size: number,
): readonly [number, number] | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return null;
  const [, from = '', to = ''] = match;
  if (from === '' && to === '') return null;

  if (from === '') {
    // `bytes=-N`: the last N bytes.
    const suffix = Number(to);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return [Math.max(0, size - suffix), size - 1];
  }

  const start = Number(from);
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (start >= size || start > end) return 'unsatisfiable';
  return [start, end];
}

function notFound(): Response {
  return new Response('not found', { status: 404 });
}
