/**
 * The Elements list as layers: the topmost element (last in `elements`, painted last) at the top of
 * the list, reordered by dragging a row, by the four layer commands, or by Alt+Up and Alt+Down on a
 * row. Every reorder is one undo step, and the selection goes where the element went.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { act, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from './app.js';
import { createLayoutLibrary } from './layout-library.js';

const TEXTS = ['a', 'b', 'c', 'd'] as const;

const LAYOUT: Layout = {
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  target: { width: 640, height: 400, frameRate: 30 },
  theme: {},
  elements: TEXTS.map((text, index) => ({
    kind: 'text' as const,
    text,
    rect: { x: 10, y: 10 + index * 40, w: 200, h: 30 },
  })),
};

type Result = ReturnType<typeof render>;

function renderEditor(): Result {
  const source = createMockSource({ autoStart: false, seed: 1 });

  return render(
    <Editor
      platform="other"
      library={createLayoutLibrary({ layouts: { 'layers-test': JSON.stringify(LAYOUT) } })}
      source={source}
      topics={source.topics}
      transport={() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })}
    />,
  );
}

/** The element rows, top first: not the eyes beside them, nor the background's row below them. */
function rows(result: Result): HTMLElement[] {
  return [
    ...result
      .getByTestId('perch-editor-elements')
      .querySelectorAll<HTMLElement>('[data-perch-layer-index]'),
  ];
}

/** The list, top row first, as the text of each element. */
function listed(result: Result): string[] {
  return rows(result).map(
    (row) => row.querySelector('.perch-editor-element__summary')?.textContent ?? '',
  );
}

/** The canvas, in paint order, as the text of each element. */
function painted(result: Result): string[] {
  return [...result.getByTestId('perch-editor-preview').querySelectorAll('.perch-element')].map(
    (element) => element.textContent,
  );
}

function row(result: Result, text: string): HTMLElement {
  const found = rows(result).find(
    (button) => button.querySelector('.perch-editor-element__summary')?.textContent === text,
  );
  if (found === undefined) throw new Error(`no row for ${text}`);

  return found;
}

function selectedName(result: Result): string {
  return (
    result.getByTestId('perch-editor-selection').querySelector('.perch-selection__name')
      ?.textContent ?? ''
  );
}

function undo(result: Result): void {
  fireEvent.click(
    within(result.getByTestId('perch-editor-header')).getByRole('button', { name: 'undo' }),
  );
}

function canvasKey(result: Result, init: KeyboardEventInit): void {
  const canvas = result.getByTestId('perch-editor-preview');
  fireEvent.keyDown(canvas, init);
}

const ROW_HEIGHT = 20;

/**
 * jsdom lays nothing out, so each row is given the box it would have: stacked ROW_HEIGHT apart from
 * the top of the list at y = 100, in the order they are drawn.
 */
function layOut(result: Result): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const at = rows(result).indexOf(this);
    const top = at === -1 ? 0 : 100 + at * ROW_HEIGHT;
    const height = at === -1 ? 0 : ROW_HEIGHT;

    return {
      top,
      bottom: top + height,
      left: 0,
      right: 200,
      width: 200,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    };
  });
}

/** Press on `from`, move to `clientY` past the drag threshold, and let go there. */
function drag(from: HTMLElement, clientY: number, release = true): void {
  const start = from.getBoundingClientRect().top + ROW_HEIGHT / 2;
  fireEvent.pointerDown(from, { button: 0, buttons: 1, pointerId: 1, clientX: 50, clientY: start });
  fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 50, clientY });
  if (release) fireEvent.pointerUp(window, { button: 0, pointerId: 1, clientX: 50, clientY });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Elements list', () => {
  it('lists the topmost element first and the bottom-most last, as layers do', () => {
    const result = renderEditor();

    expect(listed(result)).toEqual(['d', 'c', 'b', 'a']);
    expect(painted(result)).toEqual(['a', 'b', 'c', 'd']);
    // The index is still the element's place in `elements`, which is what every problem names.
    expect(
      rows(result).map(
        (button) => button.querySelector('.perch-editor-element__index')?.textContent,
      ),
    ).toEqual(['3', '2', '1', '0']);
  });

  it('still selects on a click that does not move', () => {
    const result = renderEditor();

    fireEvent.click(row(result, 'b'));

    expect(selectedName(result)).toBe('b');
  });
});

describe('dragging a row', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
  });

  it('shows where it will land, between two rows, while it is held', () => {
    const result = renderEditor();
    layOut(result);

    // From "a" (the bottom row) up to just above "c" (the second row).
    drag(row(result, 'a'), 100 + ROW_HEIGHT + 4, false);

    expect(row(result, 'c')).toHaveAttribute('data-perch-drop', 'above');
    expect(row(result, 'a')).toHaveAttribute('data-perch-dragging', 'true');
    fireEvent.pointerUp(window, { button: 0, pointerId: 1, clientX: 50, clientY: 124 });
    expect(rows(result).filter((button) => button.hasAttribute('data-perch-drop'))).toEqual([]);
  });

  it('moves the element to where it was dropped, selects it, and undoes in one step', () => {
    const result = renderEditor();
    layOut(result);

    drag(row(result, 'a'), 100 + ROW_HEIGHT + 4);

    expect(listed(result)).toEqual(['d', 'a', 'c', 'b']);
    expect(painted(result)).toEqual(['b', 'c', 'a', 'd']);
    expect(selectedName(result)).toBe('a');

    undo(result);
    expect(listed(result)).toEqual(['d', 'c', 'b', 'a']);
    expect(selectedName(result)).toBe('a');
  });

  it('drops on the top of the list as the topmost element', () => {
    const result = renderEditor();
    layOut(result);

    drag(row(result, 'b'), 90);

    expect(listed(result)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('does nothing when dropped where it started, or let go of with Escape', () => {
    const result = renderEditor();
    layOut(result);

    drag(row(result, 'c'), 100 + ROW_HEIGHT + 17);
    expect(listed(result)).toEqual(['d', 'c', 'b', 'a']);

    drag(row(result, 'c'), 90, false);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(window, { button: 0, pointerId: 1, clientX: 50, clientY: 90 });
    expect(listed(result)).toEqual(['d', 'c', 'b', 'a']);
    expect(
      within(result.getByTestId('perch-editor-header')).getByRole('button', { name: 'undo' }),
    ).toBeDisabled();
  });

  it('scrolls the sidebar while it is held near an edge', () => {
    const result = renderEditor();
    layOut(result);
    const sidebar = result.getByTestId('perch-editor-inspector');
    let scrollTop = 0;
    Object.defineProperty(sidebar, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 400,
      left: 0,
      right: 300,
      width: 300,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    drag(row(result, 'a'), 395, false);
    expect(scrollTop).toBeGreaterThan(0);
    const down = scrollTop;
    fireEvent.pointerMove(window, { buttons: 1, pointerId: 1, clientX: 50, clientY: 3 });
    expect(scrollTop).toBeLessThan(down);
    fireEvent.pointerUp(window, { button: 0, pointerId: 1, clientX: 50, clientY: 3 });
  });
});

describe('a drag that is let go of, or overtaken', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  });

  it('does not select the row it is released over after Escape let go of it', async () => {
    const result = renderEditor();
    layOut(result);

    drag(row(result, 'c'), 90, false);
    fireEvent.keyDown(window, { key: 'Escape' });
    // The author holds on a moment before letting go.
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
    fireEvent.pointerUp(window, { button: 0, pointerId: 1, clientX: 50, clientY: 90 });
    // The click the release makes on the row it started on.
    fireEvent.click(row(result, 'c'));

    expect(result.queryByTestId('perch-editor-selection')).toBeNull();
  });

  it('lets go without moving anything when the list changes under it', () => {
    const result = renderEditor();
    layOut(result);
    fireEvent.click(row(result, 'b'));
    canvasKey(result, { key: ']', ctrlKey: true });
    expect(listed(result)).toEqual(['d', 'b', 'c', 'a']);

    drag(row(result, 'a'), 90, false);
    // Undo, pressed mid-drag, puts the list back the way it was before the command.
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(listed(result)).toEqual(['d', 'c', 'b', 'a']);
    expect(rows(result).filter((button) => button.hasAttribute('data-perch-drop'))).toEqual([]);
    fireEvent.pointerUp(window, { button: 0, pointerId: 1, clientX: 50, clientY: 90 });

    expect(listed(result)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('stops asking for frames at an edge it cannot scroll past', () => {
    const result = renderEditor();
    layOut(result);
    const sidebar = result.getByTestId('perch-editor-inspector');
    let scrollTop = 0;
    Object.defineProperty(sidebar, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, value);
      },
    });
    vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 400,
      left: 0,
      right: 300,
      width: 300,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const frames = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    frames.mockClear();

    // Already at the top: a pointer held at the top edge scrolls nothing and schedules nothing.
    drag(row(result, 'd'), 3, false);
    expect(scrollTop).toBe(0);
    expect(frames).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { button: 0, pointerId: 1, clientX: 50, clientY: 3 });
  });
});

describe('the layer commands', () => {
  it.each([
    ['Mod+]', { key: ']', ctrlKey: true }, ['d', 'c', 'b', 'a'], 'b', ['d', 'b', 'c', 'a']],
    ['Mod+[', { key: '[', ctrlKey: true }, ['d', 'c', 'b', 'a'], 'b', ['d', 'c', 'a', 'b']],
    [
      'Mod+Shift+]',
      { key: '}', ctrlKey: true, shiftKey: true },
      ['d', 'c', 'b', 'a'],
      'b',
      ['b', 'd', 'c', 'a'],
    ],
    [
      'Mod+Shift+[',
      { key: '{', ctrlKey: true, shiftKey: true },
      ['d', 'c', 'b', 'a'],
      'b',
      ['d', 'c', 'a', 'b'],
    ],
  ])(
    '%s moves the selected element, keeps it selected, and undoes in one step',
    (_keys, init, before, pick, after) => {
      const result = renderEditor();
      fireEvent.click(row(result, pick));

      canvasKey(result, init);

      expect(listed(result)).toEqual(after);
      expect(selectedName(result)).toBe(pick);
      undo(result);
      expect(listed(result)).toEqual(before);
      expect(selectedName(result)).toBe(pick);
    },
  );

  it('does nothing past the top or the bottom, and records no step', () => {
    const result = renderEditor();
    fireEvent.click(row(result, 'd'));

    canvasKey(result, { key: ']', ctrlKey: true });
    canvasKey(result, { key: '}', ctrlKey: true, shiftKey: true });

    expect(listed(result)).toEqual(['d', 'c', 'b', 'a']);
    expect(
      within(result.getByTestId('perch-editor-header')).getByRole('button', { name: 'undo' }),
    ).toBeDisabled();
  });
});

describe('focus in the list', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
  });

  it('goes with the element a layer command moved, from a focused row', () => {
    const result = renderEditor();
    fireEvent.click(row(result, 'b'));
    row(result, 'b').focus();

    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: '}',
      ctrlKey: true,
      shiftKey: true,
    });

    expect(listed(result)).toEqual(['b', 'd', 'c', 'a']);
    expect(document.activeElement).toBe(row(result, 'b'));
  });

  it('goes with the element a drop moved', () => {
    const result = renderEditor();
    layOut(result);
    row(result, 'a').focus();

    drag(row(result, 'a'), 90);

    expect(listed(result)).toEqual(['a', 'd', 'c', 'b']);
    expect(document.activeElement).toBe(row(result, 'a'));
  });
});

describe('reordering from the list with the keyboard', () => {
  it('moves a focused row up and down a layer with Alt, and focus goes with it', () => {
    const result = renderEditor();
    const b = row(result, 'b');
    b.focus();

    fireEvent.keyDown(b, { key: 'ArrowUp', altKey: true });
    expect(listed(result)).toEqual(['d', 'b', 'c', 'a']);
    act(() => undefined);
    expect(document.activeElement?.textContent).toContain('b');
    expect(selectedName(result)).toBe('b');

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown', altKey: true });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown', altKey: true });
    expect(listed(result)).toEqual(['d', 'c', 'a', 'b']);
    expect(document.activeElement?.textContent).toContain('b');
  });
});
