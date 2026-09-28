/**
 * The editor store: which settings outlive a reload, which state deliberately does not, the one-time
 * move from the connection control's old `localStorage` key, and `?layout=` beating a remembered
 * layout (the last is `editor-settings.test.tsx`, through the rendered editor).
 *
 * "A reload" is a second store created over the same storage, which is what a page load does: the
 * store reads the storage once, when it is made, and writes it on every change after.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONNECTION_STORAGE_KEY } from './connection.js';
import { setElementRect } from './layout-edits.js';
import { createLayoutLibrary, type LayoutLibrary } from './layout-library.js';
import { openLayoutByName } from './open-layout.js';
import {
  EDITOR_STORE_KEY,
  EDITOR_STORE_VERSION,
  NOTHING_SELECTED,
  createEditorStore,
  firstLayoutName,
  type SettingsStorage,
} from './store.js';

function memoryStorage(initial: Record<string, string> = {}): SettingsStorage & {
  readonly data: Record<string, string>;
} {
  const data: Record<string, string> = { ...initial };

  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      Reflect.deleteProperty(data, key);
    },
  };
}

function layoutText(width: number, text: string): string {
  const layout: Layout = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    target: { width, height: 200, frameRate: 30 },
    theme: {},
    elements: [{ kind: 'text', text, rect: { x: 10, y: 10, w: 200, h: 30 } }],
  };

  return JSON.stringify(layout);
}

function testLibrary(): LayoutLibrary {
  return createLayoutLibrary({
    layouts: { 'desk-test': layoutText(640, 'desk'), 'tower-test': layoutText(200, 'tower') },
  });
}

/** What the store wrote, parsed. */
function stored(storage: { readonly data: Record<string, string> }): {
  readonly state: Record<string, unknown>;
  readonly version: number;
} {
  const text = storage.data[EDITOR_STORE_KEY];
  if (text === undefined) throw new Error(`nothing under ${EDITOR_STORE_KEY}`);

  return JSON.parse(text) as { state: Record<string, unknown>; version: number };
}

describe('persisted settings', () => {
  it('survive a store re-created over the same storage', () => {
    const storage = memoryStorage();
    const store = createEditorStore({ storage });
    const first = store.getState();
    first.selectRemote();
    first.setConnectionHost('192.168.1.3:9000');
    first.connectTo('192.168.1.3', 9000);
    first.setSectionOpen('entity/transform', false);
    first.setSectionOpen('theme/typography/advanced', true);
    first.setTab('theme', 'developer');
    first.setChip('theme', 'typography');
    first.openLayout(openLayoutByName(testLibrary(), 'tower-test'), { remember: true });

    const second = createEditorStore({ storage }).getState();

    expect(second.settings).toEqual(store.getState().settings);
    expect(second.settings).toMatchObject({
      connection: {
        mode: 'remote',
        choice: { kind: 'remote', host: '192.168.1.3', port: 9000 },
        draft: '192.168.1.3:9000',
      },
      sections: { 'entity/transform': false, 'theme/typography/advanced': true },
      tabs: { theme: 'developer' },
      chips: { theme: 'typography' },
      layout: 'tower-test',
    });
    expect(stored(storage).version).toBe(EDITOR_STORE_VERSION);
  });

  it('keeps the draft and the selection out of storage', () => {
    const storage = memoryStorage();
    const store = createEditorStore({ storage });
    const { openLayout, editDraft, select } = store.getState();
    openLayout(openLayoutByName(testLibrary(), 'desk-test'), { remember: true });
    editDraft(setElementRect(0, { x: 99, y: 10, w: 200, h: 30 }));
    select(0);

    expect(Object.keys(stored(storage).state)).toEqual(['settings']);
    expect(storage.data[EDITOR_STORE_KEY]).not.toContain('"x":99');

    const reloaded = createEditorStore({ storage }).getState();
    expect(reloaded.session.opened).toBeNull();
    expect(reloaded.session.selected).toBe(NOTHING_SELECTED);
  });

  it('falls back to defaults, field by field, over storage that is not its own', () => {
    for (const junk of [
      'not json',
      '{}',
      JSON.stringify({ state: { settings: { sections: { a: 'yes' }, tabs: { theme: 'x' } } } }),
      JSON.stringify({
        state: { settings: { connection: { choice: { kind: 'remote', host: 'a b', port: 1 } } } },
        version: EDITOR_STORE_VERSION,
      }),
    ]) {
      const settings = createEditorStore({
        storage: memoryStorage({ [EDITOR_STORE_KEY]: junk }),
      }).getState().settings;

      expect(settings.connection, junk).toEqual({
        mode: 'localhost',
        choice: { kind: 'localhost' },
        draft: '',
      });
      expect(settings.sections, junk).toEqual({});
      expect(settings.tabs, junk).toEqual({});
      expect(settings.layout, junk).toBeNull();
      expect(settings.keybindings, junk).toEqual({});
    }
  });

  it('survives a storage that throws, as a private window’s does, and keeps working in memory', () => {
    const throwing: SettingsStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const store = createEditorStore({ storage: throwing });

    expect(() => {
      store.getState().setSectionOpen('entity/transform', false);
    }).not.toThrow();
    expect(store.getState().settings.sections['entity/transform']).toBe(false);
  });
});

describe('keybinding overrides', () => {
  it('start empty, persist per command, and clear back to the defaults', () => {
    const storage = memoryStorage();
    const store = createEditorStore({ storage });
    expect(store.getState().settings.keybindings).toEqual({});

    store.getState().setKeybinding('history.undo', ['Mod+U']);
    store.getState().setKeybinding('selection.clear', []);
    expect(createEditorStore({ storage }).getState().settings.keybindings).toEqual({
      'history.undo': ['Mod+U'],
      'selection.clear': [],
    });

    store.getState().setKeybinding('history.undo', undefined);
    expect(createEditorStore({ storage }).getState().settings.keybindings).toEqual({
      'selection.clear': [],
    });
  });

  it('keep an id this build does not know, and drop what is not a list of strings', () => {
    const settings = createEditorStore({
      storage: memoryStorage({
        [EDITOR_STORE_KEY]: JSON.stringify({
          state: {
            settings: {
              keybindings: {
                'layout.future': ['Mod+F'],
                'history.undo': 'Mod+U',
                'history.redo': ['Mod+R', 3],
              },
            },
          },
          version: EDITOR_STORE_VERSION,
        }),
      }),
    }).getState().settings;

    expect(settings.keybindings).toEqual({ 'layout.future': ['Mod+F'] });
  });

  it('arrive empty in settings stored at version 1, which kept everything else', () => {
    const storage = memoryStorage({
      [EDITOR_STORE_KEY]: JSON.stringify({
        state: { settings: { sections: { 'entity/transform': false }, layout: 'tower-test' } },
        version: 1,
      }),
    });
    const { settings } = createEditorStore({ storage }).getState();

    expect(EDITOR_STORE_VERSION).toBe(2);
    expect(settings.keybindings).toEqual({});
    expect(settings.sections).toEqual({ 'entity/transform': false });
    expect(settings.layout).toBe('tower-test');
  });
});

describe('migration from the connection control’s own key', () => {
  const legacy = JSON.stringify({
    choice: { kind: 'remote', host: '192.168.1.3', port: 8085 },
    draft: '192.168.1.3',
  });

  it('carries a saved host into the store on first load, and writes the store’s key', () => {
    const storage = memoryStorage({ [CONNECTION_STORAGE_KEY]: legacy });
    const { settings } = createEditorStore({ storage }).getState();

    expect(settings.connection).toEqual({
      mode: 'remote',
      choice: { kind: 'remote', host: '192.168.1.3', port: 8085 },
      draft: '192.168.1.3',
    });
    expect(stored(storage)).toMatchObject({
      version: EDITOR_STORE_VERSION,
      state: { settings: { connection: settings.connection } },
    });
  });

  it('stops reading and writing the old key once the store has its own', () => {
    const storage = memoryStorage({ [CONNECTION_STORAGE_KEY]: legacy });
    createEditorStore({ storage }).getState().selectLocalhost();
    // The old key changing now must not reach the store: the store's own key wins from here on.
    storage.data[CONNECTION_STORAGE_KEY] = JSON.stringify({
      choice: { kind: 'remote', host: 'other.local', port: 8085 },
      draft: 'other.local',
    });

    const { settings } = createEditorStore({ storage }).getState();

    expect(settings.connection.choice).toEqual({ kind: 'localhost' });
    expect(JSON.parse(storage.data[CONNECTION_STORAGE_KEY] ?? '')).toMatchObject({
      draft: 'other.local',
    });
  });

  it('ignores an old key that does not hold a connection', () => {
    const storage = memoryStorage({ [CONNECTION_STORAGE_KEY]: 'not json' });

    expect(createEditorStore({ storage }).getState().settings.connection).toEqual({
      mode: 'localhost',
      choice: { kind: 'localhost' },
      draft: '',
    });
  });
});

describe('which layout opens first', () => {
  const names = ['desk-test', 'tower-test'];

  it('is ?layout= when given, over a remembered choice', () => {
    expect(firstLayoutName('desk-test', 'tower-test', names)).toBe('desk-test');
    expect(firstLayoutName('invalid/broken', 'tower-test', names)).toBe('invalid/broken');
  });

  it('is the remembered choice without ?layout=, while the library still offers it', () => {
    expect(firstLayoutName(undefined, 'tower-test', names)).toBe('tower-test');
    expect(firstLayoutName(undefined, 'gone', names)).toBe('desk-test');
    expect(firstLayoutName(undefined, null, names)).toBe('desk-test');
  });
});

describe('Redux DevTools', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names each action on the timeline when the extension is there', () => {
    const send = vi.fn();
    const connect = vi.fn(() => ({ init: vi.fn(), send, subscribe: vi.fn() }));
    vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', { connect });

    const { setSectionOpen, setConnectionHost, openLayout, editDraft, setKeybinding } =
      createEditorStore({ storage: memoryStorage() }).getState();
    setSectionOpen('entity/transform', false);
    setKeybinding('history.undo', ['Mod+U']);
    setConnectionHost('desk.local');
    openLayout(openLayoutByName(testLibrary(), 'desk-test'), { remember: true });
    editDraft(setElementRect(0, { x: 1, y: 1, w: 20, h: 20 }));

    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ name: 'perch-editor' }));
    const types = send.mock.calls.map(([action]) => (action as { type: string }).type);
    expect(types).toEqual(
      expect.arrayContaining([
        'toggle/section',
        'set/keybinding',
        'set/connectionHost',
        'open/layout',
        'edit/draft',
      ]),
    );
  });
});

describe('the desktop runner', () => {
  it("adopts the relay's host as the connection in effect, and remembers it", () => {
    const storage = memoryStorage();
    const store = createEditorStore({ storage, devtools: false });

    store.getState().adoptConnection({ kind: 'remote', host: '192.168.1.3', port: 8086 });

    expect(store.getState().settings.connection).toEqual({
      mode: 'remote',
      choice: { kind: 'remote', host: '192.168.1.3', port: 8086 },
      draft: '192.168.1.3:8086',
    });
    expect(
      createEditorStore({ storage, devtools: false }).getState().settings.connection.mode,
    ).toBe('remote');

    store.getState().adoptConnection({ kind: 'localhost' });
    // Localhost keeps what was typed, as picking the radio does.
    expect(store.getState().settings.connection).toEqual({
      mode: 'localhost',
      choice: { kind: 'localhost' },
      draft: '192.168.1.3:8086',
    });
  });

  it('records a Save As under the new name, clean, keeping the history', () => {
    const store = createEditorStore({ devtools: false });
    store.getState().openFirst(testLibrary(), 'desk-test');
    store.getState().editDraft(setElementRect(0, { x: 1, y: 1, w: 20, h: 20 }));
    const opened = store.getState().session.opened;
    if (opened?.ok !== true) throw new Error('not open');

    store.getState().markSavedAs('desk-test', 'desk-copy', opened.state.rendered);

    const after = store.getState().session;
    if (after.opened?.ok !== true) throw new Error('not open');
    expect(after.opened.state.name).toBe('desk-copy');
    expect(after.opened.state.saved).toEqual(opened.state.rendered);
    expect(after.history.past).toHaveLength(1);
    // An undo keeps the new name: a step holds the draft, never which file it is.
    store.getState().undo();
    const undone = store.getState().session.opened;
    expect(undone?.ok === true ? undone.state.name : undefined).toBe('desk-copy');
  });

  it('ignores a Save As for a document no longer open', () => {
    const store = createEditorStore({ devtools: false });
    store.getState().openFirst(testLibrary(), 'desk-test');
    const opened = store.getState().session.opened;
    if (opened?.ok !== true) throw new Error('not open');

    store.getState().markSavedAs('tower-test', 'tower-copy', opened.state.rendered);

    const after = store.getState().session.opened;
    expect(after?.ok === true ? after.state.name : undefined).toBe('desk-test');
  });
});
