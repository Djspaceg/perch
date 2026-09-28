/**
 * The keymap: the registry's defaults for one platform with the author's overrides laid over them, and
 * everything wrong with those overrides as data (KEYBINDINGS.md section 7). Pure, so a rebinding UI
 * can call it on a draft of the overrides and show the problems before saving any of them.
 *
 * Generic over the registry, so a test brings its own commands; the editor passes `COMMANDS`.
 */

import type { Platform } from '../platform.js';
import { bindingText, chordOf, chordText, parseBinding, type KeyChord } from './binding.js';
import type { CommandId, CommandSpec, Scope } from './commands.js';

/** Command id to the bindings that replace its defaults. `[]` unbinds; absent keeps the defaults. */
export type KeybindingOverrides = Readonly<Record<string, readonly string[]>>;

/** One command as the dispatcher and the hooks see it on one platform. */
export interface BoundCommand<Id extends string = CommandId> {
  readonly id: Id;
  readonly label: string;
  /** `['global']`, or the regions it acts in. */
  readonly scopes: readonly Scope[];
  /** Canonical binding strings, first shown first. */
  readonly bindings: readonly string[];
  /** `bindings` as this platform's keys, one each. */
  readonly chords: readonly KeyChord[];
  readonly inFields: boolean;
  readonly overridden: boolean;
}

export type KeymapIssue<Id extends string = CommandId> =
  | { readonly kind: 'invalid'; readonly command: Id; readonly binding: string }
  | { readonly kind: 'reserved'; readonly command: Id; readonly binding: string }
  | { readonly kind: 'unknown'; readonly command: string }
  | {
      readonly kind: 'conflict';
      /** The keys both are bound to, as `chordText` writes them. */
      readonly chord: string;
      /** In registry order. */
      readonly commands: readonly [Id, Id];
      /** Where both act on it. */
      readonly scopes: readonly Scope[];
      /** The one that gets the key there. */
      readonly winner: Id;
    };

export interface Keymap<Id extends string = CommandId> {
  readonly platform: Platform;
  /** In registry order. */
  readonly commands: readonly BoundCommand<Id>[];
  readonly issues: readonly KeymapIssue<Id>[];
}

/** Plain keys the controls use as their own (section 1), which no override may take. */
const RESERVED_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Enter',
  'Space',
  'Tab',
]);

const REGIONS: readonly Scope[] = ['canvas', 'sidebar'];

function scopesOf(spec: CommandSpec): readonly Scope[] {
  const scopes: readonly Scope[] = typeof spec.scope === 'string' ? [spec.scope] : spec.scope;

  return scopes.includes('global') ? ['global'] : scopes;
}

function defaultsOf(spec: CommandSpec, platform: Platform): readonly string[] {
  return 'mac' in spec.keys ? spec.keys[platform] : spec.keys;
}

/** The registry's defaults for `platform`, with `overrides` over them. */
export function resolveKeymap<Id extends string>(
  defaults: Readonly<Record<Id, CommandSpec>>,
  overrides: KeybindingOverrides,
  platform: Platform,
): Keymap<Id> {
  const issues: KeymapIssue<Id>[] = [];
  const ids = Object.keys(defaults) as Id[];

  for (const id of Object.keys(overrides)) {
    if (!Object.hasOwn(defaults, id)) issues.push({ kind: 'unknown', command: id });
  }

  const commands = ids.map((id): BoundCommand<Id> => {
    const spec = defaults[id];
    const override = Object.hasOwn(overrides, id) ? overrides[id] : undefined;
    const bindings: string[] = [];
    const chords: KeyChord[] = [];
    for (const text of override ?? defaultsOf(spec, platform)) {
      const binding = parseBinding(text);
      if (binding === undefined) {
        // A default that does not parse is a bug `keymap.test.ts` catches; reported the same way.
        issues.push({ kind: 'invalid', command: id, binding: text });
        continue;
      }
      const plain = !binding.mod && !binding.ctrl && !binding.alt && !binding.meta;
      if (override !== undefined && plain && RESERVED_KEYS.has(binding.key)) {
        issues.push({ kind: 'reserved', command: id, binding: text });
        continue;
      }
      const chord = chordOf(binding, platform);
      if (chords.some((held) => chordText(held) === chordText(chord))) continue;
      bindings.push(bindingText(binding));
      chords.push(chord);
    }

    return {
      id,
      label: spec.label,
      scopes: scopesOf(spec),
      bindings,
      chords,
      inFields: spec.inFields === true,
      overridden: override !== undefined,
    };
  });

  for (const [index, first] of commands.entries()) {
    for (const second of commands.slice(index + 1)) {
      const shared = sharedScopes(first.scopes, second.scopes);
      if (shared.length === 0) continue;
      const winner =
        first.scopes.includes('global') && !second.scopes.includes('global') ? second.id : first.id;
      const theirs = new Set(second.chords.map(chordText));
      for (const chord of first.chords.map(chordText)) {
        if (!theirs.has(chord)) continue;
        issues.push({
          kind: 'conflict',
          chord,
          commands: [first.id, second.id],
          scopes: shared,
          winner,
        });
      }
    }
  }

  return { platform, commands, issues };
}

/** Where two commands both act. `global` meets every region there. */
function sharedScopes(a: readonly Scope[], b: readonly Scope[]): readonly Scope[] {
  if (a.includes('global') && b.includes('global')) return ['global'];
  if (a.includes('global')) return b;
  if (b.includes('global')) return a;

  return REGIONS.filter((scope) => a.includes(scope) && b.includes(scope));
}

/** The command `id` in `keymap`. Every registry id is in its keymap, so this never misses. */
export function boundCommand<Id extends string>(keymap: Keymap<Id>, id: Id): BoundCommand<Id> {
  const found = keymap.commands.find((command) => command.id === id);
  if (found === undefined) throw new Error(`no command ${id} in the keymap`);

  return found;
}
