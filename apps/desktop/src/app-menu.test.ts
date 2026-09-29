import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';
// The editor's own registry, read by this test only: the menu must show what the editor accepts.
// Nothing in `src/` imports an app; a test pinning another app's table is how this repo keeps two
// statements of one fact from drifting (see `runtime-preload.test.ts` for the other one).
import { COMMANDS } from '../../editor/src/keybindings/commands.js';
import { boundCommand, resolveKeymap } from '../../editor/src/keybindings/keymap.js';
import {
  DEFAULT_MENU_BINDINGS,
  MENU_COMMANDS,
  acceleratorFor,
  appMenuTemplate,
  historyMenuTarget,
  menuBindingsFrom,
  menuEnabled,
  pageMenuStateFrom,
  type AppMenuActions,
  type AppMenuState,
} from './app-menu.js';

function state(overrides: Partial<AppMenuState> = {}): AppMenuState {
  return {
    platform: 'darwin',
    appName: 'perch',
    bindings: DEFAULT_MENU_BINDINGS.mac,
    editorOpen: true,
    devTools: false,
    enabled: { undo: true, redo: true, save: true, saveAs: true },
    presets: [
      { name: 'desk', path: '/l/desk.json' },
      { name: 'tower', path: '/l/tower.json' },
    ],
    openDocument: '/l/tower.json',
    recent: [
      { path: '/l/tower.json', label: 'tower' },
      { path: '/x/wall.json', label: 'wall' },
    ],
    ...overrides,
  };
}

function recording(): { actions: AppMenuActions; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    actions: {
      command: (id) => calls.push(id),
      openEditor: () => calls.push('openEditor'),
      showRunner: () => calls.push('showRunner'),
      openSettings: () => calls.push('openSettings'),
      openPreset: (path) => calls.push(`preset ${path}`),
      openRecent: (path) => calls.push(`recent ${path}`),
      clearRecent: () => calls.push('clearRecent'),
    },
  };
}

function submenu(
  template: MenuItemConstructorOptions[],
  label: string,
): MenuItemConstructorOptions[] {
  const found = template.find((entry) => entry.label === label);
  if (found === undefined || !Array.isArray(found.submenu)) throw new Error(`no menu ${label}`);
  return found.submenu;
}

function item(items: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions {
  const found = items.find((entry) => entry.label === label);
  if (found === undefined) throw new Error(`no item ${label}`);
  return found;
}

function click(entry: MenuItemConstructorOptions): void {
  (entry.click as () => void)();
}

describe('acceleratorFor', () => {
  it("writes the registry's binding strings as Electron accelerators", () => {
    expect(acceleratorFor('Mod+Z')).toBe('CommandOrControl+Z');
    expect(acceleratorFor('Mod+Shift+S')).toBe('CommandOrControl+Shift+S');
    expect(acceleratorFor('Ctrl+Y')).toBe('Control+Y');
    expect(acceleratorFor('Meta+K')).toBe('Super+K');
    expect(acceleratorFor('Alt+ArrowUp')).toBe('Alt+Up');
    expect(acceleratorFor('Mod++')).toBe('CommandOrControl+Plus');
    expect(acceleratorFor('mod+space')).toBe('CommandOrControl+Space');
    expect(acceleratorFor('Escape')).toBe('Escape');
  });

  it('gives no accelerator for no binding or one that does not parse', () => {
    expect(acceleratorFor(undefined)).toBeUndefined();
    expect(acceleratorFor('')).toBeUndefined();
    expect(acceleratorFor('Mod+Hyper+Z')).toBeUndefined();
    expect(acceleratorFor('Mod+Mod+Z')).toBeUndefined();
  });
});

describe("the menu's defaults and the editor's registry", () => {
  it('are the same bindings, command for command, on both platforms', () => {
    for (const platform of ['mac', 'other'] as const) {
      const keymap = resolveKeymap(COMMANDS, {}, platform);
      for (const id of MENU_COMMANDS) {
        expect(DEFAULT_MENU_BINDINGS[platform][id], `${platform} ${id}`).toEqual(
          boundCommand(keymap, id).bindings,
        );
      }
    }
  });

  it('are New, Open, Save, Save As, Undo, Redo and Settings on Mod+N, O, S, Shift+S, Z, Shift+Z and comma', () => {
    const accelerators = Object.fromEntries(
      MENU_COMMANDS.map((id) => [id, acceleratorFor(DEFAULT_MENU_BINDINGS.mac[id][0])]),
    );

    expect(accelerators).toEqual({
      'document.new': 'CommandOrControl+N',
      'document.open': 'CommandOrControl+O',
      'document.save': 'CommandOrControl+S',
      'document.saveAs': 'CommandOrControl+Shift+S',
      'history.undo': 'CommandOrControl+Z',
      'history.redo': 'CommandOrControl+Shift+Z',
      'app.settings': 'CommandOrControl+,',
    });
  });
});

describe('appMenuTemplate', () => {
  it('on macOS: the app menu, then File, Edit, View and Window', () => {
    const template = appMenuTemplate(state(), recording().actions);

    expect(template.map((entry) => entry.label)).toEqual([
      'perch',
      'File',
      'Edit',
      'View',
      'Window',
    ]);
    const roles = submenu(template, 'perch').map((entry) => entry.role);
    expect(roles).toContain('about');
    expect(roles).toContain('hide');
    expect(roles).toContain('quit');
  });

  it("on macOS: Settings... in the app menu, after About, on the registry's Mod+Comma", () => {
    const { actions, calls } = recording();
    const template = appMenuTemplate(state(), actions);
    const app = submenu(template, 'perch');
    const settings = item(app, 'Settings...');

    expect(settings.accelerator).toBe('CommandOrControl+,');
    expect(app.indexOf(settings)).toBeGreaterThan(app.findIndex((entry) => entry.role === 'about'));
    expect(submenu(template, 'File').map((entry) => entry.label)).not.toContain('Settings');
    click(settings);
    expect(calls).toEqual(['openSettings']);
  });

  it('elsewhere: Settings in File, above Quit, on Ctrl+Comma', () => {
    const { actions, calls } = recording();
    const file = submenu(
      appMenuTemplate(state({ platform: 'linux', bindings: DEFAULT_MENU_BINDINGS.other }), actions),
      'File',
    );
    const settings = item(file, 'Settings');

    expect(settings.accelerator).toBe('CommandOrControl+,');
    expect(file.indexOf(settings)).toBeLessThan(file.findIndex((entry) => entry.role === 'quit'));
    click(settings);
    expect(calls).toEqual(['openSettings']);
  });

  it("follows the editor's override for Settings", () => {
    const bindings = { ...DEFAULT_MENU_BINDINGS.mac, 'app.settings': ['Mod+Shift+P'] };
    const app = submenu(appMenuTemplate(state({ bindings }), recording().actions), 'perch');

    expect(item(app, 'Settings...').accelerator).toBe('CommandOrControl+Shift+P');
  });

  it('elsewhere: no app menu, and Quit at the foot of File', () => {
    const template = appMenuTemplate(
      state({ platform: 'win32', bindings: DEFAULT_MENU_BINDINGS.other }),
      recording().actions,
    );

    expect(template.map((entry) => entry.label)).toEqual(['File', 'Edit', 'View', 'Window']);
    expect(submenu(template, 'File').at(-1)?.role).toBe('quit');
  });

  it('shows each document command with the accelerator of its first binding', () => {
    const file = submenu(appMenuTemplate(state(), recording().actions), 'File');

    expect(item(file, 'New').accelerator).toBe('CommandOrControl+N');
    expect(item(file, 'Open...').accelerator).toBe('CommandOrControl+O');
    expect(item(file, 'Save').accelerator).toBe('CommandOrControl+S');
    expect(item(file, 'Save As...').accelerator).toBe('CommandOrControl+Shift+S');
  });

  it("follows the editor's overrides, and shows none for an unbound command", () => {
    const bindings = {
      ...DEFAULT_MENU_BINDINGS.mac,
      'document.save': ['Alt+S'],
      'document.new': [],
    };
    const file = submenu(appMenuTemplate(state({ bindings }), recording().actions), 'File');

    expect(item(file, 'Save').accelerator).toBe('Alt+S');
    expect(item(file, 'New').accelerator).toBeUndefined();
  });

  it('File: New, Open..., Open preset, Open recent, then Save and Save As', () => {
    const labels = submenu(appMenuTemplate(state(), recording().actions), 'File')
      .map((entry) => entry.label)
      .filter((label) => label !== undefined);

    expect(labels.slice(0, 6)).toEqual([
      'New',
      'Open...',
      'Open preset',
      'Open recent',
      'Save',
      'Save As...',
    ]);
  });

  it('enables Undo, Redo, Save and Save As as the editor says', () => {
    const template = appMenuTemplate(
      state({ enabled: { undo: false, redo: true, save: false, saveAs: true } }),
      recording().actions,
    );
    const file = submenu(template, 'File');
    const edit = submenu(template, 'Edit');

    expect(item(edit, 'Undo').enabled).toBe(false);
    expect(item(edit, 'Redo').enabled).toBe(true);
    expect(item(file, 'Save').enabled).toBe(false);
    expect(item(file, 'Save As...').enabled).toBe(true);
  });

  it('offers Save and Save As only while the editor is open; New and Open open it', () => {
    const { actions, calls } = recording();
    const closed = { editorOpen: false, focused: null, page: null } as const;
    const file = submenu(
      appMenuTemplate(state({ editorOpen: false, enabled: menuEnabled(closed) }), actions),
      'File',
    );

    expect(item(file, 'Save').enabled).toBe(false);
    expect(item(file, 'Save As...').enabled).toBe(false);
    expect(item(file, 'New').enabled).not.toBe(false);
    click(item(file, 'New'));
    click(item(file, 'Open...'));
    expect(calls).toEqual(['document.new', 'document.open']);
  });

  it('routes Undo and Redo through the app, not the role, and keeps the clipboard roles', () => {
    const { actions, calls } = recording();
    const edit = submenu(appMenuTemplate(state(), actions), 'Edit');

    expect(item(edit, 'Undo').role).toBeUndefined();
    expect(item(edit, 'Undo').accelerator).toBe('CommandOrControl+Z');
    expect(item(edit, 'Redo').role).toBeUndefined();
    expect(item(edit, 'Redo').accelerator).toBe('CommandOrControl+Shift+Z');
    click(item(edit, 'Undo'));
    click(item(edit, 'Redo'));
    expect(calls).toEqual(['history.undo', 'history.redo']);

    const roles = edit.map((entry) => entry.role);
    for (const role of ['cut', 'copy', 'paste', 'selectAll'] as const)
      expect(roles).toContain(role);
  });

  it('never offers a reload, which would drop unsaved edits; developer tools only when asked', () => {
    const view = (devTools: boolean) =>
      submenu(appMenuTemplate(state({ devTools }), recording().actions), 'View').map(
        (entry) => entry.role,
      );

    expect(view(false)).not.toContain('reload');
    expect(view(false)).not.toContain('forceReload');
    expect(view(false)).not.toContain('toggleDevTools');
    expect(view(true)).toContain('toggleDevTools');
  });

  it('opens the editor and shows the preview from the Window menu', () => {
    const { actions, calls } = recording();
    const window = submenu(appMenuTemplate(state(), actions), 'Window');

    click(item(window, 'Open editor'));
    click(item(window, 'Show preview'));
    expect(calls).toEqual(['openEditor', 'showRunner']);
  });
});

describe('File > Open preset', () => {
  it("lists the layouts folder's documents, checking the one the editor has open", () => {
    const { actions, calls } = recording();
    const presets = submenu(submenu(appMenuTemplate(state(), actions), 'File'), 'Open preset');

    expect(presets.map((entry) => entry.label)).toEqual(['desk', 'tower']);
    expect(item(presets, 'desk')).toMatchObject({ type: 'checkbox', checked: false });
    expect(item(presets, 'tower')).toMatchObject({ type: 'checkbox', checked: true });
    click(item(presets, 'desk'));
    expect(calls).toEqual(['preset /l/desk.json']);
  });

  it('checks nothing while the editor has no document of the folder open', () => {
    const presets = submenu(
      submenu(appMenuTemplate(state({ openDocument: null }), recording().actions), 'File'),
      'Open preset',
    );

    expect(presets.map((entry) => entry.checked)).toEqual([false, false]);
  });

  it('says No presets, disabled, for an empty folder', () => {
    const presets = submenu(
      submenu(appMenuTemplate(state({ presets: [] }), recording().actions), 'File'),
      'Open preset',
    );

    expect(presets).toEqual([{ label: 'No presets', enabled: false }]);
  });
});

describe('File > Open recent', () => {
  it('lists the recent documents in order, then a separator and Clear recently opened', () => {
    const { actions, calls } = recording();
    const recent = submenu(submenu(appMenuTemplate(state(), actions), 'File'), 'Open recent');

    expect(recent.map((entry) => entry.label ?? entry.type)).toEqual([
      'tower',
      'wall',
      'separator',
      'Clear recently opened',
    ]);
    click(item(recent, 'wall'));
    click(item(recent, 'Clear recently opened'));
    expect(calls).toEqual(['recent /x/wall.json', 'clearRecent']);
  });

  it('says so when there is nothing recent, and has nothing to clear', () => {
    const recent = submenu(
      submenu(appMenuTemplate(state({ recent: [] }), recording().actions), 'File'),
      'Open recent',
    );

    expect(item(recent, 'No recent documents').enabled).toBe(false);
    expect(item(recent, 'Clear recently opened').enabled).toBe(false);
  });
});

describe('menuEnabled', () => {
  const page = { undo: false, redo: false, save: false, saveAs: true };

  it("takes Undo and Redo from the editor page while it is focused, and native's elsewhere", () => {
    expect(menuEnabled({ editorOpen: true, focused: 'editor', page })).toMatchObject({
      undo: false,
      redo: false,
    });
    // Another window's Undo is that window's native undo, which the menu cannot see into.
    expect(menuEnabled({ editorOpen: true, focused: 'other', page })).toMatchObject({
      undo: true,
      redo: true,
    });
    expect(menuEnabled({ editorOpen: false, focused: null, page: null })).toMatchObject({
      undo: true,
      redo: true,
    });
  });

  it('takes Save and Save As from the editor page wherever the focus is, off while it is closed', () => {
    expect(menuEnabled({ editorOpen: true, focused: 'other', page })).toMatchObject({
      save: false,
      saveAs: true,
    });
    expect(menuEnabled({ editorOpen: false, focused: null, page })).toMatchObject({
      save: false,
      saveAs: false,
    });
    // Open, but the page has not reported yet: as before this change, offered.
    expect(menuEnabled({ editorOpen: true, focused: 'editor', page: null })).toEqual({
      undo: true,
      redo: true,
      save: true,
      saveAs: true,
    });
  });
});

describe('pageMenuStateFrom', () => {
  it('reads four booleans, and nothing else', () => {
    expect(pageMenuStateFrom({ undo: true, redo: false, save: true, saveAs: false })).toEqual({
      undo: true,
      redo: false,
      save: true,
      saveAs: false,
    });
    expect(pageMenuStateFrom({ undo: 'yes', redo: false, save: true, saveAs: false })).toBeNull();
    expect(pageMenuStateFrom(null)).toBeNull();
  });
});

describe('menuBindingsFrom', () => {
  it("takes the editor's bindings for the menu's commands and nothing else", () => {
    const read = menuBindingsFrom(
      { 'document.save': ['Alt+S'], 'selection.delete': ['X'], 'history.undo': 'Mod+Z' },
      DEFAULT_MENU_BINDINGS.mac,
    );

    expect(read['document.save']).toEqual(['Alt+S']);
    // Not a list of strings: the default stands.
    expect(read['history.undo']).toEqual(DEFAULT_MENU_BINDINGS.mac['history.undo']);
    expect(Object.keys(read).sort()).toEqual([...MENU_COMMANDS].sort());
  });

  it('keeps the defaults for anything that is not a record', () => {
    expect(menuBindingsFrom('nope', DEFAULT_MENU_BINDINGS.other)).toEqual(
      DEFAULT_MENU_BINDINGS.other,
    );
    expect(menuBindingsFrom(null, DEFAULT_MENU_BINDINGS.other)).toEqual(
      DEFAULT_MENU_BINDINGS.other,
    );
  });
});

describe('historyMenuTarget', () => {
  it('sends Undo and Redo to the editor page while it is focused, and native otherwise', () => {
    expect(historyMenuTarget('editor')).toBe('editor-page');
    expect(historyMenuTarget('other')).toBe('native');
    expect(historyMenuTarget(null)).toBe('native');
  });
});
