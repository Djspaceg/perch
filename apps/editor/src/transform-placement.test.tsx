/**
 * The entity's Placement panel (the section keyed `transform`): an Affinity-style resize anchor at
 * the left of x/y and w/h, which show and resize about the anchor point, and under them, on a band
 * of its own, the content alignment grid with its caption, set dot and reset.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { act, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from './app.js';
import { createLayoutLibrary } from './layout-library.js';
import { TRANSFORM_STYLES } from './transform-block.js';

const LAYOUT: Layout = {
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  target: { width: 640, height: 400, frameRate: 30 },
  theme: {},
  elements: [
    {
      kind: 'widget',
      widget: 'readout',
      topic: 'sensors/cpu/0/temperature/0',
      rect: { x: 10, y: 10, w: 200, h: 60 },
    },
    { kind: 'text', text: 'hello', rect: { x: 300, y: 70, w: 215, h: 20 } },
    { kind: 'media', src: 'photo.png', rect: { x: 0, y: 0, w: 100, h: 100 } },
    {
      kind: 'chart',
      widget: 'line-chart',
      topic: 'sensors/cpu/0/load/0',
      windowMs: 60_000,
      range: [0, 100],
      rect: { x: 10, y: 120, w: 200, h: 60 },
    },
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
      library={createLayoutLibrary({ layouts: { 'placement-test': JSON.stringify(LAYOUT) } })}
      source={source}
      topics={source.topics}
      transport={() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })}
      {...(storage === undefined ? {} : { storage })}
    />,
  );
}

function select(result: Result, index: number): void {
  const row = result
    .getByTestId('perch-editor-elements')
    .querySelector<HTMLElement>(`[data-perch-layer-index="${index}"]`);
  if (row === null) throw new Error(`no element ${index}`);
  fireEvent.click(row);
}

const entity = (result: Result): HTMLElement =>
  result.getByRole('region', { name: 'Selected entity' });
const placement = (result: Result): HTMLElement =>
  within(entity(result)).getByRole('region', { name: 'Placement' });
const anchorGrid = (result: Result): HTMLElement =>
  within(placement(result)).getByRole('radiogroup', { name: /^Resize anchor: / });
const contentGrid = (result: Result): HTMLElement =>
  within(placement(result)).getByRole('radiogroup', { name: /^Content alignment: / });
const field = (result: Result, name: 'x' | 'y' | 'w' | 'h'): HTMLInputElement => {
  const input = within(placement(result)).getByRole('spinbutton', { name });
  if (!(input instanceof HTMLInputElement)) throw new Error(`${name} is not an input`);
  return input;
};
const chooseAnchor = (result: Result, cell: string): void => {
  fireEvent.click(within(anchorGrid(result)).getByRole('radio', { name: cell }));
};

let style: HTMLStyleElement | undefined;
afterEach(() => {
  style?.remove();
  style = undefined;
});

describe('the Placement panel', () => {
  it('is what Transform was: the same section, renamed, keeping its key', () => {
    const result = renderEditor();
    select(result, 1);
    const panel = placement(result);

    expect(panel).toHaveAttribute('data-perch-panel', 'transform');
    expect(within(entity(result)).queryByRole('region', { name: 'Transform' })).toBeNull();
    expect(within(entity(result)).getAllByRole('region', { name: 'Placement' })).toHaveLength(1);
    expect(
      within(result.getByRole('region', { name: 'Global' })).getByRole('region', {
        name: 'Global Placement',
      }),
    ).toBeInTheDocument();
  });

  it('keeps a fold saved under the old key', () => {
    const storage = memoryStorage();
    const first = renderEditor(storage);
    select(first, 1);
    fireEvent.click(within(entity(first)).getByRole('button', { name: 'Placement' }));
    first.unmount();

    const again = renderEditor(storage);
    select(again, 1);
    expect(within(entity(again)).getByRole('button', { name: 'Placement' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

describe('the resize anchor', () => {
  it('is a three-by-three grid at the left of x/y and w/h, top left by default', () => {
    const result = renderEditor();
    select(result, 1);
    const block = placement(result).querySelector('.perch-transform__inner');
    if (block === null) throw new Error('no resize band');

    expect(block).toContainElement(anchorGrid(result));
    expect(within(anchorGrid(result)).getAllByRole('radio')).toHaveLength(9);
    expect(anchorGrid(result)).toHaveAccessibleName('Resize anchor: top left');
    expect(
      anchorGrid(result).compareDocumentPosition(field(result, 'x')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(anchorGrid(result)).toHaveAttribute(
      'data-perch-tip',
      expect.stringMatching(/x and y are this point.s position, and w and h resize about it/),
    );
    expect(field(result, 'x').value).toBe('300');
    expect(field(result, 'y').value).toBe('70');
  });

  it('shows the anchor point’s coordinates, and moves the box by them', () => {
    const result = renderEditor();
    select(result, 1);
    chooseAnchor(result, 'middle centre');

    expect(field(result, 'x').value).toBe('407');
    expect(field(result, 'y').value).toBe('80');
    fireEvent.change(field(result, 'x'), { target: { value: '500' } });

    chooseAnchor(result, 'top left');
    expect(field(result, 'x').value).toBe('393');
  });

  it('resizes about the anchor, which stays put', () => {
    const result = renderEditor();
    select(result, 1);
    chooseAnchor(result, 'bottom right');
    expect(field(result, 'x').value).toBe('515');
    fireEvent.change(field(result, 'w'), { target: { value: '115' } });

    expect(field(result, 'x').value).toBe('515');
    chooseAnchor(result, 'top left');
    expect(field(result, 'x').value).toBe('400');
    expect(field(result, 'w').value).toBe('115');
  });

  it('is one anchor for every element, remembered across a reload', () => {
    const storage = memoryStorage();
    const first = renderEditor(storage);
    select(first, 1);
    chooseAnchor(first, 'middle centre');
    select(first, 2);
    expect(anchorGrid(first)).toHaveAccessibleName('Resize anchor: middle centre');
    expect(field(first, 'x').value).toBe('50');
    first.unmount();

    const again = renderEditor(storage);
    select(again, 0);
    expect(anchorGrid(again)).toHaveAccessibleName('Resize anchor: middle centre');
  });

  it('is in the summary too: the folded bar names the anchor point', () => {
    const result = renderEditor();
    select(result, 1);
    chooseAnchor(result, 'middle centre');

    expect(placement(result).querySelector('.perch-section__summary')).toHaveTextContent(
      '407, 80 · 215 × 20',
    );
  });
});

describe('content alignment', () => {
  it('sits on its own band under the resize fields, labelled', () => {
    const result = renderEditor();
    select(result, 1);
    const band = placement(result).querySelector('.perch-transform__content');
    if (band === null) throw new Error('no content band');

    expect(band).toContainElement(contentGrid(result));
    expect(band).toHaveTextContent('Content alignment');
    expect(band.querySelector('.perch-row__label')).toHaveTextContent('Content alignment');
    expect(
      field(result, 'h').compareDocumentPosition(contentGrid(result)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(placement(result).querySelector('.perch-transform__inner')).not.toContainElement(
      contentGrid(result),
    );
    expect(within(contentGrid(result)).getAllByRole('radio')).toHaveLength(16);
  });

  it('is an ordinary property row: label and caption on the left, the grid in the value column', () => {
    const result = renderEditor();
    select(result, 1);
    const row = placement(result).querySelector<HTMLElement>('.perch-transform__content');
    if (row === null) throw new Error('no content row');
    const label = row.querySelector<HTMLElement>(':scope > .perch-row__label');
    const value = row.querySelector<HTMLElement>(':scope > .perch-row__value');
    if (label === null || value === null) throw new Error('not a property row');

    expect(row).toHaveClass('perch-row');
    expect(within(label).getByText('Content alignment')).toHaveClass('perch-row__label-text');
    expect(label.querySelector('.perch-transform__caption')).toHaveTextContent('left, middle');
    expect(value).toContainElement(contentGrid(result));
    expect(label).not.toContainElement(contentGrid(result));
    // Not inside the resize band's padded block, which would push its columns off the rows below.
    expect(row.closest('.perch-transform')).toBeNull();
  });

  it('writes the content placement, with the set dot in the dot column and the reset at the end', () => {
    const result = renderEditor();
    select(result, 1);
    fireEvent.click(within(contentGrid(result)).getByRole('radio', { name: 'bottom right' }));
    const row = placement(result).querySelector<HTMLElement>('.perch-transform__content');
    if (row === null) throw new Error('no content row');

    expect(row).toHaveAttribute('data-perch-source', 'own');
    expect(row.querySelector(':scope > .perch-row__label > .perch-row__mark')).not.toBeNull();
    expect(row.querySelector('.perch-transform__caption')).toHaveTextContent('right, bottom');
    const end = row.querySelector<HTMLElement>(':scope > .perch-row__end');
    if (end === null) throw new Error('no end slot');
    fireEvent.click(within(end).getByRole('button', { name: /^reset Content alignment/ }));

    expect(contentGrid(result)).toHaveAccessibleName('Content alignment: left, middle');
    expect(row.querySelector(':scope > .perch-row__end button')).toBeNull();
  });

  it('says it places the content, not the box', () => {
    const result = renderEditor();
    select(result, 1);

    expect(contentGrid(result)).toHaveAttribute(
      'data-perch-tip',
      expect.stringMatching(
        /^Content alignment: left, middle\. Where the text sits inside its box/,
      ),
    );
  });

  it('is the readout placement for a reading, three by three', () => {
    const result = renderEditor();
    select(result, 0);

    expect(within(contentGrid(result)).getAllByRole('radio')).toHaveLength(9);
  });

  it('shows only for kinds that have it; the anchor and fields stay for every kind', () => {
    const result = renderEditor();
    for (const index of [2, 3]) {
      select(result, index);

      expect(anchorGrid(result)).toBeInTheDocument();
      expect(
        within(placement(result)).queryByRole('radiogroup', { name: /^Content alignment/ }),
      ).toBeNull();
    }
  });

  it('folds its band away and back, the panel kept', () => {
    style = document.createElement('style');
    style.textContent = '.perch-collapse { transition-duration: 180ms; }';
    document.head.append(style);
    const result = renderEditor();
    select(result, 1);
    const kept = placement(result);
    select(result, 2);

    expect(placement(result)).toBe(kept);
    const band = kept.querySelector('.perch-transform__content')?.closest('.perch-collapse');
    expect(band?.getAttribute('data-perch-phase')).toBe('closing');
    act(() => {
      band?.dispatchEvent(new Event('transitionend', { bubbles: true }));
    });
    select(result, 1);
    expect(kept.querySelector('.perch-transform__content')).not.toBeNull();
  });
});

describe('a content placement the grid cannot show', () => {
  it('is left to its token rows, under "Content alignment" rather than a second Placement', () => {
    const odd: Layout = {
      ...LAYOUT,
      elements: [
        {
          kind: 'widget',
          widget: 'readout',
          topic: 'sensors/cpu/0/temperature/0',
          rect: { x: 10, y: 10, w: 200, h: 60 },
          style: { '--perch-readout-justify': 'flex-start' },
        },
      ],
    };
    const source = createMockSource({ autoStart: false, seed: 1 });
    const result = render(
      <Editor
        platform="other"
        library={createLayoutLibrary({ layouts: { 'odd-test': JSON.stringify(odd) } })}
        source={source}
        topics={source.topics}
        transport={() =>
          Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })
        }
      />,
    );
    select(result, 0);

    expect(within(entity(result)).getAllByRole('region', { name: 'Placement' })).toHaveLength(1);
    expect(
      within(entity(result)).getByRole('region', { name: 'Content alignment' }),
    ).toBeInTheDocument();
  });
});

describe('the narrow fallback', () => {
  it('puts the anchor grid on its own row above the fields when the block is too narrow', () => {
    const css = TRANSFORM_STYLES.replace(/\s+/g, ' ');

    expect(css).toMatch(/\.perch-transform \{[^}]*container-type: inline-size/);
    expect(css).toMatch(
      /@container \(max-width: \d+px\) \{ \.perch-transform__inner \{[^}]*flex-direction: column/,
    );
  });
});
