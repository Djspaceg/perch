/**
 * The handle layer, at the two things a unit test can hold.
 *
 * What it *cannot* hold is the property that matters most — that a drag inside a scaled canvas writes
 * the right *layout* pixels — because jsdom applies no transform and measures no geometry, so a fake
 * drag here would move by raw pixels and prove nothing about the scale correction. That half is proven
 * live by the research spike (`round(120 / 0.6146) = 195` at scale 0.6146; see `canvas-handles.tsx`).
 *
 * So this file pins the two halves jsdom can see honestly: the write-back is integers in layout space
 * (the pure helpers the `<Rnd>` callbacks delegate to), and the layer lays exactly one box over each
 * element, carrying the canvas scale and marking the selected one.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasHandles, rectFromDrag, rectFromResize } from './canvas-handles.js';

/** Three elements at known rects; the component reads only `rect`, so the rest is shape. */
function layout(): Layout {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    target: { width: 1920, height: 400, frameRate: 30 },
    theme: { '--perch-fg': '#e8f1ff' },
    elements: [
      { kind: 'text', text: 'hi', rect: { x: 10, y: 10, w: 200, h: 30 } },
      {
        kind: 'widget',
        widget: 'readout',
        topic: 'sensors/cpu/0/temperature/0',
        rect: { x: 40, y: 80, w: 180, h: 100 },
      },
      {
        kind: 'chart',
        widget: 'line-chart',
        topic: 'sensors/cpu/0/temperature/0',
        rect: { x: 300, y: 80, w: 400, h: 200 },
        windowMs: 60000,
      },
    ],
  };
}

describe('rectFromDrag', () => {
  it('rounds the moved position to integers and keeps the element size', () => {
    expect(rectFromDrag({ x: 0, y: 0, w: 180, h: 100 }, 234.7, 79.2)).toEqual({
      x: 235,
      y: 79,
      w: 180,
      h: 100,
    });
  });

  it('keeps a negative position, which the schema allows as bleed', () => {
    expect(rectFromDrag({ x: 0, y: 0, w: 50, h: 50 }, -12.4, -0.6)).toEqual({
      x: -12,
      y: -1,
      w: 50,
      h: 50,
    });
  });
});

describe('rectFromResize', () => {
  it('rounds every component to an integer', () => {
    expect(rectFromResize(10.2, 20.8, 181.5, 99.4)).toEqual({ x: 10, y: 21, w: 182, h: 99 });
  });
});

describe('CanvasHandles', () => {
  it('lays exactly one handle over each element', () => {
    const { container } = render(
      <CanvasHandles
        layout={layout()}
        scale={0.5}
        selected={1}
        onSelect={vi.fn()}
        onRect={vi.fn()}
      />,
    );

    const bodies = container.querySelectorAll('[data-perch-handle-index]');
    expect(bodies).toHaveLength(3);
    expect([...bodies].map((body) => body.getAttribute('data-perch-handle-index'))).toEqual([
      '0',
      '1',
      '2',
    ]);
  });

  it('marks the selected element, and only it', () => {
    const { container } = render(
      <CanvasHandles
        layout={layout()}
        scale={0.5}
        selected={1}
        onSelect={vi.fn()}
        onRect={vi.fn()}
      />,
    );

    const selected = container.querySelectorAll('.perch-editor-handle--selected');
    expect(selected).toHaveLength(1);
    expect(
      selected[0]
        ?.querySelector('[data-perch-handle-index]')
        ?.getAttribute('data-perch-handle-index'),
    ).toBe('1');
  });

  it('carries the canvas scale on the layer, so it tracks the transformed canvas', () => {
    const { getByTestId } = render(
      <CanvasHandles
        layout={layout()}
        scale={0.5}
        selected={0}
        onSelect={vi.fn()}
        onRect={vi.fn()}
      />,
    );

    expect(getByTestId('perch-editor-handles').getAttribute('style')).toContain('scale(0.5)');
  });
});
