/**
 * The tool panels round: Global's panels named as Global's, the Elements list as its own group
 * between Global and the selected entity, no category tabs, a full-width text field, chips that never
 * truncate, a delete on the selected row, clock dropdowns, and panels dragged into an order that is
 * remembered.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { fireEvent, render, within } from '@testing-library/react';
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

const group = (result: Result, name: string): HTMLElement =>
  result.getByRole('region', { name });

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
    expect(within(global).getByRole('searchbox', { name: 'search theme tokens' })).toBeInTheDocument();
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
