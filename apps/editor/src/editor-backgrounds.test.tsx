/**
 * Cloud backgrounds in the editor as an author meets them: the media element's background row, the
 * Add menu's Background, the preview playing the pick, and undo taking it back.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import type { BackgroundSource } from '@perch/ui-kit';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from './app.js';
import type { BackgroundHost, Thumbnail } from './background-host.js';
import { createLayoutLibrary } from './layout-library.js';

const LAYOUT: Layout = {
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  target: { width: 1920, height: 400, frameRate: 30 },
  theme: {},
  elements: [
    { kind: 'media', src: 'desk.assets/rails.svg', rect: { x: 0, y: 0, w: 1920, h: 400 } },
    { kind: 'text', text: 'over it', rect: { x: 10, y: 10, w: 200, h: 30 } },
  ],
};

/** Sees nothing scroll into view, so no thumbnail is asked for. */
class NoObserver {
  observe(): void {
    return undefined;
  }
  unobserve(): void {
    return undefined;
  }
  disconnect(): void {
    return undefined;
  }
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', NoObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function host(): BackgroundHost & { ensure: ReturnType<typeof vi.fn> } {
  const made = {
    ensure: vi.fn((ref: string): Promise<BackgroundSource> =>
      Promise.resolve({ status: 'ready', url: `perch-cache://backgrounds/${ref.slice(13)}.mp4` }),
    ),
    preview: () => Promise.resolve<Thumbnail>({ status: 'failed', reason: 'not in this test' }),
  };
  return made;
}

function renderEditor(backgrounds: BackgroundHost): ReturnType<typeof render> {
  const source = createMockSource({ autoStart: false, seed: 1 });
  return render(
    <Editor
      platform="other"
      library={createLayoutLibrary({ layouts: { desk: JSON.stringify(LAYOUT) } })}
      source={source}
      topics={source.topics}
      transport={() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })}
      backgrounds={backgrounds}
    />,
  );
}

function selectElement(result: ReturnType<typeof render>, index: number): void {
  // By its index in `elements`: the list draws the topmost element first.
  const button = result
    .getByTestId('perch-editor-elements')
    .querySelector<HTMLElement>(`[data-perch-layer-index="${index}"]`);
  if (button === null) throw new Error(`no element ${index}`);
  fireEvent.click(button);
}

const srcField = (): HTMLInputElement => {
  const field = within(screen.getByTestId('perch-editor-prop-src')).getByRole('textbox');
  if (!(field instanceof HTMLInputElement)) throw new Error('src is not an input');
  return field;
};

describe('the background row', () => {
  it('sets the pick as the media src once it has downloaded, and the preview plays it', async () => {
    const backgrounds = host();
    const result = renderEditor(backgrounds);
    selectElement(result, 0);

    fireEvent.click(screen.getByRole('button', { name: /choose a background/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'Gallery 42' }));
      await Promise.resolve();
    });

    expect(backgrounds.ensure).toHaveBeenCalledWith('thermalright:a042', {
      width: 1920,
      height: 400,
    });
    expect(srcField().value).toBe('thermalright:a042');
    await waitFor(() => {
      expect(result.getByTestId('perch-canvas').querySelector('video')?.getAttribute('src')).toBe(
        'perch-cache://backgrounds/a042.mp4',
      );
    });
  });

  it('is one undo step, back to the image', async () => {
    const result = renderEditor(host());
    selectElement(result, 0);
    fireEvent.click(screen.getByRole('button', { name: /choose a background/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'Gallery 1' }));
      await Promise.resolve();
    });
    expect(srcField().value).toBe('thermalright:a001');

    fireEvent.click(
      within(result.getByTestId('perch-editor-header')).getByRole('button', { name: 'undo' }),
    );

    expect(srcField().value).toBe('desk.assets/rails.svg');
  });
});

describe("the Add menu's Background", () => {
  it('adds a full-canvas background under everything, once it has downloaded', async () => {
    const result = renderEditor(host());

    fireEvent.click(screen.getByRole('button', { name: 'add an element' }));
    fireEvent.click(screen.getByRole('button', { name: /Background/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Tech' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'Tech 3' }));
      await Promise.resolve();
    });

    const elements = within(result.getByTestId('perch-editor-elements')).getAllByRole('button');
    expect(elements).toHaveLength(3);
    const first = result
      .getByTestId('perch-canvas')
      .querySelector('[data-perch-element-index="0"]');
    expect(first).toHaveAttribute('data-perch-element-kind', 'media');
    expect(srcField().value).toBe('thermalright:b003');
  });
});
