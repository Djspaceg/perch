/**
 * Which document to open at launch: the last one, if it is still there; otherwise the first in the
 * folder, and a sentence saying so.
 *
 * Pure, with the one filesystem question (does the remembered file still exist) asked by the
 * caller, so every branch is a table row in a test.
 */

import { basename } from 'node:path';
import type { LayoutDocument } from './layouts-folder.js';

export interface ResumeInput {
  /** The remembered document, or `null` on a first run. */
  readonly saved: string | null;
  /** Whether `saved` is a file that exists now. */
  readonly savedExists: boolean;
  /** The folder's documents, in the order the tray shows them. */
  readonly listing: readonly LayoutDocument[];
  /** The folder, for the sentence when it is empty. */
  readonly folder: string;
}

export interface ResumeChoice {
  readonly document: LayoutDocument | null;
  /** Why this is not the document the user last had open, or `null` when nothing needs saying. */
  readonly notice: string | null;
}

export function chooseDocument({ saved, savedExists, listing, folder }: ResumeInput): ResumeChoice {
  if (saved !== null && savedExists) {
    // A document outside the folder is reopened too: the editor may open one from anywhere, and the
    // runner reads documents, not folders.
    const listed = listing.find((document) => document.path === saved);
    return { document: listed ?? { name: basename(saved, '.json'), path: saved }, notice: null };
  }

  const first = listing[0] ?? null;

  if (first === null) {
    return {
      document: null,
      notice:
        saved === null
          ? `no layout documents in ${folder}`
          : `${saved} is gone, and there are no layout documents in ${folder}`,
    };
  }

  return {
    document: first,
    notice: saved === null ? null : `${saved} is gone; opened ${first.name} instead`,
  };
}
