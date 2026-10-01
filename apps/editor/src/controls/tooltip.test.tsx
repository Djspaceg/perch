/**
 * The chrome's tooltips: one layer per page reading `data-perch-tip`, in place of the browser's
 * `title`, so the delay, the look and the placement are the chrome's own in both schemes. Shown after
 * the same delay for a pointer and for keyboard focus, at once when moving from one tip to the next,
 * gone on Escape, a press or the pointer leaving, kept on screen, and the target's description while
 * shown.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT_SCHEMA_VERSION } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { Editor } from '../app.js';
import { createLayoutLibrary } from '../layout-library.js';
import { TOOLTIP_DELAY, TooltipLayer } from './tooltip.js';

function Fixture(): React.ReactNode {
  return (
    <div>
      <button type="button" data-perch-tip="Undo (Ctrl+Z)">
        undo
      </button>
      <button type="button" data-perch-tip="Redo (Ctrl+Shift+Z)">
        redo
      </button>
      <button type="button" aria-label="reset opacity" data-perch-tip="reset opacity" />
      <span>no tip</span>
      <TooltipLayer />
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const tooltip = (): HTMLElement | null => screen.queryByRole('tooltip');

describe('the tooltip layer', () => {
  it('shows a hovered tip after the delay, describes its target, and goes when the pointer leaves', () => {
    render(<Fixture />);
    const undo = screen.getByRole('button', { name: 'undo' });

    fireEvent.pointerOver(undo, { pointerType: 'mouse' });
    wait(TOOLTIP_DELAY - 50);
    expect(tooltip()).toBeNull();
    wait(60);
    expect(tooltip()).toHaveTextContent('Undo (Ctrl+Z)');
    expect(undo).toHaveAccessibleDescription('Undo (Ctrl+Z)');

    fireEvent.pointerOut(undo, { pointerType: 'mouse', relatedTarget: document.body });
    expect(tooltip()).toBeNull();
    expect(undo).not.toHaveAttribute('aria-describedby');
  });

  it('shows on keyboard focus too, after the same delay, and hides on Escape', () => {
    render(<Fixture />);
    const redo = screen.getByRole('button', { name: 'redo' });

    act(() => {
      redo.focus();
    });
    // Described at once, for a screen reader, which does not wait for the picture.
    expect(redo).toHaveAccessibleDescription('Redo (Ctrl+Shift+Z)');
    wait(TOOLTIP_DELAY + 10);
    expect(tooltip()).toHaveTextContent('Redo (Ctrl+Shift+Z)');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(tooltip()).toBeNull();
    expect(redo).toHaveFocus();
  });

  it('moves straight to the next tip while one is showing', () => {
    render(<Fixture />);
    const undo = screen.getByRole('button', { name: 'undo' });
    const redo = screen.getByRole('button', { name: 'redo' });
    fireEvent.pointerOver(undo, { pointerType: 'mouse' });
    wait(TOOLTIP_DELAY + 10);

    fireEvent.pointerOut(undo, { pointerType: 'mouse', relatedTarget: redo });
    fireEvent.pointerOver(redo, { pointerType: 'mouse' });
    expect(tooltip()).toHaveTextContent('Redo (Ctrl+Shift+Z)');
  });

  it('goes on a press, and never shows for touch', () => {
    render(<Fixture />);
    const undo = screen.getByRole('button', { name: 'undo' });
    fireEvent.pointerOver(undo, { pointerType: 'mouse' });
    wait(TOOLTIP_DELAY + 10);
    fireEvent.pointerDown(undo, { pointerType: 'mouse' });
    expect(tooltip()).toBeNull();

    fireEvent.pointerOver(undo, { pointerType: 'touch' });
    wait(TOOLTIP_DELAY + 10);
    expect(tooltip()).toBeNull();
  });

  it('does not describe a control by its own name twice', () => {
    render(<Fixture />);
    const reset = screen.getByRole('button', { name: 'reset opacity' });
    fireEvent.pointerOver(reset, { pointerType: 'mouse' });
    wait(TOOLTIP_DELAY + 10);

    expect(tooltip()).toHaveTextContent('reset opacity');
    expect(reset).not.toHaveAttribute('aria-describedby');
  });

  it('keeps an existing description, and gives it back', () => {
    render(
      <div>
        <span id="why">why</span>
        <button type="button" aria-describedby="why" data-perch-tip="more">
          go
        </button>
        <TooltipLayer />
      </div>,
    );
    const go = screen.getByRole('button', { name: 'go' });
    fireEvent.pointerOver(go, { pointerType: 'mouse' });
    wait(TOOLTIP_DELAY + 10);
    expect(go).toHaveAccessibleDescription('why more');

    fireEvent.pointerOut(go, { pointerType: 'mouse', relatedTarget: document.body });
    expect(go).toHaveAttribute('aria-describedby', 'why');
  });

  it('stays on screen, placed as a popover is', () => {
    render(<Fixture />);
    const undo = screen.getByRole('button', { name: 'undo' });
    // Near the bottom right of a 1024x768 window: no room below, none to the right.
    undo.getBoundingClientRect = () =>
      ({ top: 750, bottom: 766, left: 1000, right: 1020, width: 20, height: 16 }) as DOMRect;
    const box = document.querySelector<HTMLElement>('.perch-tooltip');
    if (box === null) throw new Error('no tooltip box');
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 20,
      left: 0,
      right: 120,
      width: 120,
      height: 20,
    } as DOMRect);
    fireEvent.pointerOver(undo, { pointerType: 'mouse' });
    wait(TOOLTIP_DELAY + 10);

    expect(box.style.top).toBe(`${String(750 - 4 - 20)}px`);
    expect(box.style.left).toBe(`${String(1024 - 120 - 4)}px`);
  });
});

describe('the editor', () => {
  it('carries no title attribute in its chrome, and one tooltip layer', () => {
    const source = createMockSource({ autoStart: false, seed: 1 });
    const layout = JSON.stringify({
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      target: { width: 640, height: 200, frameRate: 30 },
      theme: {},
      elements: [{ kind: 'text', text: 'x', rect: { x: 10, y: 10, w: 200, h: 30 } }],
    });
    const view = render(
      <Editor
        library={createLayoutLibrary({ layouts: { desk: layout } })}
        source={source}
        topics={source.topics}
        transport={() =>
          Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })
        }
      />,
    );
    const first = view.container.querySelector<HTMLElement>('[data-perch-layer-index="0"]');
    if (first === null) throw new Error('no element in the list');
    fireEvent.click(first);

    const chrome = [...view.container.querySelectorAll('[title]')].filter(
      (element) => element.closest('[data-testid="perch-editor-preview"]') === null,
    );
    expect(chrome.map((element) => element.outerHTML.slice(0, 80))).toEqual([]);
    expect(view.container.querySelectorAll('[data-perch-tip]').length).toBeGreaterThan(10);
    expect(document.querySelectorAll('.perch-tooltip-layer')).toHaveLength(1);
  });
});
