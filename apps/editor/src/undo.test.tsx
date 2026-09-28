/**
 * Undo and redo as an author meets them: the header's two buttons, the keys, and where one step ends —
 * one per drag, one per field between focus and blur or Enter, one per scrub. The store's own rules
 * (redo dropped by a new edit, the cap, the selection) are `history.test.ts`.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Editor } from './app.js';
import { createLayoutLibrary, type LayoutLibrary } from './layout-library.js';
import type { Platform } from './platform.js';

function layoutText(width: number, text: string): string {
  const layout: Layout = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    target: { width, height: 200, frameRate: 30 },
    theme: { '--perch-fg': '#e8f1ff' },
    elements: [
      { kind: 'text', text, rect: { x: 10, y: 10, w: 200, h: 30 } },
      {
        kind: 'widget',
        widget: 'readout',
        topic: 'sensors/cpu/0/temperature/0',
        rect: { x: 10, y: 50, w: 180, h: 100 },
      },
    ],
  };

  return JSON.stringify(layout);
}

function testLibrary(): LayoutLibrary {
  return createLayoutLibrary({
    layouts: { 'desk-test': layoutText(640, 'desk'), 'tower-test': layoutText(200, 'tower') },
  });
}

type Result = ReturnType<typeof render>;

function renderEditor(platform: Platform = 'other'): Result {
  const source = createMockSource({ autoStart: false, seed: 1 });

  return render(
    <Editor
      platform={platform}
      library={testLibrary()}
      source={source}
      topics={source.topics}
      transport={() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })}
    />,
  );
}

function selectElement(result: Result, index: number): void {
  const button = within(result.getByTestId('perch-editor-elements')).getAllByRole('button')[index];
  if (button === undefined) throw new Error(`no element ${index} in the list`);
  fireEvent.click(button);
}

function undoButton(result: Result): HTMLElement {
  return within(result.getByTestId('perch-editor-header')).getByRole('button', { name: 'undo' });
}

function redoButton(result: Result): HTMLElement {
  return within(result.getByTestId('perch-editor-header')).getByRole('button', { name: 'redo' });
}

/** The w field of the selected element. */
function wField(result: Result): HTMLInputElement {
  const field = result.getByLabelText('w');
  if (!(field instanceof HTMLInputElement)) throw new Error('w is not an input');

  return field;
}

/** Type into a field the way a browser reports it: focus, an input event per keystroke, blur. */
function typeInto(field: HTMLInputElement, values: readonly string[], blur = true): void {
  field.focus();
  for (const value of values) fireEvent.input(field, { target: { value } });
  if (blur) field.blur();
}

/** How many presses of undo it takes until there is nothing left to undo. */
function stepsBack(result: Result): number {
  let count = 0;
  while (!undoButton(result).hasAttribute('disabled')) {
    fireEvent.click(undoButton(result));
    count += 1;
    if (count > 50) throw new Error('undo never ran out');
  }

  return count;
}

describe('the header buttons', () => {
  it('are named, and disabled while there is nothing to undo or redo', () => {
    const result = renderEditor();

    expect(undoButton(result)).toBeDisabled();
    expect(redoButton(result)).toBeDisabled();
    expect(undoButton(result)).toHaveAttribute('aria-keyshortcuts');
    expect(redoButton(result)).toHaveAttribute('aria-keyshortcuts');
  });

  it('undo an edit and redo it', () => {
    const result = renderEditor();
    selectElement(result, 0);

    typeInto(wField(result), ['150']);
    expect(undoButton(result)).toBeEnabled();
    expect(redoButton(result)).toBeDisabled();

    fireEvent.click(undoButton(result));
    expect(wField(result)).toHaveValue('200');
    expect(undoButton(result)).toBeDisabled();
    expect(redoButton(result)).toBeEnabled();

    fireEvent.click(redoButton(result));
    expect(wField(result)).toHaveValue('150');
  });
});

describe('where one step ends', () => {
  it('is a field blurred: every keystroke between focus and blur is one step', () => {
    const result = renderEditor();
    selectElement(result, 0);

    typeInto(wField(result), ['1', '15', '150']);
    typeInto(wField(result), ['15', '1']);

    expect(stepsBack(result)).toBe(2);
    expect(wField(result)).toHaveValue('200');
  });

  it('is Enter in a field, without leaving it', () => {
    const result = renderEditor();
    selectElement(result, 0);
    const field = wField(result);

    typeInto(field, ['1', '15'], false);
    fireEvent.keyDown(field, { key: 'Enter' });
    typeInto(field, ['150']);

    fireEvent.click(undoButton(result));
    expect(field).toHaveValue('15');
    fireEvent.click(undoButton(result));
    expect(field).toHaveValue('200');
  });

  it('is a scrub let go: every value dragged through is one step', () => {
    const result = renderEditor();
    selectElement(result, 0);
    const field = wField(result);

    fireEvent.pointerDown(field, { clientX: 100, button: 0, pointerId: 1 });
    for (const x of [110, 120, 130])
      fireEvent.pointerMove(field, { clientX: x, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(field, { clientX: 130, pointerId: 1 });
    expect(field).toHaveValue('215');

    fireEvent.pointerDown(field, { clientX: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(field, { clientX: 110, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(field, { clientX: 110, pointerId: 1 });

    expect(stepsBack(result)).toBe(2);
    expect(field).toHaveValue('200');
  });

  it('is a click on a control that leaves focus in a field, apart from the typing', () => {
    const result = renderEditor();
    selectElement(result, 1);
    const field = wField(result);

    typeInto(field, ['150'], false);
    // Focus stays in the field, as it does where a button does not take it on click.
    fireEvent.click(result.getByRole('radio', { name: 'middle centre' }));
    expect(document.activeElement).toBe(field);

    fireEvent.click(undoButton(result));
    expect(field).toHaveValue('150');
  });

  it('is not held open by a release the page never saw', () => {
    const result = renderEditor();
    selectElement(result, 0);

    // Pressed, then let go over another window: the next move has no button down.
    fireEvent.pointerDown(document.body, { clientX: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(document.body, { clientX: 5, pointerId: 1, buttons: 0 });
    typeInto(wField(result), ['150']);
    typeInto(wField(result), ['160']);

    expect(stepsBack(result)).toBe(2);
  });

  it('is a drag on the canvas let go: one drag is one step', () => {
    const result = renderEditor();
    const handle = result.container.querySelector('[data-perch-handle-index="1"]')?.parentElement;
    if (!(handle instanceof HTMLElement)) throw new Error('no canvas handle for element 1');

    const drag = (dx: number): void => {
      fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
      fireEvent.mouseDown(handle, { clientX: 100, clientY: 100, button: 0 });
      for (let step = 1; step <= 4; step += 1) {
        fireEvent.pointerMove(document, {
          clientX: 100 + (dx * step) / 4,
          pointerId: 1,
          buttons: 1,
        });
        fireEvent.mouseMove(document, { clientX: 100 + (dx * step) / 4, clientY: 100 });
      }
      fireEvent.pointerUp(document, { clientX: 100 + dx, pointerId: 1 });
      fireEvent.mouseUp(document, { clientX: 100 + dx, clientY: 100 });
    };
    drag(40);
    drag(40);
    const x = (): string | null =>
      result
        .getByTestId('perch-editor-preview')
        .querySelector('[data-perch-element-index="1"]')
        ?.getAttribute('style') ?? null;
    expect(x()).not.toContain('left: 10px');

    expect(stepsBack(result)).toBe(2);
    expect(x()).toContain('left: 10px');
  });

  it('is each click of a discrete control', () => {
    const result = renderEditor();
    selectElement(result, 1);

    fireEvent.click(result.getByRole('radio', { name: 'middle centre' }));
    fireEvent.click(result.getByRole('radio', { name: 'bottom right' }));

    expect(stepsBack(result)).toBe(2);
  });
});

describe('the keys on a Mac', () => {
  it('undo with Cmd-Z and redo with Shift-Cmd-Z', () => {
    const result = renderEditor('mac');
    selectElement(result, 0);
    typeInto(wField(result), ['150']);

    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(wField(result)).toHaveValue('200');
    fireEvent.keyDown(document.body, { key: 'Z', metaKey: true, shiftKey: true });
    expect(wField(result)).toHaveValue('150');
  });

  it('leave Ctrl-Z, Ctrl-Shift-Z and Ctrl-Y to the browser', () => {
    const result = renderEditor('mac');
    selectElement(result, 0);
    typeInto(wField(result), ['150']);

    for (const press of [
      { key: 'z', ctrlKey: true },
      { key: 'Z', ctrlKey: true, shiftKey: true },
      { key: 'y', ctrlKey: true },
    ]) {
      expect(fireEvent.keyDown(document.body, press), JSON.stringify(press)).toBe(true);
    }
    expect(wField(result)).toHaveValue('150');
    expect(redoButton(result)).toBeDisabled();
  });

  it('are shown as glyphs on the buttons', () => {
    const result = renderEditor('mac');

    expect(undoButton(result)).toHaveAttribute('title', 'Undo (⌘Z)');
    expect(redoButton(result)).toHaveAttribute('title', 'Redo (⇧⌘Z)');
    expect(undoButton(result)).toHaveAttribute('aria-keyshortcuts', 'Meta+Z');
    expect(redoButton(result)).toHaveAttribute('aria-keyshortcuts', 'Meta+Shift+Z');
  });
});

describe('the keys on Windows and Linux', () => {
  it('undo with Ctrl-Z and redo with Ctrl-Shift-Z or Ctrl-Y', () => {
    const result = renderEditor('other');
    selectElement(result, 0);
    typeInto(wField(result), ['150']);
    typeInto(wField(result), ['160']);

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(wField(result)).toHaveValue('200');
    fireEvent.keyDown(document.body, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(wField(result)).toHaveValue('150');
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    expect(wField(result)).toHaveValue('160');
  });

  it('ignore Meta combinations', () => {
    const result = renderEditor('other');
    selectElement(result, 0);
    typeInto(wField(result), ['150']);

    for (const press of [
      { key: 'z', metaKey: true },
      { key: 'Z', metaKey: true, shiftKey: true },
    ]) {
      expect(fireEvent.keyDown(document.body, press), JSON.stringify(press)).toBe(true);
    }
    expect(wField(result)).toHaveValue('150');
  });

  it('are shown in words on the buttons, with Ctrl+Y as the alternative', () => {
    const result = renderEditor('other');

    expect(undoButton(result)).toHaveAttribute('title', 'Undo (Ctrl+Z)');
    expect(redoButton(result)).toHaveAttribute('title', 'Redo (Ctrl+Shift+Z or Ctrl+Y)');
    expect(undoButton(result)).toHaveAttribute('aria-keyshortcuts', 'Control+Z');
    expect(redoButton(result)).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+Z Control+Y');
  });
});

describe('the keys in a text field', () => {
  it('leave the field its own undo, on either platform', () => {
    for (const [platform, press] of [
      ['mac', { key: 'z', metaKey: true }],
      ['other', { key: 'z', ctrlKey: true }],
    ] as const) {
      const result = renderEditor(platform);
      selectElement(result, 0);
      typeInto(wField(result), ['150']);
      const field = wField(result);
      field.focus();

      expect(fireEvent.keyDown(field, press), platform).toBe(true);
      expect(field, platform).toHaveValue('150');
      expect(undoButton(result), platform).toBeEnabled();
      result.unmount();
    }
  });
});

describe('unsaved changes', () => {
  it('reads clean after undoing back to what was saved', async () => {
    const result = renderEditor();
    selectElement(result, 0);
    typeInto(wField(result), ['150']);
    fireEvent.click(result.getByTestId('perch-editor-save'));
    await result.findByText('saved layouts/desk-test.json');

    typeInto(wField(result), ['160']);
    expect(result.getByTestId('perch-editor-dirty')).toBeInTheDocument();

    fireEvent.click(undoButton(result));
    expect(result.queryByTestId('perch-editor-dirty')).toBeNull();
    expect(result.getByTestId('perch-editor-save')).toBeDisabled();

    fireEvent.click(undoButton(result));
    expect(result.getByTestId('perch-editor-dirty')).toBeInTheDocument();
  });
});

describe('switching layout', () => {
  it('clears the history, as a revert does', () => {
    const result = renderEditor();
    selectElement(result, 0);
    typeInto(wField(result), ['150']);
    fireEvent.change(result.getByLabelText('layout'), { target: { value: 'tower-test' } });
    fireEvent.click(result.getByRole('button', { name: 'discard and open tower-test' }));

    expect(undoButton(result)).toBeDisabled();
    expect(redoButton(result)).toBeDisabled();

    selectElement(result, 0);
    typeInto(wField(result), ['150']);
    fireEvent.click(result.getByRole('button', { name: 'revert' }));
    expect(undoButton(result)).toBeDisabled();
  });

  it('says undo cannot bring the discarded edits back', () => {
    const result = renderEditor();
    selectElement(result, 0);
    typeInto(wField(result), ['150']);
    fireEvent.change(result.getByLabelText('layout'), { target: { value: 'tower-test' } });

    expect(result.getByTestId('perch-editor-pending').textContent).toContain(
      'undo cannot bring them back',
    );
  });
});
