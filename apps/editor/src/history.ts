/**
 * Undo and redo for the document under edit, as plain functions the store (`store.ts`) wraps.
 *
 * ## What a step holds
 *
 * A step is the draft *and what was derived from it*: `rendered` and `issues`. Restoring only the draft
 * and re-validating would give back the right problems, but `rendered` is "the last draft that
 * validated", which after an undo to an invalid draft is whatever validated before *that* — history,
 * not something a re-validation can recompute. So the three travel together.
 *
 * `saved` is deliberately not in a step. It is a fact about the disk, which an undo does not change, so
 * "unsaved changes" stays a comparison (`isDirty`) and follows an undo on its own: undoing back to the
 * document on disk reads clean, and undoing past it reads dirty again. A save never clears the history.
 *
 * ## Where one step ends
 *
 * Each edit arrives with a `gesture` key, or none. Consecutive edits with the same key are one step;
 * an edit with no key is always its own. The key is the shell's to decide (`edit-gestures.ts`): one
 * press of the pointer (a scrub, a colour drag), or one stay in a text field between focus and blur or
 * Enter. A canvas drag writes once, when it is let go, so it is one step with no key at all.
 *
 * An undo or redo ends the gesture in progress, so typing on after an undo starts a new step rather
 * than folding into one that no longer exists.
 */

import { sameDocument, type DraftState } from './draft.js';

/** How many steps back an author can go. The oldest is dropped past it. */
export const HISTORY_LIMIT = 200;

/** One document state an undo or redo returns to. */
export type HistoryEntry = Pick<DraftState, 'draft' | 'rendered' | 'issues'>;

export interface EditHistory {
  /** Oldest first: the last is where one undo goes. */
  readonly past: readonly HistoryEntry[];
  /** Nearest first: the first is where one redo goes. Emptied by any new edit. */
  readonly future: readonly HistoryEntry[];
  /** The gesture the newest step belongs to, while it can still grow. */
  readonly gesture: string | null;
}

export const EMPTY_HISTORY: EditHistory = Object.freeze({
  past: Object.freeze([]),
  future: Object.freeze([]),
  gesture: null,
});

function entryOf(state: DraftState): HistoryEntry {
  return { draft: state.draft, rendered: state.rendered, issues: state.issues };
}

function restore(state: DraftState, entry: HistoryEntry): DraftState {
  return { ...state, ...entry };
}

/**
 * The history after `before` became `after` through one edit.
 *
 * An edit that changed nothing records nothing. One continuing the newest step's gesture is folded
 * into it: the step keeps the state from before the gesture began.
 */
export function recordEdit(
  history: EditHistory,
  before: DraftState,
  after: DraftState,
  gesture: string | undefined,
): EditHistory {
  if (sameDocument(before.draft, after.draft)) return history;
  const key = gesture ?? null;
  if (key !== null && key === history.gesture && history.past.length > 0) {
    return { ...history, future: [] };
  }

  return {
    past: [...history.past, entryOf(before)].slice(-HISTORY_LIMIT),
    future: [],
    gesture: key,
  };
}

/** One step back from `state`, or `null` with nothing to undo. */
export function undoStep(
  history: EditHistory,
  state: DraftState,
): { readonly history: EditHistory; readonly state: DraftState } | null {
  const entry = history.past.at(-1);
  if (entry === undefined) return null;

  return {
    history: {
      past: history.past.slice(0, -1),
      future: [entryOf(state), ...history.future],
      gesture: null,
    },
    state: restore(state, entry),
  };
}

/** One step forward from `state`, or `null` with nothing to redo. */
export function redoStep(
  history: EditHistory,
  state: DraftState,
): { readonly history: EditHistory; readonly state: DraftState } | null {
  const [entry, ...rest] = history.future;
  if (entry === undefined) return null;

  return {
    history: { past: [...history.past, entryOf(state)], future: rest, gesture: null },
    state: restore(state, entry),
  };
}

/**
 * Which element is selected after the document went from `before` to `after`.
 *
 * Elements carry no id, so an element is followed by identity: edits rebuild only what they change, so
 * every other element is the same object on both sides, and one that moved is found where it went. One
 * the step itself rewrote is a new object in a list of the same length, so it keeps its index. In a
 * list that grew or shrank, one that cannot be found is gone, and nothing is selected.
 */
export function followSelection(
  selected: number,
  before: DraftState,
  after: DraftState,
  nothing: number,
): number {
  const element = before.draft.elements[selected];
  if (element === undefined) return nothing;
  const found = after.draft.elements.indexOf(element);
  if (found !== -1) return found;

  return after.draft.elements.length === before.draft.elements.length ? selected : nothing;
}
