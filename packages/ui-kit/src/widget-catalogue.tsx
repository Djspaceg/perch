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
  type WidgetElement,
  type WidgetRegistry,
} from '@perch/layout-schema';
import { Readout } from './readout.js';

/** One widget: what the validator must know about it, and how it paints. */
export interface WidgetCatalogueEntry {
  /**
   * Whether this widget draws a scale, and so requires an authored `range` in every element that
   * uses it. Passed straight through to the registry.
   */
  readonly drawsScale: boolean;
  /**
   * The widget, as pixels. Receives the whole validated element rather than picked-apart props, so
   * a widget that later reads `range` or `style` needs no change here.
   */
  readonly render: (element: WidgetElement) => ReactNode;
}

/**
 * Every widget a layout may name, and `LayoutCanvas` can paint.
 *
 * One entry, and that is the honest state of the project: `ui-kit` ships one widget. The gauge and
 * the sparkline that README.md and the layout format both anticipate are not here because they do
 * not exist — a catalogue entry for a component nobody wrote would be exactly the "validates, then
 * renders nothing" failure this file is built to prevent, with the registry telling authors to use
 * a widget no canvas can draw.
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
    drawsScale: false,
    render: (element) => <Readout topic={element.topic} />,
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
