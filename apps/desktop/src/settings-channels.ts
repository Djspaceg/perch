/**
 * The names the Settings window's main process side and its preload agree on.
 *
 * Restated in `settings-preload.cts`, which cannot import this file for the reason the runner's
 * preload cannot (see `runner-channels.ts`), and pinned there by `settings-preload.test.ts`. The page
 * restates the global's name in `apps/editor/src/settings-host.ts`.
 */

/** The `window` property the Settings preload exposes. Neither the editor's nor the runner's. */
export const SETTINGS_BRIDGE_GLOBAL = 'perchSettingsHost';

export const SETTINGS_CHANNELS = {
  /** Invoked once at start: the relay's URL, and what it is polling. */
  load: 'perch:settings:load',
} as const;
