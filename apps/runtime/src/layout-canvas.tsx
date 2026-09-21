/**
 * A validated layout, as pixels: the fixed canvas, the scale, and the three element kinds.
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
 */

import type { CSSProperties, ReactNode } from 'react';
import {
  type Layout,
  type LayoutElement,
  type MediaElement,
  type MediaFit,
  type Rect,
  type Style,
  type TextElement,
  type WidgetElement,
} from '@perch/layout-schema';
import { MediaFrame, TextBlock, assertNever, type MediaFrameFit } from '@perch/ui-kit';
import { widgetFor } from './widget-catalogue.js';

/**
 * The tokens the *page* reads, as opposed to the ones a widget reads.
 *
 * `ui-kit` owns the widget vocabulary (`PERCH_TOKEN_DEFAULTS`); these two are the canvas's own, and
 * they belong here because the canvas and the letterbox are this package's pixels — `ui-kit` has
 * never heard of either. Declared as a record with defaults for the same reason `ui-kit` does it: a
 * `var()` whose fallback lives only in a string literal is a fallback nobody can check, and the way
 * you find out it was missing is a layout with `theme: {}` painting a transparent canvas.
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
      {layout.elements.map((element, index) => (
        <div
          // Index as key, which is the correct choice exactly here: `elements` is a fixed array read
          // once from a file, so there is no insertion, no removal and no reordering for the life of
          // the page. The index *is* the element's identity, and it is also its z-order.
          key={index}
          className="perch-element"
          data-perch-element-kind={element.kind}
          data-perch-element-index={index}
          style={elementStyle(element.rect, styleOf(element))}
        >
          {renderElement(element, resolveAsset)}
        </div>
      ))}
    </div>
  );
}

/**
 * One element, dispatched on `kind`.
 *
 * A `switch` closed by `assertNever` rather than a lookup table, because each branch needs the
 * narrowed member: a table keyed by `ElementKind` would hand every renderer the union and need a
 * cast to get its own type back, which is the one thing that could let a media renderer read a text
 * element's fields. A fourth member of `ELEMENT_KINDS` fails to compile here until it has a branch.
 */
function renderElement(
  element: LayoutElement,
  resolveAsset: (src: string) => string | undefined,
): ReactNode {
  switch (element.kind) {
    case 'widget':
      return renderWidget(element);
    case 'text':
      return renderText(element);
    case 'media':
      return renderMedia(element, resolveAsset);
    default:
      return assertNever(element, 'layout element kind');
  }
}

/**
 * A widget, through the catalogue the registry was derived from.
 *
 * The `undefined` branch is unreachable for an element that came through `loadLayout` with
 * `WIDGET_REGISTRY` — the validator rejects an unregistered name, and the registry is built from the
 * same table `widgetFor` reads, so there is no name that passes one and fails the other. It is
 * rendered anyway, and rendered *visibly*: if that invariant ever breaks, the panel must say so
 * rather than show the blank rectangle this whole arrangement exists to prevent.
 */
function renderWidget(element: WidgetElement): ReactNode {
  const widget = widgetFor(element.widget);
  if (widget === undefined) {
    return <span className="perch-element__failure">{`no such widget: ${element.widget}`}</span>;
  }

  return widget.render(element);
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
 * The format's fit, as `ui-kit`'s fit.
 *
 * Two independent unions spelling the same two words, because `ui-kit` may not import
 * `layout-schema` (ARCHITECTURE.md's dependency table). This `Record` is what stops them drifting:
 * keyed by the schema's `MediaFit` and valued by `ui-kit`'s `MediaFrameFit`, so either package
 * gaining or renaming a member is a compile error *here*, at the one place that knows both — rather
 * than a silent fallback to `cover` on a panel.
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

/** An element's box: its authored rect, plus its own tokens. Same shape, same reason. */
function elementStyle(rect: Rect, style: Style | undefined): CSSProperties {
  const declarations: Record<string, string> = {
    ...style,
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
  };

  return declarations;
}

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
.perch-element {
  position: absolute;
  overflow: hidden;
}
/*
 * A failure that must be seen. Both cases it marks — an unregistered widget, a missing asset —
 * would otherwise paint nothing, and a blank rect on a wall panel is indistinguishable from an
 * element the author forgot to finish.
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
