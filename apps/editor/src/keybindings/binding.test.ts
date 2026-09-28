/**
 * The binding grammar (KEYBINDINGS.md sections 2, 3 and 6): what parses and to what, how one binding
 * becomes each platform's keys, which presses match them, and how they are written for people and for
 * `aria-keyshortcuts`.
 */

import { describe, expect, it } from 'vitest';
import {
  ariaChords,
  bindingText,
  chordOf,
  chordText,
  formatBinding,
  formatChord,
  matchesChord,
  parseBinding,
  shortcutHint,
  type KeyChord,
} from './binding.js';

function parsed(text: string): string | undefined {
  const binding = parseBinding(text);

  return binding === undefined ? undefined : bindingText(binding);
}

function chord(text: string, platform: 'mac' | 'other'): KeyChord {
  const binding = parseBinding(text);
  if (binding === undefined) throw new Error(`${text} does not parse`);

  return chordOf(binding, platform);
}

interface Press {
  readonly key: string;
  readonly code?: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
}

function press({
  metaKey = false,
  ctrlKey = false,
  shiftKey = false,
  altKey = false,
  ...rest
}: Press) {
  return { metaKey, ctrlKey, shiftKey, altKey, ...rest };
}

describe('parseBinding', () => {
  it('reads modifiers and a key, canonically, whatever the case and order', () => {
    expect(parsed('Mod+Z')).toBe('Mod+Z');
    expect(parsed('mod+shift+z')).toBe('Mod+Shift+Z');
    expect(parsed('Shift+Mod+Z')).toBe('Mod+Shift+Z');
    expect(parsed('shift+meta+alt+ctrl+k')).toBe('Ctrl+Alt+Shift+Meta+K');
    expect(parsed('Ctrl+Y')).toBe('Ctrl+Y');
  });

  it('reads named keys, in any case, and single characters', () => {
    expect(parsed('Delete')).toBe('Delete');
    expect(parsed('backspace')).toBe('Backspace');
    expect(parsed('ESCAPE')).toBe('Escape');
    expect(parsed('Mod+arrowup')).toBe('Mod+ArrowUp');
    expect(parsed('F12')).toBe('F12');
    expect(parsed('Space')).toBe('Space');
    expect(parsed('Mod+/')).toBe('Mod+/');
    expect(parsed('Mod+1')).toBe('Mod+1');
    expect(parsed('Alt+é')).toBe('Alt+É');
  });

  it('writes the plus key as a trailing plus', () => {
    expect(parsed('Mod++')).toBe('Mod++');
    expect(parsed('+')).toBe('+');
    expect(parseBinding('Mod++')?.key).toBe('+');
  });

  it('refuses what is not a binding', () => {
    for (const text of [
      '',
      'Mod',
      'Mod+',
      'Shift+Shift+Z',
      'Mod+Ctrl+Z',
      'Mod+Meta+Z',
      'Hyper+Z',
      'Mod+Esc',
      'Mod+ZZ',
      'Mod+Z+X',
      'F13',
      ' ',
      'Mod+ ',
    ]) {
      expect(parseBinding(text), JSON.stringify(text)).toBeUndefined();
    }
  });
});

describe('chordOf: Mod is each platform`s own modifier', () => {
  it('is Meta on a Mac and Control elsewhere', () => {
    expect(chordText(chord('Mod+Z', 'mac'))).toBe('Meta+Z');
    expect(chordText(chord('Mod+Z', 'other'))).toBe('Ctrl+Z');
    expect(chordText(chord('Mod+Shift+Z', 'mac'))).toBe('Shift+Meta+Z');
  });

  it('leaves Ctrl and Meta literal on every platform', () => {
    expect(chordText(chord('Ctrl+Y', 'mac'))).toBe('Ctrl+Y');
    expect(chordText(chord('Ctrl+Y', 'other'))).toBe('Ctrl+Y');
    expect(chordText(chord('Meta+K', 'other'))).toBe('Meta+K');
  });
});

describe('matchesChord', () => {
  it('matches letters in either case, with exactly the modifiers held', () => {
    const undo = chord('Mod+Z', 'mac');
    expect(matchesChord(press({ key: 'z', metaKey: true }), undo)).toBe(true);
    expect(matchesChord(press({ key: 'Z', metaKey: true }), undo)).toBe(true);
    expect(matchesChord(press({ key: 'z', metaKey: true, altKey: true }), undo)).toBe(false);
    expect(matchesChord(press({ key: 'z', metaKey: true, shiftKey: true }), undo)).toBe(false);
    expect(matchesChord(press({ key: 'z', ctrlKey: true }), undo)).toBe(false);
    expect(matchesChord(press({ key: 'z' }), undo)).toBe(false);
  });

  it('matches named keys and Space', () => {
    expect(matchesChord(press({ key: 'Delete' }), chord('Delete', 'other'))).toBe(true);
    expect(matchesChord(press({ key: 'Backspace' }), chord('Delete', 'other'))).toBe(false);
    expect(matchesChord(press({ key: ' ' }), chord('Mod+Space', 'other'))).toBe(false);
    expect(matchesChord(press({ key: ' ', ctrlKey: true }), chord('Mod+Space', 'other'))).toBe(
      true,
    );
  });

  it('falls back to the physical key only when no ASCII character was typed', () => {
    const undo = chord('Mod+Z', 'other');
    // A Cyrillic layout types я on the Z key.
    expect(matchesChord(press({ key: 'я', code: 'KeyZ', ctrlKey: true }), undo)).toBe(true);
    // A Mac's Option layer, and a dead key.
    const option = chord('Alt+E', 'mac');
    expect(matchesChord(press({ key: '€', code: 'KeyE', altKey: true }), option)).toBe(true);
    expect(matchesChord(press({ key: 'Dead', code: 'KeyE', altKey: true }), option)).toBe(true);
    expect(
      matchesChord(press({ key: '¡', code: 'Digit1', altKey: true }), chord('Alt+1', 'mac')),
    ).toBe(true);
    // AZERTY types w on the key where QWERTY has Z: that is Ctrl-W, never Ctrl-Z.
    expect(matchesChord(press({ key: 'w', code: 'KeyZ', ctrlKey: true }), undo)).toBe(false);
  });
});

describe('formatChord and formatBinding', () => {
  it('write a Mac shortcut in glyphs, in the order the menus use', () => {
    expect(formatBinding('Mod+Z', 'mac')).toBe('⌘Z');
    expect(formatBinding('Mod+Shift+Z', 'mac')).toBe('⇧⌘Z');
    expect(formatBinding('Ctrl+Alt+Shift+Meta+Z', 'mac')).toBe('⌃⌥⇧⌘Z');
    expect(formatBinding('Backspace', 'mac')).toBe('⌫');
    expect(formatBinding('Delete', 'mac')).toBe('⌦');
    expect(formatBinding('Escape', 'mac')).toBe('⎋');
    expect(formatBinding('Mod+ArrowUp', 'mac')).toBe('⌘↑');
  });

  it('write any other shortcut in words joined by plus', () => {
    expect(formatBinding('Mod+Z', 'other')).toBe('Ctrl+Z');
    expect(formatBinding('Mod+Shift+Z', 'other')).toBe('Ctrl+Shift+Z');
    expect(formatBinding('Ctrl+Alt+Y', 'other')).toBe('Ctrl+Alt+Y');
    expect(formatBinding('Backspace', 'other')).toBe('Backspace');
    expect(formatBinding('Meta+K', 'other')).toBe('Meta+K');
    expect(formatChord(chord('Mod++', 'other'), 'other')).toBe('Ctrl++');
  });

  it('hand back a string that does not parse as it was given', () => {
    expect(formatBinding('Hyper+Z', 'mac')).toBe('Hyper+Z');
  });
});

describe('ariaChords', () => {
  it('spells each combination the way aria-keyshortcuts does, space-separated', () => {
    expect(ariaChords([chord('Mod+Z', 'mac')])).toBe('Meta+Z');
    expect(ariaChords([chord('Mod+Shift+Z', 'mac')])).toBe('Meta+Shift+Z');
    expect(ariaChords([chord('Mod+Shift+Z', 'other'), chord('Ctrl+Y', 'other')])).toBe(
      'Control+Shift+Z Control+Y',
    );
    expect(ariaChords([chord('Delete', 'mac'), chord('Space', 'mac')])).toBe('Delete Space');
  });
});

describe('shortcutHint', () => {
  it('names the action with its first combination, and any others as alternatives', () => {
    expect(shortcutHint('Undo', [chord('Mod+Z', 'mac')], 'mac')).toBe('Undo (⌘Z)');
    expect(
      shortcutHint('Redo', [chord('Mod+Shift+Z', 'other'), chord('Ctrl+Y', 'other')], 'other'),
    ).toBe('Redo (Ctrl+Shift+Z or Ctrl+Y)');
    expect(shortcutHint('Deselect', [], 'other')).toBe('Deselect');
  });
});
