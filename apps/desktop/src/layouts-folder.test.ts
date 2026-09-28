import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listLayoutDocuments, prepareLayoutsFolder } from './layouts-folder.js';

let root: string;
let seed: string;
let folder: string;

/** A seed shaped like the repo's `layouts/`: documents, their media, a README, refusal fixtures. */
async function writeSeed(): Promise<void> {
  await mkdir(join(seed, 'desk.assets'), { recursive: true });
  await mkdir(join(seed, 'invalid'), { recursive: true });
  await writeFile(join(seed, 'desk.json'), '{"seed":"desk"}');
  await writeFile(join(seed, 'tower.json'), '{"seed":"tower"}');
  await writeFile(join(seed, 'desk.assets', 'rails.svg'), '<svg>seed</svg>');
  await writeFile(join(seed, 'README.md'), '# layouts');
  await writeFile(join(seed, 'invalid', 'broken.json'), '{');
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'perch-layouts-'));
  seed = join(root, 'seed');
  folder = join(root, 'Documents', 'perch', 'layouts');
  await writeSeed();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('listLayoutDocuments', () => {
  it('lists the .json files directly in the folder, sorted by name', async () => {
    await mkdir(join(folder, 'invalid'), { recursive: true });
    await mkdir(join(folder, 'folder.json'));
    await writeFile(join(folder, 'tower.json'), '{}');
    await writeFile(join(folder, 'Desk.json'), '{}');
    await writeFile(join(folder, 'alpha.json'), '{}');
    await writeFile(join(folder, '.hidden.json'), '{}');
    await writeFile(join(folder, 'notes.txt'), '');
    await writeFile(join(folder, 'invalid', 'nested.json'), '{}');

    expect(await listLayoutDocuments(folder)).toEqual([
      { name: 'alpha', path: join(folder, 'alpha.json') },
      { name: 'Desk', path: join(folder, 'Desk.json') },
      { name: 'tower', path: join(folder, 'tower.json') },
    ]);
  });

  it('lists a missing folder as empty rather than failing', async () => {
    expect(await listLayoutDocuments(join(root, 'nowhere'))).toEqual([]);
  });
});

describe('prepareLayoutsFolder', () => {
  it('creates a missing folder and seeds it with the documents and their media', async () => {
    const prepared = await prepareLayoutsFolder(folder, seed);

    expect(prepared.created).toBe(true);
    expect([...prepared.seeded].sort()).toEqual([
      'desk.assets/rails.svg',
      'desk.json',
      'tower.json',
    ]);
    expect((await readdir(folder)).sort()).toEqual(['desk.assets', 'desk.json', 'tower.json']);
    expect(await readFile(join(folder, 'desk.assets', 'rails.svg'), 'utf8')).toBe(
      '<svg>seed</svg>',
    );
  });

  it('seeds nothing into a folder that already holds a document, and leaves it untouched', async () => {
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'desk.json'), '{"mine":true}');

    const prepared = await prepareLayoutsFolder(folder, seed);

    expect(prepared).toEqual({ created: false, seeded: [] });
    expect(await readdir(folder)).toEqual(['desk.json']);
    expect(await readFile(join(folder, 'desk.json'), 'utf8')).toBe('{"mine":true}');
  });

  it('never overwrites a user file, even while seeding a folder with no documents', async () => {
    await mkdir(join(folder, 'desk.assets'), { recursive: true });
    await writeFile(join(folder, 'desk.assets', 'rails.svg'), '<svg>mine</svg>');

    const prepared = await prepareLayoutsFolder(folder, seed);

    expect(prepared.created).toBe(false);
    expect([...prepared.seeded].sort()).toEqual(['desk.json', 'tower.json']);
    expect(await readFile(join(folder, 'desk.assets', 'rails.svg'), 'utf8')).toBe(
      '<svg>mine</svg>',
    );
  });

  it('is idempotent: a second launch seeds nothing', async () => {
    await prepareLayoutsFolder(folder, seed);
    await writeFile(join(folder, 'desk.json'), '{"edited":true}');

    expect(await prepareLayoutsFolder(folder, seed)).toEqual({ created: false, seeded: [] });
    expect(await readFile(join(folder, 'desk.json'), 'utf8')).toBe('{"edited":true}');
  });

  it('creates the folder even when there is no seed to copy', async () => {
    const prepared = await prepareLayoutsFolder(folder, join(root, 'no-seed'));

    expect(prepared).toEqual({ created: true, seeded: [] });
    expect(await readdir(folder)).toEqual([]);
  });
});
