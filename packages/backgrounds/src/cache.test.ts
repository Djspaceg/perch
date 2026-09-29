/**
 * The download cache, against an injected fetch and a temporary folder: nothing here touches the
 * network.
 */

import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createBackgroundCache,
  type BackgroundCacheOptions,
  type FetchLike,
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
  0x6d,
  0x70,
  0x34,
  0x32,
  ...new Array<number>(500).fill(7),
]);
const PNG = Uint8Array.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...new Array<number>(40).fill(1),
]);
const HTML = new TextEncoder().encode('<!DOCTYPE html><html>not found</html>');

const TARGET = { width: 1920, height: 400 };
const INTERNATIONAL = 'http://www.czhorde.cc/tr/bj1920440/';
const CHINA = 'http://www.czhorde.com/tr/bj1920440/';

type Handler = (init: { headers?: Record<string, string> }) => Promise<Response> | Response;

let root: string;
let calls: { url: string; headers: Record<string, string> }[];
let routes: Map<string, Handler>;

const fetchStub: FetchLike = (url, init) => {
  calls.push({ url, headers: { ...init.headers } });
  const handler = routes.get(url);
  if (handler === undefined) return Promise.resolve(new Response(HTML, { status: 404 }));
  return new Promise<Response>((resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'));
    });
    Promise.resolve(handler(init)).then(resolve, reject);
  });
};

function cache(
  options: Partial<BackgroundCacheOptions> = {},
): ReturnType<typeof createBackgroundCache> {
  return createBackgroundCache({
    root,
    fetch: fetchStub,
    urlFor: (relative) => `perch-cache://backgrounds/${relative}`,
    ...options,
  });
}

const ok = (body: Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}): Response =>
  new Response(body, {
    status: 200,
    headers: { 'content-length': String(body.byteLength), ...headers },
  });

async function leftovers(): Promise<string[]> {
  try {
    return (await readdir(join(root, 'thermalright', '1920x440'))).filter((name) =>
      name.endsWith('.part'),
    );
  } catch {
    return [];
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'perch-backgrounds-'));
  calls = [];
  routes = new Map();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('ensure', () => {
  it('downloads into the size folder the target picks, then answers from the cache', async () => {
    routes.set(`${INTERNATIONAL}a042.mp4`, () => ok(MP4));
    const made = cache();

    const first = await made.ensure('thermalright:a042', TARGET);
    expect(first).toEqual({
      ok: true,
      url: 'perch-cache://backgrounds/thermalright/1920x440/a042.mp4',
      path: join(root, 'thermalright', '1920x440', 'a042.mp4'),
      size: { width: 1920, height: 440 },
      from: 'international',
    });
    expect(await readFile(join(root, 'thermalright', '1920x440', 'a042.mp4'))).toEqual(
      Buffer.from(MP4),
    );

    const second = await made.ensure('thermalright:a042', TARGET);
    expect(second.ok && second.from).toBe('cache');
    expect(calls).toHaveLength(1);
  });

  it('falls back to the second server on a 404', async () => {
    routes.set(`${CHINA}a042.mp4`, () => ok(MP4));
    const got = await cache().ensure('thermalright:a042', TARGET);

    expect(got.ok && got.from).toBe('china');
    expect(calls.map((call) => call.url)).toEqual([`${INTERNATIONAL}a042.mp4`, `${CHINA}a042.mp4`]);
  });

  it('falls back on a network failure and on a server error', async () => {
    routes.set(`${INTERNATIONAL}a042.mp4`, () => Promise.reject(new TypeError('fetch failed')));
    routes.set(`${CHINA}a042.mp4`, () => ok(MP4));
    expect((await cache().ensure('thermalright:a042', TARGET)).ok).toBe(true);

    routes.set(`${INTERNATIONAL}b001.mp4`, () => new Response('busy', { status: 503 }));
    routes.set(`${CHINA}b001.mp4`, () => ok(MP4));
    expect((await cache().ensure('thermalright:b001', TARGET)).ok).toBe(true);
  });

  it('says not-found when both servers 404, and leaves nothing behind', async () => {
    const got = await cache().ensure('thermalright:a042', TARGET);

    expect(got).toMatchObject({ ok: false, code: 'not-found' });
    expect(!got.ok && got.reason).toBe(
      'not hosted at 1920x440 (international: HTTP 404; china: HTTP 404)',
    );
    expect(await leftovers()).toEqual([]);
  });

  it('says unreachable when neither server answers, naming both', async () => {
    routes.set(`${INTERNATIONAL}a042.mp4`, () =>
      Promise.reject(new TypeError('getaddrinfo ENOTFOUND')),
    );
    routes.set(`${CHINA}a042.mp4`, () => Promise.reject(new TypeError('getaddrinfo ENOTFOUND')));
    const got = await cache().ensure('thermalright:a042', TARGET);

    expect(got).toMatchObject({ ok: false, code: 'unreachable' });
    expect(!got.ok && got.reason).toMatch(/international: .*ENOTFOUND.*china: .*ENOTFOUND/);
  });

  it('gives up on a server that takes too long, and says so', async () => {
    routes.set(`${INTERNATIONAL}a042.mp4`, () => new Promise<Response>(() => undefined));
    routes.set(`${CHINA}a042.mp4`, () => new Promise<Response>(() => undefined));
    const got = await cache({ limits: { timeoutsMs: [20, 30] } }).ensure(
      'thermalright:a042',
      TARGET,
    );

    expect(got).toMatchObject({ ok: false, code: 'unreachable' });
    expect(!got.ok && got.reason).toMatch(
      /international: timed out after 20 ms; china: timed out after 30 ms/,
    );
  });

  it('drops a short body and tries the other server', async () => {
    routes.set(
      `${INTERNATIONAL}a042.mp4`,
      () => new Response(MP4.slice(0, 100), { status: 200, headers: { 'content-length': '512' } }),
    );
    routes.set(
      `${CHINA}a042.mp4`,
      () => new Response(MP4.slice(0, 100), { status: 200, headers: { 'content-length': '512' } }),
    );
    const got = await cache().ensure('thermalright:a042', TARGET);

    expect(got).toMatchObject({ ok: false, code: 'unreachable' });
    expect(!got.ok && got.reason).toMatch(/ended after 100 of 512 bytes/);
    expect(await leftovers()).toEqual([]);
    await expect(stat(join(root, 'thermalright', '1920x440', 'a042.mp4'))).rejects.toThrow();
  });

  it('refuses a file over the cap, declared or streamed', async () => {
    const big = new Uint8Array(2000);
    big.set(MP4);
    routes.set(`${INTERNATIONAL}a042.mp4`, () => ok(big));
    // No length header: the stream is counted instead.
    routes.set(`${CHINA}a042.mp4`, () => new Response(big, { status: 200 }));
    const got = await cache({ limits: { maxVideoBytes: 1000 } }).ensure(
      'thermalright:a042',
      TARGET,
    );

    expect(got).toMatchObject({ ok: false, code: 'too-large' });
    expect(await leftovers()).toEqual([]);
  });

  it('refuses a body that is not a video, such as an HTML page answered 200', async () => {
    routes.set(`${INTERNATIONAL}a042.mp4`, () => ok(HTML));
    routes.set(`${CHINA}a042.mp4`, () => ok(HTML));
    const got = await cache().ensure('thermalright:a042', TARGET);

    expect(got).toMatchObject({ ok: false, code: 'bad-content' });
    expect(await leftovers()).toEqual([]);
  });

  it('writes to a part file and renames it, so the target is never half-written', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(MP4.slice(0, 200));
        await gate;
        controller.enqueue(MP4.slice(200));
        controller.close();
      },
    });
    routes.set(
      `${INTERNATIONAL}a042.mp4`,
      () =>
        new Response(body, { status: 200, headers: { 'content-length': String(MP4.byteLength) } }),
    );

    const pending = cache().ensure('thermalright:a042', TARGET);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await leftovers()).toHaveLength(1);
    await expect(stat(join(root, 'thermalright', '1920x440', 'a042.mp4'))).rejects.toThrow();

    release();
    expect((await pending).ok).toBe(true);
    expect(await leftovers()).toEqual([]);
    expect((await stat(join(root, 'thermalright', '1920x440', 'a042.mp4'))).size).toBe(
      MP4.byteLength,
    );
  });

  it('shares one download between callers asking at once', async () => {
    routes.set(`${INTERNATIONAL}a042.mp4`, async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return ok(MP4);
    });
    const made = cache();
    const [one, two] = await Promise.all([
      made.ensure('thermalright:a042', TARGET),
      made.ensure('thermalright:a042', { width: 1920, height: 420 }),
    ]);

    expect(one.ok && two.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('runs no more downloads at once than its concurrency', async () => {
    let running = 0;
    let most = 0;
    for (const id of ['a001', 'a002', 'a003']) {
      routes.set(`${INTERNATIONAL}${id}.mp4`, async () => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 15));
        running -= 1;
        return ok(MP4);
      });
    }
    const made = cache({ limits: { concurrency: 2 } });
    await Promise.all(
      ['a001', 'a002', 'a003'].map((id) => made.ensure(`thermalright:${id}`, TARGET)),
    );

    expect(most).toBe(2);
  });

  it.each([
    ['a path', 'backdrop.png', TARGET],
    ['an id the catalogue does not have', 'thermalright:a083', TARGET],
    ['a fractional target', 'thermalright:a042', { width: 1920.5, height: 400 }],
    ['a zero target', 'thermalright:a042', { width: 0, height: 400 }],
    ['a target past the format ceiling', 'thermalright:a042', { width: 100_000, height: 400 }],
  ])('refuses %s without a request', async (_why, ref, target) => {
    expect(await cache().ensure(ref, target)).toMatchObject({ ok: false, code: 'invalid' });
    expect(calls).toEqual([]);
  });
});

describe('preview', () => {
  it('is the PNG when the server has one', async () => {
    routes.set(`${INTERNATIONAL}a042.png`, () => ok(PNG));
    const made = cache();

    expect(await made.preview('thermalright:a042', TARGET)).toEqual({
      ok: true,
      kind: 'image',
      url: 'perch-cache://backgrounds/thermalright/1920x440/a042.png',
    });
    await made.preview('thermalright:a042', TARGET);
    expect(calls).toHaveLength(1);
  });

  it('is the head of the video when neither server has a PNG, remembered so it is asked once', async () => {
    routes.set(`${INTERNATIONAL}a042.mp4`, ({ headers }) => {
      expect(headers?.['range']).toBe('bytes=0-99');
      return new Response(MP4.slice(0, 100), {
        status: 206,
        headers: { 'content-length': '100', 'content-range': `bytes 0-99/${MP4.byteLength}` },
      });
    });
    const made = cache({ limits: { headBytes: 100 } });

    expect(await made.preview('thermalright:a042', TARGET)).toEqual({
      ok: true,
      kind: 'video',
      url: 'perch-cache://backgrounds/thermalright/1920x440/a042.head.mp4',
    });
    expect(calls.map((call) => call.url)).toEqual([
      `${INTERNATIONAL}a042.png`,
      `${CHINA}a042.png`,
      `${INTERNATIONAL}a042.mp4`,
    ]);
    const folder = join(root, 'thermalright', '1920x440');
    expect((await readdir(folder)).sort()).toEqual(['a042.head.mp4', 'a042.nopng']);

    calls = [];
    await made.preview('thermalright:a042', TARGET);
    expect(calls).toEqual([]);
  });

  it('keeps only the head when a server ignores the range and sends the whole file', async () => {
    routes.set(`${INTERNATIONAL}a042.mp4`, () => ok(MP4));
    await cache({ limits: { headBytes: 100 } }).preview('thermalright:a042', TARGET);

    expect((await stat(join(root, 'thermalright', '1920x440', 'a042.head.mp4'))).size).toBe(100);
  });

  it('uses the whole video when it is already cached', async () => {
    routes.set(`${INTERNATIONAL}a042.mp4`, () => ok(MP4));
    const made = cache();
    await made.ensure('thermalright:a042', TARGET);
    calls = [];

    expect(await made.preview('thermalright:a042', TARGET)).toMatchObject({
      kind: 'video',
      url: 'perch-cache://backgrounds/thermalright/1920x440/a042.mp4',
    });
    expect(calls).toEqual([]);
  });

  it('does not remember a missing PNG when the servers could not be reached', async () => {
    routes.set(`${INTERNATIONAL}a042.png`, () => Promise.reject(new TypeError('offline')));
    routes.set(`${CHINA}a042.png`, () => Promise.reject(new TypeError('offline')));

    expect(await cache().preview('thermalright:a042', TARGET)).toMatchObject({
      ok: false,
      code: 'unreachable',
    });
    await expect(stat(join(root, 'thermalright', '1920x440', 'a042.nopng'))).rejects.toThrow();
  });
});

describe('fileFor', () => {
  it('maps a cache name to its file, and nothing else', () => {
    const made = cache();
    expect(made.fileFor('thermalright/1920x440/a042.mp4')).toBe(
      join(root, 'thermalright', '1920x440', 'a042.mp4'),
    );
    expect(made.fileFor('thermalright/1920x440/a042.head.mp4')).not.toBeNull();
    expect(made.fileFor('thermalright/1920x440/a042.png')).not.toBeNull();
    for (const bad of [
      'thermalright/1920x440/a042.nopng',
      'thermalright/1920x440/.a042.mp4.abc.part',
      'thermalright/../../etc/passwd',
      'thermalright/1920x440/../a042.mp4',
      'thermalright/1920x440/a042.mp4/',
      '/thermalright/1920x440/a042.mp4',
      'other/1920x440/a042.mp4',
    ]) {
      expect(made.fileFor(bad), bad).toBeNull();
    }
  });
});

describe('sweep', () => {
  it('removes part files an hour old, and keeps newer ones and finished files', async () => {
    const folder = join(root, 'thermalright', '1920x440');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, '.a001.mp4.old.part'), 'x');
    await writeFile(join(folder, '.a002.mp4.new.part'), 'x');
    await writeFile(join(folder, 'a003.mp4'), 'x');
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(join(folder, '.a001.mp4.old.part'), twoHoursAgo, twoHoursAgo);

    expect(await cache().sweep()).toBe(1);
    expect((await readdir(folder)).sort()).toEqual(['.a002.mp4.new.part', 'a003.mp4']);
  });

  it('is a no-op on a root that does not exist yet', async () => {
    expect(await cache({ root: join(root, 'missing') }).sweep()).toBe(0);
  });
});
