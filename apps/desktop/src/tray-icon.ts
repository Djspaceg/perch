/**
 * The tray icon, drawn in code: the app icon's songbird on its perch, as one solid silhouette.
 *
 * Drawn rather than shipped as a PNG so there is no binary asset to keep in step with a size list,
 * and so one function yields the 1x and 2x bitmaps Electron wants. The geometry below is the
 * master: the same bird as `icons/app-icon.svg`, in the same coordinates, simplified for 16pt.
 * The wing is gone (one silhouette), the eye is a hole, and the sensor trace is a straight perch
 * line, which a 16pt spike would only smudge.
 *
 * On macOS the image is a *template*: black and alpha only, which the menu bar tints for light
 * and dark bars and for the highlighted item. Elsewhere there is no template, so it is drawn in
 * the runtime chrome's grey, which reads on the light and the dark taskbars and panels alike.
 *
 * Pure: returns BGRA bytes for `nativeImage.createFromBitmap`, so it is testable without Electron.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

type Point = readonly [number, number];
/** A line to a point, or a cubic Bezier: two control points, then the point. */
type Segment = Point | readonly [number, number, number, number, number, number];

interface Outline {
  readonly start: Point;
  readonly segments: readonly Segment[];
}

/** A line with round ends, `radius` either side of it. */
interface Stroke {
  readonly from: Point;
  readonly to: Point;
  readonly radius: number;
}

// The bird, in the app icon's drawing coordinates, facing right. Closed outlines, filled.
const OUTLINES: readonly Outline[] = [
  // The tail, long and straight, down to the left.
  {
    start: [216, 800],
    segments: [
      [452, 778],
      [112, 1062],
      [88, 1083, 50, 1074, 44, 1046],
      [41, 1034, 44, 1024, 52, 1014],
    ],
  },
  // Head and body. Its back leaves the tail on the tail's own line, so the two read as one.
  {
    start: [650, 292],
    segments: [
      [618, 236, 628, 140, 704, 84],
      [772, 34, 882, 30, 952, 76],
      [990, 100, 1012, 128, 1024, 150],
      [1026, 226],
      [1010, 268, 1004, 318, 1014, 376],
      [1034, 482, 1012, 584, 948, 668],
      [878, 758, 760, 806, 628, 806],
      [560, 806, 498, 800, 440, 790],
      [218, 804],
      [300, 697, 428, 448, 560, 344],
      [590, 318, 620, 302, 650, 292],
    ],
  },
  // The beak.
  {
    start: [1012, 128],
    segments: [
      [1124, 168],
      [1146, 176, 1146, 196, 1124, 204],
      [1018, 240],
    ],
  },
];

const STROKES: readonly Stroke[] = [
  // The legs.
  { from: [640, 790], to: [670, 930], radius: 35 },
  { from: [760, 780], to: [800, 930], radius: 35 },
  // The perch: placed and sized to fill one pixel row at 1x and two at 2x exactly.
  { from: [420, 962], to: [1080, 962], radius: 37 },
];

const EYE = { centre: [896, 166] as Point, radius: 48 };

/** The drawing's bounds, centred in the image with half a point clear around them. */
const BOUNDS = { left: 41, top: 30, right: 1146, bottom: 1083 };
const FILL = 15 / 16;

/** Each outline as a polygon, its curves cut into short lines. */
const POLYGONS: readonly (readonly Point[])[] = OUTLINES.map(flatten);

export interface TrayIcon {
  /** macOS only: the menu bar tints it. */
  readonly template: boolean;
  /** 16pt, at 1x and 2x: what `nativeImage.createFromBitmap` and `addRepresentation` take. */
  readonly representations: readonly {
    readonly buffer: Buffer;
    readonly width: number;
    readonly height: number;
    readonly scaleFactor: number;
  }[];
}

const TEMPLATE_BLACK: Rgb = { r: 0, g: 0, b: 0 };
/** The runtime chrome's grey. */
const CHROME_GREY: Rgb = { r: 154, g: 164, b: 178 };
const POINTS = 16;

/** The tray icon for `platform`: a template on macOS, the chrome grey elsewhere. */
export function trayIcon(platform: NodeJS.Platform): TrayIcon {
  const template = platform === 'darwin';
  const colour = template ? TEMPLATE_BLACK : CHROME_GREY;
  return {
    template,
    representations: [1, 2].map((scaleFactor) => {
      const size = POINTS * scaleFactor;
      return { buffer: trayIconBitmap(size, colour), width: size, height: size, scaleFactor };
    }),
  };
}

/** A `size`x`size` BGRA bitmap of the icon, anti-aliased by 4x4 supersampling. */
export function trayIconBitmap(size: number, colour: Rgb): Buffer {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = (size * FILL) / Math.max(BOUNDS.right - BOUNDS.left, BOUNDS.bottom - BOUNDS.top);
  const centreX = (BOUNDS.left + BOUNDS.right) / 2;
  const centreY = (BOUNDS.top + BOUNDS.bottom) / 2;
  const samples = 4;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          // The sample, back in the drawing's coordinates.
          const px = centreX + (x + (sx + 0.5) / samples - size / 2) / scale;
          const py = centreY + (y + (sy + 0.5) / samples - size / 2) / scale;
          if (inBird(px, py)) covered += 1;
        }
      }

      const offset = (y * size + x) * 4;
      pixels[offset] = colour.b;
      pixels[offset + 1] = colour.g;
      pixels[offset + 2] = colour.r;
      pixels[offset + 3] = Math.round((covered / (samples * samples)) * 255);
    }
  }

  return pixels;
}

function inBird(x: number, y: number): boolean {
  if (STROKES.some((stroke) => distanceToSegment(x, y, stroke.from, stroke.to) <= stroke.radius)) {
    return true;
  }
  if (Math.hypot(x - EYE.centre[0], y - EYE.centre[1]) <= EYE.radius) return false;
  return POLYGONS.some((polygon) => inPolygon(x, y, polygon));
}

function flatten(outline: Outline): Point[] {
  const steps = 24;
  const points: Point[] = [outline.start];
  let [x0, y0] = outline.start;
  for (const segment of outline.segments) {
    if (segment.length === 2) {
      points.push(segment);
      [x0, y0] = segment;
      continue;
    }
    const [x1, y1, x2, y2, x3, y3] = segment;
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const u = 1 - t;
      points.push([
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      ]);
    }
    [x0, y0] = [x3, y3];
  }
  return points;
}

/** Even-odd: whether a ray to the right from the point crosses the polygon's edges an odd number of times. */
function inPolygon(x: number, y: number, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i] ?? [0, 0];
    const [xj, yj] = polygon[j] ?? [0, 0];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToSegment(x: number, y: number, from: Point, to: Point): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const t = Math.min(
    Math.max(((x - from[0]) * dx + (y - from[1]) * dy) / (dx * dx + dy * dy), 0),
    1,
  );
  return Math.hypot(x - (from[0] + t * dx), y - (from[1] + t * dy));
}
