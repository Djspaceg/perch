/**
 * The canvas: all three element kinds, in paint order, at authored pixels.
 *
 * Every layout here goes through `loadLayoutJson` with the real `WIDGET_REGISTRY` rather than being
 * hand-built as an object. That costs a few lines and buys the thing being claimed: what is rendered
 * is what the format accepts. A hand-built `Layout` would let this file assert the canvas renders
 * documents the validator would refuse — or, worse, quietly stop matching its shape.
 *
 * What jsdom cannot answer is asserted nowhere here: there is no layout engine, so `transform`,
 * `overflow: hidden` and the letterbox are strings in a style attribute, not observable geometry.
 * Those are settled by captures at the target sizes. What this file settles is that the right
 * elements exist, in the right order, carrying the right numbers.
 */

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { loadLayoutJson, type Layout } from '@perch/layout-schema';
import { createMockSource, type MockSensorSource } from '@perch/sensor-sources';
import { SensorProvider } from '@perch/ui-kit';
import { LayoutCanvas } from './layout-canvas.js';
import { WIDGET_REGISTRY } from './widget-catalogue.js';

/** Every element kind, in one document, in a deliberate paint order. */
const ALL_KINDS = {
  schemaVersion: 1,
  target: { width: 800, height: 400, frameRate: 30 },
  theme: { '--perch-fg': '#00ff88', '--perch-canvas-bg': '#101010' },
  elements: [
    // First, so it paints under everything: the bleed case too — 40px wider than the canvas.
    { kind: 'media', src: 'shipped.svg', rect: { x: -20, y: 0, w: 840, h: 400 }, fit: 'contain' },
    {
      kind: 'text',
      text: 'first line\nsecond line',
      rect: { x: 16, y: 16, w: 300, h: 60 },
      style: { '--perch-text-size': '2rem' },
    },
    {
      kind: 'widget',
      widget: 'readout',
      topic: 'sensors/cpu/0/temperature/0',
      rect: { x: 16, y: 96, w: 240, h: 180 },
      style: { '--perch-dim': '#445566' },
    },
    { kind: 'media', src: 'absent.png', rect: { x: 600, y: 300, w: 180, h: 80 } },
  ],
} as const;

/** The one asset the bundle has. `absent.png` is deliberately not here. */
const ASSETS: Readonly<Record<string, string>> = { 'shipped.svg': '/assets/shipped-abc123.svg' };

function loadFixture(document: unknown): Layout {
  const loaded = loadLayoutJson(JSON.stringify(document), { widgets: WIDGET_REGISTRY });
  if (!loaded.ok) {
    throw new Error(`fixture is not a layout: ${loaded.issues.map((i) => i.message).join('; ')}`);
  }

  return loaded.layout;
}

function mount(
  document: unknown = ALL_KINDS,
  scale = 1,
): { source: MockSensorSource; layout: Layout } {
  const layout = loadFixture(document);
  const source = createMockSource({ seed: 5, autoStart: false });

  render(
    <SensorProvider source={source}>
      <LayoutCanvas layout={layout} scale={scale} resolveAsset={(src) => ASSETS[src]} />
    </SensorProvider>,
  );

  return { source, layout };
}

const canvas = (): HTMLElement => screen.getByTestId('perch-canvas');
const elements = (): HTMLElement[] => [...canvas().querySelectorAll('.perch-element')].map(asHtml);

function asHtml(node: Element): HTMLElement {
  if (!(node instanceof HTMLElement)) throw new Error('expected an HTML element');
  return node;
}

describe('<LayoutCanvas> — the canvas', () => {
  it('is fixed at the declared target size, whatever the scale', () => {
    mount(ALL_KINDS, 0.37);

    expect(canvas().style.width).toBe('800px');
    expect(canvas().style.height).toBe('400px');
    // The scale is a transform on the canvas, so the children keep their authored pixels. The one
    // thing that must never happen is the width changing with the scale.
    expect(canvas().style.transform).toBe('scale(0.37)');
  });

  it('reports its canvas size as data, for a capture harness that cannot read CSS', () => {
    mount();

    expect(canvas()).toHaveAttribute('data-perch-canvas-width', '800');
    expect(canvas()).toHaveAttribute('data-perch-canvas-height', '400');
  });

  it("applies the layout's theme as custom properties on the canvas", () => {
    mount();

    expect(canvas().style.getPropertyValue('--perch-fg')).toBe('#00ff88');
    expect(canvas().style.getPropertyValue('--perch-canvas-bg')).toBe('#101010');
  });
});

describe('<LayoutCanvas> — paint order', () => {
  it('renders elements in array order, which is z-order', () => {
    mount();

    expect(elements().map((element) => element.dataset['perchElementKind'])).toEqual([
      'media',
      'text',
      'widget',
      'media',
    ]);
  });

  it('indexes each element by its position in the array', () => {
    mount();

    expect(elements().map((element) => element.dataset['perchElementIndex'])).toEqual([
      '0',
      '1',
      '2',
      '3',
    ]);
  });

  it('uses no z-index, so source order is the only thing deciding what covers what', () => {
    mount();

    for (const element of elements()) {
      expect(element.style.zIndex).toBe('');
    }
  });
});

describe('<LayoutCanvas> — element geometry', () => {
  it('places every element at its authored rect in pixels', () => {
    mount();

    const [, text] = elements();
    expect(text?.style.left).toBe('16px');
    expect(text?.style.top).toBe('16px');
    expect(text?.style.width).toBe('300px');
    expect(text?.style.height).toBe('60px');
  });

  it('keeps a rect that bleeds off the edge, rather than clamping it', () => {
    mount();

    // The canvas clips; the element keeps the geometry the author wrote. Clamping here would move a
    // background by 20px and the author would never know why.
    const [background] = elements();
    expect(background?.style.left).toBe('-20px');
    expect(background?.style.width).toBe('840px');
  });

  it("applies an element's own style as custom properties on its box", () => {
    mount();

    const [, text, widget] = elements();
    expect(text?.style.getPropertyValue('--perch-text-size')).toBe('2rem');
    expect(widget?.style.getPropertyValue('--perch-dim')).toBe('#445566');
  });
});

describe('<LayoutCanvas> — the three kinds', () => {
  it('renders a widget through the catalogue, subscribed to its topic', () => {
    const { source } = mount();

    const readout = screen.getByRole('group');
    // Labelled from the metadata the mock retains for that exact topic, which is how a widget proves
    // it is bound to the topic the layout named rather than to whichever topic came first.
    expect(readout).toHaveAttribute('aria-label', 'CPU Package');
    expect(readout).toHaveAttribute('data-state', 'waiting');

    // Inside `act`: the publish happens outside React, so without it the subscriber's setState lands
    // after the assertion and the readout is still `waiting`.
    act(() => {
      source.tick();
    });

    expect(screen.getByRole('group')).toHaveAttribute('data-state', 'value');
  });

  it('renders text verbatim, including the line break the author wrote', () => {
    mount();

    expect(screen.getByText(/first line/).textContent).toBe('first line\nsecond line');
  });

  it('renders media as an image at the URL the bundle gave it', () => {
    mount();

    const image = elements()[0]?.querySelector('img');
    // `getAttribute`, not `image.src`: jsdom resolves the property against the document base and
    // would report `http://localhost/assets/...`, hiding whether the path was rewritten.
    expect(image?.getAttribute('src')).toBe('/assets/shipped-abc123.svg');
  });

  it("carries the layout's fit through to the frame", () => {
    mount();

    const [background] = elements();
    expect(background?.querySelector('.perch-media')).toHaveAttribute('data-fit', 'contain');
  });

  it('defaults an unspecified fit to cover, the format default', () => {
    mount({
      ...ALL_KINDS,
      elements: [{ kind: 'media', src: 'shipped.svg', rect: { x: 0, y: 0, w: 800, h: 400 } }],
    });

    expect(elements()[0]?.querySelector('.perch-media')).toHaveAttribute('data-fit', 'cover');
  });
});

describe('<LayoutCanvas> — visible failures', () => {
  it('names a missing asset on the page, in the rect where the image should have been', () => {
    mount();

    // Reachable by design: `layout-schema` checks that `src` is a well-formed relative path, because
    // it has no filesystem. Whether the file is there is the bundle's business, and a layout
    // referencing a deleted image must not paint a blank box on a wall panel.
    const failure = screen.getByText(/missing asset: absent\.png/);

    expect(failure).toBeInTheDocument();
    expect(failure.closest('.perch-element')?.getAttribute('data-perch-element-index')).toBe('3');
  });
});
