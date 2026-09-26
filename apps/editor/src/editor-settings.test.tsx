/**
 * The editor's settings surviving a reload, as an author meets them: the layout last picked, the
 * sections folded, the tab and the chip chosen. A reload is a second editor mounted over the same
 * storage. `?layout=` still names the layout to open, over a remembered one.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Editor } from './app.js';
import { createLayoutLibrary, type LayoutLibrary } from './layout-library.js';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

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
  };
}

function layoutText(width: number, text: string): string {
  const layout: Layout = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    target: { width, height: 200, frameRate: 30 },
    theme: {},
    elements: [{ kind: 'text', text, rect: { x: 10, y: 10, w: 200, h: 30 } }],
  };

  return JSON.stringify(layout);
}

function testLibrary(): LayoutLibrary {
  return createLayoutLibrary({
    layouts: { 'desk-test': layoutText(640, 'desk'), 'tower-test': layoutText(200, 'tower') },
  });
}

describe('the editor over a remembered store', () => {
  function renderEditor(storage: Storage, initialLayout?: string): ReturnType<typeof render> {
    const source = createMockSource({ autoStart: false, seed: 1 });

    return render(
      <Editor
        library={testLibrary()}
        source={source}
        topics={source.topics}
        transport={() =>
          Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })
        }
        storage={storage}
        initialLayout={initialLayout}
      />,
    );
  }

  function picker(): HTMLSelectElement {
    return within(screen.getByTestId('perch-editor-header')).getByRole('combobox');
  }

  it('reopens the layout last picked, unless ?layout= names another', () => {
    const storage = memoryStorage();
    const first = renderEditor(storage);
    expect(picker()).toHaveValue('desk-test');
    fireEvent.change(picker(), { target: { value: 'tower-test' } });
    first.unmount();

    const reload = renderEditor(storage);
    expect(picker()).toHaveValue('tower-test');
    reload.unmount();

    renderEditor(storage, 'desk-test');
    expect(picker()).toHaveValue('desk-test');
  });

  /** A section's own toggle: the button inside its heading, not the chip of the same name. */
  function toggle(name: string): HTMLElement {
    const global = within(screen.getByTestId('perch-editor-group-global'));

    return within(global.getByRole('heading', { name })).getByRole('button');
  }

  function globalTab(name: string): HTMLElement {
    return within(screen.getByTestId('perch-editor-group-global')).getByRole('tab', { name });
  }

  function chip(name: string): HTMLElement {
    const chips = within(screen.getByRole('group', { name: 'filter by sections' }));

    return chips.getByRole('button', { name });
  }

  it('reopens with the same folded sections, tab and chip', () => {
    const storage = memoryStorage();
    const first = renderEditor(storage);
    fireEvent.click(toggle('Target'));
    fireEvent.click(toggle('Typography'));
    first.unmount();

    const second = renderEditor(storage);
    expect(toggle('Target')).toHaveAttribute('aria-expanded', 'false');
    expect(toggle('Typography')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(globalTab('Developer'));
    second.unmount();

    const third = renderEditor(storage);
    expect(globalTab('Developer')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(globalTab('Customize'));
    fireEvent.click(chip('Colour'));
    third.unmount();

    renderEditor(storage);
    expect(globalTab('Customize')).toHaveAttribute('aria-selected', 'true');
    expect(chip('Colour')).toHaveAttribute('aria-pressed', 'true');
  });
});
