/**
 * The sidebar's shape across a change of selection: the Elements list first, carrying Add and Delete,
 * then the selected entity's sections — the ones two entities share kept mounted where they are, and
 * the ones that stop applying collapsing away rather than vanishing.
 *
 * jsdom resolves no custom property, so a `Collapse` settles at once unless a test gives it a real
 * duration with a plain stylesheet and ends the transition by hand, as `controls/collapse.test.tsx`
 * does.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { act, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from './app.js';
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
    { kind: 'media', src: 'photo.png', rect: { x: 10, y: 120, w: 200, h: 100 } },
    { kind: 'text', text: 'second', rect: { x: 10, y: 230, w: 200, h: 30 } },
  ],
};

type Result = ReturnType<typeof render>;

function renderEditor(): Result {
  const source = createMockSource({ autoStart: false, seed: 1 });

  return render(
    <Editor
      platform="other"
      library={createLayoutLibrary({ layouts: { 'stable-test': JSON.stringify(LAYOUT) } })}
      source={source}
      topics={source.topics}
      transport={() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })}
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

function selectBackground(result: Result): void {
  fireEvent.click(result.getByTestId('perch-editor-background-row'));
}

function entity(result: Result): HTMLElement {
  return result.getByRole('region', { name: 'Selected entity' });
}

function elementsPanel(result: Result): HTMLElement {
  return result.getByRole('region', { name: 'Elements' });
}

/** Whether `a` comes before `b` in the document. */
function precedes(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** The region a section's body animates in, around the section with this title. */
function regionAround(result: Result, title: string): HTMLElement {
  const section = within(entity(result)).getByRole('region', { name: title, hidden: true });
  const region = section.closest('.perch-collapse');
  if (!(region instanceof HTMLElement)) throw new Error(`no region around ${title}`);
  return region;
}

let style: HTMLStyleElement | undefined;
function withDuration(): void {
  style = document.createElement('style');
  style.textContent = '.perch-collapse { transition-duration: 180ms; }';
  document.head.append(style);
}
afterEach(() => {
  style?.remove();
  style = undefined;
  vi.unstubAllGlobals();
});

function finish(result: Result): void {
  act(() => {
    for (const region of result.container.querySelectorAll('.perch-collapse')) {
      region.dispatchEvent(new Event('transitionend', { bubbles: true }));
    }
  });
}

describe('the order of the sidebar', () => {
  it('puts the Elements list after Global and above the selected entity', () => {
    const result = renderEditor();
    selectElement(result, 0);
    const global = result.getByRole('region', { name: 'Global' });
    const list = elementsPanel(result);
    const header = result.getByTestId('perch-editor-selection');
    const transform = within(entity(result)).getByRole('region', { name: 'Transform' });

    expect(precedes(global, list)).toBe(true);
    expect(precedes(list, header)).toBe(true);
    expect(precedes(list, transform)).toBe(true);
  });
});

describe('Add and Delete live in the Elements list', () => {
  it('has Add in the list, and not in the selected entity’s bar', () => {
    const result = renderEditor();
    const bar = elementsPanel(result).querySelector('.perch-editor-group__bar');
    if (!(bar instanceof HTMLElement)) throw new Error('the Elements list has no bar');

    expect(within(bar).getByRole('button', { name: /^add an element/i })).toBeInTheDocument();
    const groupBar = entity(result).querySelector('.perch-editor-group__bar');
    expect(groupBar?.querySelector('button')).toBeNull();
  });

  it('deletes the selected element from the list, asking first, and not from its header', () => {
    const result = renderEditor();
    selectElement(result, 1);

    expect(
      within(result.getByTestId('perch-editor-selection')).queryByRole('button', {
        name: /^delete/,
      }),
    ).toBeNull();
    const list = elementsPanel(result);
    fireEvent.click(within(list).getByRole('button', { name: /^delete elements\[1\]/ }));
    fireEvent.click(within(list).getByRole('button', { name: /^confirm: delete elements\[1\]/ }));

    expect(
      result.getByTestId('perch-editor-elements').querySelectorAll('[data-perch-layer-index]'),
    ).toHaveLength(3);
  });

  it('asks from the list when Delete is pressed on the canvas', () => {
    const result = renderEditor();
    selectElement(result, 1);
    fireEvent.keyDown(result.getByTestId('perch-editor-preview'), { key: 'Delete' });

    expect(
      within(elementsPanel(result)).getByRole('button', { name: /^confirm: delete elements\[1\]/ }),
    ).toHaveFocus();
  });

  it('removes the background’s source from the list, as its header did, and never the row', () => {
    const result = renderEditor();
    selectBackground(result);

    expect(
      within(result.getByTestId('perch-editor-selection')).queryByRole('button', {
        name: /^delete/,
      }),
    ).toBeNull();
    const list = elementsPanel(result);
    fireEvent.click(within(list).getByRole('button', { name: /^delete the background/ }));
    fireEvent.click(within(list).getByRole('button', { name: /^confirm: delete the background/ }));

    expect(result.getByTestId('perch-editor-background-row')).toHaveTextContent('none');
  });

  it('offers no delete with nothing selected', () => {
    const result = renderEditor();
    const trash = within(elementsPanel(result)).getByRole('button', { name: /select a layer/ });

    expect(trash).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('sections across a change of selection', () => {
  it('keeps the sections two elements share mounted, as the same nodes', () => {
    const result = renderEditor();
    selectElement(result, 0);
    const transform = within(entity(result)).getByRole('region', { name: 'Transform' });
    const appearance = result.getByTestId('perch-editor-appearance');
    const header = result.getByTestId('perch-editor-selection');
    const x = within(transform).getByRole('spinbutton', { name: 'x' });

    selectElement(result, 1);

    expect(within(entity(result)).getByRole('region', { name: 'Transform' })).toBe(transform);
    expect(result.getByTestId('perch-editor-appearance')).toBe(appearance);
    expect(result.getByTestId('perch-editor-selection')).toBe(header);
    // Only the value changed.
    expect(within(transform).getByRole('spinbutton', { name: 'x' })).toBe(x);
  });

  it('keeps Content and Appearance as the same nodes between a media element and the background', () => {
    const result = renderEditor();
    selectElement(result, 2);
    const content = within(entity(result)).getByRole('region', { name: 'Content' });
    const appearance = result.getByTestId('perch-editor-appearance');

    selectBackground(result);

    expect(within(entity(result)).getByRole('region', { name: 'Content' })).toBe(content);
    expect(result.getByTestId('perch-editor-appearance')).toBe(appearance);
  });

  it('keeps a shared section folded the way the author left it', () => {
    const result = renderEditor();
    selectElement(result, 0);
    fireEvent.click(within(entity(result)).getByRole('button', { name: 'Transform' }));
    selectElement(result, 1);

    expect(within(entity(result)).getByRole('button', { name: 'Transform' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('collapses a section that no longer applies, inert, before it goes', () => {
    withDuration();
    const result = renderEditor();
    selectElement(result, 1);
    selectBackground(result);

    // The background has no rect: Transform is on its way out, not gone.
    const leaving = regionAround(result, 'Transform');
    expect(leaving).toHaveAttribute('data-perch-phase', 'closing');
    expect(leaving).toHaveAttribute('inert');
    // Only Transform: the header and the sections the two share stay where they are, live.
    expect(result.getByTestId('perch-editor-selection').closest('[inert]')).toBeNull();
    expect(result.getByTestId('perch-editor-appearance').closest('[inert]')).toBeNull();

    finish(result);
    expect(within(entity(result)).queryByRole('region', { name: 'Transform' })).toBeNull();
  });

  it('grows in a section that newly applies', () => {
    withDuration();
    const result = renderEditor();
    selectBackground(result);
    finish(result);
    selectElement(result, 1);

    expect(regionAround(result, 'Transform').getAttribute('data-perch-phase')).toMatch(
      /^(entering|opening)$/,
    );
    // Only Transform grows: the header around it was already open, and stays so.
    expect(result.getByTestId('perch-editor-selection').closest('.perch-collapse')).toHaveAttribute(
      'data-perch-phase',
      'open',
    );
    finish(result);
    expect(regionAround(result, 'Transform')).toHaveAttribute('data-perch-phase', 'open');
  });

  it('grows in the token rows only the new kind reads, inside a section the two share', () => {
    withDuration();
    const result = renderEditor();
    selectElement(result, 0);
    finish(result);
    const placement = result.getByTestId('perch-editor-placement');
    selectElement(result, 1);

    // Placement is kept; the text's own placement grid arrives in it.
    expect(result.getByTestId('perch-editor-placement')).toBe(placement);
    const grid = result.getByTestId('perch-editor-placement-style-1---perch-text-justify');
    expect(grid.closest('.perch-collapse')?.getAttribute('data-perch-phase')).toMatch(
      /^(entering|opening)$/,
    );
  });

  it('changes at once under reduced motion', () => {
    withDuration();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const result = renderEditor();
    selectElement(result, 1);
    selectBackground(result);

    expect(within(entity(result)).queryByRole('region', { name: 'Transform' })).toBeNull();
  });

  it('collapses the selected entity away when the selection clears, rather than snapping', () => {
    withDuration();
    const result = renderEditor();
    selectElement(result, 1);
    finish(result);
    fireEvent.keyDown(result.getByTestId('perch-editor-preview'), { key: 'Escape' });

    const leaving = result.getByTestId('perch-editor-selection').closest('.perch-collapse');
    expect(leaving).toHaveAttribute('data-perch-phase', 'closing');
    finish(result);
    expect(result.queryByTestId('perch-editor-selection')).toBeNull();
  });
});
