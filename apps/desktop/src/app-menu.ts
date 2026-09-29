/**
 * The application menu, as data: App (macOS), File, Edit, View, Window.
 *
 * ```text
 * perch (macOS)  About, Settings... (Mod+,), Services, Hide, Quit
 * File           New, Open..., Open preset >, Open recent >, Save, Save As...,
 *                Settings (Windows, Linux), Close, Quit (Windows, Linux)
 * Edit           Undo, Redo, the clipboard roles
 * Window         Open editor, Show preview
 * ```
 *
 * Settings is where each platform keeps it: the app menu on macOS, File elsewhere. It opens the
 * Settings window from the main process directly rather than through the editor page, because it
 * has to work with no editor open; in the editor window its key reaches the page first, whose
 * `app.settings` command asks for the same window.
 *
 * ## Open preset and Open recent
 *
 * Open preset lists the layouts folder, the list the editor's picker showed, with a checkmark on the
 * document the editor has open; `main.ts` rebuilds the menu whenever the folder changes
 * (`folder-watch.ts`). Open recent is `recent.ts`'s list. Either opens the document in the editor,
 * opening the editor first if it is closed, through the same unsaved-changes bar as Open.
 *
 * ## What is enabled follows the editor
 *
 * The editor page reports whether Undo, Redo, Save and Save As have anything to do
 * (`pageMenuStateFrom`), and `menuEnabled` turns that into the items' state: Save and Save As always
 * the editor's, Undo and Redo the editor's only while its window is focused, since elsewhere they are
 * that window's native undo, which no page reports.
 *
 * macOS needs one with an Edit menu or Cmd-C, V, X and A do nothing in a text field, since the
 * platform delivers those through the menu. The clipboard items are Electron's roles, so they do
 * exactly what the platform's do.
 *
 * ## Undo and Redo are not the roles
 *
 * `role: 'undo'` is the focused page's native text undo, everywhere. In the editor that would take
 * over the editor's own history: Cmd-Z outside a field means "undo the last edit to the layout". So
 * the two items are plain commands, and where they go is decided at the moment they run:
 *
 * ```text
 * editor window focused  ->  sent to the editor page, which does the field's native undo when a
 *                            text entry has focus and runs the registry's history.undo otherwise
 * any other window       ->  that window's native undo (the role's own behaviour)
 * ```
 *
 * Their keys still reach the editor's page first. Electron gives a key to the focused page before
 * the menu, and the menu's accelerator fires only for a key the page did not take, so a Cmd-Z the
 * editor's dispatcher handled never also runs the menu item. A Cmd-Z in a text field is one the
 * dispatcher leaves alone, and arrives here, and goes back to the page's field as its native undo.
 *
 * ## The accelerators are the editor's bindings
 *
 * Each item shows the accelerator of its command's first binding in effect. The editor page sends
 * its keymap, overrides included, whenever it changes (`menuBindingsFrom` reads it); until it has,
 * the menu shows the registry's defaults, `DEFAULT_MENU_BINDINGS`, which `app-menu.test.ts` holds
 * equal to `apps/editor/src/keybindings/commands.ts`. What the menu shows is what the editor accepts.
 *
 * Pure — `electron` is imported for its types only — so the template is tested without the binary.
 */

import type { MenuItemConstructorOptions } from 'electron';

export const MENU_COMMANDS = [
  'document.new',
  'document.open',
  'document.save',
  'document.saveAs',
  'history.undo',
  'history.redo',
  'app.settings',
] as const;

export type MenuCommandId = (typeof MENU_COMMANDS)[number];

export type MenuBindings = Readonly<Record<MenuCommandId, readonly string[]>>;

const SHARED: Omit<MenuBindings, 'history.redo'> = {
  'document.new': ['Mod+N'],
  'document.open': ['Mod+O'],
  'document.save': ['Mod+S'],
  'document.saveAs': ['Mod+Shift+S'],
  'history.undo': ['Mod+Z'],
  'app.settings': ['Mod+,'],
};

/** The editor registry's defaults for the menu's commands, per platform. */
export const DEFAULT_MENU_BINDINGS: { readonly mac: MenuBindings; readonly other: MenuBindings } = {
  mac: { ...SHARED, 'history.redo': ['Mod+Shift+Z'] },
  other: { ...SHARED, 'history.redo': ['Mod+Shift+Z', 'Ctrl+Y'] },
};

const MODIFIERS: Readonly<Record<string, string>> = {
  mod: 'CommandOrControl',
  ctrl: 'Control',
  alt: 'Alt',
  shift: 'Shift',
  meta: 'Super',
};

const NAMED_KEYS: Readonly<Record<string, string>> = {
  escape: 'Escape',
  enter: 'Enter',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  '+': 'Plus',
};

/**
 * A registry binding (`Mod+Shift+Z`, KEYBINDINGS.md section 2) as an Electron accelerator
 * (`CommandOrControl+Shift+Z`), or `undefined` for none or one that does not parse.
 */
export function acceleratorFor(binding: string | undefined): string | undefined {
  if (binding === undefined || binding === '') return undefined;

  // `Mod++` is Mod and the plus key: split on a `+` that follows a character.
  const parts = binding.endsWith('++')
    ? [...binding.slice(0, -2).split('+'), '+']
    : binding.split('+');
  const key = parts.pop();
  if (key === undefined || key === '') return undefined;

  const modifiers: string[] = [];
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (modifier === undefined || modifiers.includes(modifier)) return undefined;
    modifiers.push(modifier);
  }

  const named = NAMED_KEYS[key.toLowerCase()];
  const written =
    named ??
    (/^f([1-9]|1[0-2])$/i.test(key)
      ? key.toUpperCase()
      : key.length === 1
        ? key.toUpperCase()
        : undefined);
  if (written === undefined) return undefined;

  return [...modifiers, written].join('+');
}

/** The editor page's bindings, read as untrusted: a list of strings per menu command, else the default. */
export function menuBindingsFrom(input: unknown, fallback: MenuBindings): MenuBindings {
  const record =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};

  return Object.fromEntries(
    MENU_COMMANDS.map((id) => {
      const value = record[id];
      const ok = Array.isArray(value) && value.every((item) => typeof item === 'string');
      return [id, ok ? value : fallback[id]];
    }),
  ) as unknown as MenuBindings;
}

/** Where a menu Undo or Redo goes; see the module comment. */
export function historyMenuTarget(focused: 'editor' | 'other' | null): 'editor-page' | 'native' {
  return focused === 'editor' ? 'editor-page' : 'native';
}

/** What the editor page says the menu's Undo, Redo, Save and Save As have to do. */
export interface MenuEnabled {
  readonly undo: boolean;
  readonly redo: boolean;
  readonly save: boolean;
  readonly saveAs: boolean;
}

/** The editor page's report, read as untrusted: four booleans, else `null`. */
export function pageMenuStateFrom(input: unknown): MenuEnabled | null {
  if (typeof input !== 'object' || input === null) return null;
  const { undo, redo, save, saveAs } = input as Record<string, unknown>;
  if (
    typeof undo !== 'boolean' ||
    typeof redo !== 'boolean' ||
    typeof save !== 'boolean' ||
    typeof saveAs !== 'boolean'
  ) {
    return null;
  }

  return { undo, redo, save, saveAs };
}

/**
 * Which of the four items are enabled. `page` is the editor page's last report, `null` before it
 * has made one, when everything is offered as it was before the page could say. `focused` is which
 * window has focus, as `historyMenuTarget` reads it.
 */
export function menuEnabled({
  editorOpen,
  focused,
  page,
}: {
  editorOpen: boolean;
  focused: 'editor' | 'other' | null;
  page: MenuEnabled | null;
}): MenuEnabled {
  const history = historyMenuTarget(focused) === 'editor-page';

  return {
    undo: history ? (page?.undo ?? true) : true,
    redo: history ? (page?.redo ?? true) : true,
    save: editorOpen && (page?.save ?? true),
    saveAs: editorOpen && (page?.saveAs ?? true),
  };
}

/** A document the Open preset submenu lists. */
export interface PresetDocument {
  readonly name: string;
  readonly path: string;
}

/** A document the Open recent submenu lists (`recent.ts`). */
export interface RecentDocument {
  readonly path: string;
  readonly label: string;
}

export interface AppMenuState {
  readonly platform: NodeJS.Platform;
  readonly appName: string;
  readonly bindings: MenuBindings;
  readonly editorOpen: boolean;
  /** Whether View offers the developer tools: an unpackaged run only. */
  readonly devTools: boolean;
  readonly enabled: MenuEnabled;
  /** The layouts folder's documents. */
  readonly presets: readonly PresetDocument[];
  /** The path of the document open in the editor, or `null`. */
  readonly openDocument: string | null;
  readonly recent: readonly RecentDocument[];
}

export interface AppMenuActions {
  /** A document or history command. New and Open open the editor first when it is closed. */
  command(id: MenuCommandId): void;
  openEditor(): void;
  showRunner(): void;
  openSettings(): void;
  /** Open a document in the editor, opening the editor first when it is closed. */
  openPreset(path: string): void;
  openRecent(path: string): void;
  clearRecent(): void;
}

/** File > Open preset's items. Exported for `folder-watch.test.ts`, which rebuilds it from a real folder. */
export function presetSubmenu(
  documents: readonly PresetDocument[],
  openDocument: string | null,
  open: (path: string) => void,
): MenuItemConstructorOptions[] {
  if (documents.length === 0) return [{ label: 'No presets', enabled: false }];

  return documents.map((document) => ({
    label: document.name,
    type: 'checkbox',
    checked: document.path === openDocument,
    click: () => {
      open(document.path);
    },
  }));
}

function recentSubmenu(
  recent: readonly RecentDocument[],
  actions: AppMenuActions,
): MenuItemConstructorOptions[] {
  return [
    ...(recent.length === 0
      ? [{ label: 'No recent documents', enabled: false }]
      : recent.map((document) => ({
          label: document.label,
          click: () => {
            actions.openRecent(document.path);
          },
        }))),
    { type: 'separator' },
    {
      label: 'Clear recently opened',
      enabled: recent.length > 0,
      click: () => {
        actions.clearRecent();
      },
    },
  ];
}

export function appMenuTemplate(
  state: AppMenuState,
  actions: AppMenuActions,
): MenuItemConstructorOptions[] {
  const mac = state.platform === 'darwin';
  const command = (
    label: string,
    id: MenuCommandId,
    extra: Partial<MenuItemConstructorOptions> = {},
  ): MenuItemConstructorOptions => {
    const accelerator = acceleratorFor(state.bindings[id][0]);
    return {
      label,
      ...(accelerator === undefined ? {} : { accelerator }),
      click: () => {
        actions.command(id);
      },
      ...extra,
    };
  };

  const settingsAccelerator = acceleratorFor(state.bindings['app.settings'][0]);
  const settings = (label: string): MenuItemConstructorOptions => ({
    label,
    ...(settingsAccelerator === undefined ? {} : { accelerator: settingsAccelerator }),
    click: () => {
      actions.openSettings();
    },
  });

  const appMenu: MenuItemConstructorOptions[] = mac
    ? [
        {
          label: state.appName,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            settings('Settings...'),
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
      ]
    : [];

  const file: MenuItemConstructorOptions[] = [
    command('New', 'document.new'),
    command('Open...', 'document.open'),
    {
      label: 'Open preset',
      submenu: presetSubmenu(state.presets, state.openDocument, (path) => {
        actions.openPreset(path);
      }),
    },
    { label: 'Open recent', submenu: recentSubmenu(state.recent, actions) },
    { type: 'separator' },
    command('Save', 'document.save', { enabled: state.enabled.save }),
    command('Save As...', 'document.saveAs', { enabled: state.enabled.saveAs }),
    { type: 'separator' },
    ...(mac ? [] : [settings('Settings'), { type: 'separator' as const }]),
    { role: 'close' },
    ...(mac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
  ];

  const edit: MenuItemConstructorOptions[] = [
    command('Undo', 'history.undo', { enabled: state.enabled.undo }),
    command('Redo', 'history.redo', { enabled: state.enabled.redo }),
    { type: 'separator' },
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    ...(mac ? [{ role: 'pasteAndMatchStyle' as const }] : []),
    { role: 'delete' },
    { role: 'selectAll' },
  ];

  // No reload: it would drop the editor's unsaved edits without asking.
  const view: MenuItemConstructorOptions[] = [
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
    ...(state.devTools
      ? [{ type: 'separator' as const }, { role: 'toggleDevTools' as const }]
      : []),
  ];

  const window: MenuItemConstructorOptions[] = [
    { role: 'minimize' },
    ...(mac ? [{ role: 'zoom' as const }] : []),
    { type: 'separator' },
    {
      label: 'Open editor',
      click: () => {
        actions.openEditor();
      },
    },
    {
      label: 'Show preview',
      click: () => {
        actions.showRunner();
      },
    },
    ...(mac ? [{ type: 'separator' as const }, { role: 'front' as const }] : []),
  ];

  return [
    ...appMenu,
    { label: 'File', submenu: file },
    { label: 'Edit', submenu: edit },
    { label: 'View', submenu: view },
    { label: 'Window', submenu: window },
  ];
}
