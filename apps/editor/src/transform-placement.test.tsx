/**
 * Transform with the content alignment grid in it: the grid at the left, x/y and w/h beside it as two
 * rows with no label column, the grid's meaning (where the content sits inside the box) in its name
 * and tooltip, a caption with its set dot and reset, and no Placement panel left for the entity.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { act, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from './app.js';
import { TRANSFORM_STYLES } from './transform-block.js';
import { createLayoutLibrary } from './layout-library.js';

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
    { kind: 'text', text: 'hello', rect: { x: 300, y: 70, w: 214, h: 20 } },
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

function renderEditor(): Result {
  const source = createMockSource({ autoStart: false, seed: 1 });
  return render(
    <Editor
      platform="other"
      library={createLayoutLibrary({ layouts: { 'transform-test': JSON.stringify(LAYOUT) } })}
      source={source}
      topics={source.topics}
      transport={() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })}
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
const transform = (result: Result): HTMLElement =>
  within(entity(result)).getByRole('region', { name: 'Transform' });
const grid = (result: Result): HTMLElement =>
  within(transform(result)).getByRole('radiogroup', { name: /^Content alignment: / });

let style: HTMLStyleElement | undefined;
afterEach(() => {
  style?.remove();
  style = undefined;
});

describe('the alignment grid in Transform', () => {
  it('sits at the left of x/y and w/h, which have no label column', () => {
    const result = renderEditor();
    select(result, 1);
    const block = transform(result).querySelector('.perch-transform');
    if (block === null) throw new Error('no transform block');
    const x = within(transform(result)).getByRole('spinbutton', { name: 'x' });

    expect(block).toContainElement(grid(result));
    expect(block).toContainElement(x);
    expect(grid(result).compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(transform(result).querySelector('.perch-row__label')).toBeNull();
    const rows = block.querySelectorAll('.perch-transform__fields > .perch-transform__row');
    expect(rows).toHaveLength(2);
    expect(
      within(rows[0] as HTMLElement).getByRole('spinbutton', { name: 'y' }),
    ).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByRole('spinbutton', { name: 'w' }),
    ).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByRole('spinbutton', { name: 'h' }),
    ).toBeInTheDocument();
  });

  it('says it places the content inside the box, in its name and tooltip', () => {
    const result = renderEditor();
    select(result, 1);

    expect(grid(result)).toHaveAccessibleName('Content alignment: left, middle');
    expect(grid(result).closest('[data-perch-tip]')).toHaveAttribute(
      'data-perch-tip',
      expect.stringMatching(
        /^Content alignment: left, middle\. Where the text sits inside its box/,
      ),
    );
    expect(grid(result).closest('[data-perch-tip]')?.getAttribute('data-perch-tip')).not.toMatch(
      /layer|anchor/i,
    );
  });

  it('writes the text placement, with a caption, its set dot and one reset', () => {
    const result = renderEditor();
    select(result, 1);
    fireEvent.click(within(grid(result)).getByRole('radio', { name: 'bottom right' }));

    const caption = transform(result).querySelector('.perch-transform__caption');
    expect(caption).toHaveTextContent('right, bottom');
    expect(caption).toHaveAttribute('data-perch-source', 'own');
    expect(caption?.querySelector('.perch-row__mark')).not.toBeNull();
    const reset = within(caption as HTMLElement).getByRole('button', {
      name: /^reset Content alignment/,
    });
    fireEvent.click(reset);
    expect(grid(result)).toHaveAccessibleName('Content alignment: left, middle');
    expect(transform(result).querySelector('.perch-transform__caption button')).toBeNull();
  });

  it('uses the readout placement for a reading, three by three', () => {
    const result = renderEditor();
    select(result, 0);

    expect(within(grid(result)).getAllByRole('radio')).toHaveLength(9);
    expect(grid(result)).toHaveAccessibleName('Content alignment: left, top');
  });
});

describe('the Placement panel', () => {
  it('is gone from the selected entity, left only in Global', () => {
    const result = renderEditor();
    select(result, 1);

    expect(within(entity(result)).queryByRole('region', { name: 'Placement' })).toBeNull();
    select(result, 0);
    expect(within(entity(result)).queryByRole('region', { name: 'Placement' })).toBeNull();
    expect(
      within(result.getByRole('region', { name: 'Global' })).getByRole('region', {
        name: 'Global Placement',
      }),
    ).toBeInTheDocument();
  });
});

describe('kinds without a placement', () => {
  it('show only the fields, at the full width', () => {
    const result = renderEditor();
    for (const index of [2, 3]) {
      select(result, index);
      const block = transform(result).querySelector('.perch-transform');

      expect(block).toHaveAttribute('data-perch-grid', 'false');
      expect(within(transform(result)).queryByRole('radiogroup')).toBeNull();
    }
  });

  it('keep Transform mounted, the grid folding out and in', () => {
    style = document.createElement('style');
    style.textContent = '.perch-transform__grid { transition-duration: 180ms; }';
    document.head.append(style);
    const result = renderEditor();
    select(result, 1);
    const kept = transform(result);
    select(result, 2);

    expect(transform(result)).toBe(kept);
    const leaving = kept.querySelector('.perch-transform__grid');
    expect(leaving).toHaveAttribute('data-perch-open', 'false');
    expect(leaving).toHaveAttribute('inert');
    act(() => {
      leaving?.dispatchEvent(new Event('transitionend', { bubbles: true }));
    });
    select(result, 1);
    expect(kept.querySelector('.perch-transform__grid')).toHaveAttribute('data-perch-open', 'true');
  });
});

describe('the narrow fallback', () => {
  it('puts the grid on its own row above the fields when the block is too narrow', () => {
    const css = TRANSFORM_STYLES.replace(/\s+/g, ' ');

    expect(css).toMatch(/\.perch-transform \{[^}]*container-type: inline-size/);
    expect(css).toMatch(
      /@container \(max-width: \d+px\) \{ \.perch-transform__inner \{[^}]*flex-direction: column/,
    );
  });
});
