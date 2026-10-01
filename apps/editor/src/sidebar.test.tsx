/**
 * The sidebar's width and whether it is showing: 420px by default, dragged or nudged between 300 and
 * 540, double-clicked back to 420, folded away to a handle on the window's right edge and back at
 * the width it had. The preview is sized from the same numbers, so its scale follows the sidebar.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from './app.js';
import { CONTROLS_STYLES } from './controls/index.js';
import { INSPECTOR_STYLES } from './inspector.js';
import { PROPERTY_VIEW_STYLES } from './property-view.js';
import { TOKEN_PANE_STYLES } from './token-pane.js';
import { createLayoutLibrary } from './layout-library.js';
import { previewViewport } from './preview-viewport.js';
import {
  SIDEBAR_AUTO_COLLAPSE_BELOW,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_HANDLE_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  dragSidebar,
  sidebarLayout,
} from './sidebar.js';

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

function layoutText(): string {
  const layout: Layout = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    target: { width: 1920, height: 400, frameRate: 30 },
    theme: {},
    elements: [{ kind: 'text', text: 'desk', rect: { x: 10, y: 10, w: 200, h: 30 } }],
  };

  return JSON.stringify(layout);
}

function renderEditor(storage: Storage = memoryStorage()): ReturnType<typeof render> {
  const source = createMockSource({ autoStart: false, seed: 1 });

  return render(
    <Editor
      library={createLayoutLibrary({ layouts: { 'desk-test': layoutText() } })}
      source={source}
      topics={source.topics}
      transport={() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })}
      storage={storage}
      platform="other"
    />,
  );
}

function resizeWindow(width: number, height = 768): void {
  act(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    window.dispatchEvent(new Event('resize'));
  });
}

const splitter = (): HTMLElement => screen.getByRole('separator', { name: 'sidebar width' });
const side = (): HTMLElement => screen.getByTestId('perch-editor-side');
const previewWidth = (): string => screen.getByTestId('perch-editor-preview').style.width;

afterEach(() => {
  resizeWindow(1024, 768);
});

describe('the sidebar layout', () => {
  it('defaults to the middle of its range', () => {
    expect([SIDEBAR_MIN_WIDTH, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH]).toEqual([300, 420, 540]);
    expect(SIDEBAR_DEFAULT_WIDTH - SIDEBAR_MIN_WIDTH).toBe(
      SIDEBAR_MAX_WIDTH - SIDEBAR_DEFAULT_WIDTH,
    );
  });

  it('clamps to its range, and to the window, so the work area keeps its minimum', () => {
    const at = (width: number, windowWidth = 1600) =>
      sidebarLayout({ windowWidth, width, collapsed: false, openedNarrow: false });

    expect(at(200).width).toBe(300);
    expect(at(900).width).toBe(540);
    expect(at(500).width).toBe(500);
    // 760px leaves 320px of work area at 440; the sidebar gives way down to its own minimum.
    expect(at(540, 760).width).toBe(440);
    expect(at(540, 640).width).toBe(320);
  });

  it('folds to the handle when collapsed, and on its own in a window too narrow for both', () => {
    expect(
      sidebarLayout({ windowWidth: 1600, width: 420, collapsed: true, openedNarrow: false }),
    ).toEqual({ collapsed: true, auto: false, width: 420, occupies: SIDEBAR_HANDLE_WIDTH });

    const narrow = SIDEBAR_AUTO_COLLAPSE_BELOW - 1;
    expect(
      sidebarLayout({ windowWidth: narrow, width: 420, collapsed: false, openedNarrow: false }),
    ).toMatchObject({ collapsed: true, auto: true, occupies: SIDEBAR_HANDLE_WIDTH });
    // Opened by hand in a narrow window, it stays open at its minimum.
    expect(
      sidebarLayout({ windowWidth: narrow, width: 420, collapsed: false, openedNarrow: true }),
    ).toMatchObject({ collapsed: false, auto: false, width: 300, occupies: 300 });
  });

  it('follows a drag from the left edge, and snaps shut well below the minimum', () => {
    // The sidebar is on the right, so moving the pointer left widens it.
    expect(dragSidebar(420, 1000, 960)).toEqual({ width: 460, collapsed: false });
    expect(dragSidebar(420, 1000, 1100)).toEqual({ width: 320, collapsed: false });
    expect(dragSidebar(420, 1000, 1150)).toEqual({ width: 300, collapsed: false });
    expect(dragSidebar(420, 1000, 1300)).toEqual({ width: 420, collapsed: true });
  });

  it('sizes the preview from what the sidebar occupies', () => {
    expect(previewViewport(1400, 700, 420).width).toBe(1400 - 420 - 32);
    expect(previewViewport(1400, 700, SIDEBAR_HANDLE_WIDTH).width).toBe(
      1400 - SIDEBAR_HANDLE_WIDTH - 32,
    );
  });
});

describe('the resize handle', () => {
  it('is a separator with its range, nudged by arrows and sent to either end by Home and End', () => {
    renderEditor();
    expect(splitter()).toHaveAttribute('aria-orientation', 'vertical');
    expect(splitter()).toHaveAttribute('aria-valuenow', '420');
    expect(splitter()).toHaveAttribute('aria-valuemin', '300');
    expect(splitter()).toHaveAttribute('aria-valuemax', '540');
    expect(side().style.width).toBe('420px');
    expect(previewWidth()).toBe(`${String(1024 - 420 - 32)}px`);

    fireEvent.keyDown(splitter(), { key: 'ArrowLeft' });
    expect(splitter()).toHaveAttribute('aria-valuenow', '430');
    fireEvent.keyDown(splitter(), { key: 'ArrowRight', shiftKey: true });
    expect(splitter()).toHaveAttribute('aria-valuenow', '380');
    fireEvent.keyDown(splitter(), { key: 'End' });
    expect(splitter()).toHaveAttribute('aria-valuenow', '540');
    expect(side().style.width).toBe('540px');
    expect(previewWidth()).toBe(`${String(1024 - 540 - 32)}px`);
    fireEvent.keyDown(splitter(), { key: 'Home' });
    expect(splitter()).toHaveAttribute('aria-valuenow', '300');
  });

  it('resets to the default on a double-click', () => {
    renderEditor();
    fireEvent.keyDown(splitter(), { key: 'End' });
    fireEvent.doubleClick(splitter());

    expect(splitter()).toHaveAttribute('aria-valuenow', '420');
  });

  it('follows the pointer while dragged, and remembers the width it was let go at', () => {
    const storage = memoryStorage();
    const first = renderEditor(storage);
    fireEvent.pointerDown(splitter(), { clientX: 600, pointerId: 1, button: 0 });
    fireEvent.pointerMove(splitter(), { clientX: 560, pointerId: 1 });
    expect(side().style.width).toBe('460px');
    fireEvent.pointerUp(splitter(), { clientX: 560, pointerId: 1 });
    first.unmount();

    renderEditor(storage);
    expect(splitter()).toHaveAttribute('aria-valuenow', '460');
  });
});

describe('collapsing the sidebar', () => {
  it('leaves focus alone when the page opens, StrictMode included', () => {
    const source = createMockSource({ autoStart: false, seed: 1 });
    render(
      <StrictMode>
        <Editor
          library={createLayoutLibrary({ layouts: { 'desk-test': layoutText() } })}
          source={source}
          topics={source.topics}
          transport={() =>
            Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })
          }
          platform="other"
        />
      </StrictMode>,
    );

    expect(document.body).toHaveFocus();
  });

  it('folds when a drag is let go well past the narrowest, keeping its width to come back at', () => {
    renderEditor();
    fireEvent.pointerDown(splitter(), { clientX: 600, pointerId: 1, button: 0 });
    fireEvent.pointerMove(splitter(), { clientX: 900, pointerId: 1 });
    // Still there while dragged, at its narrowest and marked, so the splitter keeps the pointer.
    expect(side()).toBeVisible();
    expect(side().style.width).toBe('300px');
    expect(side()).toHaveAttribute('data-perch-snapping', 'true');
    fireEvent.pointerUp(splitter(), { clientX: 900, pointerId: 1 });

    expect(side()).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'show sidebar' }));
    expect(splitter()).toHaveAttribute('aria-valuenow', '420');
  });

  it('folds to a handle at the right edge, and comes back at the width it had', () => {
    const storage = memoryStorage();
    const first = renderEditor(storage);
    fireEvent.keyDown(splitter(), { key: 'End' });
    fireEvent.keyDown(splitter(), { key: 'Enter' });

    const handle = screen.getByRole('button', { name: 'show sidebar' });
    expect(handle).toHaveAttribute('aria-expanded', 'false');
    expect(handle).toHaveFocus();
    expect(side()).not.toBeVisible();
    expect(screen.queryByRole('separator', { name: 'sidebar width' })).toBeNull();
    expect(previewWidth()).toBe(`${String(1024 - SIDEBAR_HANDLE_WIDTH - 32)}px`);
    first.unmount();

    // Remembered, folded, across a reload.
    renderEditor(storage);
    fireEvent.click(screen.getByRole('button', { name: 'show sidebar' }));
    expect(side()).toBeVisible();
    expect(splitter()).toHaveAttribute('aria-valuenow', '540');
    expect(splitter()).toHaveFocus();
  });

  it('folds and unfolds on its keyboard shortcut, from anywhere', () => {
    renderEditor();
    // Mod is Ctrl off a Mac; these tests run as Windows and Linux do.
    fireEvent.keyDown(document.body, { key: '\\', ctrlKey: true });
    expect(screen.getByRole('button', { name: 'show sidebar' })).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: '\\', ctrlKey: true });
    expect(side()).toBeVisible();
  });

  it('folds on its own in a narrow window, and opens again when the window is wide enough', () => {
    renderEditor();
    resizeWindow(SIDEBAR_AUTO_COLLAPSE_BELOW - 20);
    expect(side()).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'show sidebar' }));
    expect(side()).toBeVisible();
    expect(side().style.width).toBe('300px');

    resizeWindow(1200);
    expect(side()).toBeVisible();
    expect(side().style.width).toBe('420px');
  });
});

describe('at any width in the range', () => {
  it('lets no row of the sidebar wrap: labels truncate and controls shrink instead', () => {
    // The problems box is the one exception, and is not in these sheets: an error is read whole.
    for (const sheet of [
      CONTROLS_STYLES,
      INSPECTOR_STYLES,
      PROPERTY_VIEW_STYLES,
      TOKEN_PANE_STYLES,
    ]) {
      expect(sheet).not.toMatch(/flex-wrap:\s*wrap/);
    }
    expect(CONTROLS_STYLES).toMatch(/--ed-label-col: clamp\(/);
  });
});
