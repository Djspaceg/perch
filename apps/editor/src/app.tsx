/**
 * THE EDITOR: pick a layout, watch it render, change its fields, write it back.
 *
 * Four things, which are the four the human actually asked for — "so we can switch and preview
 * layouts and start customizing them". Everything `SPEC.md` describes beyond that is deliberately
 * absent and listed in DECISIONS.md: no dragging, no element creation, no asset management, no undo
 * stack, no multi-layout project.
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
 * ## The source is always the mock, and the page says so
 *
 * The runtime has a mock/MQTT seam. This app does not, on purpose: authoring must not require
 * hardware, the sensor host is off for days at a time, and an editor that needed a live relay to show
 * a readout would be an editor nobody could use. So `main.tsx` builds `createMockSource()`
 * unconditionally and the header says `mock data · generated here, not hardware` with
 * `data-perch-source-kind="mock"` on it — the same wording and the same attribute as the runtime's
 * chrome, because every screenshot in this repo is mock-driven and the only thing standing between
 * that fact and a misread image is the sentence being *in* the image.
 *
 * ## Switching with unsaved edits asks first
 *
 * Changing the picker while the draft differs from disk does not discard the edits. It parks the
 * request and shows a bar with an explicit discard. There is no undo in this slice, so a silent
 * discard is unrecoverable work — and the bar costs one piece of state where a confirmation dialog
 * would have cost a browser API that does not exist in jsdom.
 */

import { loadLayoutJson, type LayoutIssue, type LoadLayoutOptions } from '@perch/layout-schema';
import { normalizeSensorTopic, type SensorSource } from '@perch/sensor-contract';
import {
  LAYOUT_CANVAS_STYLES,
  MEDIA_FRAME_STYLES,
  READOUT_STYLES,
  SensorProvider,
  TEXT_BLOCK_STYLES,
  WIDGET_NAMES,
  WIDGET_REGISTRY,
} from '@perch/ui-kit';
import type { Rect } from '@perch/layout-schema';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { CANVAS_HANDLES_STYLES } from './canvas-handles.js';
import { canSave, draftSaved, editDraft, isDirty, openDraft, type DraftState } from './draft.js';
import { INSPECTOR_STYLES, Inspector } from './inspector.js';
import type { LayoutLibrary } from './layout-library.js';
import { setElementRect, type LayoutUpdate } from './layout-edits.js';
import { LAYOUT_PROBLEMS_STYLES, LayoutProblems } from './problems.js';
import { LayoutPreview, PREVIEW_STYLES, describePreviewFit } from './preview.js';
import { TOKEN_PANE_STYLES } from './token-pane.js';
import {
  HEADER_HEIGHT,
  INSPECTOR_WIDTH,
  PREVIEW_PADDING,
  usePreviewViewport,
} from './preview-viewport.js';
import { saveDraft, type SaveTransport } from './save.js';

/**
 * What every layout opened here is validated against.
 *
 * Identical to the runtime's `LOAD_OPTIONS`, and identical on purpose: the registry is
 * `WIDGET_REGISTRY` from `ui-kit` and the topic rule is `normalizeSensorTopic`, so the editor accepts
 * exactly the documents the runtime accepts. A stricter rule here would refuse layouts the panel can
 * draw; a looser one would let this editor save a file the panel then rejects, which is the failure
 * `SPEC.md` hard rule 2 names.
 *
 * The two apps cannot share the constant — `apps/` may not import `apps/` — so they share its
 * ingredients instead. That is the finding recorded in DECISIONS.md, not a divergence: both sides
 * name the same two exported values.
 */
const LOAD_OPTIONS: LoadLayoutOptions = Object.freeze({
  widgets: WIDGET_REGISTRY,
  isTopic: (topic: string) => normalizeSensorTopic(topic) !== null,
});

/** What the header says about where the numbers in the preview came from. */
const MOCK_PROVENANCE = 'mock data · generated here, not hardware';

/** A layout open for editing, or the reason one is not. */
type Opened =
  | { readonly ok: true; readonly state: DraftState }
  | {
      readonly ok: false;
      readonly name: string;
      readonly reason: string;
      readonly issues: readonly LayoutIssue[];
    };

/**
 * Open a named document from the library.
 *
 * Exported because it is the app's wiring decision — which loader, which options, what happens to a
 * file that is not a layout — and a test asserting "an invalid file shows its problems and paints
 * nothing" should be able to ask this directly rather than through a rendered tree.
 *
 * `loadLayoutJson`, not `validateLayout`: the text came from a file, so it is migrated forward first
 * and the steps are carried into the draft. See `draft.ts`.
 */
export function openLayoutByName(library: LayoutLibrary, name: string): Opened {
  const entry = library.entry(name);

  if (entry === undefined) {
    return {
      ok: false,
      name,
      reason:
        library.names.length === 0
          ? `there is no layout named "${name}", and the library is empty`
          : `there is no layout named "${name}". offered: ${library.names.join(', ')}`,
      issues: [],
    };
  }

  const loaded = loadLayoutJson(entry.text, LOAD_OPTIONS);

  if (!loaded.ok) {
    return {
      ok: false,
      name,
      reason: `layouts/${name}.json is not a valid layout, so there is nothing to edit yet`,
      issues: loaded.issues,
    };
  }

  return { ok: true, state: openDraft(name, loaded.layout, LOAD_OPTIONS, loaded.migrations) };
}

export interface EditorProps {
  /** Which layouts exist. Injected, so a test supplies its own two. */
  readonly library: LayoutLibrary;
  /** The readings the preview's widgets draw. Always the mock; see the module comment. */
  readonly source: SensorSource;
  /** Topic suggestions for the inspector. The mock source's own topics. */
  readonly topics: readonly string[];
  /** How a save reaches the filesystem. Injected, so a test can assert no request was made. */
  readonly transport: SaveTransport;
  /** Which layout to open first. Defaults to the library's first offered name. */
  readonly initialLayout?: string | undefined;
}

export function Editor({
  library,
  source,
  topics,
  transport,
  initialLayout,
}: EditorProps): ReactNode {
  return (
    <SensorProvider source={source}>
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
      <style href="perch-editor-inspector" precedence="default">
        {INSPECTOR_STYLES}
      </style>
      <style href="perch-editor-token-pane" precedence="default">
        {TOKEN_PANE_STYLES}
      </style>
      <style href="perch-editor-problems" precedence="default">
        {LAYOUT_PROBLEMS_STYLES}
      </style>
      <style href="perch-editor" precedence="default">
        {EDITOR_STYLES}
      </style>

      <EditorShell
        library={library}
        topics={topics}
        transport={transport}
        initialLayout={initialLayout}
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
  initialLayout,
}: Omit<EditorProps, 'source'>): ReactNode {
  const viewport = usePreviewViewport();

  /**
   * The name to open when nothing has been picked: the first offered layout, sorted.
   *
   * Defaulting rather than showing a chooser, for the reason the runtime gives: the common case is
   * `npm run dev` with no query string, and a first screen that made the interesting state — a layout
   * on screen — the one needing extra clicks would be the wrong way round. The name is in the picker,
   * so it is never ambiguous which file is open.
   */
  const firstName = initialLayout ?? library.names[0] ?? '';

  const [opened, setOpened] = useState<Opened>(() => openLayoutByName(library, firstName));
  const [selected, setSelected] = useState(0);
  /** A switch waiting on the author's decision about unsaved edits. `null` when there is none. */
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const open = useCallback(
    (name: string) => {
      setOpened(openLayoutByName(library, name));
      setSelected(0);
      setPendingName(null);
      setNotice('');
    },
    [library],
  );

  const onEdit = useCallback((update: LayoutUpdate) => {
    setOpened((current) =>
      current.ok ? { ok: true, state: editDraft(current.state, update) } : current,
    );
    // A stale "saved layouts/x.json" over a document that has since been edited reads as though the
    // edit is on disk. The edit clears it.
    setNotice('');
  }, []);

  /** A dragged or resized element's rect, as one edit. The same `editDraft` path as the field form. */
  const onRect = useCallback(
    (index: number, rect: Rect) => {
      onEdit(setElementRect(index, rect));
    },
    [onEdit],
  );

  const onPick = useCallback(
    (name: string) => {
      const dirty = opened.ok && isDirty(opened.state);
      if (dirty) {
        setPendingName(name);
        return;
      }
      open(name);
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
        // Read from the current state rather than the captured one: the author may have typed during
        // the write, and marking *that* document as on-disk would report a clean tree over unsaved
        // edits. Only the document actually written is recorded as saved.
        setOpened((current) =>
          current.ok && current.state.name === state.name
            ? { ok: true, state: draftSaved(current.state, outcome.written) }
            : current,
        );
      })
      .catch((error: unknown) => {
        setSaving(false);
        setNotice(
          `the save request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }, [opened, saving, transport]);

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

        <span
          className="perch-editor-item"
          data-testid="perch-editor-source"
          data-perch-source-kind="mock"
        >
          {MOCK_PROVENANCE}
        </span>

        <span className="perch-editor-spacer" />

        {dirty ? (
          <span className="perch-editor-dirty" data-testid="perch-editor-dirty">
            unsaved changes
          </span>
        ) : null}

        <button
          type="button"
          className="perch-editor-button"
          disabled={!opened.ok || !dirty}
          onClick={() => {
            open(name);
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
          {`"${name}" has unsaved changes. there is no undo in this slice, so switching to "${pendingName}" discards them.`}
          <button
            type="button"
            className="perch-editor-button"
            onClick={() => {
              open(pendingName);
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
        <main className="perch-editor-pane">
          {opened.ok ? (
            <LayoutPreview
              layout={opened.state.rendered}
              resolveAsset={library.resolveAsset}
              viewport={viewport}
              stale={opened.state.issues.length > 0}
              selected={selected}
              onSelect={setSelected}
              onRect={onRect}
            />
          ) : (
            <p className="perch-editor-empty" data-testid="perch-editor-unopened">
              {opened.reason}
            </p>
          )}
        </main>

        <aside className="perch-editor-side">
          <LayoutProblems
            issues={opened.ok ? opened.state.issues : opened.issues}
            onSelectElement={setSelected}
          />
          {opened.ok ? (
            <Inspector
              state={opened.state}
              selected={selected}
              onSelect={setSelected}
              onEdit={onEdit}
              topics={topics}
              widgets={WIDGET_NAMES}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
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
  gap: 8px;
  border-left: 1px solid #1b2028;
  background: #0d1016;
  overflow-y: auto;
  padding: 8px;
}
`;
