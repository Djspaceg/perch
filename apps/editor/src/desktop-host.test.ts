import { describe, expect, it } from 'vitest';
import {
  EDITOR_BRIDGE_GLOBAL,
  desktopLibrary,
  desktopSaveTransport,
  editorHostFrom,
  findEditorBridge,
  type EditorBridge,
} from './desktop-host.js';

const desk = {
  name: 'desk',
  path: '/l/desk.json',
  text: '{"desk":1}',
  assets: { 'desk.assets/rails.svg': 'app://editor-document/desk/desk.assets/rails.svg' },
};
const tower = { name: 'tower', path: '/l/tower.json', text: '{"tower":1}', assets: {} };

function fakeBridge(overrides: Partial<EditorBridge> = {}): EditorBridge & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const bridge: EditorBridge = {
    load: () =>
      Promise.resolve({
        brokerUrl: 'ws://127.0.0.1:1',
        relay: { host: 'localhost', port: 8085, defaultPort: 8085 },
        documents: [desk],
        initial: 'desk',
      }),
    onDocuments: () => () => undefined,
    save: (url, body) => {
      calls.push(['save', url, body]);
      return Promise.resolve({ ok: true, status: 204, text: '' });
    },
    saveAs: (suggested) => {
      calls.push(['saveAs', suggested]);
      return Promise.resolve({ name: 'copy', path: '/l/copy.json' });
    },
    open: () => {
      calls.push(['open']);
      return Promise.resolve(tower);
    },
    setDocumentState: (state) => calls.push(['state', state]),
    setMenuBindings: (bindings) => calls.push(['bindings', bindings]),
    onCommand: () => () => undefined,
    onSaveRequest: () => () => undefined,
    saveDone: (id, saved) => calls.push(['saveDone', id, saved]),
    nativeEdit: (which) => calls.push(['nativeEdit', which]),
    ...overrides,
  };
  return Object.assign(bridge, { calls });
}

describe('findEditorBridge', () => {
  it('finds the preload bridge by its global, checking its shape', () => {
    const bridge = fakeBridge();

    expect(EDITOR_BRIDGE_GLOBAL).toBe('perchEditorHost');
    expect(findEditorBridge({ [EDITOR_BRIDGE_GLOBAL]: bridge })).toBe(bridge);
    expect(findEditorBridge({})).toBeNull();
    expect(findEditorBridge({ [EDITOR_BRIDGE_GLOBAL]: { load: () => undefined } })).toBeNull();
    // The runner's bridge is not the editor's.
    expect(findEditorBridge({ perchDesktop: bridge })).toBeNull();
  });
});

describe('desktopLibrary', () => {
  it("offers the folder's documents, sorted, each with its path", () => {
    const library = desktopLibrary([tower, desk]);

    expect(library.names).toEqual(['desk', 'tower']);
    expect(library.entry('tower')).toEqual({
      name: 'tower',
      text: '{"tower":1}',
      offered: true,
      path: '/l/tower.json',
    });
    expect(library.entry('nothing')).toBeUndefined();
  });

  it("resolves a media src against the named document's own table", () => {
    const library = desktopLibrary([tower, desk]);

    expect(library.resolveAsset('desk.assets/rails.svg', 'desk')).toBe(
      'app://editor-document/desk/desk.assets/rails.svg',
    );
    expect(library.resolveAsset('desk.assets/rails.svg', 'tower')).toBeUndefined();
    expect(library.resolveAsset('desk.assets/rails.svg')).toBeUndefined();
  });
});

describe('desktopSaveTransport', () => {
  it('hands the save URL and body to the main process and answers like fetch', async () => {
    const bridge = fakeBridge({
      save: (url, body) => {
        bridge.calls.push(['save', url, body]);
        return Promise.resolve({ ok: false, status: 400, text: 'the body is not JSON' });
      },
    });
    const transport = desktopSaveTransport(bridge);

    const response = await transport('/__perch/layout/desk', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    expect(bridge.calls).toEqual([['save', '/__perch/layout/desk', '{']]);
    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('the body is not JSON');
  });
});

describe('editorHostFrom', () => {
  it('passes each document request through, and turns an opened file into a library entry', async () => {
    const bridge = fakeBridge();
    const host = editorHostFrom(bridge);

    expect(await host.saveAs('desk')).toEqual({ name: 'copy', path: '/l/copy.json' });
    expect(await host.open()).toEqual({
      name: 'tower',
      text: '{"tower":1}',
      offered: true,
      path: '/l/tower.json',
    });
    host.setDocumentState({ name: 'desk', dirty: true });
    host.nativeEdit('redo');
    host.saveDone(2, false);

    expect(bridge.calls).toEqual([
      ['saveAs', 'desk'],
      ['open'],
      ['state', { name: 'desk', dirty: true }],
      ['nativeEdit', 'redo'],
      ['saveDone', 2, false],
    ]);
  });

  it('reads a cancelled dialog as null', async () => {
    const host = editorHostFrom(
      fakeBridge({ open: () => Promise.resolve(null), saveAs: () => Promise.resolve(null) }),
    );

    expect(await host.open()).toBeNull();
    expect(await host.saveAs('desk')).toBeNull();
  });
});
