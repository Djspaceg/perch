/**
 * The layout's background: one layer under every element, across the whole canvas.
 *
 * Not an element. A background drawn as `elements[0]` is only lowest for as long as every reorder,
 * drop, paste and duplicate remembers to keep it there, and each of those is a place to forget. A
 * field of the layout cannot be reordered at all: it is painted first by construction, it has no rect
 * to drag off the canvas, and it is the one thing a layers list can show as locked without policing
 * anything. So it is its own field, `Layout['background']`, holding what a media element holds minus
 * the rect, plus the eye.
 *
 * Optional, and absence is "no background": the theme's `--perch-canvas-bg` colour shows, as it does
 * when the background is hidden. Every file older than schema version 4 opens that way.
 */

import {
  asRecord,
  describeValue,
  readField,
  rejectUnknownFields,
  requireNonEmptyString,
  optionalLiteral,
} from './checks.js';
import {
  validateOptionalHidden,
  validateOptionalOpacity,
  type Hidden,
  type MediaElement,
  type Opacity,
} from './element.js';
import { type IssueCollector } from './issues.js';
import { MEDIA_FITS, validateMediaPath, type MediaFit } from './media.js';

/** An image or video under everything, by the same `src` rules as a media element. */
export interface LayoutBackground {
  /** A path relative to the layout file, or a cloud background reference, `thermalright:a042`. */
  src: string;
  fit?: MediaFit;
  opacity?: Opacity;
  hidden?: Hidden;
}

const BACKGROUND_FIELDS = ['src', 'fit', 'opacity', 'hidden'] as const;

/**
 * The layout's `background`: `undefined` when absent, `null` having reported why it is not one, or
 * the rebuilt value.
 */
export function validateLayoutBackground(
  record: Readonly<Record<string, unknown>>,
  collect: IssueCollector,
): LayoutBackground | undefined | null {
  const value = readField(record, 'background');
  if (value === undefined) return undefined;

  const path = 'background';
  const background = asRecord(value);
  if (background === null) {
    collect.add(
      'not-an-object',
      path,
      `expected a background object like {"src": "thermalright:a042"}, got ${describeValue(value)}; leave the field out for no background`,
    );
    return null;
  }

  const before = collect.issues.length;
  rejectUnknownFields(background, BACKGROUND_FIELDS, path, collect);
  const raw = requireNonEmptyString(background, path, 'src', collect);
  const src = raw === null ? null : validateMediaPath(raw, `${path}.src`, collect);
  const fit = optionalLiteral(background, path, 'fit', MEDIA_FITS, collect);
  const opacity = validateOptionalOpacity(background, path, undefined, collect);
  const hidden = validateOptionalHidden(background, path, undefined, collect);

  if (collect.issues.length !== before || src === null) return null;

  return {
    src,
    ...(fit === undefined ? {} : { fit }),
    ...(opacity === undefined ? {} : { opacity }),
    ...(hidden === undefined ? {} : { hidden }),
  };
}

/**
 * The background as the media element it paints as: its source, fit, opacity and eye, over the whole
 * canvas. What a renderer draws for it, and what duplicating it makes.
 */
export function backgroundAsElement(
  background: LayoutBackground,
  target: { readonly width: number; readonly height: number },
): MediaElement {
  return {
    kind: 'media',
    src: background.src,
    rect: { x: 0, y: 0, w: target.width, h: target.height },
    ...(background.fit === undefined ? {} : { fit: background.fit }),
    ...(background.opacity === undefined ? {} : { opacity: background.opacity }),
    ...(background.hidden === undefined ? {} : { hidden: background.hidden }),
  };
}
