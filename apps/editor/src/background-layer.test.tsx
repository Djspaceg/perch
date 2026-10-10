/**
 * The background as a layer: always the bottom row of the layers list, locked, with an eye; selecting
 * it shows its source and fit; and every element row has an eye too. Hiding is saved in the layout.
 */

import { LAYOUT_SCHEMA_VERSION, loadLayoutJson, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { WIDGET_REGISTRY } from '@perch/ui-kit';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Editor } from './app.js';
import { createLayoutLibrary } from './layout-library.js';
import type { SaveTransport } from './save.js';

const LAYOUT: Layout = {
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  target: { width: 640, height: 400, frameRate: 30 },
  theme: {},
  elements: [
    { kind: 'text', text: 'a', rect: { x: 10, y: 10, w: 200, h: 30 } },
    { kind: 'text', text: 'b', rect: { x: 10, y: 50, w: 200, h: 30 } },
  ],
};

const WALL = 'bg-test.assets/wall.png';

type Result = ReturnType<typeof render>;

function renderEditor(layout: Layout = LAYOUT): { result: Result; saved: string[] } {
  const source = createMockSource({ autoStart: false, seed: 1 });
  const saved: string[] = [];
  const transport: SaveTransport = (_url, init) => {
    saved.push(init.body);
    return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });
  };
  const result = render(
    <Editor
      platform="other"
      library={createLayoutLibrary({
        layouts: { 'bg-test': JSON.stringify(layout) },
        assets: { [WALL]: '/assets/wall-abc.png' },
      })}
      source={source}
      topics={source.topics}
      transport={transport}
    />,
  );

  return { result, saved };
}

const list = (result: Result): HTMLElement => result.getByTestId('perch-editor-elements');
const backgroundRow = (result: Result): HTMLElement =>
  result.getByTestId('perch-editor-background-row');
const backgroundEye = (result: Result): HTMLElement =>
  within(list(result)).getByRole('button', { name: /the background$/ });
const painted = (result: Result): HTMLElement | null =>
  result.getByTestId('perch-canvas').querySelector('[data-perch-layer="background"]');
const undoButton = (result: Result): HTMLElement =>
  within(result.getByTestId('perch-editor-header')).getByRole('button', { name: 'undo' });

function chooseLocal(result: Result, src: string): void {
  fireEvent.click(backgroundRow(result));
  const field = within(result.getByTestId('perch-editor-prop-local')).getByRole('combobox');
  fireEvent.change(field, { target: { value: src } });
}

async function save(result: Result): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(result.getByTestId('perch-editor-preview'), { key: 's', ctrlKey: true });
    await Promise.resolve();
  });
}

function savedLayout(saved: readonly string[]): Layout {
  const loaded = loadLayoutJson(saved.at(-1) ?? '', { widgets: WIDGET_REGISTRY });
  if (!loaded.ok) throw new Error('the save did not write a layout');
  return loaded.layout;
}

describe('the background row', () => {
  it('is the last row of the list, locked, with no layer index and nothing to hide yet', () => {
    const { result } = renderEditor();

    const rows = list(result).querySelectorAll('li');
    expect(rows[rows.length - 1]).toContainElement(backgroundRow(result));
    expect(backgroundRow(result)).not.toHaveAttribute('data-perch-layer-index');
    expect(backgroundRow(result).querySelector('[data-perch-glyph="lock"]')).not.toBeNull();
    expect(backgroundRow(result)).toHaveTextContent('none');
    expect(backgroundEye(result)).toBeDisabled();
  });

  it('shows the background source when selected, in place of an element', () => {
    const { result } = renderEditor();

    fireEvent.click(backgroundRow(result));

    expect(backgroundRow(result)).toHaveAttribute('data-perch-selected', 'true');
    expect(result.getByTestId('perch-editor-selection')).toHaveAttribute(
      'data-perch-kind',
      'background',
    );
    for (const id of ['cloud', 'local', 'src']) {
      expect(result.getByTestId(`perch-editor-prop-${id}`)).toBeInTheDocument();
    }
    expect(result.queryByTestId('perch-editor-prop-fit')).toBeNull();
    expect(result.queryByLabelText('w')).toBeNull();
  });

  it('paints a local file chosen for it under every element, and undoes in one step', () => {
    const { result } = renderEditor();

    chooseLocal(result, WALL);

    expect(painted(result)?.querySelector('img')).toHaveAttribute('src', '/assets/wall-abc.png');
    expect(result.getByTestId('perch-canvas').firstElementChild).toBe(painted(result));
    expect(backgroundRow(result)).toHaveTextContent(WALL);
    expect(result.getByTestId('perch-editor-prop-fit')).toBeInTheDocument();
    fireEvent.click(undoButton(result));
    expect(painted(result)).toBeNull();
    expect(undoButton(result)).toBeDisabled();
    // Undo keeps the background selected: it is still the layer being looked at.
    expect(backgroundRow(result)).toHaveAttribute('data-perch-selected', 'true');
  });

  it('hides and shows with its eye, and the hiding is saved in the layout', async () => {
    const { result, saved } = renderEditor();
    chooseLocal(result, WALL);

    fireEvent.click(backgroundEye(result));
    expect(painted(result)).toBeNull();
    expect(backgroundEye(result)).toHaveAccessibleName('show the background');
    await save(result);
    expect(savedLayout(saved).background).toEqual({ src: WALL, hidden: true });

    fireEvent.click(backgroundEye(result));
    expect(painted(result)).not.toBeNull();
    await save(result);
    expect(savedLayout(saved).background).toEqual({ src: WALL });
  });

  it('is never moved, and the layer commands move nothing beneath it', () => {
    const { result } = renderEditor({ ...LAYOUT, background: { src: WALL } });

    fireEvent.click(backgroundRow(result));
    for (const key of ['[', ']', '{', '}']) {
      fireEvent.keyDown(result.getByTestId('perch-editor-preview'), {
        key,
        ctrlKey: true,
        shiftKey: key === '{' || key === '}',
      });
    }
    fireEvent.keyDown(backgroundRow(result), { key: 'ArrowUp', altKey: true });
    expect(undoButton(result)).toBeDisabled();

    // The top element sent to the back lands just above the background, never under it.
    const top = list(result).querySelector<HTMLElement>('[data-perch-layer-index="1"]');
    if (top === null) throw new Error('no top element row');
    fireEvent.click(top);
    fireEvent.keyDown(result.getByTestId('perch-editor-preview'), {
      key: '{',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(result.getByTestId('perch-canvas').firstElementChild).toBe(painted(result));
    const rows = list(result).querySelectorAll('li');
    expect(rows[rows.length - 1]).toContainElement(backgroundRow(result));
  });

  it('removes its source from the header, asking first, so the canvas colour shows', () => {
    const { result } = renderEditor({ ...LAYOUT, background: { src: WALL, opacity: 0.5 } });
    fireEvent.click(backgroundRow(result));

    const header = within(result.getByTestId('perch-editor-selection'));
    fireEvent.click(header.getByRole('button', { name: /delete the background/ }));
    fireEvent.click(header.getByRole('button', { name: /delete the background|remove/ }));

    expect(painted(result)).toBeNull();
    expect(backgroundRow(result)).toHaveTextContent('none');
  });

  it("takes an opacity of its own, as an element's", () => {
    const { result } = renderEditor({ ...LAYOUT, background: { src: WALL } });
    fireEvent.click(backgroundRow(result));

    fireEvent.change(screen.getByLabelText('Opacity'), { target: { value: '40' } });

    expect(painted(result)?.style.opacity).toBe('0.4');
  });
});

describe('the eye on an element row', () => {
  it('hides the element on the canvas, keeps its row, and undoes in one step', () => {
    const { result } = renderEditor();

    fireEvent.click(within(list(result)).getByRole('button', { name: 'hide elements[1]' }));

    const canvasTexts = (): string[] =>
      [...result.getByTestId('perch-canvas').querySelectorAll('.perch-element')].map(
        (element) => element.textContent,
      );
    expect(canvasTexts()).toEqual(['a']);
    expect(list(result).querySelector('[data-perch-layer-index="1"]')).not.toBeNull();
    expect(within(list(result)).getByRole('button', { name: 'show elements[1]' })).toBeVisible();
    fireEvent.click(undoButton(result));
    expect(canvasTexts()).toEqual(['a', 'b']);
  });

  it('does not select the row it sits on', () => {
    const { result } = renderEditor();

    fireEvent.click(within(list(result)).getByRole('button', { name: 'hide elements[0]' }));

    expect(result.queryByTestId('perch-editor-selection')).toBeNull();
  });
});
