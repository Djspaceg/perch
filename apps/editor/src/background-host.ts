/**
 * What the editor asks of its host about cloud backgrounds: download one (and say where it is), and
 * show a thumbnail of one. The desktop app answers from its main process (`desktop-host.ts`); the
 * dev server from its Node cache (`@perch/backgrounds`'s dev client). Neither is this file's: it is
 * the shape, the context the inspector reads it through, and the check an untyped answer gets.
 */

import { createContext } from 'react';
import type { BackgroundSource, EnsureBackground } from '@perch/ui-kit';

/** A thumbnail: a still image, or a video whose first frame stands for one. */
export type Thumbnail =
  | { readonly status: 'ready'; readonly kind: 'image' | 'video'; readonly url: string }
  | { readonly status: 'failed'; readonly reason: string };

export interface BackgroundHost {
  /** Download `ref` for this target if it is not cached; where it is, or why not. */
  readonly ensure: EnsureBackground;
  readonly preview: (
    ref: string,
    target: { readonly width: number; readonly height: number },
  ) => Promise<Thumbnail>;
}

/**
 * The host, the canvas it picks for, and the local media the open layout can name, for every source
 * control below it.
 */
export const BackgroundContext = createContext<{
  readonly host: BackgroundHost | undefined;
  readonly target: { readonly width: number; readonly height: number };
  /** Media files beside the open layout, as the `src` it would write (`LayoutLibrary.media`). */
  readonly localMedia?: readonly string[];
}>({ host: undefined, target: { width: 1920, height: 400 } });

/** Why the background control is off: nothing to download into. */
export const NO_BACKGROUND_CACHE =
  'no background cache here: backgrounds need the desktop app or npm run dev';

/** An untyped `{ ok, url }` answer as the canvas reads it, played only from `origin`. */
export function sourceFromAnswer(answer: unknown, origin: string): BackgroundSource {
  const record = recordOf(answer);
  const url = record['url'];
  if (record['ok'] === true && typeof url === 'string' && url.startsWith(origin)) {
    return { status: 'ready', url };
  }
  return { status: 'failed', reason: reasonOf(record) };
}

/** An untyped `{ ok, kind, url }` answer as a thumbnail, shown only from `origin`. */
export function thumbnailFromAnswer(answer: unknown, origin: string): Thumbnail {
  const record = recordOf(answer);
  const url = record['url'];
  const kind = record['kind'];
  if (
    record['ok'] === true &&
    typeof url === 'string' &&
    url.startsWith(origin) &&
    (kind === 'image' || kind === 'video')
  ) {
    return { status: 'ready', kind, url };
  }
  return { status: 'failed', reason: reasonOf(record) };
}

function recordOf(answer: unknown): Readonly<Record<string, unknown>> {
  return typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>) : {};
}

function reasonOf(record: Readonly<Record<string, unknown>>): string {
  const reason = record['reason'];
  return record['ok'] === false && typeof reason === 'string'
    ? reason
    : 'the host sent no usable answer';
}
