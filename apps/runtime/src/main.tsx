/**
 * Browser entry point. Builds the sources, mounts the page, and nothing else.
 *
 * This is the **only** file in the repo that constructs a sensor source. Everything downstream —
 * the page, the provider, the store, the widgets — receives one, and `app.test.tsx` injects its
 * own seeded pair without this file being involved at all.
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

/** How often the short-lived source publishes before it dies. */
const FROZEN_PUBLISH_INTERVAL_MS = 200;

/**
 * How long it lives.
 *
 * Long enough that the page has certainly mounted, subscribed and received several readings — a
 * few hundred ms against a mount measured in single-digit ms. The alternative, publishing once
 * immediately after `render()`, races React's scheduler: `render()` returns before effects run, so
 * the provider may not have subscribed yet, and the mock retains nothing for a late subscriber the
 * way an MQTT broker would. A publisher that runs briefly and then stops needs no such assumption,
 * and it is a truer model of the failure being shown: something that *was* publishing and isn't.
 */
const FROZEN_LIFETIME_MS = 700;

/**
 * A source that publishes for a moment and then dies, so the stale rendering has something real
 * to render. Modelling a dead publisher with an actually dead publisher beats faking a clock: the
 * age the widget prints is a true age.
 *
 * A mock in **both** modes, deliberately — a running relay cannot be asked to die on cue for a
 * demonstration — which is why its tile is captioned as mock data even when everything else on the
 * page is hardware. Seeded, because this one's job is to be reproducible in a screenshot.
 */
const frozen = createMockSource({ seed: 1, intervalMs: FROZEN_PUBLISH_INTERVAL_MS });

const { source: live, identity } = buildLiveSource();

const host = document.getElementById('perch-root');
if (host === null) {
  throw new Error('index.html is missing #perch-root');
}

createRoot(host).render(
  <StrictMode>
    <Dashboard sources={{ live, frozen }} liveSource={identity} />
  </StrictMode>,
);

setTimeout(() => {
  frozen.stop();
}, FROZEN_LIFETIME_MS);
