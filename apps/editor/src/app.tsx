/**
 * THE EDITOR: pick a layout, watch it render, change its fields, write it back.
 *
 * Four things, which are the four the human actually asked for — "so we can switch and preview
 * layouts and start customizing them" — and since then dragging, and adding and deleting elements.
 * Since then, undo and redo. Everything else `SPEC.md` describes is deliberately absent and listed in
 * DECISIONS.md: no asset management, no multi-layout project.
 *
 * ## The pipeline, in the order it runs
 *
 * ```text
 * name          ->  library.entry(name)             a file, as text
 *               ->  loadLayoutJson(text, {…})       migrate, then validate, against WIDGET_REGISTRY
 *               ->  openDraft                       draft = rendered = saved
 * a keystroke   ->  editDraft(state, update)        validate again; rendered holds if it failed
 *               ->  <LayoutPreview>                 the shared canvas, at a fitted scale
 * save          ->  saveDraft                       refuses unless issues are empty
 * ```
 *
 * Two properties are structural here rather than remembered:
 *
 * 1. **The preview renders what the runtime renders.** `LayoutPreview` contains `LayoutCanvas` from
 *    `@perch/ui-kit` and nothing else; the widget vocabulary is `WIDGET_REGISTRY` from the same
 *    package, so a layout this editor accepts is a layout the runtime can draw, and a widget it draws
 *    is the widget the panel will draw. There is no element rendering anywhere in `apps/editor`.
 * 2. **Nothing reaches disk unvalidated.** Every edit goes through `editDraft`, which runs
 *    `validateLayout`; the save button is gated on `canSave`; and `saveDraft` refuses independently of
 *    the button. See `draft.ts` and `save.ts`.
 *
 * ## Live once connected, sample data until then, and the header says which
 *
 * The header's connection control (`connection-control.tsx`) picks the sensor host — localhost or a
 * typed one — and tells the relay the dev stack started to poll it. Once the relay reports that host
 * `ok` and readings are arriving, the preview and the sensor picker read the relay. Until then, and
 * whenever the connection is lost, they read the mock, because authoring must not require hardware:
 * the sensor host is off for days at a time. The header says which with `data-perch-source-kind` —
 * `mock` under a "sample data" badge, `mqtt` beside the host — so no capture of sample values can be
 * read as a live panel.
 *
 * ## Adding and deleting are edits like any other
 *
 * An added element goes through `addElement` and a deleted one through `removeElement`, both plain
 * `LayoutUpdate`s into `editDraft`, so each is validated exactly as a keystroke is. An addition is
 * selected at once; a deletion leaves nothing selected. A delete still asks first — the selection
 * header's inline confirm, which the Delete and Backspace keys open when the canvas has focus — and
 * undo brings it back.
 *
 * ## Keys
 *
 * Every shortcut is a command in `keybindings/` and reaches this shell through `useCommand`; the
 * rules are KEYBINDINGS.md. The pane is the `canvas` scope and the sidebar the `sidebar` one: Delete
 * and Backspace ask to delete only on the canvas, so typing in a field never deletes anything, and
 * Escape deselects from either, but never from a field, a popover or a delete confirm, where Escape
 * already means "back out of this" and must mean only that.
 *
 * ## Undo and redo
 *
 * Every change to the document is a step in the store's history (`store.ts`, `history.ts`): the
 * header's undo and redo, and the platform's keys from anywhere but a text field. Where one step
 * ends — a drag, a field's commit, a scrub let go — is `edit-gestures.ts`.
 * Selection, folds, tabs and the connection are not steps.
 *
 * ## Switching with unsaved edits asks first
 *
 * Changing the picker while the draft differs from disk does not discard the edits. It parks the
 * request and shows a bar with an explicit discard. Opening a layout clears the history, so a silent
 * discard is unrecoverable work — and the bar costs one piece of state where a confirmation dialog
 * would have cost a browser API that does not exist in jsdom.
 */

import type { SensorSource } from '@perch/sensor-contract';
import {
  LAYOUT_CANVAS_STYLES,
  MEDIA_FRAME_STYLES,
  READOUT_STYLES,
  SensorProvider,
  TEXT_BLOCK_STYLES,
  WIDGET_NAMES,
} from '@perch/ui-kit';
import type { LayoutElement, Rect } from '@perch/layout-schema';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { CANVAS_HANDLES_STYLES } from './canvas-handles.js';
import {
  CONNECTION_STYLES,
  ConnectionControl,
  useConnection,
  type Connection,
  type RelayLink,
} from './connection-control.js';
import { CONTROLS_STYLES } from './controls/index.js';
import { canSave, isDirty } from './draft.js';
import { useEditGesture } from './edit-gestures.js';
import {
  KeybindingsProvider,
  keyScope,
  useCommand,
  useKeybinding,
  type CommandId,
} from './keybindings/index.js';
import { currentPlatform, type Platform } from './platform.js';
import { INSPECTOR_STYLES, Inspector } from './inspector.js';
import type { LayoutLibrary } from './layout-library.js';
import { addElement, removeElement, setElementRect, type LayoutUpdate } from './layout-edits.js';
import { LAYOUT_PROBLEMS_STYLES, LayoutProblems } from './problems.js';
import { LayoutPreview, PREVIEW_STYLES, describePreviewFit } from './preview.js';
import { PROPERTY_VIEW_STYLES } from './property-view.js';
import { SENSOR_PICKER_STYLES } from './sensor-picker.js';
import { TOKEN_PANE_STYLES } from './token-pane.js';
import {
  HEADER_HEIGHT,
  INSPECTOR_WIDTH,
  PREVIEW_PADDING,
  usePreviewViewport,
} from './preview-viewport.js';
import { saveDraft, type SaveTransport } from './save.js';
import { openLayoutByName, type Opened } from './open-layout.js';
import {
  EditorStoreProvider,
  NOTHING_SELECTED,
  createEditorStore,
  useEditorStore,
  type EditorStore,
  type SettingsStorage,
} from './store.js';

export { openLayoutByName } from './open-layout.js';

/** What the badge's tooltip says about the numbers in the preview while not connected. */
const SAMPLE_PROVENANCE =
  'sample data: generated here, not hardware. The preview reads the sensor host once connected.';

export interface EditorProps {
  /** Which layouts exist. Injected, so a test supplies its own two. */
  readonly library: LayoutLibrary;
  /** The sample readings the preview draws while not connected: the mock. */
  readonly source: SensorSource;
  /** Topic suggestions for the inspector while not connected. The mock source's own topics. */
  readonly topics: readonly string[];
  /** The relay the dev stack started, or `undefined` when there is none (`--no-relay`). */
  readonly relay?: RelayLink | undefined;
  /**
   * Where the editor's settings are remembered when no `store` is given. `localStorage` in the page;
   * absent, nothing outlives the editor.
   */
  readonly storage?: SettingsStorage | undefined;
  /**
   * The editor store (`store.ts`). `main.tsx` makes the page's once; given none, the editor makes its
   * own over `storage`, which is what a test does.
   */
  readonly store?: EditorStore | undefined;
  /** How a save reaches the filesystem. Injected, so a test can assert no request was made. */
  readonly transport: SaveTransport;
  /**
   * Which layout to open first: `?layout=`. Given, it beats the layout last picked; absent, that one
   * opens, else the library's first offered name.
   */
  readonly initialLayout?: string | undefined;
  /** Which platform's shortcuts to accept and show. Detected from the browser when absent. */
  readonly platform?: Platform | undefined;
}

export function Editor({
  store,
  storage,
  library,
  initialLayout,
  platform = currentPlatform(),
  ...rest
}: EditorProps): ReactNode {
  // Made once per mounted editor, and the first layout opened in it before anything renders, so the
  // shell never sees a store with nothing open. `openFirst` does nothing to a store that already has
  // a layout open: StrictMode's second call, or a page store handed to a remount.
  const [editorStore] = useState(() => {
    const made = store ?? createEditorStore({ storage });
    made.getState().openFirst(library, initialLayout);

    return made;
  });

  return (
    <EditorStoreProvider store={editorStore}>
      <EditorKeybindings platform={platform}>
        <ConnectedEditor library={library} {...rest} />
      </EditorKeybindings>
    </EditorStoreProvider>
  );
}

/** The one keyboard dispatcher, over the store's keybinding overrides. */
function EditorKeybindings({
  platform,
  children,
}: {
  readonly platform: Platform;
  readonly children: ReactNode;
}): ReactNode {
  const overrides = useEditorStore((state) => state.settings.keybindings);

  return (
    <KeybindingsProvider platform={platform} overrides={overrides}>
      {children}
    </KeybindingsProvider>
  );
}

/** The editor inside its store: the connection, which source the preview reads, and the sheets. */
function ConnectedEditor({
  library,
  source,
  topics,
  transport,
  relay,
}: Omit<EditorProps, 'store' | 'storage' | 'initialLayout' | 'platform'>): ReactNode {
  const connection = useConnection(relay);
  const live = relay !== undefined && connection.state.phase === 'connected';

  return (
    // The provider rebuilds its store when `source` changes, so switching between the relay and the
    // mock drops every reading of the other rather than mixing the two in one tile.
    <SensorProvider source={live ? relay.source : source}>
      {/*
       * React 19 hoists a `<style>` with `href` and `precedence` into the document head and dedupes
       * it by `href`, so each sheet travels with the code that needs it. The four `ui-kit` sheets are
       * mounted unconditionally rather than per element kind present: a layout switched in the picker
       * would otherwise add or remove a stylesheet at the moment the canvas changes, and a sheet
       * arriving a frame after the element it styles is a flash of unstyled content in the pane an
       * author is judging colours in.
       */}
      <style href="perch-readout" precedence="default">
        {READOUT_STYLES}
      </style>
      <style href="perch-text-block" precedence="default">
        {TEXT_BLOCK_STYLES}
      </style>
      <style href="perch-media-frame" precedence="default">
        {MEDIA_FRAME_STYLES}
      </style>
      <style href="perch-layout-canvas" precedence="default">
        {LAYOUT_CANVAS_STYLES}
      </style>
      <style href="perch-editor-preview" precedence="default">
        {PREVIEW_STYLES}
      </style>
      <style href="perch-editor-handles" precedence="default">
        {CANVAS_HANDLES_STYLES}
      </style>
      <style href="perch-editor-controls" precedence="default">
        {CONTROLS_STYLES}
      </style>
      <style href="perch-editor-property-view" precedence="default">
        {PROPERTY_VIEW_STYLES}
      </style>
      <style href="perch-editor-inspector" precedence="default">
        {INSPECTOR_STYLES}
      </style>
      <style href="perch-editor-token-pane" precedence="default">
        {TOKEN_PANE_STYLES}
      </style>
      <style href="perch-editor-sensor-picker" precedence="default">
        {SENSOR_PICKER_STYLES}
      </style>
      <style href="perch-editor-problems" precedence="default">
        {LAYOUT_PROBLEMS_STYLES}
      </style>
      <style href="perch-editor-connection" precedence="default">
        {CONNECTION_STYLES}
      </style>
      <style href="perch-editor" precedence="default">
        {EDITOR_STYLES}
      </style>

      <EditorShell
        library={library}
        // Connected, the picker lists what the relay publishes and nothing else: offering the mock's
        // topics beside a real machine's would suggest sensors that machine does not have.
        topics={live ? [] : topics}
        transport={transport}
        connection={connection}
        live={live}
      />
    </SensorProvider>
  );
}

/**
 * The shell: all of the editor's state, and none of its rendering of a layout.
 *
 * Separate from `Editor` because its hooks need the provider above them, and because every hook has
 * to run on every path including the ones that paint no canvas — an early return before
 * `usePreviewViewport()` would change the hook order between a valid layout and an invalid one, which
 * React forbids and which would turn a broken layout file into a crash.
 */
function EditorShell({
  library,
  topics,
  transport,
  connection,
  live,
}: Omit<EditorProps, 'source' | 'relay' | 'storage' | 'store' | 'initialLayout' | 'platform'> & {
  readonly connection: Connection;
  readonly live: boolean;
}): ReactNode {
  const viewport = usePreviewViewport();

  /**
   * The document and the selection are the store's session (`store.ts`): in the store so each edit
   * is a named action, never persisted so a reload opens the file on disk. Which layout opened first
   * is `openFirst`'s: `?layout=`, else the one last picked, else the first offered, sorted.
   *
   * Defaulting rather than showing a chooser, for the reason the runtime gives: the common case is
   * `npm run dev` with no query string, and a first screen that made the interesting state — a layout
   * on screen — the one needing extra clicks would be the wrong way round. The name is in the picker,
   * so it is never ambiguous which file is open.
   */
  const opened = useOpened();
  /** Nothing, until the author picks something: see `inspector.tsx` for why not element 0. */
  const selected = useEditorStore((state) => state.session.selected);
  const selectInStore = useEditorStore((state) => state.select);
  const openLayout = useEditorStore((state) => state.openLayout);
  const editDraft = useEditorStore((state) => state.editDraft);
  const markSaved = useEditorStore((state) => state.markSaved);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const canUndo = useEditorStore((state) => state.session.history.past.length > 0);
  const canRedo = useEditorStore((state) => state.session.history.future.length > 0);
  const gesture = useEditGesture();
  /** Whether the selection header's delete is asking. Any change of selection withdraws the ask. */
  const [deleteAsked, setDeleteAsked] = useState(false);
  /** A switch waiting on the author's decision about unsaved edits. `null` when there is none. */
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const select = useCallback(
    (index: number) => {
      selectInStore(index);
      setDeleteAsked(false);
    },
    [selectInStore],
  );

  /** Open `name`. `remember`: it was picked in the header, so it is the layout to reopen next time. */
  const open = useCallback(
    (name: string, remember: boolean) => {
      openLayout(openLayoutByName(library, name), { remember });
      setDeleteAsked(false);
      setPendingName(null);
      setNotice('');
    },
    [library, openLayout],
  );

  const onEdit = useCallback(
    (update: LayoutUpdate) => {
      editDraft(update, gesture());
      // A stale "saved layouts/x.json" over a document that has since been edited reads as though the
      // edit is on disk. The edit clears it.
      setNotice('');
    },
    [editDraft, gesture],
  );

  /** Undo or redo. The notice goes as it does for an edit: the document moved. */
  const onHistory = useCallback(
    (which: 'undo' | 'redo') => {
      if (which === 'undo') undo();
      else redo();
      setDeleteAsked(false);
      setNotice('');
    },
    [undo, redo],
  );

  useCommand('history.undo', () => {
    onHistory('undo');
  });
  useCommand('history.redo', () => {
    onHistory('redo');
  });

  /** A dragged or resized element's rect, as one edit. The same `editDraft` path as the field form. */
  const onRect = useCallback(
    (index: number, rect: Rect) => {
      onEdit(setElementRect(index, rect));
    },
    [onEdit],
  );

  /** A new element: appended through the same validated path, then selected. */
  const onAdd = useCallback(
    (element: LayoutElement) => {
      if (!opened.ok) return;
      const index = opened.state.draft.elements.length;
      onEdit(addElement(element));
      select(index);
    },
    [opened, onEdit, select],
  );

  /** A confirmed delete. Nothing is selected afterwards: the index now names a different element. */
  const onDelete = useCallback(
    (index: number) => {
      onEdit(removeElement(index));
      select(NOTHING_SELECTED);
    },
    [onEdit, select],
  );

  const hasSelection = opened.ok && opened.state.draft.elements[selected] !== undefined;

  /** Delete or Backspace with the canvas focused: ask, through the header's own confirm. */
  useCommand('selection.delete', () => {
    if (hasSelection) setDeleteAsked(true);
  });

  /** Escape on the canvas or in the sidebar, when nothing nearer uses it: deselect. */
  useCommand(
    'selection.clear',
    () => {
      select(NOTHING_SELECTED);
    },
    { enabled: hasSelection },
  );

  const onPick = useCallback(
    (name: string) => {
      const dirty = opened.ok && isDirty(opened.state);
      if (dirty) {
        setPendingName(name);
        return;
      }
      open(name, true);
    },
    [opened, open],
  );

  const onSave = useCallback(() => {
    if (!opened.ok || saving) return;

    const state = opened.state;
    setSaving(true);
    setNotice(`writing layouts/${state.name}.json…`);

    saveDraft(state, transport)
      .then((outcome) => {
        setSaving(false);
        if (!outcome.ok) {
          setNotice(outcome.reason);
          return;
        }
        setNotice(`saved ${outcome.path}`);
        // Recorded against the store's current state rather than the captured one: the author may have
        // typed during the write, and marking *that* document as on-disk would report a clean tree
        // over unsaved edits. Only the document actually written is recorded as saved.
        markSaved(state.name, outcome.written);
      })
      .catch((error: unknown) => {
        setSaving(false);
        setNotice(
          `the save request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }, [opened, saving, transport, markSaved]);

  const name = opened.ok ? opened.state.name : opened.name;
  const dirty = opened.ok && isDirty(opened.state);

  /** The picker's options: every offered layout, plus the open one if it is not offered. */
  const choices = useMemo(
    () => (library.names.includes(name) ? library.names : [name, ...library.names]),
    [library.names, name],
  );

  return (
    <div id="perch-editor" data-perch-layout={name} data-perch-dirty={dirty ? 'true' : 'false'}>
      <header className="perch-editor-header" data-testid="perch-editor-header">
        <span className="perch-editor-brand">perch · editor</span>

        <label className="perch-editor-picker">
          layout
          <select
            className="perch-editor-input"
            value={name}
            onChange={(event) => {
              onPick(event.target.value);
            }}
          >
            {choices.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        </label>

        {opened.ok ? (
          <span className="perch-editor-item" data-testid="perch-editor-fit">
            {describePreviewFit(opened.state.rendered, viewport)}
          </span>
        ) : null}

        <ConnectionControl connection={connection} />

        {live ? (
          <span
            className="perch-editor-live"
            data-testid="perch-editor-source"
            data-perch-source-kind="mqtt"
          >
            {`live · ${connection.state.target}`}
          </span>
        ) : (
          <span
            className="perch-editor-sample"
            data-testid="perch-editor-source"
            data-perch-source-kind="mock"
            title={SAMPLE_PROVENANCE}
          >
            sample data
          </span>
        )}

        <span className="perch-editor-spacer" />

        {dirty ? (
          <span className="perch-editor-dirty" data-testid="perch-editor-dirty">
            unsaved changes
          </span>
        ) : null}

        <CommandButton
          command="history.undo"
          disabled={!canUndo}
          onClick={() => {
            onHistory('undo');
          }}
        >
          undo
        </CommandButton>

        <CommandButton
          command="history.redo"
          disabled={!canRedo}
          onClick={() => {
            onHistory('redo');
          }}
        >
          redo
        </CommandButton>

        <button
          type="button"
          className="perch-editor-button"
          disabled={!opened.ok || !dirty}
          onClick={() => {
            open(name, false);
          }}
        >
          revert
        </button>

        <button
          type="button"
          className="perch-editor-button perch-editor-button--save"
          data-testid="perch-editor-save"
          disabled={!opened.ok || saving || !canSave(opened.state)}
          onClick={onSave}
        >
          save
        </button>
      </header>

      {/*
       * The version bump, said out loud before it happens. Both shipped layouts are `schemaVersion` 1
       * and a save writes 2; the migration rewrites no other field, but it is this editor that moves
       * the number and an author should not find that in a diff. See `draft.ts`.
       */}
      {opened.ok && opened.state.migrations !== '' ? (
        <p className="perch-editor-bar" data-testid="perch-editor-migrations">
          {`${opened.state.migrations} — saving writes the migrated document`}
        </p>
      ) : null}

      {pendingName === null ? null : (
        <p className="perch-editor-bar perch-editor-bar--warn" data-testid="perch-editor-pending">
          {`"${name}" has unsaved changes. switching to "${pendingName}" discards them, and undo cannot bring them back.`}
          <button
            type="button"
            className="perch-editor-button"
            onClick={() => {
              open(pendingName, true);
            }}
          >
            {`discard and open ${pendingName}`}
          </button>
          <button
            type="button"
            className="perch-editor-button"
            onClick={() => {
              setPendingName(null);
            }}
          >
            keep editing
          </button>
        </p>
      )}

      {notice === '' ? null : (
        <p className="perch-editor-bar" data-testid="perch-editor-notice">
          {notice}
        </p>
      )}

      <div className="perch-editor-body">
        <main className="perch-editor-pane" {...keyScope('canvas')}>
          {opened.ok ? (
            <LayoutPreview
              layout={opened.state.rendered}
              resolveAsset={library.resolveAsset}
              viewport={viewport}
              stale={opened.state.issues.length > 0}
              selected={selected}
              onSelect={select}
              onRect={onRect}
            />
          ) : (
            <p className="perch-editor-empty" data-testid="perch-editor-unopened">
              {opened.reason}
            </p>
          )}
        </main>

        <aside className="perch-editor-side" {...keyScope('sidebar')}>
          <LayoutProblems
            issues={opened.ok ? opened.state.issues : opened.issues}
            onSelectElement={select}
          />
          {opened.ok ? (
            <Inspector
              state={opened.state}
              selected={selected}
              onSelect={select}
              onEdit={onEdit}
              onAdd={onAdd}
              onDelete={onDelete}
              deleteAsked={deleteAsked}
              onDeleteAsked={setDeleteAsked}
              topics={topics}
              widgets={WIDGET_NAMES}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/** A header button for `command`, titled and `aria-keyshortcuts`-labelled with its keys. */
function CommandButton({
  command,
  disabled,
  onClick,
  children,
}: {
  readonly command: CommandId;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const shown = useKeybinding(command);

  return (
    <button
      type="button"
      className="perch-editor-button"
      disabled={disabled}
      aria-keyshortcuts={shown.ariaKeyShortcuts}
      title={shown.hint}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** The document open for editing. `Editor` opens one before the shell first renders. */
function useOpened(): Opened {
  const opened = useEditorStore((state) => state.session.opened);
  if (opened === null) throw new Error('the editor store has no layout open; Editor opens one');

  return opened;
}

/**
 * The editor's own chrome. Nothing here styles a layout element or reads a layout's theme.
 *
 * The three numbers that also appear in `preview-viewport.ts` are interpolated from it rather than
 * written twice: the pane's size is computed in JavaScript to derive the canvas scale, so a header
 * that was 44px in CSS and 40px in the arithmetic would produce a preview scaled for a box it is not
 * in.
 */
export const EDITOR_STYLES = `
html, body { margin: 0; height: 100%; background: #07080a; }
#perch-editor {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  font-family: ui-sans-serif, system-ui, sans-serif;
  color: #e8f1ff;
}
.perch-editor-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  height: ${HEADER_HEIGHT}px;
  padding: 0 10px;
  border-bottom: 1px solid #1b2028;
  background: #0d1016;
  font-size: 0.75rem;
  color: #9aa4b2;
}
.perch-editor-brand { font-weight: 600; color: #e8f1ff; }
.perch-editor-picker { display: flex; align-items: center; gap: 6px; }
.perch-editor-item { white-space: nowrap; font-variant-numeric: tabular-nums; }
.perch-editor-spacer { flex: 1 1 auto; }
.perch-editor-dirty {
  white-space: nowrap;
  border-radius: 999px;
  border: 1px solid #5e4a23;
  background: #261e10;
  color: #e8c98f;
  padding: 1px 8px;
  font-weight: 600;
}
.perch-editor-button {
  flex: none;
  border: 1px solid #262c36;
  border-radius: 3px;
  background: #171b22;
  color: #e8f1ff;
  font: inherit;
  padding: 3px 10px;
  cursor: pointer;
}
.perch-editor-button:disabled { color: #4c586b; cursor: not-allowed; }
.perch-editor-button--save:not(:disabled) { border-color: #23503a; background: #10241a; color: #7ee2a8; }
.perch-editor-bar {
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 5px 10px;
  border-bottom: 1px solid #1b2028;
  background: #0d1016;
  font-size: 0.75rem;
  color: #9aa4b2;
  overflow-wrap: anywhere;
}
.perch-editor-bar--warn { border-color: #5e4a23; background: #261e10; color: #e8c98f; }
.perch-editor-body { flex: 1 1 auto; display: flex; min-height: 0; }
.perch-editor-pane {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: ${PREVIEW_PADDING}px;
  overflow: hidden;
}
.perch-editor-side {
  flex: none;
  width: ${INSPECTOR_WIDTH}px;
  display: flex;
  flex-direction: column;
  border-left: 1px solid #1b2028;
  background: var(--ed-bg, #0f1217);
  overflow: hidden;
}
.perch-editor-side > .perch-editor-problems { flex: none; margin: 6px; max-height: 40%; overflow-y: auto; }
`;
