/**
 * File > Open recent: the documents last opened or saved in the editor, newest first.
 *
 * The list is paths, kept in the desktop settings (`settings.ts`) so it survives a relaunch, at most
 * `RECENT_LIMIT` of them, each once. A document that is no longer on disk is left out of the menu
 * but kept in the list: a folder on a drive that is not mounted, or a file a checkout will bring
 * back, reappears when it does. It falls off the end like any other once ten newer ones are opened.
 *
 * Pure, so the rules are tested without the binary; `editor.ts` records and `main.ts` builds.
 */

import { basename, dirname } from 'node:path';

/** How many documents the menu remembers. */
export const RECENT_LIMIT = 10;

/** `path` first, any earlier mention of it dropped, the oldest past `limit` dropped. */
export function addRecent(
  list: readonly string[],
  path: string,
  limit: number = RECENT_LIMIT,
): string[] {
  return [path, ...list.filter((listed) => listed !== path)].slice(0, limit);
}

/** One row of the submenu. */
export interface RecentEntry {
  readonly path: string;
  readonly label: string;
}

/**
 * The rows the submenu shows: each document still on disk, by its name, with its folder's name
 * after it where two share one.
 */
export function recentEntries(
  list: readonly string[],
  exists: (path: string) => boolean,
): RecentEntry[] {
  const present = list.filter((path) => exists(path));
  const name = (path: string): string => basename(path).replace(/\.json$/i, '');
  const counts = new Map<string, number>();
  for (const path of present) counts.set(name(path), (counts.get(name(path)) ?? 0) + 1);

  return present.map((path) => ({
    path,
    label:
      (counts.get(name(path)) ?? 0) > 1 ? `${name(path)} (${basename(dirname(path))})` : name(path),
  }));
}
