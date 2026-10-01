/**
 * Every editor shortcut, in one table: its id, what it is called, where it acts and its default keys.
 * KEYBINDINGS.md section 9 lists the same rows, and `keymap.test.ts` fails if the two differ.
 *
 * Order matters: within one scope, the earlier command wins a key two share (section 4).
 */

/** Where a command acts. `global` is everywhere, a region only inside its `keyScope`. */
export type Scope = 'global' | 'canvas' | 'sidebar';

/** Bindings for one command: one list for every platform, or one each. The first is shown first. */
export type DefaultKeys =
  readonly string[] | { readonly mac: readonly string[]; readonly other: readonly string[] };

export interface CommandSpec {
  /** What a person calls it: a tooltip's words, a future rebinding list's row. */
  readonly label: string;
  readonly scope: Scope | readonly Scope[];
  readonly keys: DefaultKeys;
  /** Runs even on a key a field, popover or confirm owns (section 5): the document commands. */
  readonly inFields?: boolean;
}

export const COMMANDS = {
  // A document command means the same thing typed in a field as anywhere: Mod+S never types an S.
  // New, Open and Save As have a handler only where a host can show a file dialog (the desktop
  // app); in a browser their keys stay the browser's.
  'document.new': { label: 'New', scope: 'global', keys: ['Mod+N'], inFields: true },
  'document.open': { label: 'Open', scope: 'global', keys: ['Mod+O'], inFields: true },
  'document.save': { label: 'Save', scope: 'global', keys: ['Mod+S'], inFields: true },
  'document.saveAs': { label: 'Save As', scope: 'global', keys: ['Mod+Shift+S'], inFields: true },
  'history.undo': { label: 'Undo', scope: 'global', keys: ['Mod+Z'] },
  // Ctrl+Y is Windows' own redo. On a Mac, Cmd-Y is the browser's history in some browsers.
  'history.redo': {
    label: 'Redo',
    scope: 'global',
    keys: { mac: ['Mod+Shift+Z'], other: ['Mod+Shift+Z', 'Ctrl+Y'] },
  },
  // The desktop app's Settings window, where each platform puts Settings: Cmd-, and Ctrl-,. Only
  // where a host is; in a browser the key stays the browser's.
  'app.settings': { label: 'Settings', scope: 'global', keys: ['Mod+,'], inFields: true },
  // Fold the sidebar to its handle and back (`sidebar.tsx`). Backslash, as Figma's hide-the-UI is:
  // nothing else in the editor, the browsers or the platforms takes Mod+\. In a field too, since
  // folding is not typing and the field may be in the sidebar.
  'view.toggleSidebar': {
    label: 'Toggle sidebar',
    scope: 'global',
    keys: ['Mod+\\'],
    inFields: true,
  },
  'selection.delete': {
    label: 'Delete selected element',
    scope: 'canvas',
    keys: ['Delete', 'Backspace'],
  },
  'selection.clear': { label: 'Deselect', scope: ['canvas', 'sidebar'], keys: ['Escape'] },
  // Paint order, on the brackets: Photoshop's and Illustrator's keys, and Figma's for one step. Front
  // and back add Shift, as Photoshop and Illustrator do (Figma uses the bare bracket for those).
  'selection.bringForward': {
    label: 'Bring forward',
    scope: ['canvas', 'sidebar'],
    keys: ['Mod+]'],
  },
  'selection.sendBackward': {
    label: 'Send backward',
    scope: ['canvas', 'sidebar'],
    keys: ['Mod+['],
  },
  'selection.bringToFront': {
    label: 'Bring to front',
    scope: ['canvas', 'sidebar'],
    keys: ['Mod+Shift+]'],
  },
  'selection.sendToBack': {
    label: 'Send to back',
    scope: ['canvas', 'sidebar'],
    keys: ['Mod+Shift+['],
  },
} as const satisfies Readonly<Record<string, CommandSpec>>;

/** A command's id. Only the registry's: any other string is a compile error. */
export type CommandId = keyof typeof COMMANDS;
