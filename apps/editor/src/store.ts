/**
 * The editor store: one zustand store per mounted editor, holding the settings that outlive a reload
 * and the editor state that deliberately does not.
 *
 * ## Two halves
 *
 * - **`settings`** is how the author has arranged the editor: the sensor host, which sections are
 *   open, which tab and chip each token pane shows, the layout last picked, and (reserved, empty
 *   until the sidebar can move) where the panels sit. It is persisted to `localStorage` under
 *   `EDITOR_STORE_KEY` (`persist`, with `partialize` choosing it and nothing else), so it survives a
 *   reload and a new tab alike. How a sidebar is folded is not a fact about a dashboard, so none of
 *   it is ever written into a layout.
 * - **`session`** is the document open for editing, the selection, and the undo history. In the
 *   store, so every change to the draft is a named action that undo and redo (`history.ts`) wrap, and
 *   never persisted: a reload must not resurrect unsaved edits over the file on disk, a selection is
 *   an index into a draft that no longer exists after one, and a history is steps through that draft.
 *
 * Everything else — a hover, an open popover, a search being typed, a confirm being asked — stays in
 * the component that shows it. DECISIONS.md has the table of which `useState` went where.
 *
 * ## Middleware
 *
 * `devtools(persist(...), { name: 'perch-editor' })`. The Redux DevTools extension, when installed,
 * shows each action by name (`toggle/section`, `set/connectionHost`, `edit/draft`) with the state
 * after it. Without the extension `devtools` hands the store through untouched, which is what tests
 * and a production build get.
 *
 * Storage is read once, when the store is made, and written on every change. Storage that is absent
 * or throws (a locked-down profile, a full quota) leaves the store working in memory for the page.
 *
 * ## Versions and the old connection key
 *
 * The stored value carries `EDITOR_STORE_VERSION`, and `migrate` brings an older one forward. Before
 * this store the connection control kept its choice under `CONNECTION_STORAGE_KEY`. A load that finds
 * no store key but finds that one reads it as version 0 and migrates it, so a saved host carries
 * over; the store's own key is written at once, and from then on the old key is neither read nor
 * written. It is left in place rather than deleted, so a checkout from before this store, served on
 * the same origin, still finds its host.
 *
 * ## One store per editor
 *
 * `createEditorStore` makes one; `main.tsx` makes the page's, and `Editor` makes its own when it is
 * given none (every test that mounts an editor does, so no test inherits another's settings). A
 * component reads it through `EditorStoreProvider`. A primitive rendered on its own, outside any
 * editor — a `Section` in its test — gets `DETACHED_EDITOR_STORE`, memory only, which the test setup
 * resets between tests.
 */

import type { Layout } from '@perch/layout-schema';
import { createContext, createElement, useCallback, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { devtools, persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  CONNECTION_STORAGE_KEY,
  readSavedConnection,
  type ConnectionChoice,
} from './connection.js';
import { draftSaved, editDraft as applyEdit } from './draft.js';
import {
  EMPTY_HISTORY,
  followSelection,
  recordEdit,
  redoStep,
  undoStep,
  type EditHistory,
} from './history.js';
import type { LayoutUpdate } from './layout-edits.js';
import type { LayoutLibrary } from './layout-library.js';
import { openLayoutByName, type Opened } from './open-layout.js';

/** The selection when there is none. Any out-of-range index means the same. */
export const NOTHING_SELECTED = -1;

/** The `localStorage` key the settings live under. */
export const EDITOR_STORE_KEY = 'perch-editor';

/** The shape `settings` is stored in. Bump it, and teach `migrate` the step, when the shape changes. */
export const EDITOR_STORE_VERSION = 1;

/** A token pane's two tabs. */
export type TokenTab = 'customize' | 'developer';

export type ConnectionMode = 'localhost' | 'remote';

/** The connection control: which radio is picked, the host in effect, and the field's text. */
export interface ConnectionSettings {
  readonly mode: ConnectionMode;
  readonly choice: ConnectionChoice;
  readonly draft: string;
}

/**
 * Where the panels sit and how big they are. Reserved: the sidebar cannot move or resize yet, so
 * this is empty, and exists so placement lands here rather than in a store of its own.
 */
export type PanelSettings = Readonly<Record<string, never>>;

/** Everything persisted. */
export interface EditorSettings {
  readonly connection: ConnectionSettings;
  /** Open (`true`) or folded, by section id (`entity/transform`, `theme/colour/advanced`). */
  readonly sections: Readonly<Record<string, boolean>>;
  /** The tab each token pane shows, by the pane's disclosure key (`theme`, `style`). */
  readonly tabs: Readonly<Record<string, TokenTab>>;
  /** The category chip each token pane has pressed, by the same key. */
  readonly chips: Readonly<Record<string, string>>;
  /** The layout last picked in the header, or `null` before one has been. `?layout=` beats it. */
  readonly layout: string | null;
  readonly panels: PanelSettings;
}

/** Everything in the store and never persisted. */
export interface EditorSession {
  /** The document open for editing. `null` only before `openFirst`, which `Editor` runs at once. */
  readonly opened: Opened | null;
  /** Which element is selected. Out of range means none. */
  readonly selected: number;
  /** Undo and redo for `opened`. Emptied whenever a layout is opened, a revert included. */
  readonly history: EditHistory;
}

export interface EditorActions {
  /** The localhost radio: takes effect at once, as there is nothing to type. */
  readonly selectLocalhost: () => void;
  /** The host radio: enables the field, and changes nothing else until Connect. */
  readonly selectRemote: () => void;
  /** The host field's text. */
  readonly setConnectionHost: (text: string) => void;
  /** Connect: the typed host becomes the one in effect. */
  readonly connectTo: (host: string, port: number) => void;
  readonly setSectionOpen: (id: string, open: boolean) => void;
  readonly setTab: (pane: string, tab: TokenTab) => void;
  readonly setChip: (pane: string, chip: string) => void;
  /** Open the first layout — `?layout=`, else the one last picked, else the library's first — once. */
  readonly openFirst: (library: LayoutLibrary, initialLayout: string | undefined) => void;
  /** Open a layout, dropping the selection. `remember` records it as the layout last picked. */
  readonly openLayout: (opened: Opened, options: { readonly remember: boolean }) => void;
  /**
   * One edit to the draft, through `editDraft`'s validation, recorded for undo. Edits sharing a
   * `gesture` are one step; one with none is a step of its own. See `history.ts`.
   */
  readonly editDraft: (update: LayoutUpdate, gesture?: string) => void;
  /** Back one step, keeping the selection on its element while that element exists. */
  readonly undo: () => void;
  /** Forward one step, the same way. */
  readonly redo: () => void;
  /** The layout named `name` was written as `written`. Ignored if another layout is open by now. */
  readonly markSaved: (name: string, written: Layout) => void;
  readonly select: (index: number) => void;
}

export interface EditorState extends EditorActions {
  readonly settings: EditorSettings;
  readonly session: EditorSession;
}

export type EditorStore = StoreApi<EditorState>;

/** The part of `localStorage` the store uses, so a test supplies a record. */
export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'> &
  Partial<Pick<Storage, 'removeItem'>>;

const DEFAULT_SETTINGS: EditorSettings = Object.freeze({
  connection: Object.freeze({
    mode: 'localhost',
    choice: Object.freeze({ kind: 'localhost' }),
    draft: '',
  }),
  sections: Object.freeze({}),
  tabs: Object.freeze({}),
  chips: Object.freeze({}),
  layout: null,
  panels: Object.freeze({}),
});

/**
 * What storage holds under `EDITOR_STORE_KEY`: `settings` from version 1. Version 0 is the old
 * connection key, read as `{ legacyConnection }` by `settingsStorage`; nothing ever writes it.
 */
interface Stored {
  readonly settings?: unknown;
  readonly legacyConnection?: unknown;
}

/**
 * The name to open when the page starts: `?layout=` whenever given, even one the picker does not
 * offer; else the layout last picked, while the library still offers it; else the first offered.
 */
export function firstLayoutName(
  initial: string | undefined,
  remembered: string | null,
  names: readonly string[],
): string {
  if (initial !== undefined) return initial;
  if (remembered !== null && names.includes(remembered)) return remembered;

  return names[0] ?? '';
}

/** Make a store, reading `storage` for settings a previous page left. */
export function createEditorStore(
  options: { readonly storage?: SettingsStorage | undefined; readonly devtools?: boolean } = {},
): EditorStore {
  return createStore<EditorState>()(
    devtools(
      persist(
        (set, get) => {
          const settle = (
            patch: Partial<EditorSettings>,
            action: { readonly type: string; readonly [key: string]: unknown },
          ): void => {
            set((state) => ({ settings: { ...state.settings, ...patch } }), undefined, action);
          };
          const connection = (patch: Partial<ConnectionSettings>): Partial<EditorSettings> => ({
            connection: { ...get().settings.connection, ...patch },
          });
          /** An undo or redo. With nothing to go to, nothing is set, so DevTools shows nothing. */
          const step = (move: typeof undoStep, type: string): void => {
            const { opened, history, selected } = get().session;
            if (opened?.ok !== true) return;
            const moved = move(history, opened.state);
            if (moved === null) return;
            set(
              {
                session: {
                  opened: { ok: true, state: moved.state },
                  selected: followSelection(selected, opened.state, moved.state, NOTHING_SELECTED),
                  history: moved.history,
                },
              },
              undefined,
              type,
            );
          };

          return {
            settings: DEFAULT_SETTINGS,
            session: { opened: null, selected: NOTHING_SELECTED, history: EMPTY_HISTORY },

            selectLocalhost: () => {
              // A new choice object even when it already was localhost: the control asks the relay
              // again whenever the choice changes, as picking the radio always has.
              settle(connection({ mode: 'localhost', choice: { kind: 'localhost' } }), {
                type: 'set/connectionMode',
                mode: 'localhost',
              });
            },
            selectRemote: () => {
              settle(connection({ mode: 'remote' }), {
                type: 'set/connectionMode',
                mode: 'remote',
              });
            },
            setConnectionHost: (text) => {
              settle(connection({ draft: text }), { type: 'set/connectionHost', text });
            },
            connectTo: (host, port) => {
              settle(connection({ choice: { kind: 'remote', host, port } }), {
                type: 'set/connectionChoice',
                host,
                port,
              });
            },
            setSectionOpen: (id, open) => {
              settle(
                { sections: { ...get().settings.sections, [id]: open } },
                { type: 'toggle/section', id, open },
              );
            },
            setTab: (pane, tab) => {
              settle(
                { tabs: { ...get().settings.tabs, [pane]: tab } },
                { type: 'set/tab', pane, tab },
              );
            },
            setChip: (pane, chip) => {
              settle(
                { chips: { ...get().settings.chips, [pane]: chip } },
                { type: 'set/chip', pane, chip },
              );
            },

            openFirst: (library, initialLayout) => {
              if (get().session.opened !== null) return;
              const name = firstLayoutName(initialLayout, get().settings.layout, library.names);
              set(
                {
                  session: {
                    opened: openLayoutByName(library, name),
                    selected: NOTHING_SELECTED,
                    history: EMPTY_HISTORY,
                  },
                },
                undefined,
                { type: 'open/layout', name, remember: false },
              );
            },
            openLayout: (opened, { remember }) => {
              const name = opened.ok ? opened.state.name : opened.name;
              set(
                (state) => ({
                  session: { opened, selected: NOTHING_SELECTED, history: EMPTY_HISTORY },
                  settings: remember ? { ...state.settings, layout: name } : state.settings,
                }),
                undefined,
                { type: 'open/layout', name, remember },
              );
            },
            editDraft: (update, gesture) => {
              set(
                (state) => {
                  const { opened, history } = state.session;
                  if (opened?.ok !== true) return {};
                  const edited = applyEdit(opened.state, update);

                  return {
                    session: {
                      ...state.session,
                      opened: { ok: true, state: edited },
                      history: recordEdit(history, opened.state, edited, gesture),
                    },
                  };
                },
                undefined,
                'edit/draft',
              );
            },
            undo: () => {
              step(undoStep, 'history/undo');
            },
            redo: () => {
              step(redoStep, 'history/redo');
            },
            markSaved: (name, written) => {
              set(
                (state) => {
                  const { opened } = state.session;
                  // Only the document actually written is recorded as saved, and only if it is still
                  // the one open: the author may have switched during the write.
                  if (opened?.ok !== true || opened.state.name !== name) return {};

                  return {
                    session: {
                      ...state.session,
                      opened: { ok: true, state: draftSaved(opened.state, written) },
                    },
                  };
                },
                undefined,
                { type: 'save/written', name },
              );
            },
            select: (index) => {
              set((state) => ({ session: { ...state.session, selected: index } }), undefined, {
                type: 'set/selection',
                index,
              });
            },
          };
        },
        {
          name: EDITOR_STORE_KEY,
          version: EDITOR_STORE_VERSION,
          storage: settingsStorage(options.storage),
          partialize: (state): Stored => ({ settings: state.settings }),
          migrate: (persisted, version): Stored => {
            // Version 0 is the connection control's own key, from before this store.
            if (version === 0 && isRecord(persisted)) {
              const saved = readSavedConnection(persisted['legacyConnection']);

              return saved === undefined
                ? {}
                : { settings: { connection: { mode: saved.choice.kind, ...saved } } };
            }

            return isRecord(persisted) ? persisted : {};
          },
          // Field by field, so a stored value that is partly wrong keeps what is right, and a field
          // added later arrives with its default rather than as `undefined`.
          merge: (persisted, current) => ({
            ...current,
            settings: readSettings(isRecord(persisted) ? persisted['settings'] : undefined),
          }),
        },
      ),
      { name: 'perch-editor', ...(options.devtools === false ? { enabled: false } : {}) },
    ),
  );
}

/** Storage as `persist` wants it: parsed, never throwing, and seeded from the old connection key. */
function settingsStorage(storage: SettingsStorage | undefined): PersistStorage<Stored> {
  const read = (key: string): string | null => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const parse = (text: string): unknown => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  };

  return {
    getItem: (name): StorageValue<Stored> | null => {
      const own = read(name);
      if (own !== null) {
        // The store's key is present, so the old one is never consulted again, even when this one
        // turns out not to parse: `merge` then falls back to the defaults.
        const value = parse(own);

        return isRecord(value) ? (value as unknown as StorageValue<Stored>) : null;
      }

      const legacy = read(CONNECTION_STORAGE_KEY);

      return legacy === null ? null : { state: { legacyConnection: parse(legacy) }, version: 0 };
    },
    setItem: (name, value) => {
      try {
        storage?.setItem(name, JSON.stringify(value));
      } catch {
        // Remembering is a convenience; the store carries on in memory.
      }
    },
    removeItem: (name) => {
      try {
        storage?.removeItem?.(name);
      } catch {
        // As above.
      }
    },
  };
}

/** Settings read back from storage, each field checked and defaulted on its own. */
function readSettings(raw: unknown): EditorSettings {
  const body = isRecord(raw) ? raw : {};

  return {
    connection: readConnection(body['connection']) ?? DEFAULT_SETTINGS.connection,
    sections: readRecord(body['sections'], (value) => typeof value === 'boolean'),
    tabs: readRecord(body['tabs'], isTokenTab),
    chips: readRecord(body['chips'], (value) => typeof value === 'string'),
    layout: typeof body['layout'] === 'string' ? body['layout'] : null,
    panels: DEFAULT_SETTINGS.panels,
  };
}

function readConnection(raw: unknown): ConnectionSettings | undefined {
  const saved = readSavedConnection(raw);
  if (saved === undefined || !isRecord(raw)) return undefined;
  const mode = raw['mode'];

  return { mode: mode === 'localhost' || mode === 'remote' ? mode : saved.choice.kind, ...saved };
}

/** The entries of `raw` whose value passes `keep`; `{}` when `raw` is not a record. */
function readRecord<T>(raw: unknown, keep: (value: unknown) => value is T): Record<string, T> {
  if (!isRecord(raw)) return {};
  const kept: Record<string, T> = {};
  for (const [key, value] of Object.entries(raw)) if (keep(value)) kept[key] = value;

  return kept;
}

function isTokenTab(value: unknown): value is TokenTab {
  return value === 'customize' || value === 'developer';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The store a component outside any editor reads: memory only, and not shown in DevTools. The
 * editor never uses it; `vitest.setup.ts` resets it between tests.
 */
export const DETACHED_EDITOR_STORE: EditorStore = createEditorStore({ devtools: false });

const EditorStoreContext = createContext<EditorStore>(DETACHED_EDITOR_STORE);

/** Hand `store` to every component below. */
export function EditorStoreProvider({
  store,
  children,
}: {
  readonly store: EditorStore;
  readonly children: ReactNode;
}): ReactNode {
  return createElement(EditorStoreContext.Provider, { value: store }, children);
}

/** A slice of the nearest editor store, re-rendering only when that slice changes. */
export function useEditorStore<T>(selector: (state: EditorState) => T): T {
  return useStore(useContext(EditorStoreContext), selector);
}

/** Whether section `id` is open, and a setter. Every section with the same id shares the answer. */
export function useDisclosure(
  id: string,
  defaultOpen: boolean,
): readonly [boolean, (open: boolean) => void] {
  const open = useEditorStore((state) => state.settings.sections[id]) ?? defaultOpen;
  const setSectionOpen = useEditorStore((state) => state.setSectionOpen);
  const set = useCallback(
    (next: boolean) => {
      setSectionOpen(id, next);
    },
    [id, setSectionOpen],
  );

  return [open, set] as const;
}
