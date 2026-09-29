/**
 * The page's side of the desktop runner: finding the bridge, and turning the one document it hands
 * over into the catalogue and request the page already takes.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockSource } from '@perch/sensor-sources';
import type { EnsureBackground } from '@perch/ui-kit';
import { Dashboard } from './app.js';
import {
  DESKTOP_BRIDGE_GLOBAL,
  desktopBackgrounds,
  desktopCatalogue,
  desktopPageRequest,
  findDesktopBridge,
  type DesktopDocument,
} from './desktop-host.js';

const LAYOUT = JSON.stringify({
  schemaVersion: 1,
  target: { width: 1024, height: 768, frameRate: 30 },
  theme: {},
  elements: [
    { kind: 'media', src: 'desk.assets/rails.svg', rect: { x: 0, y: 0, w: 1024, h: 768 } },
    { kind: 'text', text: 'from disk', rect: { x: 16, y: 16, w: 400, h: 32 } },
  ],
});

const DOCUMENT: DesktopDocument = {
  name: 'desk',
  text: LAYOUT,
  assets: { 'desk.assets/rails.svg': 'app://document/desk.assets/rails.svg' },
};

describe('findDesktopBridge', () => {
  it('finds nothing in a plain browser, so `npm run dev` is unchanged', () => {
    expect(findDesktopBridge({})).toBeNull();
  });

  it('finds the bridge the preload exposed', () => {
    const bridge = { load: () => Promise.resolve(), onDocument: () => () => undefined };

    expect(findDesktopBridge({ [DESKTOP_BRIDGE_GLOBAL]: bridge })).toBe(bridge);
  });

  it('refuses something under that name that is not the bridge', () => {
    expect(findDesktopBridge({ [DESKTOP_BRIDGE_GLOBAL]: { load: 1 } })).toBeNull();
    expect(findDesktopBridge({ [DESKTOP_BRIDGE_GLOBAL]: null })).toBeNull();
  });
});

describe('desktopCatalogue', () => {
  it('offers exactly the one document, as text, with its media', () => {
    const catalogue = desktopCatalogue(DOCUMENT);

    expect(catalogue.names).toEqual(['desk']);
    expect(catalogue.entry('desk')?.text).toBe(LAYOUT);
    expect(catalogue.resolveAsset('desk.assets/rails.svg')).toBe(
      'app://document/desk.assets/rails.svg',
    );
    expect(catalogue.resolveAsset('elsewhere.svg')).toBeUndefined();
  });

  it('offers nothing for a document that is not on disk', () => {
    const catalogue = desktopCatalogue({ ...DOCUMENT, text: null });

    expect(catalogue.names).toEqual([]);
    expect(catalogue.entry('desk')).toBeUndefined();
  });
});

describe('desktopPageRequest', () => {
  it("names the document and keeps the URL's mode", () => {
    expect(desktopPageRequest('', DOCUMENT)).toEqual({ layout: 'desk', mode: 'windowed' });
    expect(desktopPageRequest('?mode=capture&layout=other', DOCUMENT)).toEqual({
      layout: 'desk',
      mode: 'capture',
    });
  });
});

describe('the page, fed a document from disk', () => {
  const page = (document: DesktopDocument) => (
    <Dashboard
      source={createMockSource({ seed: 1 })}
      liveSource={{ kind: 'mqtt', url: 'ws://127.0.0.1:19001' }}
      catalogue={desktopCatalogue(document)}
      request={desktopPageRequest('', document)}
    />
  );

  it('renders it', () => {
    render(page(DOCUMENT));

    expect(screen.getByText('from disk')).toBeInTheDocument();
    expect(screen.getByTestId('perch-layout-name')).toHaveTextContent('desk');
  });

  it("shows the runtime's own refusal for a malformed document, then renders the fixed one", () => {
    const { rerender } = render(page({ ...DOCUMENT, text: '{ "schemaVersion": 1,' }));

    expect(document.querySelector('[data-perch-problem]')).not.toBeNull();
    expect(screen.queryByText('from disk')).toBeNull();

    rerender(page(DOCUMENT));

    expect(document.querySelector('[data-perch-problem]')).toBeNull();
    expect(screen.getByText('from disk')).toBeInTheDocument();
  });

  it('says the document is missing when it is not on disk', () => {
    render(page({ ...DOCUMENT, text: null }));

    expect(document.querySelector('[data-perch-problem="unknown-layout"]')).not.toBeNull();
    expect(screen.getAllByText(/desk/).length).toBeGreaterThan(0);
  });
});

/** `desktopBackgrounds` for a bridge that has the call, which the tests below all give it. */
function backgroundsOf(bridge: Parameters<typeof desktopBackgrounds>[0]): EnsureBackground {
  const made = desktopBackgrounds(bridge);
  if (made === undefined) throw new Error('expected a background host');
  return made;
}

describe('desktopBackgrounds', () => {
  it("turns the runner's answer into what the canvas reads", async () => {
    const asked: unknown[][] = [];
    const ensure = backgroundsOf({
      ensureBackground: (...args: unknown[]) => {
        asked.push(args);
        return Promise.resolve(
          args[0] === 'thermalright:a042'
            ? { ok: true, url: 'perch-cache://backgrounds/thermalright/1920x440/a042.mp4' }
            : { ok: false, code: 'not-found', reason: 'international: HTTP 404; china: HTTP 404' },
        );
      },
    });

    expect(await ensure('thermalright:a042', { width: 1920, height: 400 })).toEqual({
      status: 'ready',
      url: 'perch-cache://backgrounds/thermalright/1920x440/a042.mp4',
    });
    expect(await ensure('thermalright:a043', { width: 1920, height: 400 })).toEqual({
      status: 'failed',
      reason: 'international: HTTP 404; china: HTTP 404',
    });
    expect(asked[0]).toEqual(['thermalright:a042', { width: 1920, height: 400 }]);
  });

  it('refuses an answer that is not one, rather than playing whatever it names', async () => {
    const ensure = backgroundsOf({
      ensureBackground: () => Promise.resolve({ ok: true, url: 'https://elsewhere.test/x.mp4' }),
    });

    expect(await ensure('thermalright:a042', { width: 1920, height: 400 })).toMatchObject({
      status: 'failed',
    });
  });

  it('is absent for a bridge without the call', () => {
    expect(desktopBackgrounds({})).toBeUndefined();
  });
});

describe('the page, fed a document naming a cloud background', () => {
  it('asks for it with the layout target, and plays what comes back', async () => {
    const asked: unknown[][] = [];
    const document: DesktopDocument = {
      name: 'cloud',
      text: JSON.stringify({
        schemaVersion: 2,
        target: { width: 1024, height: 768, frameRate: 30 },
        theme: {},
        elements: [
          { kind: 'media', src: 'thermalright:a042', rect: { x: 0, y: 0, w: 1024, h: 768 } },
        ],
      }),
      assets: {},
    };
    render(
      <Dashboard
        source={createMockSource({ seed: 1 })}
        liveSource={{ kind: 'mqtt', url: 'ws://127.0.0.1:19001' }}
        catalogue={desktopCatalogue(document)}
        request={desktopPageRequest('', document)}
        ensureBackground={(ref, target) => {
          asked.push([ref, target]);
          return Promise.resolve({ status: 'ready', url: 'perch-cache://backgrounds/v.mp4' });
        }}
      />,
    );

    const video = await waitFor(() => {
      const found = window.document.querySelector('video');
      if (found === null) throw new Error('no video yet');
      return found;
    });
    expect(video.getAttribute('src')).toBe('perch-cache://backgrounds/v.mp4');
    expect(asked).toEqual([['thermalright:a042', { width: 1024, height: 768 }]]);
  });
});
