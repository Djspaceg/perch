/**
 * Binding strings: parsing `Mod+Shift+Z`, turning one into each platform's keys, matching a key press
 * against those, and writing them for people and for `aria-keyshortcuts`. The rules are
 * KEYBINDINGS.md sections 2, 3 and 6; this file is their implementation and nothing more.
 *
 * Two shapes. A `KeyBinding` is what was written, `Mod` and all, and the same on every platform. A
 * `KeyChord` is what one platform holds down for it: `Mod` resolved to Meta or Control. Matching,
 * display and conflicts all work on chords, because `Mod+Y` and `Ctrl+Y` are the same keys off a Mac
 * and different ones on it.
 */

import type { Platform } from '../platform.js';

/** A binding as written. `key` is canonical: letters upper-case, named keys spelled as in the spec. */
export interface KeyBinding {
  readonly key: string;
  readonly mod: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
}

/** The keys one platform holds for a binding. */
export interface KeyChord {
  readonly key: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
}

/** The parts of a `KeyboardEvent` matching reads. */
export interface KeyPress {
  readonly key: string;
  readonly code?: string | undefined;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

type Modifier = 'mod' | 'ctrl' | 'alt' | 'shift' | 'meta';

/** Modifiers by their lower-cased name, in the order a binding is written. */
const MODIFIERS: Readonly<Record<string, Modifier>> = {
  mod: 'mod',
  ctrl: 'ctrl',
  alt: 'alt',
  shift: 'shift',
  meta: 'meta',
};

const NAMED_KEYS = [
  'Escape',
  'Enter',
  'Tab',
  'Space',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  ...Array.from({ length: 12 }, (_, index) => `F${String(index + 1)}`),
];

/** Named keys by their lower-cased name. */
const NAMED: ReadonlyMap<string, string> = new Map(
  NAMED_KEYS.map((name) => [name.toLowerCase(), name]),
);

/** Keys with a symbol of their own on a Mac. */
const MAC_KEYS: Readonly<Record<string, string>> = {
  Backspace: '⌫',
  Delete: '⌦',
  Escape: '⎋',
  Enter: '↩',
  Tab: '⇥',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** Whether `text` is one code point: `é` and `я` are, `Esc` is not. */
function isOneCharacter(text: string): boolean {
  const point = text.codePointAt(0);

  return point !== undefined && text.length === (point > 0xffff ? 2 : 1);
}

/** The canonical key a single token names, or `undefined` if it names none. */
function keyToken(token: string): string | undefined {
  const named = NAMED.get(token.toLowerCase());
  if (named !== undefined) return named;
  // One character, printable: not a space (that is `Space`) and not a control character.
  if (isOneCharacter(token) && token.trim() !== '' && !/\p{C}/u.test(token)) {
    return token.toUpperCase();
  }

  return undefined;
}

/** `text` as a binding, or `undefined` when it is not one (KEYBINDINGS.md section 2). */
export function parseBinding(text: string): KeyBinding | undefined {
  // `Mod++` and `+` bind the plus key: the last `+` is the key, not a separator.
  const plus = text === '+' || text.endsWith('++');
  const tokens = (plus ? text.slice(0, -1) : text).split('+');
  const last = tokens.pop();
  if (last === undefined) return undefined;
  const key = plus ? (last === '' ? '+' : undefined) : keyToken(last);
  if (key === undefined) return undefined;

  const held = new Set<Modifier>();
  for (const token of tokens) {
    const modifier = MODIFIERS[token.toLowerCase()];
    if (modifier === undefined || held.has(modifier)) return undefined;
    held.add(modifier);
  }
  // On one platform or the other, Mod is Ctrl or Meta: combined with either, it is one key twice.
  if (held.has('mod') && (held.has('ctrl') || held.has('meta'))) return undefined;

  return {
    key,
    mod: held.has('mod'),
    ctrl: held.has('ctrl'),
    alt: held.has('alt'),
    shift: held.has('shift'),
    meta: held.has('meta'),
  };
}

/** `binding` written canonically: `Mod+Ctrl+Alt+Shift+Meta+Key`, with only the modifiers held. */
export function bindingText(binding: KeyBinding): string {
  return [
    ...(binding.mod ? ['Mod'] : []),
    ...(binding.ctrl ? ['Ctrl'] : []),
    ...(binding.alt ? ['Alt'] : []),
    ...(binding.shift ? ['Shift'] : []),
    ...(binding.meta ? ['Meta'] : []),
    binding.key,
  ].join('+');
}

/** The keys `platform` holds for `binding`: Mod is Meta on a Mac and Control elsewhere. */
export function chordOf(binding: KeyBinding, platform: Platform): KeyChord {
  return {
    key: binding.key,
    ctrl: binding.ctrl || (binding.mod && platform === 'other'),
    alt: binding.alt,
    shift: binding.shift,
    meta: binding.meta || (binding.mod && platform === 'mac'),
  };
}

/** `chord` as one platform-free string, `Ctrl+Alt+Shift+Meta+Key`: what conflicts are keyed on. */
export function chordText(chord: KeyChord): string {
  return bindingText({ ...chord, mod: false });
}

/** Whether a press typed something other than an ASCII character, so its `key` names no letter. */
function typedNoAscii(key: string): boolean {
  if (key === 'Dead' || key === 'Unidentified') return true;

  return isOneCharacter(key) && (key.codePointAt(0) ?? 0) > 0x7e;
}

/** The canonical key of a press: its `key`, else its physical letter or digit where section 3 says. */
function pressedKeys(press: KeyPress): readonly string[] {
  const own = press.key === ' ' ? 'Space' : (keyToken(press.key) ?? press.key);
  if (!typedNoAscii(press.key) || press.code === undefined) return [own];
  const physical = /^(?:Key([A-Z])|Digit(\d))$/.exec(press.code);
  const fallback = physical?.[1] ?? physical?.[2];

  return fallback === undefined ? [own] : [own, fallback];
}

/** Whether `press` is exactly `chord`: its key, and its modifiers with none extra. */
export function matchesChord(press: KeyPress, chord: KeyChord): boolean {
  return (
    press.ctrlKey === chord.ctrl &&
    press.altKey === chord.alt &&
    press.shiftKey === chord.shift &&
    press.metaKey === chord.meta &&
    pressedKeys(press).includes(chord.key)
  );
}

/** `chord` as a person reads it on `platform`. */
export function formatChord(chord: KeyChord, platform: Platform): string {
  if (platform === 'mac') {
    return [
      chord.ctrl ? '⌃' : '',
      chord.alt ? '⌥' : '',
      chord.shift ? '⇧' : '',
      chord.meta ? '⌘' : '',
      MAC_KEYS[chord.key] ?? chord.key,
    ].join('');
  }

  return chordText(chord);
}

/** A binding string as a person reads it on `platform`; one that does not parse, as given. */
export function formatBinding(text: string, platform: Platform): string {
  const binding = parseBinding(text);

  return binding === undefined ? text : formatChord(chordOf(binding, platform), platform);
}

/** `chords` as `aria-keyshortcuts` spells them: key names, the platform's own modifier first. */
export function ariaChords(chords: readonly KeyChord[]): string {
  return chords
    .map((chord) =>
      [
        ...(chord.ctrl ? ['Control'] : []),
        ...(chord.meta ? ['Meta'] : []),
        ...(chord.alt ? ['Alt'] : []),
        ...(chord.shift ? ['Shift'] : []),
        chord.key,
      ].join('+'),
    )
    .join(' ');
}

/** A tooltip: `Redo (Ctrl+Shift+Z or Ctrl+Y)`, or the label alone when there are no keys. */
export function shortcutHint(
  label: string,
  chords: readonly KeyChord[],
  platform: Platform,
): string {
  if (chords.length === 0) return label;

  return `${label} (${chords.map((chord) => formatChord(chord, platform)).join(' or ')})`;
}
