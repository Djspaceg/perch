/**
 * The Settings window's entry point: `settings.html`, a second page of the editor's build, which only
 * the desktop app loads. It reads its preload's bridge (`settings-host.ts`), dials the relay the same
 * way the editor does (`relay-link.ts`) and mounts `SettingsPage`. With no bridge, as under
 * `npm run dev`, it says what it is for rather than showing a control with nothing behind it.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { buildRelay } from './relay-link.js';
import { findSettingsBridge } from './settings-host.js';
import { SettingsPage } from './settings-page.js';

const host = document.getElementById('perch-settings-root');
if (host === null) {
  throw new Error('settings.html is missing #perch-settings-root');
}

const bridge = findSettingsBridge(window);

if (bridge === null) {
  host.textContent = "perch's Settings window: open it from the desktop app's menu or tray.";
} else {
  bridge.load().then(
    (start) => {
      createRoot(host).render(
        <StrictMode>
          <SettingsPage relay={buildRelay(start.brokerUrl, 'config')} target={start.relay} />
        </StrictMode>,
      );
    },
    (error: unknown) => {
      host.textContent = `perch could not open Settings: ${error instanceof Error ? error.message : String(error)}`;
    },
  );
}
