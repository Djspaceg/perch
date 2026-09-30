/**
 * An element's own opacity: a row at the top of its Appearance, for every kind, painted on its box in
 * the preview, and one undo step per edit. The theme no longer offers a media opacity.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Editor } from './app.js';
import { createLayoutLibrary } from './layout-library.js';

const LAYOUT: Layout = {
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  target: { width: 640, height: 400, frameRate: 30 },
  theme: {},
  elements: [
    {
      kind: 'media',
      src: 'thermalright:a042',
      rect: { x: 0, y: 0, w: 640, h: 400 },
      opacity: 0.55,
    },
    { kind: 'text', text: 'CPU', rect: { x: 10, y: 10, w: 200, h: 30 } },
    {
      kind: 'widget',
      widget: 'readout',
      topic: 'sensors/cpu/0/temperature/0',
      rect: { x: 10, y: 50, w: 180, h: 100 },
    },
    {
      kind: 'chart',
      widget: 'line-chart',
      topic: 'sensors/cpu/0/temperature/0',
      rect: { x: 10, y: 200, w: 400, h: 160 },
      windowMs: 60_000,
      range: [0, 100],
    },
  ],
};

type Result = ReturnType<typeof render>;

function renderEditor(): Result {
  const source = createMockSource({ autoStart: false, seed: 1 });

  return render(
    <Editor
      platform="other"
      library={createLayoutLibrary({ layouts: { 'opacity-test': JSON.stringify(LAYOUT) } })}
      source={source}
      topics={source.topics}
      transport={() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })}
    />,
  );
}

/** Select an element by its index in `elements`, whichever row of the list it is drawn in. */
function selectElement(result: Result, index: number): void {
  const rows = within(result.getByTestId('perch-editor-elements')).getAllByRole('button');
  const row = rows.find(
    (button) => button.querySelector('.perch-editor-element__index')?.textContent === String(index),
  );
  if (row === undefined) throw new Error(`no element ${index} in the list`);
  fireEvent.click(row);
}

function opacityField(result: Result): HTMLInputElement {
  const row = result.getByTestId('perch-editor-prop-opacity');
  const field = within(row).getByRole('spinbutton');
  if (!(field instanceof HTMLInputElement)) throw new Error('opacity is not an input');

  return field;
}

function box(result: Result, index: number): HTMLElement | null {
  return result
    .getByTestId('perch-editor-preview')
    .querySelector<HTMLElement>(`[data-perch-element-index="${index}"]`);
}

function undo(result: Result): void {
  fireEvent.click(
    within(result.getByTestId('perch-editor-header')).getByRole('button', { name: 'undo' }),
  );
}

describe('an element`s opacity', () => {
  it.each([
    [0, 'media', '55'],
    [1, 'text', '100'],
    [2, 'widget', '100'],
    [3, 'chart', '100'],
  ])('is the first row of a %s element`s Appearance, in percent', (index, _kind, shown) => {
    const result = renderEditor();
    selectElement(result, index);
    const appearance = result.getByTestId('perch-editor-appearance');
    const firstRow = appearance.querySelector('.perch-row');

    expect(firstRow).toBe(result.getByTestId('perch-editor-prop-opacity'));
    expect(opacityField(result)).toHaveValue(shown);
    expect(opacityField(result)).toHaveAttribute('aria-valuemin', '0');
    expect(opacityField(result)).toHaveAttribute('aria-valuemax', '100');
  });

  it.each([1, 2, 3])(
    'paints element %i`s box at the percentage typed, and undoes in one step',
    (index) => {
      const result = renderEditor();
      selectElement(result, index);
      const field = opacityField(result);

      field.focus();
      fireEvent.input(field, { target: { value: '4' } });
      fireEvent.input(field, { target: { value: '40' } });
      field.blur();
      expect(box(result, index)?.style.opacity).toBe('0.4');

      undo(result);
      expect(box(result, index)?.style.opacity).toBe('');
      expect(opacityField(result)).toHaveValue('100');
    },
  );

  it('nudges with the arrow keys and drops the field at 100%, the default', () => {
    const result = renderEditor();
    selectElement(result, 0);

    fireEvent.keyDown(opacityField(result), { key: 'ArrowUp' });
    expect(box(result, 0)?.style.opacity).toBe('0.56');
    fireEvent.change(opacityField(result), { target: { value: '100' } });
    expect(box(result, 0)?.style.opacity).toBe('');
  });

  it('resets to solid from the row`s reset, where the element sets one', () => {
    const result = renderEditor();
    selectElement(result, 0);
    const row = result.getByTestId('perch-editor-prop-opacity');

    fireEvent.click(within(row).getByRole('button', { name: /reset opacity/i }));

    expect(box(result, 0)?.style.opacity).toBe('');
    expect(within(row).queryByRole('button', { name: /reset opacity/i })).toBeNull();
  });
});

describe('the theme', () => {
  it('offers no media opacity any more', () => {
    const result = renderEditor();
    const global = result.getByRole('region', { name: 'Global' });
    // A search opens every section it matches, so the absence below is not a folded section's.
    fireEvent.change(within(global).getByRole('searchbox', { name: /search theme tokens/i }), {
      target: { value: 'opacity' },
    });

    expect(within(global).getByText('Chart fill opacity')).toBeInTheDocument();
    expect(within(global).queryByText(/image opacity/i)).toBeNull();
  });
});
