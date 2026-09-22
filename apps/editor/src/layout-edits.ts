/**
 * Every edit the editor can make, as a pure `Layout -> Layout` function.
 *
 * ## Why edits are functions over a validated shape rather than patches over loose JSON
 *
 * The obvious design for a form-driven editor is a `Record<string, unknown>` draft with stringly
 * paths — `elements[3].rect.w` — because that is the shape an HTML form naturally produces and
 * because it can hold anything a user types. It was rejected. A path-patched blob is unchecked
 * everywhere: nothing stops a control writing `fit` onto a text element or `text` onto a chart, and
 * the failure surfaces as a `unknown-field` issue from the validator rather than as a compile error
 * at the control that did it.
 *
 * So the draft is a `Layout` — the very type `layout-schema` hands back and `LayoutCanvas` takes —
 * and every edit below is typed against it. That is not a claim that the draft is always *valid*:
 * `Layout`'s TypeScript types permit a great many documents the validator refuses, which is precisely
 * what makes this workable. `rect.w` is a `number`, so `0` and `2.5` and `NaN` all typecheck and all
 * get named by `validateLayout`. `text` is a `string`, so `''` typechecks and gets named. A theme
 * token value is a `string`, so `red;color:blue` typechecks and gets named. The editor therefore
 * needs no parallel "maybe invalid" representation, and the refusal path is exercised by ordinary
 * edits rather than by a shape only the tests can build.
 *
 * `NaN` is the one that earns its keep. A number input cleared to empty yields `''`, which this
 * editor maps to `Number.NaN` rather than to a default or to the previous value — see
 * `numberFromInput`. Substituting silently is the failure: the author sees an empty box, the document
 * still holds `214`, and the save writes a number nobody typed. `NaN` is a `number`, so it flows
 * through every type here untouched, and `requireInteger` reports it against the field it is in.
 *
 * ## Immutability, and why it is spelled out
 *
 * `Layout` and its members are declared with mutable fields — `layout-schema` rebuilds them from
 * checked values and hands them over — so nothing in the type system stops an in-place edit. Every
 * function here rebuilds instead, because the draft's previous value is *kept*: `DraftState` holds the
 * last layout that validated, and the preview renders that one. Mutating in place would edit the
 * object the preview is still holding, and a form whose only visible effect is on the next render
 * would appear to work.
 *
 * ## Optional fields and `exactOptionalPropertyTypes`
 *
 * `style`, `range`, `fit` and `gap` are optional, and under `exactOptionalPropertyTypes` a key set to
 * `undefined` is a *different document* from an absent key — it survives `JSON.stringify` as nothing
 * at all, but it survives a `rejectUnknownFields` pass as a key that is there. So every rebuild below
 * uses the spread-or-nothing form `...(x === undefined ? {} : { x })` that `layout-schema`'s own
 * validators use, and nothing here ever writes an explicit `undefined`.
 */

import type {
  ChartGap,
  Layout,
  LayoutElement,
  MediaFit,
  Range,
  Rect,
  Style,
} from '@perch/layout-schema';

/** One edit: a whole new layout from the old one. */
export type LayoutUpdate = (layout: Layout) => Layout;

/** Which component of a rect a control is bound to. */
export type RectField = 'x' | 'y' | 'w' | 'h';

/** Which component of `target` a control is bound to. */
export type TargetField = 'width' | 'height' | 'frameRate';

/** Which end of a `range` a control is bound to. */
export type RangeBound = 'min' | 'max';

/**
 * A number as typed into a numeric input.
 *
 * `''` becomes `NaN` deliberately — see the module comment. `Number('')` is `0`, which is the exact
 * silent substitution this avoids, so the empty case is tested for rather than left to the coercion.
 */
export function numberFromInput(text: string): number {
  return text.trim() === '' ? Number.NaN : Number(text);
}

/**
 * A number as shown in a numeric input.
 *
 * The inverse of `numberFromInput` for every value it produces, which is what makes an empty field
 * stay empty while the author is clearing it rather than snapping back to a number they deleted.
 * `NaN` is the only non-finite value reachable from a numeric input, and it renders as the empty
 * string it came from.
 */
export function numberToInput(value: number): string {
  return Number.isNaN(value) ? '' : String(value);
}

/** Set one component of the canvas target. */
export function setTargetField(field: TargetField, value: number): LayoutUpdate {
  return (layout) => ({ ...layout, target: { ...layout.target, [field]: value } });
}

/** Set a theme token, adding it if the layout does not have it. */
export function setThemeToken(name: string, value: string): LayoutUpdate {
  return (layout) => ({ ...layout, theme: { ...layout.theme, [name]: value } });
}

/**
 * Remove a theme token.
 *
 * Removal rather than setting it empty, because `layout-schema` rejects an empty token value with
 * "remove the key instead of setting it empty" — so a control that blanked a token would be teaching
 * the author a spelling the format refuses.
 */
export function removeThemeToken(name: string): LayoutUpdate {
  return (layout) => ({ ...layout, theme: withoutKey(layout.theme, name) });
}

/** Set one component of an element's rect. */
export function setElementRectField(index: number, field: RectField, value: number): LayoutUpdate {
  return mapElement(index, (element) => withRect(element, { ...element.rect, [field]: value }));
}

/**
 * Replace an element's whole rect in one edit.
 *
 * The four-at-once counterpart to `setElementRectField`, for direct manipulation: a drag moves `x` and
 * `y` together and a resize moves all four, and writing them one field at a time would run the
 * validator on three intermediate rects nobody authored. The caller (the canvas overlay) has already
 * rounded to integers in layout space; this makes no claim about the values beyond that they replace
 * the rect wholesale, so `validateLayout` still names anything wrong with them.
 */
export function setElementRect(index: number, rect: Rect): LayoutUpdate {
  return mapElement(index, (element) => withRect(element, rect));
}

/** Replace a text element's string. A no-op on any other kind. */
export function setElementText(index: number, text: string): LayoutUpdate {
  return mapElement(index, (element) => (element.kind === 'text' ? { ...element, text } : element));
}

/** Rebind a widget or chart element to another topic. A no-op on any other kind. */
export function setElementTopic(index: number, topic: string): LayoutUpdate {
  return mapElement(index, (element) =>
    element.kind === 'widget' || element.kind === 'chart' ? { ...element, topic } : element,
  );
}

/** Point a widget or chart element at another widget by name. A no-op on any other kind. */
export function setElementWidget(index: number, widget: string): LayoutUpdate {
  return mapElement(index, (element) =>
    element.kind === 'widget' || element.kind === 'chart' ? { ...element, widget } : element,
  );
}

/** Repoint a media element at another asset path. A no-op on any other kind. */
export function setElementSrc(index: number, src: string): LayoutUpdate {
  return mapElement(index, (element) => (element.kind === 'media' ? { ...element, src } : element));
}

/** Set a media element's fit. A no-op on any other kind. */
export function setElementFit(index: number, fit: MediaFit): LayoutUpdate {
  return mapElement(index, (element) => (element.kind === 'media' ? { ...element, fit } : element));
}

/** Set a chart element's time window, in milliseconds. A no-op on any other kind. */
export function setElementWindowMs(index: number, windowMs: number): LayoutUpdate {
  return mapElement(index, (element) =>
    element.kind === 'chart' ? { ...element, windowMs } : element,
  );
}

/** Set what a chart draws across a stretch with no readings. A no-op on any other kind. */
export function setElementGap(index: number, gap: ChartGap): LayoutUpdate {
  return mapElement(index, (element) => (element.kind === 'chart' ? { ...element, gap } : element));
}

/**
 * Move one end of an element's authored scale.
 *
 * A no-op when the element has no `range`, and deliberately not an "add a range" operation. Whether
 * an element *needs* one is the widget registry's knowledge — `drawsScale` — and the format rejects a
 * `range` on a widget that draws none, so a control that could add one to any element would let the
 * editor manufacture an `unknown-field`-shaped refusal out of a button press. Editing a range that is
 * already authored is unambiguous; creating one belongs with the element-creation work this slice
 * does not do. See DECISIONS.md.
 */
export function setElementRangeBound(
  index: number,
  bound: RangeBound,
  value: number,
): LayoutUpdate {
  return mapElement(index, (element) => {
    if (element.kind === 'media' || element.kind === 'text') return element;

    const range = element.range;
    if (range === undefined) return element;

    const next: Range = bound === 'min' ? [value, range[1]] : [range[0], value];

    return { ...element, range: next };
  });
}

/** Set one of an element's own style tokens, adding it if absent. A no-op on a media element. */
export function setElementStyleToken(index: number, name: string, value: string): LayoutUpdate {
  return mapElement(index, (element) => {
    if (element.kind === 'media') return element;

    const style: Style = { ...element.style, [name]: value };

    return { ...element, style };
  });
}

/**
 * Remove one of an element's own style tokens.
 *
 * The last token removed takes `style` with it rather than leaving `{}`. Both validate, but an empty
 * map is a key the author did not write, and it would be the one difference between a layout they
 * opened and a layout they saved without editing.
 */
export function removeElementStyleToken(index: number, name: string): LayoutUpdate {
  return mapElement(index, (element) => {
    if (element.kind === 'media') return element;
    if (element.style === undefined) return element;

    const style = withoutKey(element.style, name);
    const rest = withoutStyle(element);

    return Object.keys(style).length === 0 ? rest : { ...rest, style };
  });
}

/** Replace the element at `index`, leaving every other element and every other field alone. */
function mapElement(
  index: number,
  update: (element: LayoutElement) => LayoutElement,
): LayoutUpdate {
  return (layout) => ({
    ...layout,
    elements: layout.elements.map((element, at) => (at === index ? update(element) : element)),
  });
}

/**
 * An element with a new rect.
 *
 * Written as one function over the union rather than inside each branch, because `rect` is the one
 * field every kind has and the one the four kinds agree about completely. A `switch` here would be
 * four identical branches whose only content is the member's own name.
 */
function withRect(element: LayoutElement, rect: Rect): LayoutElement {
  return { ...element, rect };
}

/** The element without its `style` key at all, rather than with the key set to `undefined`. */
function withoutStyle(element: LayoutElement): LayoutElement {
  if (element.kind === 'media') return element;

  const { style: _dropped, ...rest } = element;

  return rest;
}

/** A token map without one key. A fresh object; the original is untouched. */
function withoutKey(
  tokens: Readonly<Record<string, string>>,
  name: string,
): Record<string, string> {
  return Object.fromEntries(Object.entries(tokens).filter(([key]) => key !== name));
}
