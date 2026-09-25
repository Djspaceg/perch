/**
 * Adding and removing an element: the same pure `Layout -> Layout` shape as every other edit, so they
 * run through `editDraft` and its validation like a keystroke does.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout, type LayoutElement } from '@perch/layout-schema';
import { describe, expect, it } from 'vitest';
import { addElement, removeElement } from './layout-edits.js';

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
