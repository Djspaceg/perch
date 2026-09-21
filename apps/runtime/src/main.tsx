/**
 * Browser entry point. Builds the sources, mounts the page, and nothing else.
 *
 * This is the **only** file in the repo that constructs a sensor source. Everything downstream —
 * the page, the provider, the store, the widgets — receives one. Swapping the mock for MQTT is
 * therefore a change to the two `createMockSource` calls below and to nothing else:
 *
 * ```ts
 * const live = createMqttSource({ url: await resolveBrokerUrlAsync() });
 * ```
 *
 * Keeping construction here also keeps it out of the test for `app.tsx`, which injects its own
 * seeded sources and never touches a timer it did not start.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createMockSource } from '@perch/sensor-sources';
import { Dashboard } from './app.js';

/**
 * The live source. **This is the mock/MQTT seam.**
 *
 * Unseeded, so the values differ run to run and the page looks like a machine rather than a
 * fixture — a seeded page invites reading the same numbers back as proof that it works.
 */
const live = createMockSource();

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
 * Seeded, because this one's job is to be reproducible in a screenshot.
 */
const frozen = createMockSource({ seed: 1, intervalMs: FROZEN_PUBLISH_INTERVAL_MS });

const host = document.getElementById('perch-root');
if (host === null) {
  throw new Error('index.html is missing #perch-root');
}

createRoot(host).render(
  <StrictMode>
    <Dashboard sources={{ live, frozen }} />
  </StrictMode>,
);

setTimeout(() => {
  frozen.stop();
}, FROZEN_LIFETIME_MS);
