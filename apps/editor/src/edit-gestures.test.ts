/**
 * The undo and redo keys, per platform: each platform's own combinations act, and every other
 * combination, the other platform's included, does nothing.
 */

import { describe, expect, it } from 'vitest';
import { HISTORY_SHORTCUTS, historyShortcut } from './edit-gestures.js';

interface Press {
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
}

function press({
  key,
  metaKey = false,
  ctrlKey = false,
  shiftKey = false,
  altKey = false,
}: Press): Parameters<typeof historyShortcut>[0] {
  return { key, metaKey, ctrlKey, shiftKey, altKey };
}

describe('on a Mac', () => {
  it('undoes with Cmd-Z and redoes with Shift-Cmd-Z', () => {
    expect(historyShortcut(press({ key: 'z', metaKey: true }), 'mac')).toBe('undo');
    expect(historyShortcut(press({ key: 'Z', metaKey: true, shiftKey: true }), 'mac')).toBe('redo');
  });

  it('ignores Ctrl-Z, Ctrl-Shift-Z, Ctrl-Y, Cmd-Y and extra modifiers', () => {
    for (const ignored of [
      { key: 'z', ctrlKey: true },
      { key: 'Z', ctrlKey: true, shiftKey: true },
      { key: 'y', ctrlKey: true },
      { key: 'y', metaKey: true },
      { key: 'z', metaKey: true, ctrlKey: true },
      { key: 'z', metaKey: true, altKey: true },
      { key: 'z' },
    ]) {
      expect(historyShortcut(press(ignored), 'mac'), JSON.stringify(ignored)).toBeNull();
    }
  });
});

describe('on Windows and Linux', () => {
  it('undoes with Ctrl-Z and redoes with Ctrl-Shift-Z or Ctrl-Y', () => {
    expect(historyShortcut(press({ key: 'z', ctrlKey: true }), 'other')).toBe('undo');
    expect(historyShortcut(press({ key: 'Z', ctrlKey: true, shiftKey: true }), 'other')).toBe(
      'redo',
    );
    expect(historyShortcut(press({ key: 'y', ctrlKey: true }), 'other')).toBe('redo');
  });

  it('ignores Meta combinations, Ctrl-Shift-Y and extra modifiers', () => {
    for (const ignored of [
      { key: 'z', metaKey: true },
      { key: 'Z', metaKey: true, shiftKey: true },
      { key: 'z', metaKey: true, ctrlKey: true },
      { key: 'y', metaKey: true },
      { key: 'Y', ctrlKey: true, shiftKey: true },
      { key: 'z', ctrlKey: true, altKey: true },
      { key: 'z' },
    ]) {
      expect(historyShortcut(press(ignored), 'other'), JSON.stringify(ignored)).toBeNull();
    }
  });
});

describe('HISTORY_SHORTCUTS', () => {
  it('lists the redo alternative only where it is accepted', () => {
    expect(HISTORY_SHORTCUTS.mac.redo).toHaveLength(1);
    expect(HISTORY_SHORTCUTS.other.redo).toHaveLength(2);
  });
});
