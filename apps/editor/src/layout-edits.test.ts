/**
 * Adding and removing an element: the same pure `Layout -> Layout` shape as every other edit, so they
 * run through `editDraft` and its validation like a keystroke does.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout, type LayoutElement } from '@perch/layout-schema';
import { describe, expect, it } from 'vitest';
import {
  addElement,
  clearBackground,
  moveElement,
  removeElement,
  setBackgroundFit,
  setBackgroundHidden,
  setBackgroundOpacity,
  setBackgroundSrc,
  setElementHidden,
} from './layout-edits.js';

function layout(): Layout {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    target: { width: 640, height: 200, frameRate: 30 },
    theme: {},
    elements: [
      { kind: 'text', text: 'a', rect: { x: 0, y: 0, w: 10, h: 10 } },
      { kind: 'text', text: 'b', rect: { x: 0, y: 0, w: 10, h: 10 } },
      { kind: 'text', text: 'c', rect: { x: 0, y: 0, w: 10, h: 10 } },
    ],
  };
}

const LABEL: LayoutElement = { kind: 'text', text: 'new', rect: { x: 5, y: 5, w: 20, h: 20 } };

describe('addElement', () => {
  it('appends, so the new element paints over everything already there', () => {
    const before = layout();
    const after = addElement(LABEL)(before);

    expect(after.elements.map((element) => (element.kind === 'text' ? element.text : ''))).toEqual([
      'a',
      'b',
      'c',
      'new',
    ]);
    expect(after.elements[3]).toBe(LABEL);
  });

  it('rebuilds rather than mutating the layout it was given', () => {
    const before = layout();
    const elements = before.elements;
    const after = addElement(LABEL)(before);

    expect(before.elements).toBe(elements);
    expect(before.elements).toHaveLength(3);
    expect(after).not.toBe(before);
    expect(after.target).toBe(before.target);
  });
});

describe('removeElement', () => {
  it('removes exactly the element at the index, and the ones after it move up', () => {
    const after = removeElement(1)(layout());

    expect(after.elements.map((element) => (element.kind === 'text' ? element.text : ''))).toEqual([
      'a',
      'c',
    ]);
  });

  it('leaves the layout it was given alone', () => {
    const before = layout();
    removeElement(0)(before);

    expect(before.elements).toHaveLength(3);
  });

  it('is a no-op for an index that names no element, which is what "nothing selected" is', () => {
    const before = layout();

    expect(removeElement(-1)(before).elements).toEqual(before.elements);
    expect(removeElement(3)(before).elements).toEqual(before.elements);
  });
});

describe('moveElement', () => {
  const texts = (after: Layout): string[] =>
    after.elements.map((element) => (element.kind === 'text' ? element.text : ''));

  it('takes the element out and puts it back at the index it is to end up at', () => {
    expect(texts(moveElement(0, 2)(layout()))).toEqual(['b', 'c', 'a']);
    expect(texts(moveElement(2, 0)(layout()))).toEqual(['c', 'a', 'b']);
    expect(texts(moveElement(1, 2)(layout()))).toEqual(['a', 'c', 'b']);
  });

  it('moves the element itself, and keeps every element the same object', () => {
    const before = layout();
    const after = moveElement(0, 2)(before);

    expect(after.elements[2]).toBe(before.elements[0]);
    expect(after.elements[0]).toBe(before.elements[1]);
    expect(texts(before)).toEqual(['a', 'b', 'c']);
  });

  it('hands back the same layout for a move that goes nowhere or names no element', () => {
    const before = layout();

    expect(moveElement(1, 1)(before)).toBe(before);
    expect(moveElement(-1, 0)(before)).toBe(before);
    expect(moveElement(0, 3)(before)).toBe(before);
  });
});

describe('the background edits', () => {
  it('makes a background from a source, and changes only the source of one there is', () => {
    const made = setBackgroundSrc('thermalright:a042')(layout());
    expect(made.background).toEqual({ src: 'thermalright:a042' });

    const faded = setBackgroundOpacity(0.5)(made);
    expect(setBackgroundSrc('a.assets/b.png')(faded).background).toEqual({
      src: 'a.assets/b.png',
      opacity: 0.5,
    });
  });

  it('reads an empty source as none, removing the field', () => {
    const made = setBackgroundSrc('thermalright:a042')(layout());

    expect('background' in setBackgroundSrc('')(made)).toBe(false);
    expect('background' in clearBackground()(made)).toBe(false);
  });

  it('is the same layout for an edit with no background to make it to', () => {
    const before = layout();

    expect(clearBackground()(before)).toBe(before);
    expect(setBackgroundFit('contain')(before)).toBe(before);
    expect(setBackgroundHidden(true)(before)).toBe(before);
    expect(setBackgroundOpacity(0.2)(before)).toBe(before);
  });

  it('writes hidden as true and removes it to show, and opacity 1 as nothing', () => {
    const made = setBackgroundSrc('thermalright:a042')(layout());
    const hidden = setBackgroundHidden(true)(made);

    expect(hidden.background).toEqual({ src: 'thermalright:a042', hidden: true });
    expect(setBackgroundHidden(false)(hidden).background).toEqual({ src: 'thermalright:a042' });
    expect(setBackgroundOpacity(1)(setBackgroundOpacity(0.3)(made)).background).toEqual({
      src: 'thermalright:a042',
    });
  });
});

describe('setElementHidden', () => {
  it('hides one element and leaves every other the same object', () => {
    const before = layout();
    const after = setElementHidden(1, true)(before);

    expect(after.elements[1]).toEqual({ ...before.elements[1], hidden: true });
    expect(after.elements[0]).toBe(before.elements[0]);
    expect(setElementHidden(1, false)(after).elements[1]).toEqual(before.elements[1]);
  });
});
