/**
 * The editor's keybindings: one registry, one dispatcher, and the hooks that use them. The rules are
 * `apps/editor/KEYBINDINGS.md`.
 */

export {
  ariaChords,
  bindingText,
  chordOf,
  chordText,
  formatBinding,
  formatChord,
  matchesChord,
  parseBinding,
  shortcutHint,
  type KeyBinding,
  type KeyChord,
  type KeyPress,
} from './binding.js';
export {
  COMMANDS,
  type CommandId,
  type CommandSpec,
  type DefaultKeys,
  type Scope,
} from './commands.js';
export {
  KEY_SCOPE_ATTRIBUTE,
  activeScopes,
  commandFor,
  keyScope,
  type KeyEventLike,
} from './dispatch.js';
export {
  boundCommand,
  resolveKeymap,
  type BoundCommand,
  type KeybindingOverrides,
  type Keymap,
  type KeymapIssue,
} from './keymap.js';
export { isTextEntry, ownsKey } from './local-keys.js';
export {
  KeybindingsProvider,
  useCommand,
  useKeybinding,
  type ShownKeybinding,
} from './provider.js';
