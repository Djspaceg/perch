/**
 * How much room the preview pane has, and therefore what scale the canvas is shown at.
 *
 * The runtime asks the same question of the whole window (`apps/runtime/src/viewport.ts`) and this
 * file follows it deliberately rather than inventing a parallel mechanism:
 * `useSyncExternalStore` over `resize`, a module-level cache so the snapshot is referentially stable,
 * and a pure function doing the arithmetic so the arithmetic can be tested without a window.
 *
 * The cache is not an optimisation. `useSyncExternalStore` compares snapshots by identity, so a
 * `getSnapshot` returning a fresh object each call re-renders forever and React says so —
 * "the result of getSnapshot should be cached". The runtime's copy carries the same note.
 *
 * ## Why the pane is measured in JavaScript rather than by CSS
 *
 * `LayoutCanvas` needs a *number*: the canvas is fixed at the layout's target size and scaled by one
 * `transform`, so somebody has to divide. CSS can size a box to the space left over, but it cannot
 * hand that size to a prop. The alternatives were a `ResizeObserver` on the pane — absent in jsdom,
 * so every preview test would need a polyfill or a fake — or laying the chrome out in CSS and
 * measuring the pane afterwards, which is the same observer with an extra frame of wrong scale.
 *
 * So the header's height and the padding are constants here, the sidebar's width is handed in (it is
 * the author's, and moves: `sidebar.tsx`), the pane's inline `width`/`height` come from these
 * numbers, and the scale comes from the same numbers. One source for a size that would otherwise be
 * spelled twice — once in a stylesheet, once in a division — and drift between the two is exactly a
 * preview whose scale does not match the box it is drawn in.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { SIDEBAR_DEFAULT_WIDTH } from './sidebar.js';

/** The space available to the canvas, in CSS pixels. */
export interface PreviewViewport {
  readonly width: number;
  readonly height: number;
}

/** How tall the header strip is. */
export const HEADER_HEIGHT = 44;

/** The gap between the pane's edge and the canvas, on every side. */
export const PREVIEW_PADDING = 16;

/** The window's inner size, in CSS pixels. */
export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The pane's size for a given window and the width the sidebar takes from it (its width, or the
 * folded handle's), floored to whole pixels and never below 1.
 *
 * Floored because a fractional pane against an integer canvas produces a scale with no exact
 * representation, and the scale is printed. Clamped at 1 because a window narrower than the
 * sidebar yields a negative width, and a negative width divided into a canvas is a negative scale
 * — a canvas mirrored through the origin, which is a rendering no author could explain.
 */
export function previewViewport(
  windowWidth: number,
  windowHeight: number,
  sidebarWidth: number = SIDEBAR_DEFAULT_WIDTH,
): PreviewViewport {
  return {
    width: Math.max(1, Math.floor(windowWidth - sidebarWidth - PREVIEW_PADDING * 2)),
    height: Math.max(1, Math.floor(windowHeight - HEADER_HEIGHT - PREVIEW_PADDING * 2)),
  };
}

/**
 * The last window size handed out, so repeated `getSnapshot` calls return the same object.
 *
 * Module-level rather than per-hook: it is a cache of a global — the one window — and two hooks
 * asking would get the same answer anyway.
 */
let lastSize: WindowSize = { width: 1, height: 1 };

/** The size during a server render: no window, so no size. */
const SERVER_SIZE: WindowSize = Object.freeze({ width: 0, height: 0 });

function readSize(): WindowSize {
  if (window.innerWidth !== lastSize.width || window.innerHeight !== lastSize.height) {
    lastSize = { width: window.innerWidth, height: window.innerHeight };
  }

  return lastSize;
}

function readServerSize(): WindowSize {
  return SERVER_SIZE;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);

  return () => {
    window.removeEventListener('resize', onChange);
  };
}

/** The window's size, re-read on every resize. */
export function useWindowSize(): WindowSize {
  return useSyncExternalStore(subscribe, readSize, readServerSize);
}

/**
 * The preview pane's size beside a sidebar taking `sidebarWidth`, re-read on every window resize. The
 * same object while nothing it depends on changes, so the canvas does not re-render for nothing.
 */
export function usePreviewViewport(sidebarWidth: number): PreviewViewport {
  const size = useWindowSize();

  return useMemo(
    () =>
      size.width === 0 && size.height === 0
        ? SERVER_SIZE
        : previewViewport(size.width, size.height, sidebarWidth),
    [size, sidebarWidth],
  );
}
