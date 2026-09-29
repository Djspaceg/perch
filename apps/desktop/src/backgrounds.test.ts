/**
 * The desktop's side of the background cache: the `perch-cache://` names, the handler that serves
 * only cache files, and what a page is told.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBackgroundCache, type BackgroundCache } from '@perch/backgrounds/node';
import {
  BACKGROUNDS_ORIGIN,
  CACHE_SCHEME,
  backgroundsRoot,
  cacheName,
  cacheUrlFor,
  forPage,
  serveCacheRequest,
} from './backgrounds.js';

let root: string;
let cache: BackgroundCache;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'perch-desktop-backgrounds-'));
  cache = createBackgroundCache({
    root,
    fetch: () => Promise.reject(new Error('no network in this test')),
    urlFor: cacheUrlFor,
  });
  await mkdir(join(root, 'thermalright', '1920x440'), { recursive: true });
  await writeFile(join(root, 'thermalright', '1920x440', 'a042.mp4'), Buffer.alloc(100, 1));
  await writeFile(join(root, 'thermalright', '1920x440', 'a042.nopng'), 'x');
  await writeFile(join(root, 'secret.txt'), 'not for pages');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('the cache scheme', () => {
  it('is its own scheme, with one host', () => {
    expect(CACHE_SCHEME).toBe('perch-cache');
    expect(BACKGROUNDS_ORIGIN).toBe('perch-cache://backgrounds');
    expect(cacheUrlFor('thermalright/1920x440/a042.mp4')).toBe(
      'perch-cache://backgrounds/thermalright/1920x440/a042.mp4',
    );
  });

  it('keeps the cache in userData', () => {
    expect(backgroundsRoot('/tmp/user-data')).toBe(join('/tmp/user-data', 'backgrounds'));
  });

  it('reads a cache name back out of a URL, and nothing else', () => {
    expect(cacheName('perch-cache://backgrounds/thermalright/1920x440/a042.mp4')).toBe(
      'thermalright/1920x440/a042.mp4',
    );
    // A media fragment is the page's (a thumbnail asks for `#t=0.1`), and Electron hands it over.
    expect(cacheName('perch-cache://backgrounds/thermalright/1920x440/a042.head.mp4#t=0.1')).toBe(
      'thermalright/1920x440/a042.head.mp4',
    );
    for (const bad of [
      'perch-cache://elsewhere/thermalright/1920x440/a042.mp4',
      'perch-cache://backgrounds/thermalright/%2e%2e/secret.txt',
      'perch-cache://backgrounds/thermalright/1920x440%2Fa042.mp4',
      'perch-cache://backgrounds/thermalright/1920x440/a042.mp4?x=1',
      'app://backgrounds/thermalright/1920x440/a042.mp4',
      'perch-cache://backgrounds/%E0%A4%A',
    ]) {
      expect(cacheName(bad), bad).toBeNull();
    }
  });
});

describe('serveCacheRequest', () => {
  const get = (url: string, headers: Record<string, string> = {}): Promise<Response> =>
    serveCacheRequest(new Request(url, { headers }), cache);

  it('serves a cached video, and a range of it', async () => {
    const whole = await get('perch-cache://backgrounds/thermalright/1920x440/a042.mp4');
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-type')).toBe('video/mp4');

    const part = await get('perch-cache://backgrounds/thermalright/1920x440/a042.mp4', {
      range: 'bytes=0-9',
    });
    expect(part.status).toBe(206);
    expect((await part.arrayBuffer()).byteLength).toBe(10);
  });

  it.each([
    ['a file outside the grammar', 'perch-cache://backgrounds/secret.txt'],
    ['a marker file', 'perch-cache://backgrounds/thermalright/1920x440/a042.nopng'],
    ['an escape', 'perch-cache://backgrounds/thermalright/../secret.txt'],
    ['a name not cached', 'perch-cache://backgrounds/thermalright/1920x440/a043.mp4'],
  ])('answers 404 for %s', async (_why, url) => {
    expect((await get(url)).status).toBe(404);
  });
});

describe('forPage', () => {
  it('drops the file path and the server before a result reaches a page', () => {
    expect(
      forPage({
        ok: true,
        url: 'perch-cache://backgrounds/thermalright/1920x440/a042.mp4',
        path: '/Users/someone/Library/Application Support/perch/backgrounds/x.mp4',
        size: { width: 1920, height: 440 },
        from: 'international',
      }),
    ).toEqual({ ok: true, url: 'perch-cache://backgrounds/thermalright/1920x440/a042.mp4' });
    expect(forPage({ ok: true, kind: 'image', url: 'perch-cache://backgrounds/x' })).toEqual({
      ok: true,
      kind: 'image',
      url: 'perch-cache://backgrounds/x',
    });
    expect(forPage({ ok: false, code: 'not-found', reason: 'international: HTTP 404' })).toEqual({
      ok: false,
      code: 'not-found',
      reason: 'international: HTTP 404',
    });
  });
});
