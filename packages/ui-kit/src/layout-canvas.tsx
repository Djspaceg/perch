/**
 * A validated layout, as pixels: the fixed canvas, the scale, and the element kinds.
 *
 * ## Why this is in `ui-kit` and not in `runtime`
 *
 * It began in `apps/runtime`, which is the only thing that rendered a layout at the time. The
 * editor renders one too — its canvas *is* this canvas — and `apps/` may not import `apps/`, so
 * leaving it there meant the editor writing a second one. Two canvases is the specific way the
 * editor's preview stops matching the runtime's output, which is the failure `ui-kit` exists as its
 * own package to prevent: "the editor's canvas must draw the same gauge the runtime draws, or
 * WYSIWYG is a lie" (ARCHITECTURE.md). One canvas makes that structural rather than aspirational.
 *
 * What stayed in `runtime` is everything that is not the pixels of a layout: the page chrome and its
 * provenance strip, the mock/MQTT source choice, the `layouts/` catalogue and the `?layout=`
 * plumbing, the viewport fit, and the refusal page. This file knows nothing about any of it.
 *
 * ## The coordinate system, and what it refuses to be
 *
 * The canvas is a box exactly `target.width` x `target.height` CSS pixels, every element is
 * absolutely positioned at its authored integer rect, and the **whole canvas** is scaled with one
 * `transform` to fit the viewport. Nothing reflows, ever. A browser tab and the panel show the same
 * arrangement at two sizes — which is the guarantee that makes the editor's canvas and the panel's
 * output pixel-identical, and the reason `layout-schema`'s geometry is integers.
 *
 * `transform: scale()` rather than resizing anything: a transform is applied by the compositor after
 * layout, so children keep their authored pixel geometry and no amount of scaling can change which
 * element is where. Recomputing sizes instead — even proportionally — would put every rounding
 * decision back in play at every viewport.
 *
 * Centring is left to flexbox rather than done with offsets. A transformed box still occupies its
 * *untransformed* size in layout, so with `transform-origin: center` the scaled canvas stays centred
 * in the stage and the leftover space becomes the letterbox bars on whichever axis has spare room.
 *
 * ## Paint order
 *
 * `elements` is painted in array order, and array order is z-order: later elements paint over
 * earlier ones. That falls out of source order here — no `z-index` anywhere — which is why a
 * full-bleed media element is written first in a layout file and everything else after it.
 *
 * ## Where a theme lands
 *
 * `layout.theme` is applied as CSS custom properties on the canvas element, and an element's own
 * `style` on that element's box. Both are plain custom-property maps, validated by `layout-schema`
 * against a conservative name and value grammar, so a layout cannot reach any property that is not a
 * token — no `position`, no `transform`, nothing that could move an element out of its rect or
 * reintroduce a reflow.
 *
 * ## The element box, and why the rect is its footprint
 *
 * Every styled entity's box has three tokens of its own — `--perch-box-bg`, `--perch-box-radius`,
 * `--perch-box-padding`. The box is `border-box`, which was the human's decision and is the reason
 * the rect stays the truth: background and corners paint exactly the rect the author dragged and
 * `validateLayout` checked, the editor's handles sit on the painted edges, and padding comes out of
 * the content rather than growing the box past the rect into its neighbours.
 *
 * The background is read by `ELEMENT_BOX_STYLES`. Radius and padding are read here instead
 * (`CANVAS_RESOLVED_TOKENS`), because each holds a one-to-four-value CSS shorthand (`box-shorthand.ts`)
 * and no `calc()` can turn a list into pixels. The canvas resolves each the way custom-property
 * inheritance would — element style, then theme, then the default — and writes it on the box as a
 * native `padding` or `border-radius`. Padding is also the value JavaScript has to know: a chart is
 * sized by arithmetic from its box, never by measurement, so `elementContentSize` hands the chart the
 * content box the resolved sides leave, and the box is written with those same sides. Nothing is
 * written to a box whose element and theme set neither token, so a layout that sets none of these
 * renders the same markup it always did.
 */

import type { CSSProperties, ReactNode } from 'react';
import {
  type ChartElement,
  type Layout,
  type LayoutElement,
  type MediaElement,
  type MediaFit,
  type Rect,
  type Style,
  type TextElement,
  type WidgetElement,
} from '@perch/layout-schema';
import { boxQuadCss, parseBoxToken, type BoxQuad } from './box-shorthand.js';
import { assertNever } from './exhaustive.js';
import { MediaFrame, type MediaFrameFit } from './media-frame.js';
import { TextBlock } from './text-block.js';
import { PERCH_TOKEN_DEFAULTS, token, type PerchToken } from './tokens.js';
import { widgetFor, type ContentBox } from './widget-catalogue.js';

/**
 * The tokens the *canvas* reads, as opposed to the ones a widget reads.
 *
 * `PERCH_TOKEN_DEFAULTS` is the widget vocabulary; these two are the canvas's own, and they stay a
 * separate record rather than joining it because they are read at a different level — one canvas
 * element and one stage, not once per widget — and because a layout's `theme` may set either.
 * Declared as a record with defaults for the same reason `tokens.ts` does it: a `var()` whose
 * fallback lives only in a string literal is a fallback nobody can check, and the way you find out
 * it was missing is a layout with `theme: {}` painting a transparent canvas.
 */
export const CANVAS_TOKEN_DEFAULTS = {
  /** Behind the elements, inside the canvas. A layout's "background colour". */
  '--perch-canvas-bg': '#101318',
  /**
   * Outside the canvas, in the letterbox bars.
   *
   * Darker than any layout's own background by default, so the bars read as "not part of the
   * dashboard" rather than as an oddly empty region of it.
   */
  '--perch-letterbox-bg': '#07080a',
} as const;

export type CanvasToken = keyof typeof CANVAS_TOKEN_DEFAULTS;

/** A canvas token as a `var()` reference carrying its declared default. */
export function canvasToken(name: CanvasToken): string {
  return `var(${name}, ${CANVAS_TOKEN_DEFAULTS[name]})`;
}

export interface LayoutCanvasProps {
  readonly layout: Layout;
  /** Canvas pixels to output pixels, from `fitLayoutTarget`. */
  readonly scale: number;
  /** A layout's media `src` as a URL, or `undefined` if the asset is missing from the bundle. */
  readonly resolveAsset: (src: string) => string | undefined;
}

export function LayoutCanvas({ layout, scale, resolveAsset }: LayoutCanvasProps): ReactNode {
  return (
    <div
      className="perch-canvas"
      data-testid="perch-canvas"
      data-perch-canvas-width={layout.target.width}
      data-perch-canvas-height={layout.target.height}
      style={canvasStyle(layout, scale)}
    >
      {layout.elements.map((element, index) => {
        const style = styleOf(element);
        const content = boxOf(element, style, layout.theme);

        return (
          <div
            // Index as key, which is the correct choice exactly here: `elements` is a fixed array read
            // once from a file, so there is no insertion, no removal and no reordering for the life of
            // the page. The index *is* the element's identity, and it is also its z-order.
            key={index}
            className="perch-element"
            data-perch-element-kind={element.kind}
            data-perch-element-index={index}
            style={elementStyle(element, style, content, layout.theme)}
          >
            {renderElement(element, content, resolveAsset)}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One element, dispatched on `kind`.
 *
 * A `switch` closed by `assertNever` rather than a lookup table, because each branch needs the
 * narrowed member: a table keyed by `ElementKind` would hand every renderer the union and need a
 * cast to get its own type back, which is the one thing that could let a media renderer read a text
 * element's fields. A new member of `ELEMENT_KINDS` fails to compile here until it has a branch —
 * which is exactly what `chart` did.
 */
function renderElement(
  element: LayoutElement,
  content: ContentBox,
  resolveAsset: (src: string) => string | undefined,
): ReactNode {
  switch (element.kind) {
    case 'widget':
      return renderWidget(element, content);
    case 'text':
      return renderText(element);
    case 'media':
      return renderMedia(element, resolveAsset);
    case 'chart':
      return renderChart(element, content);
    default:
      return assertNever(element, 'layout element kind');
  }
}

/**
 * A chart element, through the same catalogue a widget element goes through.
 *
 * `layout-schema` version 2 added `chart` to `ELEMENT_KINDS` and this branch was the failure box for
 * as long as no chart existed. It now resolves the element's `widget` against `widgetFor`, which is
 * deliberately the *same* lookup and the same registry as `renderWidget` — the format resolves a
 * chart's widget name against `WidgetRegistry` too, so a second table here would be a second answer
 * to "does this widget exist".
 *
 * What differs is the binding check. An entry declares which element kind it paints, because a
 * `ChartElement` carries `windowMs` and `gap` that a `WidgetElement` has no field for; see
 * `widget-catalogue.tsx`. `readout` on a chart element is therefore a real authoring mistake that the
 * format cannot reject — its registry has one capability flag and it is about scales — so it is
 * caught here and drawn, rather than handed to a renderer that would read a window that is not there.
 */
function renderChart(element: ChartElement, content: ContentBox): ReactNode {
  const widget = widgetFor(element.widget);
  if (widget === undefined) {
    return <span className="perch-element__failure">{`no such widget: ${element.widget}`}</span>;
  }
  if (widget.binding !== 'chart') {
    return (
      <span className="perch-element__failure">{`not a chart widget: ${element.widget}`}</span>
    );
  }

  return widget.render(element, content);
}

/**
 * A widget, through the catalogue the registry was derived from.
 *
 * The `undefined` branch is unreachable for an element that came through `loadLayout` with
 * `WIDGET_REGISTRY` — the validator rejects an unregistered name, and the registry is built from the
 * same table `widgetFor` reads, so there is no name that passes one and fails the other. It is
 * rendered anyway, and rendered *visibly*: if that invariant ever breaks, the panel must say so
 * rather than show the blank rectangle this whole arrangement exists to prevent.
 *
 * The binding branch, unlike that one, *is* reachable from a valid layout: `widget: line-chart` on a
 * `kind: 'widget'` element passes every check the format makes, and there is no window in that
 * element for a chart to draw. It says which mistake was made, in the rect where it was made.
 */
function renderWidget(element: WidgetElement, content: ContentBox): ReactNode {
  const widget = widgetFor(element.widget);
  if (widget === undefined) {
    return <span className="perch-element__failure">{`no such widget: ${element.widget}`}</span>;
  }
  if (widget.binding !== 'widget') {
    return (
      <span className="perch-element__failure">{`needs a chart element: ${element.widget}`}</span>
    );
  }

  return widget.render(element, content);
}

function renderText(element: TextElement): ReactNode {
  return <TextBlock text={element.text} />;
}

/**
 * A media element, with its path already turned into a URL.
 *
 * The missing-asset box is reachable, unlike the missing-widget one: `layout-schema` checks that
 * `src` is a *well-formed relative path*, which it must — it has no filesystem and no bundler — but
 * whether a file is there is the bundle's business. A layout referencing a deleted PNG therefore
 * validates, and the honest rendering is a box naming the path it could not find, in the rect where
 * the image should have been.
 */
function renderMedia(
  element: MediaElement,
  resolveAsset: (src: string) => string | undefined,
): ReactNode {
  const url = resolveAsset(element.src);
  if (url === undefined) {
    return <span className="perch-element__failure">{`missing asset: ${element.src}`}</span>;
  }

  return <MediaFrame src={url} fit={mediaFit(element.fit)} />;
}

/**
 * The format's fit, as `MediaFrame`'s fit.
 *
 * Two independent unions spelling the same two words, and they stay independent now that both are
 * reachable from one file. `MediaFit` is what a *layout file* may say; `MediaFrameFit` is what the
 * component accepts, and `MediaFrame` is usable by a caller that has no layout at all. Collapsing
 * them would make the widget's prop type a re-export of the format's, so `media-frame.tsx` would
 * start depending on `layout-schema` to describe its own API.
 *
 * This `Record` is what stops them drifting: keyed by the schema's `MediaFit` and valued by
 * `MediaFrameFit`, so either side gaining or renaming a member is a compile error *here*, at the one
 * place that knows both — rather than a silent fallback to `cover` on a panel.
 */
const MEDIA_FITS_TO_FRAME: Readonly<Record<MediaFit, MediaFrameFit>> = Object.freeze({
  cover: 'cover',
  contain: 'contain',
});

function mediaFit(fit: MediaFit | undefined): MediaFrameFit {
  // The default is the format's own (`cover`), restated rather than relied upon: `MediaFrame` also
  // defaults to `cover`, and two defaults that happen to agree today are one release from not.
  return fit === undefined ? 'cover' : MEDIA_FITS_TO_FRAME[fit];
}

/** Whichever elements carry a `style`. Media does not: an image has no type or colour to theme. */
function styleOf(element: LayoutElement): Style | undefined {
  return element.kind === 'media' ? undefined : element.style;
}

/**
 * The canvas box: fixed at the target size, scaled as one unit, themed.
 *
 * Built as `Record<string, string>` and returned as `CSSProperties`, which needs no assertion: a
 * string-indexed record satisfies `CSSProperties`, whose own keys all accept a string. That is what
 * lets a `--token` key through, since `csstype`'s `Properties` has no index signature to declare one
 * against. Every value is a string deliberately — React writes custom properties via `setProperty`,
 * which drops a number.
 */
function canvasStyle(layout: Layout, scale: number): CSSProperties {
  const declarations: Record<string, string> = {
    // Theme first, geometry second. A theme key cannot be `width` — `layout-schema` requires every
    // token to start with `--` — so this ordering guards nothing today and is written in the order
    // that stays correct if that ever loosens.
    ...layout.theme,
    width: `${layout.target.width}px`,
    height: `${layout.target.height}px`,
    transform: `scale(${scale})`,
  };

  return declarations;
}

/**
 * An element's box: its own tokens, the radius and padding the canvas resolved for it, then its
 * authored rect. Same shape, same reason.
 *
 * Radius and padding are written only when something set one — the element or the theme — and never
 * on media, which reads no box token. An element nobody styled carries exactly the declarations it
 * carried before the box tokens existed.
 */
function elementStyle(
  element: LayoutElement,
  style: Style | undefined,
  content: ContentBox,
  theme: Style | undefined,
): CSSProperties {
  const { rect } = element;
  const boxed = element.kind !== 'media';
  const radius = boxed ? resolvedRadius(style, theme) : undefined;
  const { top, right, bottom, left } = content.padding;
  const declarations: Record<string, string> = {
    ...style,
    ...(radius === undefined ? {} : { 'border-radius': boxQuadCss(radius) }),
    ...(boxed && sets(BOX_PADDING, style, theme)
      ? { padding: boxQuadCss([top, right, bottom, left]) }
      : {}),
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
  };

  return declarations;
}

const BOX_PADDING = '--perch-box-padding';
const BOX_RADIUS = '--perch-box-radius';

/**
 * The box tokens the canvas reads and writes as native declarations, rather than a sheet reading them
 * with `var()`. Each holds a shorthand of one to four numbers; see `box-shorthand.ts`.
 */
export const CANVAS_RESOLVED_TOKENS: readonly PerchToken[] = Object.freeze([
  BOX_RADIUS,
  BOX_PADDING,
]);

/** Whether the element or the theme sets `name` at all. */
function sets(name: PerchToken, style: Style | undefined, theme: Style | undefined): boolean {
  return style?.[name] !== undefined || theme?.[name] !== undefined;
}

/**
 * A box token as its four values, in the order the cascade gives — the element's own `style`, then the
 * layout `theme` it inherits from, then the declared default — with a value CSS would reject read as
 * zero on every side, as CSS reads it.
 */
function resolveBoxToken(
  name: PerchToken,
  style: Style | undefined,
  theme: Style | undefined,
): BoxQuad {
  const raw = style?.[name] ?? theme?.[name] ?? PERCH_TOKEN_DEFAULTS[name];

  return parseBoxToken(raw) ?? [0, 0, 0, 0];
}

/** The corners a box is written with, or `undefined` where nothing set a radius. */
function resolvedRadius(style: Style | undefined, theme: Style | undefined): BoxQuad | undefined {
  return sets(BOX_RADIUS, style, theme) ? resolveBoxToken(BOX_RADIUS, style, theme) : undefined;
}

/** The content box an element's renderer gets. Media reads no box token, so it keeps its rect. */
function boxOf(
  element: LayoutElement,
  style: Style | undefined,
  theme: Style | undefined,
): ContentBox {
  return element.kind === 'media'
    ? { w: element.rect.w, h: element.rect.h, padding: { top: 0, right: 0, bottom: 0, left: 0 } }
    : elementContentSize(element.rect, style, theme);
}

/**
 * The box an element's content is laid out in, after padding, in layout pixels.
 *
 * Resolves `--perch-box-padding` in the order the cascade does, and treats a value CSS would reject as
 * no padding, as CSS does. Each side comes off its own edge.
 *
 * Clamped as well, so left plus right fits the width and top plus bottom fits the height. That is not
 * CSS's behaviour but a correction of it: a `border-box` whose padding exceeds its width grows past its
 * specified width, which would put the painted box outside the rect. All four sides are shrunk by one
 * factor, so padding keeps the shape the author gave it; for an even padding that is exactly the old
 * rule, half the smaller side. The canvas writes the clamped sides onto the box, so the box and the
 * chart both use them.
 */
export function elementContentSize(
  rect: Rect,
  style: Style | undefined,
  theme: Style | undefined,
): ContentBox {
  const [top, right, bottom, left] = resolveBoxToken(BOX_PADDING, style, theme);
  // The binding axis, as a fraction `num / den` rather than a float factor: an even padding then
  // clamps to exactly `w / 2` or `h / 2`, as it did before sides existed.
  let num = 1;
  let den = 1;
  if (left + right > rect.w) [num, den] = [rect.w, left + right];
  if (top + bottom > rect.h && rect.h * den < num * (top + bottom)) {
    [num, den] = [rect.h, top + bottom];
  }
  const fit = (side: number): number => (side * num) / den;
  const padding = { top: fit(top), right: fit(right), bottom: fit(bottom), left: fit(left) };

  return {
    w: rect.w - padding.left - padding.right,
    h: rect.h - padding.top - padding.bottom,
    padding,
  };
}

/**
 * The element box, as a string: the one sheet in this file that reads `PERCH_TOKEN_DEFAULTS` tokens.
 *
 * Separate from `LAYOUT_CANVAS_STYLES` — and interpolated into it, so every app that already mounts
 * the canvas sheet gets it — because it reads the widget-level vocabulary rather than the canvas' own
 * two tokens, and `tokens.test.ts` checks every sheet that does: declared names only, each carrying its
 * default, no literal colour.
 *
 * `box-sizing: border-box` applies to every element, media included, and is inert until something
 * pads or borders a box; nothing did before these tokens, so no shipped layout moves. The background
 * skips media: a media element carries no `style` in the format, so the only way a box token could
 * reach one is a theme meant for the entities over it. Radius and padding are not here; the canvas
 * writes them (`CANVAS_RESOLVED_TOKENS`), and it skips media for the same reason.
 */
export const ELEMENT_BOX_STYLES = `
.perch-element {
  position: absolute;
  box-sizing: border-box;
  overflow: hidden;
}
.perch-element:not([data-perch-element-kind='media']) {
  background: ${token('--perch-box-bg')};
}
`;

/**
 * The canvas and the letterbox, as a string for the page to inject once.
 *
 * `overflow: hidden` on the canvas is the bleed rule made real: `layout-schema` deliberately allows
 * a rect to hang off the edge (a background bled past the corner is normal authoring) and clips it,
 * so a layout cannot paint outside its own declared area however its rects are written.
 *
 * No transition on `transform`. A resize would otherwise animate the scale, and a capture taken
 * during it is a screenshot of the wrong geometry — the one failure this file's whole approach is
 * meant to make impossible.
 */
export const LAYOUT_CANVAS_STYLES = `
.perch-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: ${canvasToken('--perch-letterbox-bg')};
}
.perch-canvas {
  position: relative;
  flex: none;
  overflow: hidden;
  transform-origin: center center;
  background: ${canvasToken('--perch-canvas-bg')};
}
${ELEMENT_BOX_STYLES}
/*
 * A failure that must be seen. Every case it marks — an unregistered widget, a widget used on the
 * wrong element kind, a chart with no range, a missing asset — would otherwise paint nothing, and a
 * blank rect on a wall panel is indistinguishable from an element the author forgot to finish.
 */
.perch-element__failure {
  display: block;
  padding: 4px 6px;
  border: 1px dashed #d08770;
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
  line-height: 1.3;
  color: #d08770;
  overflow-wrap: anywhere;
}
`;
