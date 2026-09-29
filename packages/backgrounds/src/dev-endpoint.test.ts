/**
 * The dev server's background endpoint: the same cache as the desktop's, behind three routes, so
 * `npm run dev` fetches, caches and plays a background as the desktop app does.
 */

import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEV_BACKGROUNDS_PREFIX,
  createBackgroundCache,
  devBackgroundsMiddleware,
  devBackgroundsRoot,
  devCacheUrlFor,
} from '@perch/backgrounds/node';

const MP4 = Uint8Array.from([
  0,
  0,
  0,
  0x1c,
  0x66,
  0x74,
  0x79,
  0x70,
  ...new Array<number>(300).fill(3),
]);

let root: string;
let server: Server;
let base: string;
let fetched: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'perch-dev-backgrounds-'));
  fetched = [];
  const cache = createBackgroundCache({
    root,
    urlFor: devCacheUrlFor,
    fetch: (url) => {
      fetched.push(url);
      return Promise.resolve(
        url.endsWith('a042.mp4')
          ? new Response(MP4, {
              status: 200,
              headers: { 'content-length': String(MP4.byteLength) },
            })
          : new Response('no', { status: 404 }),
      );
    },
  });
  const middleware = devBackgroundsMiddleware(cache);
  server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 418;
      response.end('not mine');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address !== null ? String(address.port) : '0'}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

describe('devBackgroundsMiddleware', () => {
  it('ensures a background and serves it back, with ranges', async () => {
    const answer: unknown = await (
      await fetch(`${base}${DEV_BACKGROUNDS_PREFIX}ensure?ref=thermalright:a042&w=1920&h=400`)
    ).json();

    expect(answer).toEqual({
      ok: true,
      url: '/__perch/backgrounds/file/thermalright/1920x440/a042.mp4',
    });
    const file = await fetch(`${base}${(answer as { url: string }).url}`, {
      headers: { range: 'bytes=0-7' },
    });
    expect(file.status).toBe(206);
    expect(file.headers.get('content-type')).toBe('video/mp4');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(MP4.subarray(0, 8));
  });

  it('answers a failure as JSON, with no path or server in it', async () => {
    const response = await fetch(
      `${base}${DEV_BACKGROUNDS_PREFIX}ensure?ref=thermalright:a041&w=1920&h=400`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'not-found',
      reason: 'not hosted at 1920x440 (international: HTTP 404; china: HTTP 404)',
    });
  });

  it('answers a preview', async () => {
    const answer: unknown = await (
      await fetch(`${base}${DEV_BACKGROUNDS_PREFIX}preview?ref=thermalright:a042&w=1920&h=400`)
    ).json();
    expect(answer).toMatchObject({ ok: true, kind: 'video' });
  });

  it('refuses a bad target before any request, and names only cache files', async () => {
    const bad: unknown = await (
      await fetch(`${base}${DEV_BACKGROUNDS_PREFIX}ensure?ref=thermalright:a042&w=wide&h=400`)
    ).json();
    expect(bad).toMatchObject({ ok: false, code: 'invalid' });
    expect(fetched).toEqual([]);

    expect(
      (await fetch(`${base}${DEV_BACKGROUNDS_PREFIX}file/thermalright/..%2F..%2Fetc`)).status,
    ).toBe(404);
    expect(
      (await fetch(`${base}${DEV_BACKGROUNDS_PREFIX}file/thermalright/1920x440/a042.nopng`)).status,
    ).toBe(404);
  });

  it('passes anything else on', async () => {
    expect((await fetch(`${base}/index.html`)).status).toBe(418);
  });
});

describe('devBackgroundsRoot', () => {
  it('is under the repository by default, and moved by PERCH_BACKGROUNDS_DIR', () => {
    expect(devBackgroundsRoot({}, '/repo')).toBe(
      join('/repo', 'node_modules', '.cache', 'perch', 'backgrounds'),
    );
    expect(devBackgroundsRoot({ PERCH_BACKGROUNDS_DIR: '/tmp/bg' }, '/repo')).toBe('/tmp/bg');
    expect(devBackgroundsRoot({ PERCH_BACKGROUNDS_DIR: '  ' }, '/repo')).toBe(
      join('/repo', 'node_modules', '.cache', 'perch', 'backgrounds'),
    );
  });
});
