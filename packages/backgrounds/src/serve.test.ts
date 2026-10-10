/**
 * Serving a cached file, with byte ranges: a `<video>` asks for ranges, and a custom protocol that
 * cannot answer them leaves Chromium unable to seek or loop.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveCachedFile } from '@perch/backgrounds/node';

let folder: string;
let video: string;
const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, index) => index % 256));

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'perch-serve-'));
  video = join(folder, 'a042.mp4');
  await writeFile(video, BYTES);
  await writeFile(join(folder, 'a042.png'), 'png');
  await writeFile(join(folder, 'loop.webm'), 'webm');
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

const body = async (response: Response): Promise<Buffer> =>
  Buffer.from(await response.arrayBuffer());

describe('serveCachedFile', () => {
  it('serves the whole file with its type and length, and says ranges work', async () => {
    const response = await serveCachedFile(video, 'GET', null);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-length')).toBe('1000');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(await body(response)).toEqual(BYTES);
  });

  it('types a WebM video as one, for a video beside a layout', async () => {
    const response = await serveCachedFile(join(folder, 'loop.webm'), 'GET', null);
    expect(response.headers.get('content-type')).toBe('video/webm');
  });

  it('types a PNG as one', async () => {
    const response = await serveCachedFile(join(folder, 'a042.png'), 'GET', null);
    expect(response.headers.get('content-type')).toBe('image/png');
  });

  it.each([
    ['a closed range', 'bytes=10-19', 10, 19],
    ['an open-ended range', 'bytes=990-', 990, 999],
    ['a suffix range', 'bytes=-5', 995, 999],
    ['a range past the end, clamped', 'bytes=995-5000', 995, 999],
  ])('answers %s with 206 and the bytes asked for', async (_why, range, start, end) => {
    const response = await serveCachedFile(video, 'GET', range);

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/1000`);
    expect(response.headers.get('content-length')).toBe(String(end - start + 1));
    expect(await body(response)).toEqual(BYTES.subarray(start, end + 1));
  });

  it.each([['bytes=1000-'], ['bytes=20-10'], ['bytes=-0']])(
    'answers %s, which it cannot satisfy, with 416',
    async (range) => {
      const response = await serveCachedFile(video, 'GET', range);

      expect(response.status).toBe(416);
      expect(response.headers.get('content-range')).toBe('bytes */1000');
    },
  );

  it('ignores a range it does not understand and sends the whole file, as HTTP allows', async () => {
    const response = await serveCachedFile(video, 'GET', 'bytes=0-1,5-6');
    expect(response.status).toBe(200);
  });

  it('answers HEAD with the headers and no body', async () => {
    const response = await serveCachedFile(video, 'HEAD', null);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('1000');
    expect(await body(response)).toHaveLength(0);
  });

  it('answers 404 for a file that is not there, and 405 for anything but GET or HEAD', async () => {
    expect((await serveCachedFile(join(folder, 'missing.mp4'), 'GET', null)).status).toBe(404);
    expect((await serveCachedFile(video, 'POST', null)).status).toBe(405);
  });
});
