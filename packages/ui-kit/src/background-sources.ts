/**
 * The state of each cloud background a layout names, for `LayoutCanvas` to paint.
 *
 * A background reference (`thermalright:a042`) is resolved by the *host*: the desktop app's main
 * process, or the dev server, downloads it into a cache and answers a URL the page can read. This
 * module holds only the asking and the answers — the `ensure` function is injected — so `ui-kit`
 * carries no network or Electron code, and the runtime and the editor share one implementation of
 * "ask once per reference and target, show loading, then the video or why not".
 *
 * Keyed by reference *and* target, because the target picks which hosted size is fetched: a layout
 * resized in the editor asks again, and a draft edit that changes nothing else asks nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isBackgroundRef, type Layout } from '@perch/layout-schema';

/** Where a background is: a URL to play, still being fetched, or not to be had and why. */
export type BackgroundSource =
  | { readonly status: 'ready'; readonly url: string }
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly reason: string };

/** The host's download-and-cache, for one reference at one layout target. */
export type EnsureBackground = (
  ref: string,
  target: { readonly width: number; readonly height: number },
) => Promise<BackgroundSource>;

/** Why a page with no host to ask shows no background. */
export const NO_BACKGROUND_HOST =
  'this page has no background cache; the desktop app and npm run dev have one';

const LOADING: BackgroundSource = Object.freeze({ status: 'loading' });

/**
 * Ask `ensure` for each background `layout` names, and return how the canvas reads the answers.
 * `layout` may be `null` (nothing to paint yet); `ensure` may be `undefined` (no host), in which
 * case every reference reads as failed, saying so.
 */
export function useBackgroundSources(
  layout: Layout | null,
  ensure: EnsureBackground | undefined,
): (ref: string) => BackgroundSource {
  const [answers, setAnswers] = useState<ReadonlyMap<string, BackgroundSource>>(() => new Map());
  /**
   * What has been asked for, so a re-render or StrictMode's second effect asks nothing twice. A ref,
   * not state: an ask is not something to render. Not reset when `ensure` changes, since both apps
   * make theirs once per page; an answer is the same file whoever fetched it.
   */
  const asked = useRef(new Set<string>());
  const width = layout?.target.width ?? 0;
  const height = layout?.target.height ?? 0;
  const refsKey = useMemo(() => referencesIn(layout).join('\n'), [layout]);

  useEffect(() => {
    if (ensure === undefined || refsKey === '') return;
    for (const ref of refsKey.split('\n')) {
      const key = keyOf(ref, width, height);
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      // Not cancelled on cleanup: the answer is keyed, so one that lands after the layout moved on
      // is simply kept for when it comes back, and one after unmount is dropped by React.
      ensure(ref, { width, height }).then(
        (answer) => {
          setAnswers((before) => new Map(before).set(key, answer));
        },
        (error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          setAnswers((before) => new Map(before).set(key, { status: 'failed', reason }));
        },
      );
    }
  }, [ensure, refsKey, width, height]);

  // Anything asked for and not yet answered reads as loading, so nothing is written to say so.
  return useCallback(
    (ref: string) =>
      ensure === undefined
        ? { status: 'failed', reason: NO_BACKGROUND_HOST }
        : (answers.get(keyOf(ref, width, height)) ?? LOADING),
    [answers, ensure, width, height],
  );
}

function keyOf(ref: string, width: number, height: number): string {
  return `${ref}@${String(width)}x${String(height)}`;
}

/** Each distinct background reference the layout's background and media name, in paint order. */
function referencesIn(layout: Layout | null): string[] {
  if (layout === null) return [];
  const found = new Set<string>();
  // Hidden layers too: showing one again should not wait on a download.
  if (layout.background !== undefined && isBackgroundRef(layout.background.src)) {
    found.add(layout.background.src);
  }
  for (const element of layout.elements) {
    if (element.kind === 'media' && isBackgroundRef(element.src)) found.add(element.src);
  }
  return [...found];
}
