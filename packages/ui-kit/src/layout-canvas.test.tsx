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
import { LAYOUT_SCHEMA_VERSION, loadLayoutJson, type Layout } from '@perch/layout-schema';
import {
  sensorTopic,
  type SensorMeta,
  type SensorReading,
  type SensorSource,
  type SensorTopic,
} from '@perch/sensor-contract';
import { SensorProvider } from '@perch/ui-kit';
import { LayoutCanvas } from './layout-canvas.js';
import { WIDGET_REGISTRY } from './widget-catalogue.js';

const CPU_TEMP = sensorTopic('cpu', 'temperature');

/**
 * `ui-kit` may not import `sensor-sources`, so the double lives here.
 *
 * This is the one thing that changed when this file moved out of `apps/runtime`: it used to reach for
 * `createMockSource`, which this package has no edge to. Same idiom as `readout.test.tsx` and
 * `sensor-context.test.tsx`, and the same metadata — `CPU_TEMP` is labelled `CPU Package`, which is
 * what lets the widget assertion below still prove the readout is bound to the topic the *layout*
 * named rather than to whichever topic arrived first.
 */
function fakeSource() {
  const handlers = new Set<(topic: SensorTopic, reading: SensorReading) => void>();
  const metas = new Map<string, SensorMeta>([[CPU_TEMP, { label: 'CPU Package' }]]);

  return {
    status: 'live' as const,
    subscribe(_pattern: string, onReading: (topic: SensorTopic, reading: SensorReading) => void) {
      handlers.add(onReading);
      return () => handlers.delete(onReading);
    },
    meta(topic: SensorTopic) {
      return metas.get(topic);
    },
    emit(topic: SensorTopic, reading: SensorReading) {
      for (const handler of [...handlers]) handler(topic, reading);
    },
  } satisfies SensorSource & Record<string, unknown>;
}

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
): { source: ReturnType<typeof fakeSource>; layout: Layout } {
  const layout = loadFixture(document);
  const source = fakeSource();

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

describe('<LayoutCanvas> — the widget, text and media kinds', () => {
  it('renders a widget through the catalogue, subscribed to its topic', () => {
    const { source } = mount();

    const readout = screen.getByRole('group');
    // Labelled from the metadata the source retains for that exact topic, which is how a widget proves
    // it is bound to the topic the layout named rather than to whichever topic came first.
    expect(readout).toHaveAttribute('aria-label', 'CPU Package');
    expect(readout).toHaveAttribute('data-state', 'waiting');

    // Inside `act`: the publish happens outside React, so without it the subscriber's setState lands
    // after the assertion and the readout is still `waiting`.
    act(() => {
      source.emit(CPU_TEMP, { value: 61.5, at: Date.now() });
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

describe('<LayoutCanvas> — the chart kind', () => {
  /**
   * A one-element document at the current schema version.
   *
   * Separate from `ALL_KINDS` rather than added to it, because the widget assertions above find their
   * readout with a bare `getByRole('group')` and a chart is a second group. The point being made here
   * is about dispatch, not about coexistence.
   */
  const chartDocument = (element: Record<string, unknown>): Record<string, unknown> => ({
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    target: { width: 800, height: 400, frameRate: 30 },
    theme: {},
    elements: [element],
  });

  const CHART_ELEMENT = {
    kind: 'chart',
    widget: 'line-chart',
    topic: 'sensors/cpu/0/temperature/0',
    rect: { x: 16, y: 16, w: 400, h: 200 },
    windowMs: 60_000,
    range: [0, 100],
  };

  it('draws a chart element through the same catalogue a widget element goes through', () => {
    mount(chartDocument(CHART_ELEMENT));

    const chart = screen.getByRole('group');
    expect(chart).toHaveClass('perch-chart');
    expect(chart).toHaveAttribute('data-topic', 'sensors/cpu/0/temperature/0');
    // The placeholder from `chart-view`, which is how the element proves it reached the real renderer
    // rather than the failure box this branch used to be.
    expect(chart).toHaveTextContent('waiting for readings');
  });

  it('gives the chart the window and the rect the element authored', () => {
    mount(chartDocument(CHART_ELEMENT));

    const chart = screen.getByRole('group');
    expect(chart.querySelector('.perch-chart__span')?.textContent).toBe('1 min');
    // The plot's width is the element's rect, so the geometry came from the layout and not from a
    // measurement of whatever box jsdom reports.
    expect(chart.querySelector('.perch-chart__plot')?.getAttribute('width')).toBe('400');
  });

  it('subscribes the chart to the topic the element named', () => {
    const { source } = mount(chartDocument(CHART_ELEMENT));

    act(() => {
      source.emit(CPU_TEMP, { value: 61.5, at: Date.now() });
    });

    const chart = screen.getByRole('group');
    expect(chart).toHaveAttribute('data-state', 'series');
    expect(chart.querySelector('.perch-chart__value')?.textContent).toBe('61.5 °C');
  });

  it('says so when a chart element names a widget that is not a chart', () => {
    // Reachable from a layout that validates: `readout` is a registered name and it draws no scale, so
    // the format has no rule to refuse it here. Its registry carries one capability flag and that flag
    // is about ranges — see DECISIONS.md on this being reported rather than patched into the schema.
    mount(
      chartDocument({
        kind: 'chart',
        widget: 'readout',
        topic: 'sensors/cpu/0/temperature/0',
        rect: { x: 0, y: 0, w: 400, h: 200 },
        windowMs: 60_000,
      }),
    );

    expect(screen.getByText(/not a chart widget: readout/)).toBeInTheDocument();
  });

  it('says so when a widget element names a chart', () => {
    // The mirror case, equally valid to the format and equally undrawable: a `widget` element has no
    // `windowMs`, so there is no window for a chart to plot.
    mount(
      chartDocument({
        kind: 'widget',
        widget: 'line-chart',
        topic: 'sensors/cpu/0/temperature/0',
        rect: { x: 0, y: 0, w: 400, h: 200 },
        range: [0, 100],
      }),
    );

    expect(screen.getByText(/needs a chart element: line-chart/)).toBeInTheDocument();
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
