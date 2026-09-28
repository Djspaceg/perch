/**
 * Which platform the editor is on, and how a shortcut is written for it: glyphs on a Mac, words
 * elsewhere, and the `aria-keyshortcuts` spelling, which is the same everywhere.
 */

import { describe, expect, it } from 'vitest';
import { ariaKeys, detectPlatform, formatKeys, shortcutHint, type KeyCombo } from './platform.js';

describe('detectPlatform', () => {
  it('reads userAgentData first', () => {
    expect(detectPlatform({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe('mac');
    expect(detectPlatform({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' })).toBe(
      'other',
    );
    expect(detectPlatform({ userAgentData: { platform: 'Linux' } })).toBe('other');
  });

  it('falls back to navigator.platform, counting iPhone and iPad as Mac', () => {
    for (const platform of ['MacIntel', 'iPhone', 'iPad']) {
      expect(detectPlatform({ userAgentData: { platform: '' }, platform }), platform).toBe('mac');
    }
    for (const platform of ['Win32', 'Linux x86_64']) {
      expect(detectPlatform({ platform }), platform).toBe('other');
    }
  });

  it('falls back to the userAgent when both are empty', () => {
    expect(
      detectPlatform({
        platform: '',
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
      }),
    ).toBe('mac');
    expect(
      detectPlatform({ platform: '', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }),
    ).toBe('other');
    expect(detectPlatform({})).toBe('other');
    expect(detectPlatform(undefined)).toBe('other');
  });
});

describe('formatKeys', () => {
  const undo: KeyCombo = { key: 'z', meta: true };
  const redo: KeyCombo = { key: 'z', meta: true, shift: true };

  it('writes a Mac shortcut in glyphs, in the order the menus use', () => {
    expect(formatKeys(undo, 'mac')).toBe('⌘Z');
    expect(formatKeys(redo, 'mac')).toBe('⇧⌘Z');
    expect(formatKeys({ key: 'z', ctrl: true, alt: true, shift: true, meta: true }, 'mac')).toBe(
      '⌃⌥⇧⌘Z',
    );
    expect(formatKeys({ key: 'Backspace' }, 'mac')).toBe('⌫');
  });

  it('writes any other shortcut in words joined by plus', () => {
    expect(formatKeys({ key: 'z', ctrl: true }, 'other')).toBe('Ctrl+Z');
    expect(formatKeys({ key: 'z', ctrl: true, shift: true }, 'other')).toBe('Ctrl+Shift+Z');
    expect(formatKeys({ key: 'y', ctrl: true, alt: true }, 'other')).toBe('Ctrl+Alt+Y');
    expect(formatKeys({ key: 'Backspace' }, 'other')).toBe('Backspace');
  });
});

describe('ariaKeys', () => {
  it('spells each combination the way aria-keyshortcuts does, space-separated', () => {
    expect(ariaKeys([{ key: 'z', meta: true }])).toBe('Meta+Z');
    expect(ariaKeys([{ key: 'z', meta: true, shift: true }])).toBe('Meta+Shift+Z');
    expect(
      ariaKeys([
        { key: 'z', ctrl: true, shift: true },
        { key: 'y', ctrl: true },
      ]),
    ).toBe('Control+Shift+Z Control+Y');
  });
});

describe('shortcutHint', () => {
  it('names the action with its first combination, and any others as alternatives', () => {
    expect(shortcutHint('Undo', [{ key: 'z', meta: true }], 'mac')).toBe('Undo (⌘Z)');
    expect(
      shortcutHint(
        'Redo',
        [
          { key: 'z', ctrl: true, shift: true },
          { key: 'y', ctrl: true },
        ],
        'other',
      ),
    ).toBe('Redo (Ctrl+Shift+Z or Ctrl+Y)');
  });
});
