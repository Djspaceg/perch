/**
 * The header in a small window: it never wraps and never clips. What does not fit moves, least
 * needed first, into the "more" popover at its end, and comes back when there is room; the unsaved
 * mark and Save never move. In a browser the popover also holds the colour scheme, which the desktop
 * app keeps in its Settings window.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from './app.js';
import type { EditorHost } from './editor-host.js';
import { fitHeader } from './header-bar.js';
import { createLayoutLibrary } from './layout-library.js';

function layoutText(): string {
  const layout: Layout = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    target: { width: 640, height: 200, frameRate: 30 },
    theme: {},
    elements: [{ kind: 'text', text: 'x', rect: { x: 10, y: 10, w: 200, h: 30 } }],
  };

  return JSON.stringify(layout);
}

function renderEditor(host?: EditorHost): ReturnType<typeof render> {
  const source = createMockSource({ autoStart: false, seed: 1 });

  return render(
    <Editor
      library={createLayoutLibrary({ layouts: { 'desk-test': layoutText() } })}
      source={source}
      topics={source.topics}
      transport={() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })}
      host={host}
      platform="other"
    />,
  );
}

const header = () => within(screen.getByTestId('perch-editor-header'));

/**
 * jsdom lays nothing out, so every width is 0 and everything fits. Give the header and each of its
 * items a width, as a browser would.
 */
function layOut(headerWidth: number, itemWidth = 100): void {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset['testid'] === 'perch-editor-header' ? headerWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset['perchHeaderItem'] !== undefined ||
      this.dataset['perchHeaderMore'] !== undefined
      ? itemWidth
      : 0;
  });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fitHeader', () => {
  const items = [
    { key: 'brand', width: 100, drop: 1 },
    { key: 'fit', width: 100, drop: 2 },
    { key: 'undo', width: 50, drop: 5 },
    { key: 'save', width: 50, drop: Number.POSITIVE_INFINITY },
  ];

  it('keeps everything that fits, with room for the more button only when it is needed', () => {
    expect(fitHeader({ available: 330, gap: 10, items, more: 30, moreAlways: false })).toEqual([]);
    expect(fitHeader({ available: 329, gap: 10, items, more: 30, moreAlways: false })).toEqual([
      'brand',
    ]);
  });

  it('drops the least needed first, and never what is pinned', () => {
    expect(fitHeader({ available: 100, gap: 10, items, more: 30, moreAlways: true })).toEqual([
      'brand',
      'fit',
      'undo',
    ]);
  });
});

describe('the header in a narrow window', () => {
  it('moves what does not fit into more, least needed first, and brings it back when wide', () => {
    renderEditor();
    layOut(520);

    // The brand goes first, then the fit; the picker and Save stay.
    expect(header().queryByText('perch · editor')).toBeNull();
    expect(header().getByLabelText('layout')).toBeInTheDocument();
    expect(screen.getByTestId('perch-editor-save')).toBeInTheDocument();

    fireEvent.click(header().getByRole('button', { name: 'more' }));
    const more = within(screen.getByRole('dialog', { name: 'more' }));
    expect(more.getByText('perch · editor')).toBeInTheDocument();
    expect(more.queryByTestId('perch-editor-save')).toBeNull();

    layOut(4000);
    expect(header().getByText('perch · editor')).toBeInTheDocument();
  });

  it('keeps the unsaved mark and Save in the header however narrow', () => {
    renderEditor();
    layOut(200);

    expect(header().getByTestId('perch-editor-save')).toBeInTheDocument();
    expect(header().getByRole('button', { name: 'more' })).toBeInTheDocument();
    expect(header().queryByRole('button', { name: 'undo' })).toBeNull();
  });
});

describe('the colour scheme in a browser', () => {
  it('is picked from more, shown at once and remembered', () => {
    const first = renderEditor();
    fireEvent.click(header().getByRole('button', { name: 'more' }));
    const group = within(screen.getByRole('radiogroup', { name: 'colour scheme' }));
    expect(group.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(group.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement).toHaveAttribute('data-ed-scheme', 'light');
    first.unmount();
    expect(document.documentElement).not.toHaveAttribute('data-ed-scheme');
  });

  it('is not offered in the desktop app, whose Settings window has it', () => {
    const host: EditorHost = {
      saveAs: () => Promise.resolve(null),
      open: () => Promise.resolve(null),
      setDocumentState: () => undefined,
      setMenuBindings: () => undefined,
      onCommand: () => () => undefined,
      onSaveRequest: () => () => undefined,
      saveDone: () => undefined,
      nativeEdit: () => undefined,
      setMenuState: () => undefined,
      openSettings: () => undefined,
      onOpenDocument: () => () => undefined,
    };
    renderEditor(host);

    // Everything fits, and there is nothing else for more to hold.
    expect(header().queryByRole('button', { name: 'more' })).toBeNull();
  });
});
