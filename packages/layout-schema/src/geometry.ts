/**
 * The coordinate system: absolute pixels on a fixed canvas the size of `target`.
 *
 * The whole canvas is scaled to fit whatever viewport it lands in and letterboxed; it never
 * reflows. Responsive layout sounds more flexible and is wrong here — the primary target is a
 * fixed 1920x400 panel, the authoring model is AIDA64-SensorPanel-style absolute placement, and
 * scaling the entire canvas is the only approach under which the editor's canvas and the panel's
 * output are guaranteed pixel-identical. That guarantee is the entire reason `ui-kit` is its own
 * package, so degrading to a browser tab is a scale factor and never a reflow.
 *
 * Two consequences are enforced below rather than documented and hoped for:
 *
 * 1. **Rect components are integers.** A device pixel is not divisible. A fractional rect on a
 *    physical panel is resolved by the compositor into antialiasing, which `ARCHITECTURE.md`
 *    rules out for exactly this surface ("nothing that tears or leans on sub-pixel
 *    antialiasing — it reads badly on a physical panel").
 * 2. **A rect has to be able to paint.** An element entirely outside the canvas is a blank
 *    rectangle the author will discover on the wall. See `rectIntersectsCanvas`.
 */

import { asRecord, readField, rejectUnknownFields, requireInteger } from './checks.js';
import { fieldPath, type IssueCollector } from './issues.js';

/** A rectangle in absolute canvas pixels. `x`/`y` are its top-left corner. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const RECT_FIELDS = ['x', 'y', 'w', 'h'] as const;

/**
 * Whether a rect covers at least one pixel of a `width` x `height` canvas.
 *
 * Partial overhang is deliberately *allowed*: bleeding a background off the edge is a normal
 * authoring move, and the canvas clips it. Being entirely outside is not, because there is no
 * authoring intent it could express — the element can never paint, which is indistinguishable
 * on the panel from the element not existing.
 */
export function rectIntersectsCanvas(rect: Rect, width: number, height: number): boolean {
  return rect.x < width && rect.y < height && rect.x + rect.w > 0 && rect.y + rect.h > 0;
}

/**
 * Validate an element's `rect`, reporting each bad component separately.
 *
 * `x`/`y` may be negative (bleed); `w`/`h` must be at least one pixel, since a zero-width
 * element is another way to spell "invisible". `canvas` is `null` when `target` itself failed
 * to validate — there is no canvas to place anything on, and inventing one would report a
 * cascade of off-canvas issues whose real cause is a single bad `target`.
 */
export function validateRect(
  owner: Readonly<Record<string, unknown>>,
  path: string,
  canvas: { readonly width: number; readonly height: number } | null,
  collect: IssueCollector,
  elementIndex: number,
): Rect | null {
  const rectPath = fieldPath(path, 'rect');
  const value = readField(owner, 'rect');
  if (value === undefined) {
    collect.add('missing-field', rectPath, 'missing required field "rect"', elementIndex);
    return null;
  }

  const record = asRecord(value);
  if (record === null) {
    collect.add(
      'not-an-object',
      rectPath,
      'expected an object with integer x, y, w and h',
      elementIndex,
    );
    return null;
  }

  rejectUnknownFields(record, RECT_FIELDS, rectPath, collect, elementIndex);

  const x = requireInteger(record, rectPath, 'x', {}, collect, elementIndex);
  const y = requireInteger(record, rectPath, 'y', {}, collect, elementIndex);
  const w = requireInteger(record, rectPath, 'w', { min: 1 }, collect, elementIndex);
  const h = requireInteger(record, rectPath, 'h', { min: 1 }, collect, elementIndex);

  if (x === null || y === null || w === null || h === null) return null;

  const rect: Rect = { x, y, w, h };
  if (canvas !== null && !rectIntersectsCanvas(rect, canvas.width, canvas.height)) {
    collect.add(
      'off-canvas',
      rectPath,
      `rect ${describeRect(rect)} lies entirely outside the ${canvas.width}x${canvas.height} canvas, so it can never paint`,
      elementIndex,
    );
    return null;
  }

  return rect;
}

function describeRect(rect: Rect): string {
  return `${rect.w}x${rect.h} at (${rect.x}, ${rect.y})`;
}
