/**
 * The editor as an author meets it: a list, a switch, a preview, and a refusal.
 *
 * The load-bearing test in this file is the last one. `SPEC.md` hard rule 1 and the reason
 * `LayoutCanvas` was moved into `ui-kit` at all are the same thing — the preview must render what the
 * runtime renders — and that is a property no assertion about the editor's own markup can establish.
 * So it is checked by rendering `LayoutCanvas` directly, with the layout and the scale the editor
 * chose, and demanding the two subtrees be the *same HTML*. A local reimplementation that looked right
 * would fail it; so would a wrapper that added a handle, a grid, or a selection outline.
 *
 * Every layout here is validated against `WIDGET_REGISTRY` and `normalizeSensorTopic` by the app
 * itself, and the source is the mock with `autoStart: false` so no interval publishes mid-assertion:
 * the widgets paint their waiting state, which is deterministic and enough to compare markup.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { LayoutCanvas, SensorProvider } from '@perch/ui-kit';
import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Editor, openLayoutByName } from './app.js';
import { createLayoutLibrary, type LayoutLibrary } from './layout-library.js';
import type { SaveTransport } from './save.js';

/** Two layouts with different targets, so a switch is visible in the canvas' own attributes. */
function layoutText(width: number, height: number, text: string): string {
  const layout: Layout = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    target: { width, height, frameRate: 30 },
    theme: { '--perch-fg': '#e8f1ff' },
    elements: [
      { kind: 'text', text, rect: { x: 10, y: 10, w: 200, h: 30 } },
      {
        kind: 'widget',
        widget: 'readout',
        topic: 'sensors/cpu/0/temperature/0',
        rect: { x: 10, y: 50, w: 180, h: 100 },
      },
    ],
  };

  return JSON.stringify(layout);
}

function testLibrary(): LayoutLibrary {
  return createLayoutLibrary({
    layouts: {
      'tower-test': layoutText(200, 640, 'tower'),
      'desk-test': layoutText(640, 200, 'desk'),
    },
    invalid: { 'invalid/broken-desk': '{ "schemaVersion": 2 ' },
  });
}

/** A transport that records instead of requesting, so "no request was made" is assertable. */
function recordingTransport(): {
  readonly calls: { url: string; body: string }[];
  readonly transport: SaveTransport;
} {
  const calls: { url: string; body: string }[] = [];

  return {
    calls,
    transport: (url, init) => {
      calls.push({ url, body: init.body });

      return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });
    },
  };
}

function renderEditor(library = testLibrary()): {
  readonly library: LayoutLibrary;
  readonly calls: { url: string; body: string }[];
  readonly result: ReturnType<typeof render>;
} {
  const source = createMockSource({ autoStart: false, seed: 1 });
  const { calls, transport } = recordingTransport();

  return {
    library,
    calls,
    result: render(
      <Editor library={library} source={source} topics={source.topics} transport={transport} />,
    ),
  };
}

/** The picker. `getByLabelText` returns the `<select>` because the label wraps it. */
function picker(result: ReturnType<typeof render>): HTMLSelectElement {
  const element = result.getByLabelText('layout');

  if (!(element instanceof HTMLSelectElement)) throw new Error('the layout picker is not a select');

  return element;
}

function canvasOf(result: ReturnType<typeof render>): HTMLElement {
  const canvas = result
    .getByTestId('perch-editor-preview')
    .querySelector('[data-testid="perch-canvas"]');

  if (!(canvas instanceof HTMLElement)) throw new Error('the preview contains no canvas');

  return canvas;
}

describe('listing the layouts', () => {
  it('offers every layout in the library, sorted, with the first one open', () => {
    const { result } = renderEditor();

    expect([...picker(result).options].map((option) => option.value)).toEqual([
      'desk-test',
      'tower-test',
    ]);
    expect(picker(result).value).toBe('desk-test');
  });

  it('does not offer the invalid fixture', () => {
    const { result } = renderEditor();

    expect([...picker(result).options].map((option) => option.value)).not.toContain(
      'invalid/broken-desk',
    );
  });

  it('opens the layout named in the props instead, when there is one', () => {
    const source = createMockSource({ autoStart: false });
    const { transport } = recordingTransport();
    const result = render(
      <Editor
        library={testLibrary()}
        source={source}
        topics={source.topics}
        transport={transport}
        initialLayout="tower-test"
      />,
    );

    expect(picker(result).value).toBe('tower-test');
    expect(canvasOf(result).getAttribute('data-perch-canvas-width')).toBe('200');
  });
});

describe('switching layouts', () => {
  it('paints the other layout at its own target size', () => {
    const { result } = renderEditor();

    expect(canvasOf(result).getAttribute('data-perch-canvas-width')).toBe('640');
    expect(canvasOf(result).getAttribute('data-perch-canvas-height')).toBe('200');

    fireEvent.change(picker(result), { target: { value: 'tower-test' } });

    expect(canvasOf(result).getAttribute('data-perch-canvas-width')).toBe('200');
    expect(canvasOf(result).getAttribute('data-perch-canvas-height')).toBe('640');
  });

  it('shows the switched layout in the header and the element list', () => {
    const { result } = renderEditor();

    fireEvent.change(picker(result), { target: { value: 'tower-test' } });

    expect(result.container.querySelector('#perch-editor')?.getAttribute('data-perch-layout')).toBe(
      'tower-test',
    );
    expect(within(result.getByTestId('perch-editor-elements')).getAllByRole('button')).toHaveLength(
      2,
    );
  });

  it('parks the switch rather than discarding unsaved edits', () => {
    const { result } = renderEditor();

    fireEvent.change(result.getByLabelText('w'), { target: { value: '150' } });
    fireEvent.change(picker(result), { target: { value: 'tower-test' } });

    // Still on the edited document, with the discard offered explicitly: there is no undo here.
    expect(canvasOf(result).getAttribute('data-perch-canvas-width')).toBe('640');
    expect(result.getByTestId('perch-editor-pending').textContent).toContain('unsaved changes');

    fireEvent.click(result.getByRole('button', { name: 'discard and open tower-test' }));

    expect(canvasOf(result).getAttribute('data-perch-canvas-width')).toBe('200');
  });
});

describe('editing a field', () => {
  it('moves the preview and offers the save', () => {
    const { result } = renderEditor();

    fireEvent.change(result.getByLabelText('w'), { target: { value: '150' } });

    expect(result.getByTestId('perch-editor-dirty')).toBeDefined();
    expect(result.getByTestId('perch-editor-save')).not.toBeDisabled();
    expect(canvasOf(result).querySelector('.perch-element')?.getAttribute('style')).toContain(
      'width: 150px',
    );
  });

  it('writes the document through the transport and reports the path', async () => {
    const { result, calls } = renderEditor();

    fireEvent.change(result.getByLabelText('w'), { target: { value: '150' } });
    fireEvent.click(result.getByTestId('perch-editor-save'));

    await result.findByText('saved layouts/desk-test.json');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/__perch/layout/desk-test');
    expect(calls[0]?.body).toContain('"w": 150');
    // Written means clean: no dirty pill, and nothing further to save.
    expect(result.queryByTestId('perch-editor-dirty')).toBeNull();
    expect(result.getByTestId('perch-editor-save')).toBeDisabled();
  });
});

describe('an edit the runtime would reject', () => {
  it('shows the problem with its field path, and refuses the save', () => {
    const { result, calls } = renderEditor();

    fireEvent.change(result.getByLabelText('w'), { target: { value: '0' } });

    expect(result.getByTestId('perch-editor-problem-text').textContent).toContain(
      'elements[0].rect.w',
    );
    expect(result.getByTestId('perch-editor-save')).toBeDisabled();
    // Disabled is the visible half; the other half is that no request exists to be made.
    fireEvent.click(result.getByTestId('perch-editor-save'));
    expect(calls).toEqual([]);
  });

  it('holds the preview on the last document that validated, and says it is holding', () => {
    const { result } = renderEditor();

    fireEvent.change(result.getByLabelText('w'), { target: { value: '150' } });
    fireEvent.change(result.getByLabelText('w'), { target: { value: '0' } });

    // The control shows the author their own 0 …
    expect(result.getByLabelText('w')).toHaveValue('0');
    // … the canvas keeps the last width that was a layout …
    expect(canvasOf(result).querySelector('.perch-element')?.getAttribute('style')).toContain(
      'width: 150px',
    );
    // … and the pane says so rather than leaving a frozen preview unexplained.
    expect(
      result.getByTestId('perch-editor-preview').getAttribute('data-perch-preview-stale'),
    ).toBe('true');
  });

  it('recovers when the field is fixed', () => {
    const { result } = renderEditor();

    fireEvent.change(result.getByLabelText('w'), { target: { value: '0' } });
    fireEvent.change(result.getByLabelText('w'), { target: { value: '220' } });

    expect(result.queryByTestId('perch-editor-problems')).toBeNull();
    expect(result.getByTestId('perch-editor-save')).not.toBeDisabled();
  });

  it('refuses a file that is not a layout without painting a canvas', () => {
    const source = createMockSource({ autoStart: false });
    const { transport } = recordingTransport();
    const result = render(
      <Editor
        library={testLibrary()}
        source={source}
        topics={source.topics}
        transport={transport}
        initialLayout="invalid/broken-desk"
      />,
    );

    expect(result.getByTestId('perch-editor-unopened').textContent).toContain(
      'is not a valid layout',
    );
    expect(result.queryByTestId('perch-canvas')).toBeNull();
    expect(result.getByTestId('perch-editor-save')).toBeDisabled();
  });
});

describe('the preview renders what the runtime renders', () => {
  /**
   * The property, checked the only way it can be: against the component itself.
   *
   * The editor's canvas subtree and a directly rendered `LayoutCanvas` — same layout, same scale, same
   * provider — must be byte-identical HTML. This fails if `apps/editor` ever grows its own element
   * rendering, wraps elements in editor-only chrome, or forks the canvas' markup; those are exactly
   * the divergences moving the canvas into `ui-kit` was meant to make impossible.
   */
  it('produces the same markup as rendering LayoutCanvas directly', () => {
    const library = testLibrary();
    const { result } = renderEditor(library);

    const pane = result.getByTestId('perch-editor-preview');
    const scale = Number(pane.getAttribute('data-perch-preview-scale'));
    expect(Number.isFinite(scale)).toBe(true);

    const opened = openLayoutByName(library, 'desk-test');
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    // Queried through `container`, not `getByTestId`: both trees are mounted in the same document at
    // this point, and a document-wide query for the canvas now legitimately finds two.
    const reference = render(
      <SensorProvider source={createMockSource({ autoStart: false })}>
        <LayoutCanvas
          layout={opened.state.rendered}
          scale={scale}
          resolveAsset={library.resolveAsset}
        />
      </SensorProvider>,
    ).container.querySelector('[data-testid="perch-canvas"]');

    expect(reference).not.toBeNull();
    expect(canvasOf(result).outerHTML).toBe(reference?.outerHTML);
  });

  it('scales the canvas to the pane rather than resizing the layout', () => {
    const { result } = renderEditor();

    const canvas = canvasOf(result);

    // The canvas is always the authored size; only the transform changes. An editor that fitted a
    // layout by rewriting its target would be editing the document every time the window moved.
    expect(canvas.getAttribute('data-perch-canvas-width')).toBe('640');
    expect(canvas.getAttribute('style')).toContain('width: 640px');
    expect(canvas.getAttribute('style')).toContain('scale(');
  });
});
