import { describe, expect, it } from 'vitest';
import {
  closeChoice,
  dockAction,
  dockVisible,
  mustAsk,
  unsavedPrompt,
  type DockWindow,
} from './editor-close.js';

/** A window as the dock reads one. A destroyed one throws on `isVisible`, as Electron's does. */
function fakeWindow(state: 'visible' | 'hidden' | 'destroyed'): DockWindow {
  return {
    isDestroyed: () => state === 'destroyed',
    isVisible: () => {
      if (state === 'destroyed') throw new TypeError('Object has been destroyed');
      return state === 'visible';
    },
  };
}

describe('closing the editor with unsaved changes', () => {
  it('asks only when the document is dirty and the close has not been answered yet', () => {
    expect(mustAsk({ dirty: false, answered: false })).toBe(false);
    expect(mustAsk({ dirty: true, answered: false })).toBe(true);
    expect(mustAsk({ dirty: true, answered: true })).toBe(false);
  });

  it("offers Save, Don't Save and Cancel, naming the document, with Cancel on Escape", () => {
    const prompt = unsavedPrompt('desk', 'close');

    expect(prompt.buttons).toEqual(['Save', "Don't Save", 'Cancel']);
    expect(prompt.defaultId).toBe(0);
    expect(prompt.cancelId).toBe(2);
    expect(prompt.message).toContain('desk');
    expect(unsavedPrompt('desk', 'quit').detail).toMatch(/quit/i);
  });

  it('reads the answer back by button', () => {
    expect(closeChoice(0)).toBe('save');
    expect(closeChoice(1)).toBe('discard');
    expect(closeChoice(2)).toBe('cancel');
    // Anything else, such as the dialog closing without an answer, keeps the editor open.
    expect(closeChoice(7)).toBe('cancel');
  });
});

describe('the dock icon', () => {
  it('shows while any window is showing, and hides once none is', () => {
    const none = { runnerVisible: false, editorOpen: false, settingsOpen: false };
    expect(dockVisible({ ...none, runnerVisible: true })).toBe(true);
    expect(dockVisible({ ...none, editorOpen: true })).toBe(true);
    // The Settings window too: without a dock icon a macOS app has no menu bar, and the host
    // field's paste is a menu item.
    expect(dockVisible({ ...none, settingsOpen: true })).toBe(true);
    expect(dockVisible(none)).toBe(false);
  });

  it('follows the runner window while it is open', () => {
    const others = { quitting: false, editorOpen: false, settingsOpen: false };
    expect(dockAction({ ...others, runner: fakeWindow('visible') })).toBe('show');
    expect(dockAction({ ...others, runner: fakeWindow('hidden') })).toBe('hide');
    expect(dockAction({ ...others, runner: null })).toBe('hide');
    expect(dockAction({ ...others, runner: fakeWindow('hidden'), editorOpen: true })).toBe('show');
  });

  // Quit, Don't Save: the runner's window closes first, then the editor's 'closed' asks for the
  // dock. A destroyed window throws on every method, which was "A JavaScript error occurred in the
  // main process".
  it('reads a destroyed runner window as not showing, rather than throwing', () => {
    const others = { quitting: false, editorOpen: false, settingsOpen: false };
    expect(() => dockAction({ ...others, runner: fakeWindow('destroyed') })).not.toThrow();
    expect(dockAction({ ...others, runner: fakeWindow('destroyed') })).toBe('hide');
    expect(dockAction({ ...others, runner: fakeWindow('destroyed'), settingsOpen: true })).toBe(
      'show',
    );
  });

  it('leaves the dock alone once a quit is going ahead', () => {
    const closing = { quitting: true, editorOpen: false, settingsOpen: false };
    expect(dockAction({ ...closing, runner: fakeWindow('destroyed') })).toBe('leave');
    expect(dockAction({ ...closing, runner: fakeWindow('visible'), editorOpen: true })).toBe(
      'leave',
    );
  });
});
