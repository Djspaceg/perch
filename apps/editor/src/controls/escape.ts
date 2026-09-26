/**
 * Whether an Escape pressed at `target` already means something there.
 *
 * Escape backs out of the innermost thing: a field (a search box clears, a text input is being typed
 * in), a popover (it closes), a delete confirm (it keeps). Only when none of those holds focus may a
 * pane-level Escape — the editor's "deselect" — act, and it must never act as well. Handlers that use
 * the key also `preventDefault` it; this is the check that does not depend on each of them
 * remembering to.
 */

/** Everything that owns its own Escape. The confirm's class is `reset-button.tsx`'s. */
const OWNS_ESCAPE = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="dialog"]',
  '.perch-reset__confirm',
].join(', ');

export function escapeIsTaken(target: Element): boolean {
  return target.closest(OWNS_ESCAPE) !== null;
}
