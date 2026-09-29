import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RECENT_LIMIT, addRecent, recentEntries } from './recent.js';
import { SETTINGS_FILENAME, createSettingsStore, readSettings } from './settings.js';

describe('addRecent', () => {
  it('puts the newest first', () => {
    expect(addRecent(['/l/a.json', '/l/b.json'], '/l/c.json')).toEqual([
      '/l/c.json',
      '/l/a.json',
      '/l/b.json',
    ]);
  });

  it('moves a path already listed to the front rather than listing it twice', () => {
    expect(addRecent(['/l/a.json', '/l/b.json', '/l/c.json'], '/l/b.json')).toEqual([
      '/l/b.json',
      '/l/a.json',
      '/l/c.json',
    ]);
  });

  it('keeps ten, dropping the oldest', () => {
    const ten = Array.from({ length: RECENT_LIMIT }, (_, index) => `/l/${String(index)}.json`);

    const next = addRecent(ten, '/l/new.json');

    expect(RECENT_LIMIT).toBe(10);
    expect(next).toHaveLength(10);
    expect(next[0]).toBe('/l/new.json');
    expect(next).not.toContain('/l/9.json');
  });

  it('does not change the list it was given', () => {
    const list = ['/l/a.json'];
    addRecent(list, '/l/b.json');

    expect(list).toEqual(['/l/a.json']);
  });
});

describe('recentEntries', () => {
  it('names each document by its file name, in list order', () => {
    expect(recentEntries(['/l/desk.json', '/x/tower.json'], () => true)).toEqual([
      { path: '/l/desk.json', label: 'desk' },
      { path: '/x/tower.json', label: 'tower' },
    ]);
  });

  it('drops a document that is no longer on disk', () => {
    expect(
      recentEntries(['/l/gone.json', '/l/desk.json'], (path) => path !== '/l/gone.json'),
    ).toEqual([{ path: '/l/desk.json', label: 'desk' }]);
  });

  it('tells two documents of one name apart by their folder', () => {
    expect(recentEntries(['/a/one/desk.json', '/a/two/desk.json'], () => true)).toEqual([
      { path: '/a/one/desk.json', label: 'desk (one)' },
      { path: '/a/two/desk.json', label: 'desk (two)' },
    ]);
  });
});

describe('the recent list in the settings file', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'perch-recent-'));
    file = join(dir, SETTINGS_FILENAME);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('survives a relaunch, in order, and a clear survives one too', async () => {
    const store = createSettingsStore(file);
    await store.load();

    let recent = store.current.recent;
    for (const path of ['/l/a.json', '/l/b.json', '/l/a.json']) recent = addRecent(recent, path);
    await store.update({ recent });

    const relaunched = createSettingsStore(file);
    expect((await relaunched.load()).settings.recent).toEqual(['/l/a.json', '/l/b.json']);

    await relaunched.update({ recent: [] });
    expect((await readSettings(file)).settings.recent).toEqual([]);
  });
});
