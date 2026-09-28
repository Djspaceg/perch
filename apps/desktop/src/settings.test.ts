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
    expect(DEFAULT_SETTINGS).toEqual({ lastDocument: null, lhm: null });
  });

  it('reads back what was written', async () => {
    const settings = {
      lastDocument: '/somewhere/desk-1920x400.json',
      lhm: { host: '192.168.1.3', port: 8085 },
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

    expect(read.settings).toEqual({ lastDocument: '/a/b.json', lhm: null });
    expect(read.problem).toContain('lhm');
  });

  it('rejects an LHM host that the relay would refuse', async () => {
    await writeFile(file, JSON.stringify({ lastDocument: null, lhm: { host: '', port: 8085 } }));

    expect((await readSettings(file)).settings.lhm).toBeNull();
  });
});

describe('writeSettings', () => {
  it('is atomic: the file is complete JSON and no temporary file is left beside it', async () => {
    await writeFile(file, 'previous contents that are not JSON');

    await writeSettings(file, { lastDocument: '/x.json', lhm: null });

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
    await writeSettings(file, { lastDocument: '/a.json', lhm: { host: 'pc', port: 8085 } });
    const store = createSettingsStore(file);

    expect((await store.load()).settings.lastDocument).toBe('/a.json');
    await store.update({ lastDocument: '/b.json' });

    expect(store.current).toEqual({ lastDocument: '/b.json', lhm: { host: 'pc', port: 8085 } });
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
