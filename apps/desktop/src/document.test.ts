import { mkdir, mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DOCUMENT_ASSET_ORIGIN } from './app-protocol.js';
import { readLayoutDocument, watchDocument } from './document.js';

/** Room for FSEvents' own delivery latency on a loaded machine, past Vitest's one second. */
const WATCH_POLL = { timeout: 3000 };

let folder: string;
const stops: (() => void)[] = [];

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'perch-document-'));
});

afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  await rm(folder, { recursive: true, force: true });
});

describe('readLayoutDocument', () => {
  it('reads the text as it is on disk, and maps each media file beside it to a URL', async () => {
    await mkdir(join(folder, 'desk.assets'));
    await writeFile(join(folder, 'desk.json'), '{ "not": "validated here" ,}');
    await writeFile(join(folder, 'desk.assets', 'rails.svg'), '<svg/>');
    await writeFile(join(folder, 'desk.assets', 'grid lines.png'), '');
    await writeFile(join(folder, 'desk.assets', 'notes.txt'), '');

    const payload = await readLayoutDocument({ name: 'desk', path: join(folder, 'desk.json') });

    expect(payload).toEqual({
      name: 'desk',
      text: '{ "not": "validated here" ,}',
      assets: {
        'desk.assets/grid lines.png': `${DOCUMENT_ASSET_ORIGIN}/desk.assets/grid%20lines.png`,
        'desk.assets/rails.svg': `${DOCUMENT_ASSET_ORIGIN}/desk.assets/rails.svg`,
      },
    });
  });

  it('reads a document that is not on disk as text null, not as an error', async () => {
    const payload = await readLayoutDocument({ name: 'gone', path: join(folder, 'gone.json') });

    expect(payload).toEqual({ name: 'gone', text: null, assets: {} });
  });
});

describe('watchDocument', () => {
  const path = (): string => join(folder, 'desk.json');

  async function watching(): Promise<string[]> {
    await writeFile(path(), 'v1');
    const seen: string[] = [];
    stops.push(watchDocument(path(), (payload) => seen.push(payload.text ?? '(gone)'), 20));
    return seen;
  }

  it('reports an in-place write', async () => {
    const seen = await watching();

    await writeFile(path(), 'v2');

    await expect.poll(() => seen, WATCH_POLL).toEqual(['v2']);
  });

  it('keeps following the file across an atomic save, which replaces it', async () => {
    const seen = await watching();

    await writeFile(join(folder, 'desk.json.tmp'), 'v2');
    await rename(join(folder, 'desk.json.tmp'), path());
    await expect.poll(() => seen, WATCH_POLL).toEqual(['v2']);

    await writeFile(join(folder, 'desk.json.tmp'), 'v3');
    await rename(join(folder, 'desk.json.tmp'), path());
    await expect.poll(() => seen, WATCH_POLL).toEqual(['v2', 'v3']);
  });

  it('keeps watching through a malformed save and a deletion', async () => {
    const seen = await watching();

    await writeFile(path(), '{ malformed');
    await expect.poll(() => seen, WATCH_POLL).toEqual(['{ malformed']);
    await unlink(path());
    await expect.poll(() => seen, WATCH_POLL).toEqual(['{ malformed', '(gone)']);
    await writeFile(path(), 'back');
    await expect.poll(() => seen, WATCH_POLL).toEqual(['{ malformed', '(gone)', 'back']);
  });

  it('ignores other files in the folder', async () => {
    const seen = await watching();

    await writeFile(join(folder, 'tower.json'), 'other');
    await writeFile(path(), 'v2');

    await expect.poll(() => seen, WATCH_POLL).toEqual(['v2']);
  });

  it('reports nothing once stopped', async () => {
    const seen = await watching();
    stops.pop()?.();

    await writeFile(path(), 'v2');
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(seen).toEqual([]);
  });
});
