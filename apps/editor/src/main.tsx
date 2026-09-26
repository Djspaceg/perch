/**
 * Browser entry point. Builds the source, reads the URL, mounts the editor, and nothing else.
 *
 * The only file in `apps/editor` that constructs anything global: the sensor sources, the relay's
 * control path, the layout library, and the transport a save travels over. Everything downstream receives one, which is what
 * lets `app.test.tsx` mount the editor with its own two-layout library and its own recording
 * transport, and assert that a refused save never reached it.
 *
 * ## Two sources: the relay's, and the mock for when it is not connected
 *
 * `PERCH_RELAY_URL` is set by the dev stack (`tools/dev-stack.mjs`) to the WebSocket port the relay
 * *reported* binding, and by nothing else — this page never assumes 9001, which on this machine may be
 * a mosquitto that accepts the connection and delivers nothing. It reaches the page because
 * `vite.config.ts` adds `PERCH_` to `envPrefix`, as the runtime's does. Unset (`--no-relay`), there is
 * no relay: the connection control says so and the preview stays on sample data.
 *
 * `PERCH_BROKER_URL` is the runtime page's variable, not this one: the runtime dials a broker; this
 * editor dials the relay the stack started and tells it which sensor host to poll.
 *
 * The mock is unseeded, so values differ run to run and the preview looks like a machine rather than a
 * fixture — a seeded page invites reading the same numbers back as proof that something works.
 *
 * ## `?layout=`
 *
 * Read once at startup and not watched. The picker is the way to change layouts once the page is up;
 * the query parameter exists so a link can open a particular file, including one under
 * `layouts/invalid/` that the picker deliberately does not offer.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createMockSource,
  createMqttSource,
  createRelayControl,
  isRelayBrokerUrl,
} from '@perch/sensor-sources';
import { Editor } from './app.js';
import type { ConnectionStorage } from './connection.js';
import type { RelayLink } from './connection-control.js';
import { LAYOUT_LIBRARY } from './layout-library.js';
import { browserSaveTransport } from './save.js';

const source = createMockSource();

/** The relay the stack started, or `undefined`. A malformed URL is a thrown error, not the mock. */
function buildRelay(url: string | undefined): RelayLink | undefined {
  const trimmed = url?.trim() ?? '';
  if (trimmed === '') return undefined;
  if (!isRelayBrokerUrl(trimmed)) {
    throw new TypeError(`PERCH_RELAY_URL is not a ws:// or wss:// URL: ${JSON.stringify(trimmed)}`);
  }

  return {
    url: trimmed,
    source: createMqttSource({ url: trimmed, origin: 'env' }),
    control: createRelayControl({ url: trimmed }),
  };
}

/** `localStorage`, or `undefined` where reading the property itself throws (some privacy modes). */
function browserStorage(): ConnectionStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The layout named in the URL, or `undefined` to take the library's first. */
function requestedLayout(search: string): string | undefined {
  const name = new URLSearchParams(search).get('layout');

  return name === null || name === '' ? undefined : name;
}

const host = document.getElementById('perch-editor-root');
if (host === null) {
  throw new Error('index.html is missing #perch-editor-root');
}

createRoot(host).render(
  <StrictMode>
    <Editor
      library={LAYOUT_LIBRARY}
      source={source}
      // The mock's own canonical topics, as the inspector's suggestions while not connected. Once
      // connected, the picker lists what the relay publishes instead.
      topics={source.topics}
      relay={buildRelay(import.meta.env.PERCH_RELAY_URL)}
      storage={browserStorage()}
      transport={browserSaveTransport}
      initialLayout={requestedLayout(window.location.search)}
    />
  </StrictMode>,
);
