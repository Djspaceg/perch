/**
 * The Elements panel, after Photoshop's Layers palette: the eye in a fixed first column, a kind glyph
 * or thumbnail before each name, the background in italics with its lock at the right edge, a kind
 * filter and the selected element's opacity at the top, and a panel options menu. It says "element",
 * never "layer".
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Editor } from './app.js';
import { createLayoutLibrary } from './layout-library.js';

const LAYOUT: Layout = {
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  target: { width: 640, height: 400, frameRate: 30 },
  theme: {},
  background: { src: 'wall.png' },
  elements: [
    { kind: 'media', src: 'photo.png', rect: { x: 0, y: 0, w: 100, h: 100 } },
    {
      kind: 'widget',
      widget: 'readout',
      topic: 'sensors/cpu/0/temperature/0',
      rect: { x: 10, y: 10, w: 200, h: 60 },
    },
    { kind: 'text', text: 'hello', rect: { x: 10, y: 80, w: 200, h: 30 } },
    {
      kind: 'chart',
      widget: 'line-chart',
      topic: 'sensors/cpu/0/load/0',
      windowMs: 60_000,
      range: [0, 100],
      rect: { x: 10, y: 120, w: 200, h: 60 },
    },
    { kind: 'media', src: 'clip.mp4', rect: { x: 0, y: 200, w: 100, h: 100 } },
  ],
};

type Result = ReturnType<typeof render>;

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  } as Storage;
}

function renderEditor(storage?: Storage): Result {
  const source = createMockSource({ autoStart: false, seed: 1 });
  return render(
    <Editor
      platform="other"
      library={createLayoutLibrary({
        layouts: { 'elements-test': JSON.stringify(LAYOUT) },
        assets: {
          'photo.png': '/a/photo.png',
          'clip.mp4': '/a/clip.mp4',
          'wall.png': '/a/wall.png',
        },
      })}
      source={source}
      topics={source.topics}
      transport={() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })}
      {...(storage === undefined ? {} : { storage })}
    />,
  );
}

const panel = (result: Result): HTMLElement => result.getByRole('region', { name: /^Elements/ });
const list = (result: Result): HTMLElement => result.getByTestId('perch-editor-elements');
const rows = (result: Result): HTMLElement[] => [
  ...list(result).querySelectorAll<HTMLElement>('.perch-editor-layer'),
];
const rowOf = (result: Result, index: number): HTMLElement => {
  const row = list(result)
    .querySelector(`[data-perch-layer-index="${index}"]`)
    ?.closest<HTMLElement>('.perch-editor-layer');
  if (row === null || row === undefined) throw new Error(`no row for element ${index}`);
  return row;
};
const background = (result: Result): HTMLElement => {
  const row = result
    .getByTestId('perch-editor-background-row')
    .closest<HTMLElement>('.perch-editor-layer');
  if (row === null) throw new Error('no background row');
  return row;
};
/** The indices of the element rows still shown, top first. */
const shownIndices = (result: Result): string[] =>
  [...list(result).querySelectorAll('[data-perch-layer-index]')]
    .filter((row) => row.closest('[inert]') === null && row.closest('[hidden]') === null)
    .map((row) => row.getAttribute('data-perch-layer-index') ?? '');

describe('the visibility column', () => {
  it('is the first thing in every row, the background’s included', () => {
    const result = renderEditor();
    for (const row of rows(result)) {
      expect(row.firstElementChild).toHaveClass('perch-editor-eye');
    }
  });
});

describe('a glyph or thumbnail per row', () => {
  it('sits between the eye and the name, by kind', () => {
    const result = renderEditor();
    const glyphOf = (index: number): string | null =>
      rowOf(result, index)
        .querySelector('[data-perch-kind-glyph]')
        ?.getAttribute('data-perch-kind-glyph') ?? null;

    expect(glyphOf(2)).toBe('text');
    expect(glyphOf(3)).toBe('chart');
    expect(glyphOf(1)).toBe('reading');
    expect(glyphOf(4)).toBe('media');
    const button = rowOf(result, 2).querySelector('.perch-editor-element');
    expect(button?.firstElementChild).toHaveAttribute('data-perch-kind-glyph', 'text');
  });

  it('shows an image element’s own picture as its thumbnail, and a glyph for a video', () => {
    const result = renderEditor();
    const image = rowOf(result, 0).querySelector('img.perch-editor-thumb');

    expect(image).not.toBeNull();
    expect(image).toHaveAttribute('alt', '');
    expect(rowOf(result, 4).querySelector('img')).toBeNull();
  });

  it('falls back to the glyph when the picture cannot be loaded', () => {
    const result = renderEditor();
    const image = rowOf(result, 0).querySelector('img.perch-editor-thumb');
    if (image === null) throw new Error('no thumbnail');
    fireEvent.error(image);

    expect(rowOf(result, 0).querySelector('img')).toBeNull();
    expect(rowOf(result, 0).querySelector('[data-perch-kind-glyph="media"]')).not.toBeNull();
  });
});

describe('the background row', () => {
  it('has its name in italics and its lock at the right edge', () => {
    const result = renderEditor();
    const row = background(result);
    const name = row.querySelector('.perch-editor-element__name');
    const button = result.getByTestId('perch-editor-background-row');

    expect(name).toHaveTextContent('Background');
    expect(name).toHaveClass('perch-editor-element__name--locked');
    expect(button.lastElementChild?.querySelector('[data-perch-glyph="lock"]')).not.toBeNull();
  });
});

describe('the kind filter', () => {
  const toggle = (result: Result, name: string): HTMLElement =>
    within(within(panel(result)).getByRole('group', { name: 'filter elements by kind' })).getByRole(
      'button',
      { name },
    );

  it('is a Kind label and four toggles, all off', () => {
    const result = renderEditor();
    const filter = within(panel(result)).getByRole('group', { name: 'filter elements by kind' });

    expect(filter).toHaveTextContent('Kind');
    for (const name of ['Text', 'Media', 'Chart', 'Reading']) {
      expect(toggle(result, name)).toHaveAttribute('aria-pressed', 'false');
    }
    expect(shownIndices(result)).toEqual(['4', '3', '2', '1', '0']);
  });

  it('shows only the kinds pressed, keeps the background, and says the panel is filtered', () => {
    const result = renderEditor();
    fireEvent.click(toggle(result, 'Media'));

    expect(toggle(result, 'Media')).toHaveAttribute('aria-pressed', 'true');
    expect(shownIndices(result)).toEqual(['4', '0']);
    expect(result.getByTestId('perch-editor-background-row')).toBeVisible();
    expect(panel(result).querySelector('.perch-editor-group__title')).toHaveTextContent(
      'Elements (filtered)',
    );

    fireEvent.click(toggle(result, 'Text'));
    expect(shownIndices(result)).toEqual(['4', '2', '0']);
  });

  it('changes nothing in the layout', () => {
    const result = renderEditor();
    const painted = (): number =>
      result.getByTestId('perch-canvas').querySelectorAll('.perch-element').length;
    const before = painted();
    fireEvent.click(toggle(result, 'Chart'));

    expect(result.getByTestId('perch-editor-save')).toBeDisabled();
    expect(painted()).toBe(before);
  });

  it('clears in one click', () => {
    const result = renderEditor();
    fireEvent.click(toggle(result, 'Text'));
    fireEvent.click(toggle(result, 'Chart'));
    fireEvent.click(within(panel(result)).getByRole('button', { name: 'Clear the kind filter' }));

    expect(shownIndices(result)).toEqual(['4', '3', '2', '1', '0']);
    expect(panel(result).querySelector('.perch-editor-group__title')).toHaveTextContent(
      /^Elements$/,
    );
    expect(
      within(panel(result)).queryByRole('button', { name: 'Clear the kind filter' }),
    ).toBeNull();
  });
});

describe('the opacity at the top', () => {
  const field = (result: Result): HTMLInputElement => {
    const input = within(panel(result)).getByLabelText('Opacity of the selected element');
    if (!(input instanceof HTMLInputElement)) throw new Error('not an input');
    return input;
  };

  it('edits the selected element’s own opacity, the same value its panel shows', () => {
    const result = renderEditor();
    fireEvent.click(
      within(rowOf(result, 2)).getByRole('button', { current: false, name: /hello/ }),
    );
    expect(field(result).value).toBe('100');

    fireEvent.change(field(result), { target: { value: '40' } });

    const own = within(result.getByTestId('perch-editor-prop-opacity')).getByRole('spinbutton');
    expect((own as HTMLInputElement).value).toBe('40');
    expect(field(result).closest('.perch-number')?.querySelector('label')).toHaveTextContent(
      'Opacity',
    );
  });

  it('has nothing to edit with nothing selected', () => {
    const result = renderEditor();

    expect(within(panel(result)).queryByLabelText('Opacity of the selected element')).toBeNull();
    expect(panel(result).querySelector('.perch-elements-opacity')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('the panel options menu', () => {
  const openMenu = (result: Result): HTMLElement => {
    fireEvent.click(within(panel(result)).getByRole('button', { name: 'Elements panel options' }));
    return screen.getByRole('menu', { name: 'Elements panel options' });
  };

  it('opens from a three-line button in the Elements bar', () => {
    const result = renderEditor();
    const bar = panel(result).querySelector<HTMLElement>('.perch-editor-group__bar');
    if (bar === null) throw new Error('no Elements bar');
    const button = within(bar).getByRole('button', { name: 'Elements panel options' });

    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button.querySelector('svg[data-perch-glyph="menu"]')).not.toBeNull();
    const menu = openMenu(result);
    expect(
      [...menu.querySelectorAll('[role^="menuitem"]')].map((item) =>
        item.textContent.replace('✓', '').trim(),
      ),
    ).toEqual(['Show thumbnails', 'Clear kind filter', 'Reset panel order']);
  });

  it('hides and shows thumbnails, remembered', () => {
    const storage = memoryStorage();
    const result = renderEditor(storage);
    const item = within(openMenu(result)).getByRole('menuitemcheckbox', {
      name: 'Show thumbnails',
    });
    expect(item).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(item);

    expect(rowOf(result, 0).querySelector('img')).toBeNull();
    expect(rowOf(result, 0).querySelector('[data-perch-kind-glyph="media"]')).not.toBeNull();
    result.unmount();
    const again = renderEditor(storage);
    expect(rowOf(again, 0).querySelector('img')).toBeNull();
  });

  it('resets the panel order of Global and Selected entity, from here only', () => {
    const result = renderEditor();
    const global = result.getByRole('region', { name: 'Global' });
    const clock = within(global).getByRole('button', { name: 'move the Global Clock panel' });
    fireEvent.keyDown(clock, { key: 'ArrowUp', altKey: true });
    expect(within(global).queryByRole('button', { name: /reset/i })).toBeNull();

    const reset = within(openMenu(result)).getByRole('menuitem', { name: 'Reset panel order' });
    expect(reset).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(reset);

    const first = global.querySelector('[data-perch-panel]');
    expect(first).toHaveAttribute('data-perch-panel', 'target');
    expect(
      within(openMenu(result)).getByRole('menuitem', { name: 'Reset panel order' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('says "element", never "layer"', () => {
    const result = renderEditor();
    const words = [
      ...panel(result).querySelectorAll('*'),
      ...openMenu(result).querySelectorAll('*'),
    ].flatMap((node) => [
      node.getAttribute('aria-label') ?? '',
      node.getAttribute('data-perch-tip') ?? '',
      node.children.length === 0 ? node.textContent : '',
    ]);

    expect(words.filter((text) => /layer/i.test(text))).toEqual([]);
  });
});
