/**
 * The layouts folder, watched: every add, rename or removal lists the folder again and hands the
 * listing on. The tray's layouts and File > Open preset are rebuilt from it, and the editor's picker
 * is told, so a Save As or a file dropped in from Finder appears without a relaunch.
 *
 * `fs.watch` on the directory, which reports those three on every platform this runs on, often
 * several times for one change; the listing waits for the events to go quiet (`debounceMs`) so one
 * rename is one rebuild. Node only, so it is tested against a real temporary folder.
 *
 * The folder is also listed once `settleMs` after the watch starts, whether or not anything was
 * reported: macOS drops changes made in the first moments of an FSEvents stream, the reason the
 * document watch reads its file once more (`document.ts`). Without it, `folder-watch.test.ts` lost
 * the change it made right after starting the watch in two runs of three of the whole suite.
 */

import { watch } from 'node:fs';
import { listLayoutDocuments, type LayoutDocument } from './layouts-folder.js';

export interface FolderWatchOptions {
  /** The folder's documents, after each change. */
  readonly onList: (documents: LayoutDocument[]) => void;
  /** The watch stopped, or a listing failed. */
  readonly onError: (error: Error) => void;
  readonly debounceMs?: number;
  readonly settleMs?: number;
}

/** Watch `folder`. Returns the stop. */
export function watchLayoutsFolder(folder: string, options: FolderWatchOptions): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const list = (): void => {
    listLayoutDocuments(folder).then(
      (documents) => {
        if (!stopped) options.onList(documents);
      },
      (error: unknown) => {
        if (!stopped) options.onError(error instanceof Error ? error : new Error(String(error)));
      },
    );
  };

  const watcher = watch(folder, () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(list, options.debounceMs ?? 200);
  });
  watcher.on('error', (error) => {
    options.onError(error);
  });
  const settle = setTimeout(list, options.settleMs ?? 250);

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    clearTimeout(settle);
    watcher.close();
  };
}
