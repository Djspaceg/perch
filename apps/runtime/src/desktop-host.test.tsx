/**
 * The page's side of the desktop runner: finding the bridge, and turning the one document it hands
 * over into the catalogue and request the page already takes.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockSource } from '@perch/sensor-sources';
import { Dashboard } from './app.js';
import {
  DESKTOP_BRIDGE_GLOBAL,
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
