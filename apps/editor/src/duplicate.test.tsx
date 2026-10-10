/**
 * Duplicate: Mod+D, the selected row's button, and the desktop menu's Edit > Duplicate all copy the
 * selected layer directly above itself and select the copy, as one undo step. The background's copy
 * is an ordinary media layer just above it, and the background itself stays as it was.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Editor } from './app.js';
import { createLayoutLibrary } from './layout-library.js';

const WALL = 'dup-test.assets/wall.png';

const LAYOUT: Layout = {
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  target: { width: 640, height: 400, frameRate: 30 },
  theme: {},
  background: { src: WALL, fit: 'contain', opacity: 0.6, hidden: true },
  elements: [
    { kind: 'text', text: 'a', rect: { x: 10, y: 10, w: 200, h: 30 } },
    { kind: 'text', text: 'b', rect: { x: 10, y: 50, w: 200, h: 30 }, opacity: 0.5 },
  ],
};

type Result = ReturnType<typeof render>;

function renderEditor(layout: Layout = LAYOUT): Result {
  const source = createMockSource({ autoStart: false, seed: 1 });
  return render(
    <Editor
      platform="other"
      library={createLayoutLibrary({
        layouts: { 'dup-test': JSON.stringify(layout) },
        assets: { [WALL]: '/assets/wall.png' },
      })}
      source={source}
      topics={source.topics}
      transport={() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })}
    />,
  );
}

const list = (result: Result): HTMLElement => result.getByTestId('perch-editor-elements');
const rowOf = (result: Result, index: number): HTMLElement => {
  const row = list(result).querySelector<HTMLElement>(`[data-perch-layer-index="${index}"]`);
  if (row === null) throw new Error(`no row for elements[${index}]`);
  return row;
};
/** The list, top row first, as each element row's summary, then the background row's. */
const listed = (result: Result): string[] =>
  [...list(result).querySelectorAll('.perch-editor-element__summary')].map(
    (summary) => summary.textContent,
  );
const duplicateKey = (result: Result): void => {
  fireEvent.keyDown(result.getByTestId('perch-editor-preview'), { key: 'd', ctrlKey: true });
};
const undoButton = (result: Result): HTMLElement =>
  within(result.getByTestId('perch-editor-header')).getByRole('button', { name: 'undo' });
const selectedIndex = (result: Result): string | null =>
  list(result)
    .querySelector('[data-perch-selected="true"]')
    ?.getAttribute('data-perch-layer-index') ?? null;

describe('duplicating an element', () => {
  it('puts a copy directly above it on Mod+D, selects the copy, and undoes in one step', () => {
    const result = renderEditor();
    fireEvent.click(rowOf(result, 0));

    duplicateKey(result);

    expect(listed(result)).toEqual(['b', 'a', 'a', WALL]);
    expect(selectedIndex(result)).toBe('1');
    fireEvent.click(undoButton(result));
    expect(listed(result)).toEqual(['b', 'a', WALL]);
    expect(undoButton(result)).toBeDisabled();
  });

  it('keeps everything set on it, opacity included', () => {
    const result = renderEditor();
    fireEvent.click(rowOf(result, 1));

    duplicateKey(result);

    const painted = result
      .getByTestId('perch-canvas')
      .querySelector<HTMLElement>('[data-perch-element-index="2"]');
    expect(painted?.textContent).toBe('b');
    expect(painted?.style.opacity).toBe('0.5');
    expect(painted?.style.top).toBe('50px');
  });

  it('shows the button only on the selected row, and it does what the key does', () => {
    const result = renderEditor();
    expect(within(list(result)).queryByRole('button', { name: 'duplicate' })).toBeNull();

    fireEvent.click(rowOf(result, 1));
    fireEvent.click(within(list(result)).getByRole('button', { name: 'duplicate' }));

    expect(listed(result)).toEqual(['b', 'b', 'a', WALL]);
    expect(selectedIndex(result)).toBe('2');
  });

  it('does nothing with nothing selected', () => {
    const result = renderEditor();

    duplicateKey(result);

    expect(undoButton(result)).toBeDisabled();
  });
});

describe('duplicating the background', () => {
  it('makes a standard media layer just above it, and leaves the background as it was', () => {
    const result = renderEditor();
    fireEvent.click(result.getByTestId('perch-editor-background-row'));

    duplicateKey(result);

    expect(listed(result)).toEqual(['b', 'a', WALL, WALL]);
    expect(selectedIndex(result)).toBe('0');
    // The copy carries the background's eye, so it is hidden too, and has a full-canvas rect.
    expect(within(list(result)).getByRole('button', { name: 'show elements[0]' })).toBeVisible();
    expect(result.getByLabelText('w')).toHaveValue('640');
    expect(result.getByLabelText('h')).toHaveValue('400');
    expect(result.getByLabelText('x')).toHaveValue('0');
    expect(within(list(result)).getByRole('button', { name: 'show the background' })).toBeVisible();
    expect(result.getByTestId('perch-editor-background-row')).toHaveTextContent(WALL);
    fireEvent.click(undoButton(result));
    expect(listed(result)).toEqual(['b', 'a', WALL]);
  });

  it('is offered on the background row once it is selected, and only with a source', () => {
    const result = renderEditor({ ...LAYOUT, background: { src: WALL } });
    fireEvent.click(result.getByTestId('perch-editor-background-row'));

    fireEvent.click(within(list(result)).getByRole('button', { name: 'duplicate' }));

    const copy = result
      .getByTestId('perch-canvas')
      .querySelector<HTMLElement>('[data-perch-element-index="0"]');
    expect(copy?.querySelector('img')).toHaveAttribute('src', '/assets/wall.png');
    expect(copy?.style.width).toBe('640px');
  });

  it('does nothing with no background', () => {
    const { background: _none, ...bare } = LAYOUT;
    const result = renderEditor(bare);
    fireEvent.click(result.getByTestId('perch-editor-background-row'));

    expect(within(list(result)).queryByRole('button', { name: 'duplicate' })).toBeNull();
    duplicateKey(result);
    expect(undoButton(result)).toBeDisabled();
  });

  it('is deselected by Escape, as an element is', () => {
    const result = renderEditor();
    fireEvent.click(result.getByTestId('perch-editor-background-row'));

    fireEvent.keyDown(result.getByTestId('perch-editor-preview'), { key: 'Escape' });

    expect(result.getByTestId('perch-editor-background-row')).toHaveAttribute(
      'data-perch-selected',
      'false',
    );
  });
});
