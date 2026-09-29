/**
 * The page, hosted by the desktop app's Settings window: what its preload hands over.
 *
 * The window's preload puts a bridge on `window.perchSettingsHost` with one method, `load`, which
 * answers the in-process relay's URL and what it is polling. Everything else the window does it does
 * over the relay's own control path, exactly as the editor's connection control does in a browser,
 * and the runner saves the host the relay is moved to (`apps/desktop/src/runner.ts`).
 *
 * Restated rather than imported, as `desktop-host.ts` is: nothing imports an app. The global and the
 * channel are pinned on the desktop side by `settings-preload.test.ts`.
 */

import type { RelayTarget } from './editor-host.js';

/** The `window` property the Settings window's preload exposes. Neither the editor's nor the runner's. */
export const SETTINGS_BRIDGE_GLOBAL = 'perchSettingsHost';

export interface SettingsStart {
  /** The in-process relay's WebSocket URL. */
  readonly brokerUrl: string;
  /** What the relay is polling, so the control starts there. */
  readonly relay: RelayTarget;
}

export interface SettingsBridge {
  load(): Promise<SettingsStart>;
}

/** The bridge, if this page is in the Settings window. Checked structurally, since it arrives untyped. */
export function findSettingsBridge(host: object): SettingsBridge | null {
  const candidate: unknown = (host as Record<string, unknown>)[SETTINGS_BRIDGE_GLOBAL];
  if (typeof candidate !== 'object' || candidate === null) return null;

  return typeof (candidate as { load?: unknown }).load === 'function'
    ? (candidate as SettingsBridge)
    : null;
}
