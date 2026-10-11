/**
 * The tool panels round: Global's panels named as Global's, the Elements list as its own group
 * between Global and the selected entity, no category tabs, a full-width text field, chips that never
 * truncate, a delete on the selected row, clock dropdowns, and panels dragged into an order that is
 * remembered.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { act, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from './app.js';
import { PROPERTY_ROW_STYLES } from './controls/property-row.js';
import { createLayoutLibrary } from './layout-library.js';

const LAYOUT: Layout = {
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  target: { width: 640, height: 400, frameRate: 30 },
  theme: {},
  background: { src: 'wall.png' },
  elements: [
    {
      kind: 'widget',
      widget: 'readout',
      topic: 'sensors/cpu/0/temperature/0',
      rect: { x: 10, y: 10, w: 200, h: 60 },
    },
    { kind: 'text', text: 'hello', rect: { x: 10, y: 80, w: 200, h: 30 } },
  ],
};

type Result = ReturnType<typeof render>;

function renderEditor(layout: Layout = LAYOUT, storage?: Storage): Result {
  const source = createMockSource({ autoStart: false, seed: 1 });

  return render(
    <Editor
      platform="other"
      library={createLayoutLibrary({ layouts: { 'panels-test': JSON.stringify(layout) } })}
      source={source}
      topics={source.topics}
      transport={() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })}
      {...(storage === undefined ? {} : { storage })}
    />,
  );
}

function selectElement(result: Result, index: number): void {
  const button = result
    .getByTestId('perch-editor-elements')
    .querySelector<HTMLElement>(`[data-perch-layer-index="${index}"]`);
  if (button === null) throw new Error(`no element ${index} in the list`);
  fireEvent.click(button);
}

const group = (result: Result, name: string): HTMLElement => result.getByRole('region', { name });

/** The titles of a group's top-level panels, in the order they are drawn. */
function panelTitles(region: HTMLElement): string[] {
  return [...region.querySelectorAll('.perch-section--section')]
    .filter((section) => section.parentElement?.closest('.perch-section') === null)
    .map((section) => section.querySelector('.perch-section__toggle')?.textContent ?? '');
}

/** A `localStorage` stand-in, so a second editor reads what the first remembered. */
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

/** Whether `a` comes before `b` in the document. */
function precedes(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Global’s panels', () => {
  it('are each titled "Global ..."', () => {
    const result = renderEditor();
    const titles = panelTitles(group(result, 'Global'));

    expect(titles).toEqual([
      'Global Target',
      'Global Clock',
      'Global Appearance',
      'Global Placement',
      'Global Typography',
      'Global Colour',
    ]);
  });

  it('keep their folds under the same ids as before the titles changed', () => {
    const storage = memoryStorage();
    const result = renderEditor(LAYOUT, storage);
    const target = within(group(result, 'Global')).getByRole('button', { name: 'Global Target' });
    expect(target).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(target);
    result.unmount();

    const again = renderEditor(LAYOUT, storage);
    expect(
      within(group(again, 'Global')).getByRole('button', { name: 'Global Target' }),
    ).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('the Elements group', () => {
  it('sits between Global and Selected entity, outside both', () => {
    const result = renderEditor();
    const global = group(result, 'Global');
    const elements = group(result, 'Elements');
    const entity = group(result, 'Selected entity');

    expect(elements).toHaveClass('perch-editor-group');
    expect(precedes(global, elements)).toBe(true);
    expect(precedes(elements, entity)).toBe(true);
    expect(entity.contains(elements)).toBe(false);
    expect(global.contains(elements)).toBe(false);
    expect(within(elements).getByTestId('perch-editor-elements')).toBeInTheDocument();
  });

  it('carries Add in its own bar', () => {
    const result = renderEditor();
    const bar = group(result, 'Elements').querySelector('.perch-editor-group__bar');
    if (!(bar instanceof HTMLElement)) throw new Error('no Elements bar');

    expect(within(bar).getByRole('button', { name: /^add an element/i })).toBeInTheDocument();
  });

  it('leaves the selected entity with its header first', () => {
    const result = renderEditor();
    selectElement(result, 0);
    const entity = group(result, 'Selected entity');
    const header = within(entity).getByTestId('perch-editor-selection');

    expect(panelTitles(entity)[0]).toBe('Content');
    expect(precedes(header, within(entity).getByRole('region', { name: 'Content' }))).toBe(true);
  });
});

describe('the category tabs', () => {
  it('are gone: Global lists every panel, and folds do the hiding', () => {
    const result = renderEditor();
    const global = group(result, 'Global');

    expect(within(global).queryByRole('group', { name: 'filter by sections' })).toBeNull();
    expect(within(global).queryByRole('button', { name: 'All' })).toBeNull();
    expect(panelTitles(global)).toHaveLength(6);
  });

  it('leave the Customize and Developer tabs and the search', () => {
    const result = renderEditor();
    const global = group(result, 'Global');

    expect(within(global).getByRole('tab', { name: 'Customize' })).toBeInTheDocument();
    expect(within(global).getByRole('tab', { name: 'Developer' })).toBeInTheDocument();
    expect(
      within(global).getByRole('searchbox', { name: 'search theme tokens' }),
    ).toBeInTheDocument();
  });
});

describe('the text field', () => {
  it('drops the label column: the label sits above, and the field spans the row', () => {
    const result = renderEditor();
    selectElement(result, 1);
    const row = result.getByTestId('perch-editor-prop-text');
    const label = row.querySelector('.perch-row__label');
    const value = row.querySelector('.perch-row__value');
    if (label === null || value === null) throw new Error('the text row has no label or value');

    expect(row).toHaveClass('perch-row--stacked');
    expect(within(label as HTMLElement).getByText('text')).toBeInTheDocument();
    expect(within(value as HTMLElement).getByRole('textbox')).toBeInstanceOf(HTMLTextAreaElement);
    expect(
      within(value as HTMLElement).getByRole('button', { name: /^insert a sensor/ }),
    ).toBeInTheDocument();
  });

  it('is laid out as a label line over a value that spans every column', () => {
    const css = PROPERTY_ROW_STYLES.replace(/\s+/g, ' ');

    expect(css).toMatch(/\.perch-row--stacked \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.perch-row--stacked \.perch-row__value \{[^}]*grid-column: 1 \/ -1/);
    expect(css).toMatch(/\.perch-row--stacked \.perch-row__label \{[^}]*grid-row: 1/);
  });

  it('keeps a one-line field, the widget name, in the label column', () => {
    const result = renderEditor();
    selectElement(result, 0);

    expect(result.getByTestId('perch-editor-prop-widget')).not.toHaveClass('perch-row--stacked');
  });
});

describe('delete on the selected row', () => {
  const list = (result: Result): HTMLElement => result.getByTestId('perch-editor-elements');
  const rowOf = (result: Result, index: number): HTMLElement => {
    const button = list(result).querySelector(`[data-perch-layer-index="${index}"]`);
    const row = button?.closest('.perch-editor-layer');
    if (!(row instanceof HTMLElement)) throw new Error(`no row for element ${index}`);
    return row;
  };

  it('sits right after Duplicate, named and tipped "Delete element"', () => {
    const result = renderEditor();
    selectElement(result, 1);
    const row = rowOf(result, 1);
    const duplicate = within(row).getByRole('button', { name: 'duplicate' });
    const trash = within(row).getByRole('button', { name: 'Delete element' });

    expect(duplicate.nextElementSibling).toBe(trash);
    expect(trash).toHaveAttribute('data-perch-tip', 'Delete element');
    expect(within(rowOf(result, 0)).queryByRole('button', { name: 'Delete element' })).toBeNull();
  });

  it('asks inline, then deletes that element', () => {
    const result = renderEditor();
    selectElement(result, 1);
    fireEvent.click(within(rowOf(result, 1)).getByRole('button', { name: 'Delete element' }));
    fireEvent.click(
      within(list(result)).getByRole('button', { name: /^confirm: delete elements\[1\]/ }),
    );

    expect(list(result).querySelectorAll('[data-perch-layer-index]')).toHaveLength(1);
  });

  it('is no longer in the Elements bar', () => {
    const result = renderEditor();
    selectElement(result, 1);
    const bar = group(result, 'Elements').querySelector('.perch-editor-group__bar');
    if (!(bar instanceof HTMLElement)) throw new Error('no Elements bar');

    expect(within(bar).queryByRole('button', { name: /delete/i })).toBeNull();
  });

  it('opens from the Delete key on the canvas, on the selected row', () => {
    const result = renderEditor();
    selectElement(result, 0);
    fireEvent.keyDown(result.getByTestId('perch-editor-preview'), { key: 'Delete' });

    expect(
      within(rowOf(result, 0)).getByRole('button', { name: /^confirm: delete elements\[0\]/ }),
    ).toHaveFocus();
  });

  it('is not offered on the background row', () => {
    const result = renderEditor();
    fireEvent.click(result.getByTestId('perch-editor-background-row'));
    const background = result
      .getByTestId('perch-editor-background-row')
      .closest('.perch-editor-layer');
    if (!(background instanceof HTMLElement)) throw new Error('no background row');

    expect(within(background).queryByRole('button', { name: /delete/i })).toBeNull();
    expect(within(list(result)).queryByRole('button', { name: /delete/i })).toBeNull();
  });

  it('says "element", never "layer", in what the list shows and tips', () => {
    const result = renderEditor();
    fireEvent.click(result.getByTestId('perch-editor-background-row'));
    const words = [...list(result).querySelectorAll('*')].flatMap((node) => [
      node.getAttribute('aria-label') ?? '',
      node.getAttribute('data-perch-tip') ?? '',
    ]);

    expect(words.filter((text) => /layer/i.test(text))).toEqual([]);
  });
});

describe('dragging panels', () => {
  const PANEL_HEIGHT = 40;

  /** The group's panels as drawn, each given a box PANEL_HEIGHT tall from y = 100. */
  function layOut(region: HTMLElement): void {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const panels = [...region.querySelectorAll<HTMLElement>('[data-perch-panel]')];
      const section = this.closest<HTMLElement>('[data-perch-panel]');
      const at = section === null ? -1 : panels.indexOf(section);
      const top = at === -1 ? 0 : 100 + at * PANEL_HEIGHT;
      const height = at === -1 ? 0 : this === section ? PANEL_HEIGHT : 22;
      return {
        top,
        bottom: top + height,
        left: 0,
        right: 300,
        width: 300,
        height,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    });
  }

  const grip = (region: HTMLElement, title: string): HTMLElement =>
    within(region).getByRole('button', { name: `move the ${title} panel` });

  it('gives each panel a grip just before its disclosure triangle', () => {
    const result = renderEditor();
    const global = group(result, 'Global');
    const handle = grip(global, 'Global Target');
    const toggle = within(global).getByRole('button', { name: 'Global Target' });

    expect(handle.closest('.perch-section__bar')).toBe(toggle.closest('.perch-section__bar'));
    expect(precedes(handle, toggle)).toBe(true);
    expect(handle).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
    expect(handle.getAttribute('data-perch-tip')).not.toMatch(/layer/i);
  });

  it('moves a panel with Alt+Up and Alt+Down on its grip, keeping focus on it', () => {
    const result = renderEditor();
    const global = group(result, 'Global');
    const clock = grip(global, 'Global Clock');
    clock.focus();
    fireEvent.keyDown(clock, { key: 'ArrowUp', altKey: true });

    expect(panelTitles(global).slice(0, 2)).toEqual(['Global Clock', 'Global Target']);
    expect(grip(global, 'Global Clock')).toHaveFocus();
    fireEvent.keyDown(grip(global, 'Global Clock'), { key: 'ArrowDown', altKey: true });
    expect(panelTitles(global).slice(0, 2)).toEqual(['Global Target', 'Global Clock']);
  });

  it('drags a panel: an insertion line where it would land, a faint clone following, and a drop', () => {
    const result = renderEditor();
    const global = group(result, 'Global');
    layOut(global);
    const target = grip(global, 'Global Target');

    fireEvent.pointerDown(target, {
      button: 0,
      buttons: 1,
      pointerId: 1,
      clientX: 10,
      clientY: 110,
    });
    // Below the middle of the third panel (Global Appearance, 180 to 220): gap 3.
    fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 30, clientY: 205 });

    const marked = global.querySelector('[data-perch-drop]');
    expect(marked).toHaveAttribute('data-perch-drop', 'above');
    expect(marked?.querySelector('.perch-section__toggle')).toHaveTextContent('Global Placement');
    const ghost = document.querySelector<HTMLElement>('.perch-drag-ghost');
    expect(ghost).not.toBeNull();
    expect(ghost).toHaveTextContent('Global Target');
    expect(ghost?.style.transform).toBe('translate(20px, 95px)');
    expect(ghost?.querySelector('[id]')).toBeNull();
    expect(within(global).getByRole('region', { name: 'Global Target' })).toHaveAttribute(
      'data-perch-dragging',
      'true',
    );

    fireEvent.pointerUp(window, { button: 0, pointerId: 1, clientX: 30, clientY: 205 });

    expect(panelTitles(global).slice(0, 3)).toEqual([
      'Global Clock',
      'Global Appearance',
      'Global Target',
    ]);
    expect(document.querySelector('.perch-drag-ghost')).toBeNull();
    expect(global.querySelector('[data-perch-drop]')).toBeNull();
  });

  it('lets go on Escape without moving anything', () => {
    const result = renderEditor();
    const global = group(result, 'Global');
    layOut(global);

    fireEvent.pointerDown(grip(global, 'Global Target'), {
      button: 0,
      buttons: 1,
      pointerId: 1,
      clientX: 10,
      clientY: 110,
    });
    fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 10, clientY: 205 });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(panelTitles(global)[0]).toBe('Global Target');
    expect(document.querySelector('.perch-drag-ghost')).toBeNull();
  });

  it('remembers the order across a reload, in the editor settings', () => {
    const storage = memoryStorage();
    const first = renderEditor(LAYOUT, storage);
    fireEvent.keyDown(grip(group(first, 'Global'), 'Global Clock'), {
      key: 'ArrowUp',
      altKey: true,
    });
    first.unmount();

    const stored = JSON.parse(storage.getItem('perch-editor') ?? '{}') as {
      state?: { settings?: { panels?: { order?: Record<string, string[]> } } };
    };
    expect(stored.state?.settings?.panels?.order?.['global']?.slice(0, 2)).toEqual([
      'clock',
      'target',
    ]);
    const again = renderEditor(LAYOUT, storage);
    expect(panelTitles(group(again, 'Global')).slice(0, 2)).toEqual([
      'Global Clock',
      'Global Target',
    ]);
  });

  it('keeps entity panels among entity panels, in one order for every element', () => {
    const result = renderEditor();
    selectElement(result, 0);
    const entity = group(result, 'Selected entity');
    fireEvent.keyDown(grip(entity, 'Transform'), { key: 'ArrowUp', altKey: true });
    expect(panelTitles(entity).slice(0, 2)).toEqual(['Transform', 'Content']);
    expect(panelTitles(group(result, 'Global'))[0]).toBe('Global Target');

    selectElement(result, 1);
    expect(panelTitles(entity).slice(0, 2)).toEqual(['Transform', 'Content']);
  });

  it('puts the default order back from "Reset panel order" in the Elements options', () => {
    const result = renderEditor();
    const global = group(result, 'Global');
    fireEvent.keyDown(grip(global, 'Global Clock'), { key: 'ArrowUp', altKey: true });
    fireEvent.click(
      within(group(result, 'Elements')).getByRole('button', { name: 'Elements panel options' }),
    );
    act(() => {
      fireEvent.click(
        within(result.getByRole('menu')).getByRole('menuitem', { name: 'Reset panel order' }),
      );
    });

    expect(panelTitles(global).slice(0, 2)).toEqual(['Global Target', 'Global Clock']);
  });

});
