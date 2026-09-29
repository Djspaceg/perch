/**
 * The layouts folder's watch, against a real temporary folder: what the tray and File > Open preset
 * are rebuilt from. Real files and the real `fs.watch`, because the claim is that a file added,
 * renamed or removed in Finder reaches the menu, and a fake watcher would only prove the debounce.
 */

import type { MenuItemConstructorOptions } from 'electron';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { presetSubmenu } from './app-menu.js';
import { watchLayoutsFolder } from './folder-watch.js';
import type { LayoutDocument } from './layouts-folder.js';

let dir: string;
let stop: (() => void) | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'perch-folder-watch-'));
  await writeFile(join(dir, 'desk.json'), '{}');
});

afterEach(async () => {
  stop?.();
  stop = undefined;
  await rm(dir, { recursive: true, force: true });
});

/** Watch `dir`, and resolve the next listing that satisfies `until`. */
function watching(): { next(until: (names: string[]) => boolean): Promise<LayoutDocument[]> } {
  let latest: LayoutDocument[] = [];
  const waiters = new Set<() => void>();
  stop = watchLayoutsFolder(dir, {
    debounceMs: 20,
    onList: (documents) => {
      latest = documents;
      for (const waiter of waiters) waiter();
    },
    onError: (error) => {
      throw error;
    },
  });

  return {
    next: (until) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`timed out; last listing ${JSON.stringify(latest)}`));
        }, 5000);
        const check = (): void => {
          if (!until(latest.map((document) => document.name))) return;
          clearTimeout(timer);
          waiters.delete(check);
          resolve(latest);
        };
        waiters.add(check);
      }),
  };
}

const labels = (items: MenuItemConstructorOptions[]) => items.map((item) => item.label);

describe('watchLayoutsFolder', () => {
  it('lists the folder again when a document is added, renamed or removed', async () => {
    const watch = watching();

    await writeFile(join(dir, 'tower.json'), '{}');
    expect((await watch.next((names) => names.includes('tower'))).map((d) => d.name)).toEqual([
      'desk',
      'tower',
    ]);

    await rename(join(dir, 'tower.json'), join(dir, 'wall.json'));
    expect(
      (await watch.next((names) => names.includes('wall') && !names.includes('tower'))).map(
        (d) => d.name,
      ),
    ).toEqual(['desk', 'wall']);

    await rm(join(dir, 'desk.json'));
    expect((await watch.next((names) => !names.includes('desk'))).map((d) => d.name)).toEqual([
      'wall',
    ]);
  });

  it('is what the Open preset submenu is rebuilt from', async () => {
    const watch = watching();
    const opened: string[] = [];
    const rebuild = (documents: LayoutDocument[]) =>
      presetSubmenu(documents, join(dir, 'desk.json'), (path) => opened.push(path));

    await writeFile(join(dir, 'added.json'), '{}');
    const menu = rebuild(await watch.next((names) => names.includes('added')));

    expect(labels(menu)).toEqual(['added', 'desk']);
    expect(menu.find((item) => item.label === 'desk')?.checked).toBe(true);
    (menu[0]?.click as () => void)();
    expect(opened).toEqual([join(dir, 'added.json')]);

    await rm(join(dir, 'added.json'));
    await rm(join(dir, 'desk.json'));
    expect(labels(rebuild(await watch.next((names) => names.length === 0)))).toEqual([
      'No presets',
    ]);
  });
});
