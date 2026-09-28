/**
 * Which command a key press reaches, if any (KEYBINDINGS.md sections 3 to 5). Pure: the provider
 * calls it from its one `keydown` listener, and a test calls it with a hand-made event.
 */

import { matchesChord, type KeyPress } from './binding.js';
import type { CommandId, Scope } from './commands.js';
import type { Keymap } from './keymap.js';
import { ownsKey } from './local-keys.js';

/** The attribute a region's scope is declared with. */
export const KEY_SCOPE_ATTRIBUTE = 'data-perch-keyscope';

/** Props that make an element a region of `scope`: `<main {...keyScope('canvas')}>`. */
export function keyScope(scope: Exclude<Scope, 'global'>): {
  readonly [KEY_SCOPE_ATTRIBUTE]: Scope;
} {
  return { [KEY_SCOPE_ATTRIBUTE]: scope };
}

export interface KeyEventLike extends KeyPress {
  readonly target: EventTarget | null;
  readonly defaultPrevented?: boolean;
  readonly isComposing?: boolean;
}

function isScope(value: string | null): value is Scope {
  return value === 'canvas' || value === 'sidebar';
}

/** The regions around `target`, innermost first, then `global`. */
export function activeScopes(target: EventTarget | null): readonly Scope[] {
  const scopes: Scope[] = [];
  let at = target instanceof Element ? target.closest(`[${KEY_SCOPE_ATTRIBUTE}]`) : null;
  while (at !== null) {
    const scope = at.getAttribute(KEY_SCOPE_ATTRIBUTE);
    if (isScope(scope)) scopes.push(scope);
    at = at.parentElement?.closest(`[${KEY_SCOPE_ATTRIBUTE}]`) ?? null;
  }
  scopes.push('global');

  return scopes;
}

/**
 * The command `event` runs: the first, trying the most specific active scope first and the registry's
 * order within one, that matches, is not held back by the target owning the key, and `isActive`.
 */
export function commandFor<Id extends string = CommandId>(
  event: KeyEventLike,
  keymap: Keymap<Id>,
  isActive: (id: Id) => boolean,
): Id | null {
  if (event.defaultPrevented === true || event.isComposing === true) return null;
  const owned = ownsKey(event.target, event.key);

  for (const scope of activeScopes(event.target)) {
    for (const command of keymap.commands) {
      if (!command.scopes.includes(scope)) continue;
      if (owned && !command.inFields) continue;
      if (!command.chords.some((chord) => matchesChord(event, chord))) continue;
      if (isActive(command.id)) return command.id;
    }
  }

  return null;
}
