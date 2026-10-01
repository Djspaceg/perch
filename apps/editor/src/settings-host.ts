/**
 * The page, hosted by the desktop app's Settings window: what its preload hands over.
 *
 * The window's preload puts a bridge on `window.perchSettingsHost` with two methods: `load`, which
 * answers the in-process relay's URL, what it is polling and the windows' colour scheme, and
 * `setScheme`, which the main process applies to every window (Electron's `nativeTheme`, which the
 * editor's chrome follows through `prefers-color-scheme`). Everything else the window does it does
 * over the relay's own control path, exactly as the editor's connection control does in a browser,
 * and the runner saves the host the relay is moved to (`apps/desktop/src/runner.ts`).
 *
 * Restated rather than imported, as `desktop-host.ts` is: nothing imports an app. The global and the
 * channel are pinned on the desktop side by `settings-preload.test.ts`.
 */

import type { ChromeScheme } from './controls/chrome.js';
import type { RelayTarget } from './editor-host.js';

/** The `window` property the Settings window's preload exposes. Neither the editor's nor the runner's. */
export const SETTINGS_BRIDGE_GLOBAL = 'perchSettingsHost';

export interface SettingsStart {
  /** The in-process relay's WebSocket URL. */
  readonly brokerUrl: string;
  /** What the relay is polling, so the control starts there. */
  readonly relay: RelayTarget;
  /** The windows' colour scheme. */
  readonly scheme: ChromeScheme;
}

export interface SettingsBridge {
  load(): Promise<SettingsStart>;
  setScheme(scheme: ChromeScheme): Promise<void>;
}

/** The bridge, if this page is in the Settings window. Checked structurally, since it arrives untyped. */
export function findSettingsBridge(host: object): SettingsBridge | null {
  const candidate: unknown = (host as Record<string, unknown>)[SETTINGS_BRIDGE_GLOBAL];
  if (typeof candidate !== 'object' || candidate === null) return null;

  const { load, setScheme } = candidate as { load?: unknown; setScheme?: unknown };

  return typeof load === 'function' && typeof setScheme === 'function'
    ? (candidate as SettingsBridge)
    : null;
}
