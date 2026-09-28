/**
 * The names the runner's main process and its preload agree on.
 *
 * The preload cannot import this file: a sandboxed preload's `require` knows `electron` and
 * nothing else, so `runtime-preload.cts` restates each string, and `runtime-preload.test.ts` runs
 * the preload against these constants so the two cannot drift. The page restates the global's name
 * too, in `apps/runtime/src/desktop-host.ts`, for the reason apps restate topic strings: nothing
 * imports an app.
 */

/** The `window` property the preload exposes the bridge on. */
export const DESKTOP_BRIDGE_GLOBAL = 'perchDesktop';

/** Invoked by the page once, at start: the relay URL and the open document. */
export const RUNNER_LOAD_CHANNEL = 'perch:runner:load';

/** Sent to the page whenever the open document changes on disk. */
export const RUNNER_DOCUMENT_CHANNEL = 'perch:runner:document';
