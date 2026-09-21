/**
 * The viewport, and the two questions the page asks about it.
 *
 * A layout declares a canvas size. The browser has whatever size it has. `layout-schema` states the
 * *relationship* between the two — `fitLayoutTarget` for the scale factor and the kind of fit,
 * `describeTargetMismatch` for the sentence — and deliberately stops there: whether a letterbox is
 * acceptable is the runtime's policy, not the format's. This file is that policy.
 *
 * ## The policy, in one table
 *
 * | Mode | Viewport | What happens |
 * |---|---|---|
 * | windowed | anything | the whole canvas is scaled to fit and letterboxed. Never refused. |
 * | capture | exactly `target` | rendered 1:1 |
 * | capture | anything else | **refused**, naming the mismatch |
 *
 * Windowed mode cannot refuse, because scaling to fit *is* what windowed mode is — a browser tab is
 * not 1920x400 and a page that refused to draw in one would be a page nobody could develop against.
 * Capture mode is where README.md's hard rule 2 lives ("rejects a layout it cannot honour, naming
 * the mismatch"): a capture is pixels somebody will treat as the panel's output, so a silent 0.74x
 * scale would put a scaled screenshot into evidence as though it were the real thing. The refusal is
 * the honest outcome, and the fix is a correctly-sized viewport, which the capture harness controls.
 *
 * ## Why `frameRate` is not compared
 *
 * `OutputCapabilities.frameRate` is omitted, which `fitLayoutTarget` reads as "unknown, do not
 * check". A browser will not tell a page its compositor's refresh rate; `requestAnimationFrame`
 * cadence is an estimate that needs a second of samples and is wrong under a headless capture, which
 * is exactly where this code runs. A measured-looking number that is a guess would make a layout's
 * declared ceiling appear checked when it is not, and the check that matters — can this output paint
 * the canvas at the size the author authored — is the geometric one.
 */

import { useSyncExternalStore } from 'react';
import {
  describeTargetMismatch,
  fitLayoutTarget,
  type LayoutTarget,
  type OutputCapabilities,
  type TargetFit,
} from '@perch/layout-schema';

/** How the page is being looked at. Chosen by the URL; see `parsePageRequest`. */
export type PageMode = 'windowed' | 'capture';

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The decision: paint at this scale, or refuse with this sentence.
 *
 * A discriminated union rather than a fit plus a nullable message, so a caller cannot paint and
 * report a refusal at the same time — which is the failure this whole path exists to prevent.
 */
export type CanvasFit =
  | { readonly ok: true; readonly fit: TargetFit }
  | { readonly ok: false; readonly mismatch: string };

/**
 * Whether this viewport may paint this layout, and at what scale.
 *
 * Pure, and taking the viewport as an argument rather than reading `window`, because the interesting
 * cases are all "what would happen at a size this machine's browser window is not".
 */
export function fitCanvas(target: LayoutTarget, viewport: ViewportSize, mode: PageMode): CanvasFit {
  const output: OutputCapabilities = { width: viewport.width, height: viewport.height };

  if (mode === 'capture') {
    const mismatch = describeTargetMismatch(target, output);
    if (mismatch !== null) return { ok: false, mismatch };
  }

  return { ok: true, fit: fitLayoutTarget(target, output) };
}

/**
 * The viewport, re-read on resize.
 *
 * `useSyncExternalStore` rather than `useState` in an effect: the size is external state that exists
 * before this component mounts, and the store form makes the *first* render use the real size
 * instead of a placeholder that is corrected one frame later. A capture samples one frame, and a
 * page whose first frame is laid out for the wrong viewport is a page that can be photographed
 * mid-correction.
 *
 * `resize` alone is enough here — the canvas scale depends on nothing else. Zoom, a device-pixel-ratio
 * change and an orientation change all fire it.
 */
export function useViewport(): ViewportSize {
  return useSyncExternalStore(subscribeToViewport, readViewport, readServerViewport);
}

function subscribeToViewport(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
  };
}

/**
 * The current size, memoised by value.
 *
 * `useSyncExternalStore` compares snapshots with `Object.is` and re-renders when they differ, so a
 * fresh object every call would re-render on every unrelated render and, in development, trip
 * React's "getSnapshot should be cached" warning. The cached object is replaced only when a number
 * actually changed.
 */
let lastViewport: ViewportSize = { width: 0, height: 0 };

function readViewport(): ViewportSize {
  const width = window.innerWidth;
  const height = window.innerHeight;

  if (width !== lastViewport.width || height !== lastViewport.height) {
    lastViewport = { width, height };
  }

  return lastViewport;
}

/**
 * The server snapshot, which must never be a guess.
 *
 * There is no viewport during a server render, and a made-up 1920x1080 would produce a scale factor
 * that is wrong on every real client — hydration would then correct the geometry on the first
 * client frame, which is the one a capture may already have taken. Zero is the honest answer and
 * lands as a scale of 0: nothing paints until a real viewport is known.
 */
function readServerViewport(): ViewportSize {
  return { width: 0, height: 0 };
}

/**
 * What the URL asked for.
 *
 * Both fields are deliberately `null`/defaulted rather than validated here: "no such layout" is a
 * message the page renders with the list of names it *does* have, and that list lives in the
 * catalogue, not in a URL parser.
 */
export interface PageRequest {
  /** The layout named by `?layout=`, or `null` to take the catalogue's default. */
  readonly layout: string | null;
  readonly mode: PageMode;
}

/**
 * Read the page's two knobs out of a query string.
 *
 * A query parameter rather than a path segment or a build flag, for one reason each: the page is a
 * single static bundle with no server to route paths, and a build flag would mean rebuilding to look
 * at the other layout. `?layout=desk-1920x400&mode=capture` is also the whole interface a capture
 * harness needs — it navigates to a URL and nothing else.
 *
 * An unrecognised `mode` falls back to `windowed`, which is the mode that cannot refuse: a typo in a
 * URL should show a page, not a refusal about a mode. An unrecognised layout does *not* fall back —
 * see `PageRequest.layout`.
 */
export function parsePageRequest(search: string): PageRequest {
  const params = new URLSearchParams(search);
  const layout = params.get('layout');

  return {
    layout: layout === null || layout === '' ? null : layout,
    mode: params.get('mode') === 'capture' ? 'capture' : 'windowed',
  };
}
