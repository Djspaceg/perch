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

  it('are New, Open, Save, Save As, Undo and Redo on Mod+N, O, S, Shift+S, Z and Shift+Z', () => {
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

  it('offers Save and Save As only while the editor is open; New and Open open it', () => {
    const { actions, calls } = recording();
    const file = submenu(appMenuTemplate(state({ editorOpen: false }), actions), 'File');

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

  it('opens the editor and shows the runner from the Window menu', () => {
    const { actions, calls } = recording();
    const window = submenu(appMenuTemplate(state(), actions), 'Window');

    click(item(window, 'Open editor'));
    click(item(window, 'Show runner window'));
    expect(calls).toEqual(['openEditor', 'showRunner']);
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
