/**
 * The widget vocabulary, declared **once**.
 *
 * Two consumers need to know what a widget is, and they need to agree:
 *
 * - `@perch/layout-schema` needs a `WidgetRegistry` — which names exist, and which of them draw a
 *   scale and therefore require an authored `range`. It must not import `ui-kit` (its SPEC's hard
 *   rule 5), so the vocabulary is injected from here. That rule is unaffected by this package now
 *   importing *it*: the edge runs one way, `ui-kit` → `layout-schema`, and the registry is still
 *   handed to the validator at the call site rather than known by it.
 * - `LayoutCanvas` needs a name → React component map, to turn a validated `WidgetElement` into
 *   pixels.
 *
 * Kept as two hand-written lists, those drift, and the drift has one specific shape: a name in the
 * registry with no component. A layout using it **validates and then renders nothing**, which is
 * the worst available outcome — the format's own typo-safety says the layout is fine while the panel
 * shows an empty rectangle, so the author looks anywhere but at the widget name.
 *
 * So neither list is written. `WIDGET_CATALOGUE` below is the only declaration, and both are
 * *derived* from it at module load: the registry by projecting each entry's `drawsScale`, the
 * component map by `Object.entries` of the same object. Drift is not tested for, it is
 * unrepresentable — a new widget is one entry carrying both halves, and an entry cannot carry one
 * half, because `render` and `drawsScale` are both required by `WidgetCatalogueEntry`.
 *
 * ## Why this is in `ui-kit`, and why `drawsScale` is still not a component's business
 *
 * This file moved here with `LayoutCanvas`, and for the same reason: it is the other half of drawing
 * a layout. A catalogue left in `apps/runtime` would have the editor build its own, and then the two
 * would disagree about which widgets exist — the runtime painting a gauge the editor cannot offer,
 * or the editor offering one the runtime refuses. Both apps now inject *this* registry into
 * `loadLayout`, so "what widgets are there" has one answer in the repo.
 *
 * `drawsScale` is still not a prop and still not `Readout`'s business. It is the *registry builder's*
 * knowledge, per `layout-schema`'s own note: whether a widget needs a `range` is a statement about
 * the layout format's requirements on an author, not about the component's API. A widget component
 * stays usable by a caller holding no layout at all; the flag lives out here in the catalogue entry
 * beside it, which is what `WidgetCatalogueEntry` keeps together — the component and the one fact
 * the validator needs about it.
 */

import type { ReactNode } from 'react';
import {
  createWidgetRegistry,
  type ChartElement,
  type WidgetElement,
  type WidgetRegistry,
} from '@perch/layout-schema';
import { LineChart } from './line-chart.js';
import { Readout } from './readout.js';

/**
 * Which element kind a catalogue entry paints.
 *
 * This is the one thing the chart contract made necessary here, and it is worth being precise about
 * why. `layout-schema` resolves a `chart` element's `widget` against **this same registry** — the same
 * name check, the same `drawsScale`/`range` rule, deliberately, so that "charts need ranges" is not a
 * second mechanism. But the two element types are not interchangeable: a `ChartElement` carries
 * `windowMs` and `gap`, which a `WidgetElement` has no field for, and a `WidgetElement` is what a
 * `widget` element supplies. One entry shape taking `WidgetElement` would leave a chart renderer with
 * no window to draw, and one taking the union would need a cast in every renderer to get its own type
 * back — which is exactly the mistake the `renderElement` switch in `layout-canvas.tsx` avoids.
 *
 * So an entry declares which kind it binds to, and the union below gives each renderer its own
 * narrowed element type with no cast anywhere. A `widget` element naming a chart widget, or a `chart`
 * element naming a readout, is then a mismatch the canvas can *detect* and draw visibly, rather than a
 * renderer quietly reading fields that are not there.
 *
 * `layout-schema` cannot make that mismatch impossible, because `WidgetRegistry` has one capability
 * flag and it is about scales. See DECISIONS.md: this is reported as an awkwardness in the chart
 * contract, not patched into the schema.
 */
export type WidgetBinding = 'widget' | 'chart';

/**
 * The box a renderer lays out in: the element's rect less its padding, in layout pixels.
 *
 * Handed to every renderer by `LayoutCanvas`, which is the one place that resolves the padding — see
 * `elementContentSize`. A widget sized by arithmetic (the chart) must use this rather than
 * `element.rect`, or it is sized for a box larger than the one it is drawn in; a widget sized by CSS
 * (the readout) can ignore it, because CSS already lays it out inside the padding.
 */
export interface ContentBox {
  readonly w: number;
  readonly h: number;
  /** The padding the canvas applied to each side, after clamping. */
  readonly padding: BoxInsets;
}

/** One number per side of a box, in layout pixels. */
export interface BoxInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** What every entry carries, whichever kind it paints. */
interface WidgetCatalogueEntryBase {
  /**
   * Whether this widget draws a scale, and so requires an authored `range` in every element that
   * uses it — `widget` and `chart` elements alike. Passed straight through to the registry.
   */
  readonly drawsScale: boolean;
}

/** One widget: what the validator must know about it, and how it paints. */
export type WidgetCatalogueEntry =
  | (WidgetCatalogueEntryBase & {
      readonly binding: 'widget';
      /**
       * The widget, as pixels. Receives the whole validated element rather than picked-apart props, so
       * a widget that later reads `range` or `style` needs no change here.
       */
      readonly render: (element: WidgetElement, content: ContentBox) => ReactNode;
    })
  | (WidgetCatalogueEntryBase & {
      readonly binding: 'chart';
      /**
       * The chart, as pixels. Receives the element, which is where the window and the gap are, and the
       * content box it is drawn in, which is what its geometry is computed from.
       */
      readonly render: (element: ChartElement, content: ContentBox) => ReactNode;
    });

/**
 * Every widget a layout may name, and `LayoutCanvas` can paint.
 *
 * Two entries, and that is the honest state of the project: a numeric readout and a line chart. The
 * gauge that README.md and the layout format both anticipate is still not here because it does not
 * exist — a catalogue entry for a component nobody wrote would be exactly the "validates, then renders
 * nothing" failure this file is built to prevent, with the registry telling authors to use a widget no
 * canvas can draw. The sparkline is no longer listed as missing for a different reason: a sparkline is
 * a chart element with a small rect, which `line-chart` now draws.
 *
 * `satisfies` rather than an annotation: the object keeps its literal key type, so `WidgetName`
 * below is the exact union of what is here, while every entry is still checked against the shape.
 */
const WIDGET_CATALOGUE = {
  /**
   * The numeric readout. `drawsScale: false` — it prints one number and no axis, so a `range` on a
   * readout element would be an authored value nothing reads, and the format rejects it for a
   * widget that does not draw one.
   */
  readout: {
    binding: 'widget',
    drawsScale: false,
    render: (element) => <Readout topic={element.topic} />,
  },
  /**
   * The line chart. `drawsScale: true` — it draws a y-axis, so the format requires an authored `range`
   * on every element that uses it, through the rule that already existed rather than a new one.
   *
   * The `range` fallback below is unreachable for an element that came through `loadLayout` with
   * `WIDGET_REGISTRY`: `drawsScale: true` is what makes `range` required, and the registry is derived
   * from this entry. It is written out because `ChartElement.range` is optional in the *type* — the
   * requirement is a validator rule, not a type-level one — and a non-null assertion here would be a
   * claim about a validator this file cannot see. A layout built by hand in code, which every test in
   * this repo does, can reach it.
   */
  'line-chart': {
    binding: 'chart',
    drawsScale: true,
    render: (element, content) =>
      element.range === undefined ? (
        <span className="perch-element__failure">{`chart needs a range: ${element.widget}`}</span>
      ) : (
        <LineChart
          topic={element.topic}
          windowMs={element.windowMs}
          range={element.range}
          // The authored rect less its padding, so the chart's geometry is arithmetic rather than a
          // measurement. See `line-chart.tsx` on why a measured chart reflows its first captured frame.
          width={content.w}
          height={content.h}
          gap={element.gap}
        />
      ),
  },
} satisfies Readonly<Record<string, WidgetCatalogueEntry>>;

/** Every widget name, as a type. A misspelling in this package is a compile error. */
export type WidgetName = keyof typeof WIDGET_CATALOGUE;

/**
 * The names, in declaration order.
 *
 * Only for messages and tests; `WIDGET_REGISTRY.names` is the sorted canonical list that
 * `layout-schema` reports in its own errors.
 */
export const WIDGET_NAMES: readonly WidgetName[] = Object.freeze(
  Object.keys(WIDGET_CATALOGUE) as WidgetName[],
);

/**
 * Name → component, derived.
 *
 * A `Map` rather than the object itself, because the lookup key is a `string` from a layout file and
 * `Map.get` answers that honestly with `WidgetCatalogueEntry | undefined`. Indexing the object would
 * need a cast from `string` to `WidgetName` — which is the assertion that a layout's widget name is
 * one this catalogue knows, i.e. exactly the thing being checked.
 */
const WIDGET_COMPONENTS: ReadonlyMap<string, WidgetCatalogueEntry> = new Map(
  Object.entries(WIDGET_CATALOGUE),
);

/**
 * The registry handed to `loadLayout`, derived from the same declaration.
 *
 * Built at module load and shared: `createWidgetRegistry` freezes its result and sorts `names`, so
 * one instance produces byte-identical error messages everywhere and there is nothing to keep in
 * sync between the canvas and its tests.
 */
export const WIDGET_REGISTRY: WidgetRegistry = createWidgetRegistry(
  Object.fromEntries(
    Object.entries(WIDGET_CATALOGUE).map(([name, entry]) => [
      name,
      { drawsScale: entry.drawsScale },
    ]),
  ),
);

/**
 * The component for a widget name, or `undefined`.
 *
 * `undefined` is unreachable for an element that came through `loadLayout` with `WIDGET_REGISTRY` —
 * the validator rejected every unregistered name, and the registry is derived from the same table
 * this reads. It is still returned rather than thrown past, because the caller has a page to draw
 * and a visible failure box beats an exception that unmounts the whole canvas.
 */
export function widgetFor(name: string): WidgetCatalogueEntry | undefined {
  return WIDGET_COMPONENTS.get(name);
}
