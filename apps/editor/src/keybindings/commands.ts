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
  /** Runs even on a key a field, popover or confirm owns (section 5). None does yet. */
  readonly inFields?: boolean;
}

export const COMMANDS = {
  'history.undo': { label: 'Undo', scope: 'global', keys: ['Mod+Z'] },
  // Ctrl+Y is Windows' own redo. On a Mac, Cmd-Y is the browser's history in some browsers.
  'history.redo': {
    label: 'Redo',
    scope: 'global',
    keys: { mac: ['Mod+Shift+Z'], other: ['Mod+Shift+Z', 'Ctrl+Y'] },
  },
  'selection.delete': {
    label: 'Delete selected element',
    scope: 'canvas',
    keys: ['Delete', 'Backspace'],
  },
  'selection.clear': { label: 'Deselect', scope: ['canvas', 'sidebar'], keys: ['Escape'] },
} as const satisfies Readonly<Record<string, CommandSpec>>;

/** A command's id. Only the registry's: any other string is a compile error. */
export type CommandId = keyof typeof COMMANDS;
