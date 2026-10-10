/**
 * Cloud backgrounds in the editor as an author meets them: the media element's cloud video row, the
 * layout background's, the Add menu's Image and Video, the preview playing the pick, and undo taking
 * it back.
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

function renderEditor(
  backgrounds: BackgroundHost | undefined,
  assets: Readonly<Record<string, string>> = {},
): ReturnType<typeof render> {
  const source = createMockSource({ autoStart: false, seed: 1 });
  return render(
    <Editor
      platform="other"
      library={createLayoutLibrary({ layouts: { desk: JSON.stringify(LAYOUT) }, assets })}
      source={source}
      topics={source.topics}
      transport={() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })}
      {...(backgrounds === undefined ? {} : { backgrounds })}
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

describe("a media element's cloud video row", () => {
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

describe("the layout background's cloud video", () => {
  it('sets the pick as the background, painted under every element', async () => {
    const result = renderEditor(host());
    fireEvent.click(result.getByTestId('perch-editor-background-row'));

    fireEvent.click(screen.getByRole('button', { name: /choose a background/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'Gallery 42' }));
      await Promise.resolve();
    });

    expect(result.getByTestId('perch-editor-background-row')).toHaveTextContent(
      'thermalright:a042',
    );
    await waitFor(() => {
      const layer = result
        .getByTestId('perch-canvas')
        .querySelector('[data-perch-layer="background"]');
      expect(layer?.querySelector('video')).toHaveAttribute(
        'src',
        'perch-cache://backgrounds/a042.mp4',
      );
    });
    // The image element that was first is still element 0, painted over the background.
    const canvas = result.getByTestId('perch-canvas');
    expect(canvas.firstElementChild).toHaveAttribute('data-perch-layer', 'background');
    expect(canvas.children[1]).toHaveAttribute('data-perch-element-index', '0');
  });
});

const elementRows = (result: ReturnType<typeof render>): NodeListOf<Element> =>
  result.getByTestId('perch-editor-elements').querySelectorAll('[data-perch-layer-index]');

describe("the Add menu's media", () => {
  it('adds a video on top, at the new media size, selected, once it has downloaded', async () => {
    const result = renderEditor(host());

    fireEvent.click(screen.getByRole('button', { name: 'add an element' }));
    fireEvent.click(screen.getByRole('button', { name: /^Cloud video/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Tech' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'Tech 3' }));
      await Promise.resolve();
    });

    expect(elementRows(result)).toHaveLength(3);
    const added = result
      .getByTestId('perch-canvas')
      .querySelector<HTMLElement>('[data-perch-element-index="2"]');
    expect(added).toHaveAttribute('data-perch-element-kind', 'media');
    expect(added?.style.width).toBe('480px');
    expect(added?.style.height).toBe('270px');
    expect(srcField().value).toBe('thermalright:b003');
  });

  it('adds an image from the files beside the layout', () => {
    const result = renderEditor(undefined, {
      'desk.assets/rails.svg': '/assets/rails.svg',
      'desk.assets/wall.png': '/assets/wall.png',
    });

    fireEvent.click(screen.getByRole('button', { name: 'add an element' }));
    fireEvent.click(screen.getByRole('button', { name: /^Image/ }));
    const files = within(screen.getByRole('list', { name: 'files beside the layout' }));
    expect(files.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'desk.assets/rails.svg',
      'desk.assets/wall.png',
    ]);
    fireEvent.click(files.getByRole('button', { name: 'desk.assets/wall.png' }));

    expect(elementRows(result)).toHaveLength(3);
    expect(
      result.getByTestId('perch-canvas').querySelector('[data-perch-element-index="2"] img'),
    ).toHaveAttribute('src', '/assets/wall.png');
    expect(srcField().value).toBe('desk.assets/wall.png');
  });

  it('adds a local video as a video, playing in the preview', () => {
    const result = renderEditor(undefined, { 'desk.assets/loop.mp4': '/assets/loop.mp4' });

    fireEvent.click(screen.getByRole('button', { name: 'add an element' }));
    fireEvent.click(screen.getByRole('button', { name: /^Image or video/ }));
    fireEvent.click(screen.getByRole('button', { name: 'desk.assets/loop.mp4' }));

    expect(
      result.getByTestId('perch-canvas').querySelector('[data-perch-element-index="2"] video'),
    ).toHaveAttribute('src', '/assets/loop.mp4');
  });

  it('turns each off, saying why, when there is nothing to choose from', () => {
    renderEditor(undefined);

    fireEvent.click(screen.getByRole('button', { name: 'add an element' }));

    expect(screen.getByRole('button', { name: /^Image/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Cloud video/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Label/ })).toBeEnabled();
  });
});
