/**
 * The dispatcher and its hooks (KEYBINDINGS.md sections 4 to 6).
 *
 * `KeybindingsProvider` sits at the editor's root and installs the editor's one `keydown` listener,
 * on `window` and in the bubble phase, so every handler nearer the key — a control's own `onKeyDown`,
 * a popover's document-level Escape — has had its turn, and marked the event used, before a shortcut
 * is looked for. It resolves the press to at most one command (`commandFor`), calls that command's
 * handler, and `preventDefault`s only then: a key no handler took reaches the browser.
 *
 * - `useCommand(id, handler, { enabled })` registers `handler` for as long as the component is
 *   mounted and `enabled`. The latest render's handler is the one called. Two components registering
 *   one id: the one registered last runs.
 * - `useKeybinding(id)` is what a button shows: the label, the keys in effect on this platform, a
 *   tooltip and `aria-keyshortcuts`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { Platform } from '../platform.js';
import { ariaChords, formatChord, shortcutHint } from './binding.js';
import { COMMANDS, type CommandId } from './commands.js';
import { commandFor } from './dispatch.js';
import { boundCommand, resolveKeymap, type KeybindingOverrides, type Keymap } from './keymap.js';

type Handler = (event: KeyboardEvent) => void;

interface Keybindings {
  readonly keymap: Keymap;
  readonly register: (id: CommandId, handler: { readonly current: Handler }) => () => void;
}

const KeybindingsContext = createContext<Keybindings | null>(null);

function useKeybindings(hook: string): Keybindings {
  const found = useContext(KeybindingsContext);
  if (found === null) throw new Error(`${hook} needs a KeybindingsProvider above it`);

  return found;
}

export function KeybindingsProvider({
  platform,
  overrides,
  children,
}: {
  readonly platform: Platform;
  readonly overrides: KeybindingOverrides;
  readonly children: ReactNode;
}): ReactNode {
  const keymap = useMemo(() => resolveKeymap(COMMANDS, overrides, platform), [overrides, platform]);
  const handlers = useRef(new Map<CommandId, { readonly current: Handler }[]>());

  const register = useCallback((id: CommandId, handler: { readonly current: Handler }) => {
    const list = handlers.current.get(id) ?? [];
    handlers.current.set(id, [...list, handler]);

    return () => {
      handlers.current.set(
        id,
        (handlers.current.get(id) ?? []).filter((held) => held !== handler),
      );
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const id = commandFor(
        event,
        keymap,
        (command) => (handlers.current.get(command)?.length ?? 0) > 0,
      );
      const handler = id === null ? undefined : handlers.current.get(id)?.at(-1);
      if (handler === undefined) return;
      event.preventDefault();
      handler.current(event);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [keymap]);

  const value = useMemo(() => ({ keymap, register }), [keymap, register]);

  return <KeybindingsContext.Provider value={value}>{children}</KeybindingsContext.Provider>;
}

/** Run `handler` when command `id`'s keys are pressed where it acts, while mounted and `enabled`. */
export function useCommand(
  id: CommandId,
  handler: Handler,
  { enabled = true }: { readonly enabled?: boolean } = {},
): void {
  const { register } = useKeybindings('useCommand');
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => (enabled ? register(id, latest) : undefined), [enabled, id, register]);
}

export interface ShownKeybinding {
  readonly label: string;
  /** The canonical binding strings in effect, first shown first. */
  readonly bindings: readonly string[];
  /** The same, as this platform writes them: `⇧⌘Z`, `Ctrl+Y`. */
  readonly keys: readonly string[];
  /** A tooltip: `Redo (Ctrl+Shift+Z or Ctrl+Y)`. */
  readonly hint: string;
  /** For `aria-keyshortcuts`; `undefined` with no keys, so the attribute is left off. */
  readonly ariaKeyShortcuts: string | undefined;
}

/** Command `id` as a button shows it on this platform, overrides included. */
export function useKeybinding(id: CommandId): ShownKeybinding {
  const { keymap } = useKeybindings('useKeybinding');

  return useMemo(() => {
    const command = boundCommand(keymap, id);

    return {
      label: command.label,
      bindings: command.bindings,
      keys: command.chords.map((chord) => formatChord(chord, keymap.platform)),
      hint: shortcutHint(command.label, command.chords, keymap.platform),
      ariaKeyShortcuts: command.chords.length === 0 ? undefined : ariaChords(command.chords),
    };
  }, [keymap, id]);
}
