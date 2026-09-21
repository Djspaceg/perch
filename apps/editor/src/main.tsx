/**
 * Browser entry point. Builds the source, reads the URL, mounts the editor, and nothing else.
 *
 * The only file in `apps/editor` that constructs anything global: the sensor source, the layout
 * library, and the transport a save travels over. Everything downstream receives one, which is what
 * lets `app.test.tsx` mount the editor with its own two-layout library and its own recording
 * transport, and assert that a refused save never reached it.
 *
 * ## One source, and it is the mock
 *
 * No `PERCH_BROKER_URL` seam here, unlike `apps/runtime/src/main.tsx`. Authoring must not require
 * hardware: the machine this dashboard watches is off for days at a time, and an editor that needed a
 * relay to draw a readout would be an editor that could not be used to lay one out. The values in the
 * preview are generated in this process and the header says so.
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
import { createMockSource } from '@perch/sensor-sources';
import { Editor } from './app.js';
import { LAYOUT_LIBRARY } from './layout-library.js';
import { browserSaveTransport } from './save.js';

const source = createMockSource();

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
      // The mock's own canonical topics, as the inspector's suggestions. This is SPEC.md's "topic
      // picker populated from live topics", reduced to what is available with the sensor host off.
      topics={source.topics}
      transport={browserSaveTransport}
      initialLayout={requestedLayout(window.location.search)}
    />
  </StrictMode>,
);
