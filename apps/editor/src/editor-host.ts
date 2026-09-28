/**
 * The editor's one seam to a host that is more than a browser tab: the desktop app, which can show a
 * file dialog, owns a menu bar, and asks before a window with unsaved changes closes.
 *
 * `Editor` takes an `EditorHost` or none. None is the browser under `npm run dev`, which is unchanged:
 * the picker lists the bundled library, a save is a `PUT` to the dev server, and New, Open and Save
 * As have no handler, so their keys stay the browser's. Given one, those three commands appear, the
 * host is told the document's name and whether it is dirty, and the host's menu runs commands through
 * the same registry a key does. How the host is filled is `desktop-host.ts`; this file is the shape,
 * and the rules that need no host to test.
 *
 * A save still goes through `saveDraft` and the injected `SaveTransport` in both cases, so the
 * validation gate — no invalid layout reaches a disk — is the same code in both.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import type { ConnectionChoice } from './connection.js';
import { boundCommand, isTextEntry, type CommandId, type Keymap } from './keybindings/index.js';
import type { LayoutLibraryEntry } from './layout-library.js';

/** The commands a host's menu shows, in its File then Edit order. */
export const MENU_COMMAND_IDS = [
  'document.new',
  'document.open',
  'document.save',
  'document.saveAs',
  'history.undo',
  'history.redo',
] as const satisfies readonly CommandId[];

export type MenuCommandId = (typeof MENU_COMMAND_IDS)[number];

/** Each menu command's bindings in effect, first shown first. */
export type MenuBindings = Readonly<Record<MenuCommandId, readonly string[]>>;

/** What the host is told about the open document. */
export interface DocumentState {
  readonly name: string;
  readonly dirty: boolean;
}

export interface EditorHost {
  /**
   * Ask where to write a copy, suggesting `suggested`. Resolves the name the host registered it
   * under, which a save then writes through the transport, or `null` when the author cancelled.
   */
  saveAs(suggested: string): Promise<{ readonly name: string; readonly path: string } | null>;
  /** Show the host's Open dialog. Resolves the chosen document, or `null` when cancelled. */
  open(): Promise<LayoutLibraryEntry | null>;
  setDocumentState(state: DocumentState): void;
  /** What the menu should show for each command: the editor's keymap, overrides included. */
  setMenuBindings(bindings: MenuBindings): void;
  /** The host's menu ran `id`. Returns an unsubscribe. */
  onCommand(listener: (id: string) => void): () => void;
  /** The host wants the document saved before it closes; answer with `saveDone(id, saved)`. */
  onSaveRequest(listener: (id: number) => void): () => void;
  saveDone(id: number, saved: boolean): void;
  /** The menu's Undo or Redo, done by the platform in the focused text field. */
  nativeEdit(which: 'undo' | 'redo'): void;
}

export type MenuRoute =
  | { readonly kind: 'native'; readonly edit: 'undo' | 'redo' }
  | { readonly kind: 'command'; readonly id: MenuCommandId };

function isMenuCommand(id: string): id is MenuCommandId {
  return (MENU_COMMAND_IDS as readonly string[]).includes(id);
}

/**
 * Where a menu command goes. The menu's Undo and Redo in a text field are the field's own undo of
 * the typing, as the keys are there (KEYBINDINGS.md section 5); anywhere else they are the editor's
 * history. Every other command runs through the registry wherever the focus is. `null` for an id
 * that is not a menu command, which is ignored.
 */
export function menuCommandRoute(id: string, active: Element | null): MenuRoute | null {
  if (!isMenuCommand(id)) return null;
  if ((id === 'history.undo' || id === 'history.redo') && isTextEntry(active)) {
    return { kind: 'native', edit: id === 'history.undo' ? 'undo' : 'redo' };
  }

  return { kind: 'command', id };
}

/** The keymap's bindings for the menu's commands, so the menu shows what the editor accepts. */
export function menuBindings(keymap: Keymap): MenuBindings {
  return Object.fromEntries(
    MENU_COMMAND_IDS.map((id) => [id, boundCommand(keymap, id).bindings]),
  ) as unknown as MenuBindings;
}

/** The relay's poll target as the desktop app reports it. */
export interface RelayTarget {
  readonly host: string;
  readonly port: number;
  /** The port a bare `localhost` request means: the relay's configured one. */
  readonly defaultPort: number;
}

/**
 * The connection choice that asks the relay for exactly what it is polling, so opening the editor
 * never moves the runner's relay: localhost, when the relay polls its own default, else that host.
 */
export function choiceForRelay(target: RelayTarget): ConnectionChoice {
  return target.host === 'localhost' && target.port === target.defaultPort
    ? { kind: 'localhost' }
    : { kind: 'remote', host: target.host, port: target.port };
}

/** New's canvas size when there is no valid open document to take one from. */
const DEFAULT_TARGET = Object.freeze({ width: 1920, height: 400, frameRate: 30 });

/**
 * New's document: an empty canvas with the open document's target and theme, or 1920x400 and no
 * theme when nothing valid is open. Blank rather than a starter, because a starter is a document to
 * delete from; the size and look carry over because a second panel is usually for the same screen.
 */
export function blankLayoutLike(open: Layout | undefined): Layout {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    target: open?.target ?? { ...DEFAULT_TARGET },
    theme: open?.theme ?? {},
    elements: [],
  };
}

/** `untitled`, or `untitled-<n>` for the first `n` not already a name in `taken`. */
export function untitledName(taken: readonly string[]): string {
  if (!taken.includes('untitled')) return 'untitled';
  let n = 2;
  while (taken.includes(`untitled-${String(n)}`)) n += 1;

  return `untitled-${String(n)}`;
}
