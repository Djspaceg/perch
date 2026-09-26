/**
 * Undo and redo in the store: what a step is, what a new edit does to redo, what undo does to "unsaved
 * changes" and to the selection, the cap, and what clears the history. The keys, the header buttons
 * and the gestures that decide where a step ends are `undo.test.tsx`, through the rendered editor.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDirty } from './draft.js';
import { HISTORY_LIMIT } from './history.js';
import { addElement, removeElement, setElementRectField, setElementText } from './layout-edits.js';
import { createLayoutLibrary } from './layout-library.js';
import { openLayoutByName } from './open-layout.js';
import { NOTHING_SELECTED, createEditorStore, type EditorStore } from './store.js';

function layoutText(width: number): string {
  const layout: Layout = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    target: { width, height: 200, frameRate: 30 },
    theme: {},
    elements: [
      { kind: 'text', text: 'one', rect: { x: 10, y: 10, w: 200, h: 30 } },
      { kind: 'text', text: 'two', rect: { x: 10, y: 50, w: 200, h: 30 } },
    ],
  };

  return JSON.stringify(layout);
}

const library = createLayoutLibrary({
  layouts: { 'desk-test': layoutText(640), 'tower-test': layoutText(200) },
});

function openStore(): EditorStore {
  const store = createEditorStore();
  store.getState().openFirst(library, 'desk-test');

  return store;
}

function draftOf(store: EditorStore): Layout {
  const { opened } = store.getState().session;
  if (opened?.ok !== true) throw new Error('nothing open');

  return opened.state.draft;
}

function textOf(store: EditorStore, index: number): string | undefined {
  const element = draftOf(store).elements[index];

  return element?.kind === 'text' ? element.text : undefined;
}

function dirty(store: EditorStore): boolean {
  const { opened } = store.getState().session;

  return opened?.ok === true && isDirty(opened.state);
}

function steps(store: EditorStore): { readonly back: number; readonly forward: number } {
  const { history } = store.getState().session;

  return { back: history.past.length, forward: history.future.length };
}

describe('a step', () => {
  it('is undone and redone as a whole document, preview and problems included', () => {
    const store = openStore();
    const { editDraft, undo, redo } = store.getState();

    editDraft(setElementText(0, ''));
    expect(store.getState().session.opened).toMatchObject({ ok: true });
    const broken = store.getState().session.opened;
    expect(broken?.ok === true && broken.state.issues.length).toBeGreaterThan(0);

    undo();
    const back = store.getState().session.opened;
    expect(textOf(store, 0)).toBe('one');
    expect(back?.ok === true && back.state.issues).toEqual([]);
    expect(back?.ok === true && back.state.rendered.elements[0]).toMatchObject({ text: 'one' });

    redo();
    expect(textOf(store, 0)).toBe('');
    expect(steps(store)).toEqual({ back: 1, forward: 0 });
  });

  it('is each edit made outside a gesture, however quickly they follow', () => {
    const store = openStore();
    const { editDraft, undo } = store.getState();

    editDraft(setElementText(0, 'a'));
    editDraft(setElementText(0, 'ab'));
    expect(steps(store).back).toBe(2);

    undo();
    expect(textOf(store, 0)).toBe('a');
  });

  it('is every edit sharing one gesture, and a new gesture starts the next', () => {
    const store = openStore();
    const { editDraft, undo } = store.getState();

    // A field being typed in: one gesture per focus, per keystroke an edit.
    editDraft(setElementText(0, 'o'), 'field:1');
    editDraft(setElementText(0, 'on'), 'field:1');
    editDraft(setElementText(0, 'onc'), 'field:1');
    // Blurred and typed in again: a new gesture.
    editDraft(setElementText(0, 'once'), 'field:2');
    // A scrub: one gesture per press.
    editDraft(setElementRectField(1, 'x', 11), 'pointer:3');
    editDraft(setElementRectField(1, 'x', 12), 'pointer:3');
    editDraft(setElementRectField(1, 'x', 13), 'pointer:3');

    expect(steps(store).back).toBe(3);
    undo();
    expect(draftOf(store).elements[1]?.rect.x).toBe(10);
    expect(textOf(store, 0)).toBe('once');
    undo();
    expect(textOf(store, 0)).toBe('onc');
    undo();
    expect(textOf(store, 0)).toBe('one');
  });

  it('does not continue a gesture across an undo', () => {
    const store = openStore();
    const { editDraft, undo } = store.getState();

    editDraft(setElementText(0, 'a'), 'field:1');
    undo();
    editDraft(setElementText(0, 'b'), 'field:1');
    editDraft(setElementText(0, 'c'), 'field:1');

    expect(steps(store)).toEqual({ back: 1, forward: 0 });
    undo();
    expect(textOf(store, 0)).toBe('one');
  });

  it('is not recorded for an edit that changes nothing', () => {
    const store = openStore();
    store.getState().editDraft(setElementText(0, 'one'));

    expect(steps(store).back).toBe(0);
  });

  it('does nothing, and says nothing, when there is nothing to undo or redo', () => {
    const store = openStore();
    const before = store.getState().session;
    store.getState().undo();
    store.getState().redo();

    expect(store.getState().session).toBe(before);
  });
});

describe('redo', () => {
  it('is dropped by a new edit after an undo', () => {
    const store = openStore();
    const { editDraft, undo, redo } = store.getState();

    editDraft(setElementText(0, 'a'));
    editDraft(setElementText(0, 'b'));
    undo();
    expect(steps(store)).toEqual({ back: 1, forward: 1 });

    editDraft(setElementText(0, 'c'));
    expect(steps(store)).toEqual({ back: 2, forward: 0 });
    redo();
    expect(textOf(store, 0)).toBe('c');
  });
});

describe('unsaved changes', () => {
  it('reads clean when undo reaches the document on disk, and dirty past it', () => {
    const store = openStore();
    const { editDraft, markSaved, undo, redo } = store.getState();

    editDraft(setElementText(0, 'saved'));
    markSaved('desk-test', draftOf(store));
    expect(dirty(store)).toBe(false);
    // A save keeps the history.
    expect(steps(store).back).toBe(1);

    editDraft(setElementText(0, 'after'));
    expect(dirty(store)).toBe(true);
    undo();
    expect(textOf(store, 0)).toBe('saved');
    expect(dirty(store)).toBe(false);
    undo();
    expect(textOf(store, 0)).toBe('one');
    expect(dirty(store)).toBe(true);
    redo();
    expect(dirty(store)).toBe(false);
  });
});

describe('the selection after an undo or redo', () => {
  it('stays on an element that still exists', () => {
    const store = openStore();
    const { editDraft, select, undo } = store.getState();

    select(1);
    editDraft(setElementText(1, 'changed'));
    undo();

    expect(store.getState().session.selected).toBe(1);
  });

  it('follows the element when an undo moves it', () => {
    const store = openStore();
    const { editDraft, select, undo } = store.getState();

    editDraft(removeElement(0));
    // "two" is now element 0.
    select(0);
    undo();

    expect(textOf(store, 1)).toBe('two');
    expect(store.getState().session.selected).toBe(1);
  });

  it('is cleared when the element is gone', () => {
    const store = openStore();
    const { editDraft, select, undo, redo } = store.getState();

    editDraft(addElement({ kind: 'text', text: 'three', rect: { x: 0, y: 0, w: 10, h: 10 } }));
    select(2);
    undo();
    expect(store.getState().session.selected).toBe(NOTHING_SELECTED);

    // Redo takes the selected element away, and another now sits at its index.
    editDraft(removeElement(0));
    undo();
    select(0);
    redo();
    expect(textOf(store, 0)).toBe('two');
    expect(store.getState().session.selected).toBe(NOTHING_SELECTED);
  });
});

describe('the cap', () => {
  it(`keeps the last ${HISTORY_LIMIT} steps and drops the oldest`, () => {
    expect(HISTORY_LIMIT).toBe(200);
    const store = openStore();
    const { editDraft, undo } = store.getState();

    for (let step = 1; step <= HISTORY_LIMIT + 5; step += 1)
      editDraft(setElementText(0, `${step}`));
    expect(steps(store).back).toBe(HISTORY_LIMIT);

    for (let step = 0; step < HISTORY_LIMIT + 5; step += 1) undo();
    // The oldest five are gone, so the furthest back is the fifth edit, not the file.
    expect(textOf(store, 0)).toBe('5');
    expect(steps(store)).toEqual({ back: 0, forward: HISTORY_LIMIT });
  });
});

describe('clearing the history', () => {
  it('happens on switching layout and on reverting to disk', () => {
    const store = openStore();
    const { editDraft, undo, openLayout } = store.getState();

    editDraft(setElementText(0, 'a'));
    editDraft(setElementText(0, 'b'));
    undo();
    openLayout(openLayoutByName(library, 'tower-test'), { remember: true });
    expect(steps(store)).toEqual({ back: 0, forward: 0 });

    store.getState().editDraft(setElementText(0, 'c'));
    // Revert is the same layout, opened again from disk.
    openLayout(openLayoutByName(library, 'tower-test'), { remember: false });
    expect(steps(store)).toEqual({ back: 0, forward: 0 });
  });

  it('never happens on a change of selection or a setting', () => {
    const store = openStore();
    const { editDraft, select, setSectionOpen, setTab } = store.getState();

    editDraft(setElementText(0, 'a'));
    select(1);
    setSectionOpen('entity/transform', false);
    setTab('theme', 'developer');

    expect(steps(store).back).toBe(1);
  });
});

describe('Redux DevTools', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names undo and redo on the timeline', () => {
    const send = vi.fn();
    vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', {
      connect: () => ({ init: vi.fn(), send, subscribe: vi.fn() }),
    });
    const store = createEditorStore();
    store.getState().openFirst(library, 'desk-test');
    store.getState().editDraft(setElementText(0, 'a'));
    store.getState().undo();
    store.getState().redo();

    const types = send.mock.calls.map(([action]) => (action as { type: string }).type);
    expect(types.filter((type) => type !== 'anonymous')).toEqual([
      'open/layout',
      'edit/draft',
      'history/undo',
      'history/redo',
    ]);
  });
});
