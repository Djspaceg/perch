/**
 * Whether a key already means something where it was pressed (KEYBINDINGS.md section 5), so that no
 * shortcut takes it from there.
 *
 * - A text entry owns every key: typing, and the browser's own undo of the typing, are what the
 *   author means in a field.
 * - Escape backs out of the innermost thing: a field (a search box clears), a popover (it closes), a
 *   delete confirm (it keeps). Those own their Escape, even where they do not type text.
 *
 * Handlers that use a key also `preventDefault` it, and the dispatcher never takes a used key; this
 * is the check that does not depend on each of them remembering to.
 */

/** Input types that are pressed rather than typed into. */
const PRESSED_INPUTS = new Set(['button', 'checkbox', 'radio', 'reset', 'submit', 'image', 'file']);

const EDITABLE = '[contenteditable]:not([contenteditable="false"])';

/** Everything that owns its own Escape. The confirm's class is `reset-button.tsx`'s. */
const OWNS_ESCAPE = [
  'input',
  'textarea',
  'select',
  EDITABLE,
  '[role="dialog"]',
  '.perch-reset__confirm',
].join(', ');

/** Whether `target` is a field the author types into, with an undo of its own. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return !PRESSED_INPUTS.has(target.type);

  return target instanceof Element && target.closest(EDITABLE) !== null;
}

/** Whether a press of `key` at `target` belongs to the thing it was pressed in. */
export function ownsKey(target: EventTarget | null, key: string): boolean {
  if (isTextEntry(target)) return true;

  return key === 'Escape' && target instanceof Element && target.closest(OWNS_ESCAPE) !== null;
}
