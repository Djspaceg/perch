/**
 * Browser entry point. Builds the source, reads the URL, mounts the page, and nothing else.
 *
 * In the desktop runner the source and the layout come from the runner instead; see
 * `desktop-host.ts` and `startInDesktop` below. Everything that follows describes the browser path,
 * which is unchanged by it.
 *
 * This is the **only** file in the repo that constructs a sensor source. Everything downstream —
 * the page, the provider, the store, the widgets — receives one, and `app.test.tsx` injects its
 * own seeded source and its own catalogue without this file being involved at all.
 *
 * ## One source, since the layout decides what is shown
 *
 * There used to be a second, deliberately short-lived mock here, so the hard-coded page could show
 * a tile in its stale state. A layout file has no way to say which source a widget reads — nor
 * should it; `SensorSource` is one stream of one machine's readings — so a second source now has no
 * tile it could reach. The stale rendering is still exercised where it belongs, in `ui-kit`'s tests
 * against a controlled clock, and it still appears on the page the moment a real publisher stops.
 *
 * ## The seam is conditional, and that is the point
 *
 * ```text
 * PERCH_BROKER_URL set    ->  createMqttSource, reading the real relay
 * PERCH_BROKER_URL unset  ->  createMockSource, generated here
 * ```
 *
 * Not "MQTT now, mock deleted": the machine this dashboard watches is off most of the time, and
 * `npm run dev` has to keep drawing a page with no relay, no broker and no hardware — that is how
 * the widgets get worked on at all. Equally it must never quietly *substitute* the mock for
 * hardware, so the identity of whichever source was built is passed to the page and printed there.
 *
 * ## How the variable reaches the browser
 *
 * `resolveBrokerUrl` reads an environment record, and `readProcessEnv()` deliberately returns `{}`
 * in a browser — there is no `process` in a page, so a value can only arrive if the bundler put it
 * there. Vite replaces `import.meta.env.PERCH_BROKER_URL` at build time with the value the shell
 * had, and it will only do that for a name matching `envPrefix` — hence `PERCH_` in
 * `vite.config.ts`, and the narrow `ImportMetaEnv` in `vite-env.d.ts` that keeps the value
 * `string | undefined` rather than `any`.
 *
 * The value is then handed to the package's own `resolveBrokerUrl` rather than used directly, so
 * the trimming, the `ws:`/`wss:` validation and the "a malformed override throws with the
 * variable's name in it" rule are the same in the browser as everywhere else. What this file adds
 * is one decision the package cannot make for it: *only* `origin === 'env'` selects MQTT. Falling
 * back to `ws://localhost:9001` because that is the built-in default is precisely the trap
 * `broker-url.ts` documents — on this machine that port is a Homebrew Mosquitto, which accepts the
 * connection, accepts the subscriptions and delivers nothing, leaving a page that looks connected
 * and stays empty.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  RELAY_BROKER_URL_ENV_VAR,
  createMockSource,
  createMqttSource,
  resolveBrokerUrl,
} from '@perch/sensor-sources';
import type { SensorSource } from '@perch/sensor-contract';
import { Dashboard, type LiveSourceIdentity } from './app.js';
import {
  desktopCatalogue,
  desktopPageRequest,
  findDesktopBridge,
  type DesktopBridge,
  type DesktopDocument,
} from './desktop-host.js';
import {
  LAYOUT_CATALOGUE,
  createLayoutCatalogue,
  type LayoutCatalogue,
} from './layout-catalogue.js';
import { parsePageRequest, type PageRequest } from './viewport.js';

/**
 * The live source. **This is the mock/MQTT seam.**
 *
 * The mock is unseeded, so the values differ run to run and the page looks like a machine rather
 * than a fixture — a seeded page invites reading the same numbers back as proof that it works.
 */
function buildLiveSource(): { source: SensorSource; identity: LiveSourceIdentity } {
  // One key, read through the package's resolver: `origin` is what the decision turns on, and a
  // malformed `PERCH_BROKER_URL` throws here rather than silently becoming the mock.
  const resolved = resolveBrokerUrl({
    env: { [RELAY_BROKER_URL_ENV_VAR]: import.meta.env.PERCH_BROKER_URL },
  });

  if (resolved.origin !== 'env') {
    return { source: createMockSource(), identity: { kind: 'mock' } };
  }

  return {
    source: createMqttSource({ url: resolved.url, origin: resolved.origin }),
    identity: { kind: 'mqtt', url: resolved.url },
  };
}

const host = document.getElementById('perch-root');
if (host === null) {
  throw new Error('index.html is missing #perch-root');
}
const root = createRoot(host);

function renderPage(
  source: SensorSource,
  identity: LiveSourceIdentity,
  catalogue: LayoutCatalogue,
  request: PageRequest,
): void {
  root.render(
    <StrictMode>
      <Dashboard source={source} liveSource={identity} catalogue={catalogue} request={request} />
    </StrictMode>,
  );
}

/**
 * In the desktop runner: the relay the runner started, and the one document it opened, re-rendered
 * in place on every save. See `desktop-host.ts`. The source is built once and kept across documents,
 * so a save does not drop the connection or the readings already in the store.
 */
async function startInDesktop(bridge: DesktopBridge): Promise<void> {
  const { brokerUrl, document: opened } = await bridge.load();
  const source = createMqttSource({ url: brokerUrl, origin: 'config' });
  const identity: LiveSourceIdentity = { kind: 'mqtt', url: brokerUrl };

  const show = (shown: DesktopDocument | null): void => {
    renderPage(
      source,
      identity,
      shown === null ? createLayoutCatalogue({ layouts: {} }) : desktopCatalogue(shown),
      shown === null
        ? parsePageRequest(window.location.search)
        : desktopPageRequest(window.location.search, shown),
    );
  };

  show(opened);
  bridge.onDocument(show);
}

const bridge = findDesktopBridge(window);

if (bridge === null) {
  const { source, identity } = buildLiveSource();
  // The catalogue is read at build time from `layouts/`, so a static bundle carries every layout it
  // can render and needs no server to fetch one. Injected rather than imported by the page for the
  // same reason the source is: a test supplies its own two-entry catalogue.
  //
  // The request is read once at startup, not watched. Changing `?layout=` is a navigation, and a
  // full reload is the honest way to switch: it rebuilds the store, so no reading from the previous
  // layout's topics can survive into the next one's tiles.
  renderPage(source, identity, LAYOUT_CATALOGUE, parsePageRequest(window.location.search));
} else {
  startInDesktop(bridge).catch((error: unknown) => {
    // The runner forwards the page's console to its own log, which is where this is read.
    console.error('perch: the desktop runner could not start the page', error);
  });
}
