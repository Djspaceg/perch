/**
 * The document being edited, and the one rule that governs it: **validate before saving.**
 *
 * `apps/editor/SPEC.md` hard rule 2 — "an editor that can produce a layout the runtime rejects is
 * broken" — is implemented here rather than in the save button, because a check that lives in a click
 * handler is a check a second click handler can skip. Every edit goes through `editDraft`, every
 * `editDraft` runs `validateLayout`, and `DraftState.issues` is the result. There is no path from a
 * keystroke to a file that does not pass through this function.
 *
 * ## Three layouts, not one
 *
 * `DraftState` holds the draft the form is bound to *and* the last draft that validated, and the
 * distinction is the whole design:
 *
 * - **`draft`** is what the controls read and write. It is a `Layout` by type and frequently not one
 *   by the format's rules — a half-typed number, a blanked text element, a token value with a
 *   semicolon in it. See `layout-edits.ts` for why that is representable and wanted.
 * - **`rendered`** is the last `draft` that validated, *as the validator rebuilt it*. This is what the
 *   preview paints, and painting this rather than `draft` is what makes the preview honest: the
 *   runtime renders only documents that came out of `validateLayout`, so a preview that rendered the
 *   raw draft would be showing pixels for a document the runtime would have refused outright. While
 *   the draft is invalid the preview holds still and the problem list says why, which is the same
 *   arrangement the runtime has — canvas or refusal, never a half-painted canvas.
 * - **`saved`** is the document as it currently is on disk, so `dirty` is a comparison rather than a
 *   flag something has to remember to set. A flag gets out of step the first time an edit is undone by
 *   editing back to the original value; a comparison cannot.
 *
 * `rendered` is the validator's *output*, never the input that produced it. `validateLayout` rebuilds
 * from checked values and drops nothing silently, so the rebuilt object is byte-identical to what will
 * be written and to what the runtime will load — which is what makes "the preview shows what the panel
 * gets" a property of the code rather than an aspiration.
 *
 * ## Why `validateLayout` and not `loadLayout`
 *
 * `layout-schema`'s own note assigns them: `loadLayout` is for a document from outside, which is
 * migrated forward and then validated; `validateLayout` is for a document already known to be at the
 * current version, "which is the editor's case". Both happen here, at different moments. `openDraft`
 * is handed the output of `loadLayoutJson` — the file came off disk, so it was migrated — and
 * everything after that is `validateLayout`, because the draft is already at
 * `LAYOUT_SCHEMA_VERSION` and a draft that failed to migrate is not a state a form can be bound to.
 *
 * That has a consequence worth stating plainly rather than discovering: **both shipped layouts are
 * `schemaVersion` 1, and saving one writes `schemaVersion` 2.** The migration from 1 to 2 changes no
 * field (it exists to make the version number carry the `chart` element kind), so nothing else in the
 * file moves — but the version line does, and it is the editor that moves it. `DraftState.migrations`
 * carries the report so the editor can say so on screen before the author saves, rather than the
 * author finding a version bump in a diff they did not ask for.
 */

import {
  formatMigrationReport,
  validateLayout,
  type Layout,
  type LayoutIssue,
  type LayoutMigrationStep,
  type ValidateLayoutOptions,
} from '@perch/layout-schema';
import type { LayoutUpdate } from './layout-edits.js';

/** The document under edit, with everything the UI needs derived rather than remembered. */
export interface DraftState {
  /** The layout name, as the picker and the save endpoint both spell it. */
  readonly name: string;
  /** What the form is bound to. A `Layout` by type; not necessarily one by the format's rules. */
  readonly draft: Layout;
  /**
   * The last draft that validated, as the validator rebuilt it. What the preview paints and what a
   * save would write.
   */
  readonly rendered: Layout;
  /** The document as it is on disk, for `dirty`. */
  readonly saved: Layout;
  /**
   * What every edit to this draft is validated against.
   *
   * Carried on the state rather than passed to `editDraft`, so the registry and topic rule a document
   * was *opened* under are the ones every later edit is judged by. Two call sites passing options
   * separately is how an element gets accepted on open and refused on the next keystroke for reasons
   * the author did not cause.
   */
  readonly options: ValidateLayoutOptions;
  /** Every reason `draft` is not a layout. Empty means it is one, and a save may proceed. */
  readonly issues: readonly LayoutIssue[];
  /**
   * What `loadLayout` had to do to the file to reach the current schema version, as one line, or `''`
   * when the file was already current. Reported on screen; see the module comment.
   */
  readonly migrations: string;
}

/** Whether the draft differs from what is on disk. */
export function isDirty(state: DraftState): boolean {
  return !sameDocument(state.draft, state.saved);
}

/** Whether a save may proceed: the draft validated, and there is something to write. */
export function canSave(state: DraftState): boolean {
  return state.issues.length === 0 && isDirty(state);
}

/**
 * Open a layout for editing.
 *
 * `layout` must have come through `loadLayout`/`loadLayoutJson`, so it is already at the current
 * schema version. It is validated again here rather than trusted, which costs nothing at these sizes
 * and means `rendered` is the validator's own rebuild on the first frame exactly as on every frame
 * after it — no branch where the preview paints an object that took a different path.
 *
 * A document that fails *this* validation is not a programming error and is not thrown on: the
 * elements it contains still came from a real file, and the editor's job at that point is to show the
 * author what is wrong with it. `rendered` falls back to the layout as given, which is the only
 * pixels available, and `issues` carries the reasons.
 */
export function openDraft(
  name: string,
  layout: Layout,
  options: ValidateLayoutOptions,
  migrations: readonly LayoutMigrationStep[] = [],
): DraftState {
  const result = validateLayout(layout, options);

  return {
    name,
    draft: layout,
    rendered: result.ok ? result.layout : layout,
    saved: layout,
    options,
    issues: result.ok ? [] : result.issues,
    migrations: migrations.length === 0 ? '' : formatMigrationReport(migrations),
  };
}

/**
 * Apply one edit, and re-decide everything that follows from it.
 *
 * The single gate. `update` is a pure `Layout -> Layout` from `layout-edits.ts`; this function owns
 * the validation, the preview's hold-last-valid behaviour and nothing else.
 */
export function editDraft(state: DraftState, update: LayoutUpdate): DraftState {
  const draft = update(state.draft);
  const result = validateLayout(draft, state.options);

  return {
    ...state,
    draft,
    rendered: result.ok ? result.layout : state.rendered,
    issues: result.ok ? [] : result.issues,
  };
}

/**
 * Mark the draft as written to disk.
 *
 * Takes the document that was actually written rather than reading `state.rendered`, so "what is on
 * disk" can only be set from the value the save path serialized. A `saved` derived from the draft
 * instead would report a clean tree after a write that failed halfway.
 */
export function draftSaved(state: DraftState, written: Layout): DraftState {
  return { ...state, saved: written, migrations: '' };
}

/**
 * Whether two layouts are the same document.
 *
 * Compared as canonical JSON rather than field by field. Both sides came out of `validateLayout` or
 * out of an edit over one that did, so both are plain data with no cycles, no `undefined` values and
 * no key a `JSON.stringify` round trip would drop — the exact property `layout-schema` rebuilds its
 * result to guarantee. Key *order* therefore has to match too, and it does: an edit rebuilds each
 * object by spreading the original, which preserves insertion order.
 *
 * `NaN` is the one value where this is load-bearing in an unobvious direction. `JSON.stringify` writes
 * it as `null`, so two drafts differing only in which field holds a `NaN` would compare equal — but a
 * draft containing one never validates, so it can never reach a save, and `dirty` being briefly wrong
 * about an unsaveable document changes nothing a user can act on.
 */
export function sameDocument(left: Layout, right: Layout): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
