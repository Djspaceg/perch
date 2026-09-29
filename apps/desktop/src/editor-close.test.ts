import { describe, expect, it } from 'vitest';
import { closeChoice, dockVisible, mustAsk, unsavedPrompt } from './editor-close.js';

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
});
