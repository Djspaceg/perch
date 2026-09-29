import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_FILENAME,
  createSettingsStore,
  readSettings,
  writeSettings,
} from './settings.js';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'perch-settings-'));
  file = join(dir, SETTINGS_FILENAME);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('readSettings', () => {
  it('reads a missing file as the defaults, with nothing to report', async () => {
    expect(await readSettings(file)).toEqual({ settings: DEFAULT_SETTINGS, problem: null });
    expect(DEFAULT_SETTINGS).toEqual({ lastDocument: null, lhm: null, recent: [] });
  });

  it('reads back what was written', async () => {
    const settings = {
      lastDocument: '/somewhere/desk-1920x400.json',
      lhm: { host: '192.168.1.3', port: 8085 },
      recent: ['/somewhere/desk-1920x400.json', '/elsewhere/tower.json'],
    };
    await writeSettings(file, settings);

    expect(await readSettings(file)).toEqual({ settings, problem: null });
  });

  it('reads a malformed file as the defaults, and says which file', async () => {
    await writeFile(file, '{"lastDocument": ');

    const read = await readSettings(file);

    expect(read.settings).toEqual(DEFAULT_SETTINGS);
    expect(read.problem).toContain(file);
  });

  it('keeps the valid fields of a file with one bad field, and names the bad one', async () => {
    await writeFile(
      file,
      JSON.stringify({ lastDocument: '/a/b.json', lhm: { host: 'pc', port: 'eighty' } }),
    );

    const read = await readSettings(file);

    expect(read.settings).toEqual({ lastDocument: '/a/b.json', lhm: null, recent: [] });
    expect(read.problem).toContain('lhm');
  });

  it('rejects an LHM host that the relay would refuse', async () => {
    await writeFile(file, JSON.stringify({ lastDocument: null, lhm: { host: '', port: 8085 } }));

    expect((await readSettings(file)).settings.lhm).toBeNull();
  });

  it('reads a settings file from before the recent list as an empty one, with nothing to report', async () => {
    await writeFile(file, JSON.stringify({ lastDocument: '/a.json', lhm: null }));

    expect(await readSettings(file)).toEqual({
      settings: { lastDocument: '/a.json', lhm: null, recent: [] },
      problem: null,
    });
  });

  it('keeps the paths of a recent list, drops what is not one, and never more than ten', async () => {
    const many = Array.from({ length: 14 }, (_, index) => `/l/${String(index)}.json`);
    await writeFile(
      file,
      JSON.stringify({ recent: [...many.slice(0, 2), 7, '', ...many.slice(2)] }),
    );

    const read = await readSettings(file);

    expect(read.settings.recent).toEqual(many.slice(0, 10));
    expect(read.problem).toContain('recent');
  });

  it('reads a recent list that is not a list as empty, and names it', async () => {
    await writeFile(file, JSON.stringify({ recent: '/a.json' }));

    const read = await readSettings(file);

    expect(read.settings.recent).toEqual([]);
    expect(read.problem).toContain('recent');
  });
});

describe('writeSettings', () => {
  it('is atomic: the file is complete JSON and no temporary file is left beside it', async () => {
    await writeFile(file, 'previous contents that are not JSON');

    await writeSettings(file, { lastDocument: '/x.json', lhm: null, recent: [] });

    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ lastDocument: '/x.json' });
    expect(await readdir(dir)).toEqual([SETTINGS_FILENAME]);
  });

  it('creates the directory it is written into', async () => {
    const nested = join(dir, 'not', 'yet');
    await writeSettings(join(nested, SETTINGS_FILENAME), DEFAULT_SETTINGS);

    expect(await readdir(nested)).toEqual([SETTINGS_FILENAME]);
  });
});

describe('createSettingsStore', () => {
  it('loads, updates one field at a time, and persists every update', async () => {
    await writeSettings(file, {
      lastDocument: '/a.json',
      lhm: { host: 'pc', port: 8085 },
      recent: ['/a.json'],
    });
    const store = createSettingsStore(file);

    expect((await store.load()).settings.lastDocument).toBe('/a.json');
    await store.update({ lastDocument: '/b.json' });

    expect(store.current).toEqual({
      lastDocument: '/b.json',
      lhm: { host: 'pc', port: 8085 },
      recent: ['/a.json'],
    });
    expect((await readSettings(file)).settings).toEqual(store.current);
  });

  it('serialises overlapping updates, so the last one wins on disk', async () => {
    const store = createSettingsStore(file);
    await store.load();

    await Promise.all(
      Array.from({ length: 20 }, (_, index) => store.update({ lastDocument: `/${index}.json` })),
    );

    expect((await readSettings(file)).settings.lastDocument).toBe('/19.json');
    expect(await readdir(dir)).toEqual([SETTINGS_FILENAME]);
  });
});
