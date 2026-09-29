/**
 * What Thermalright hosts, as static data, and which of its sizes a layout gets.
 *
 * The catalogue is not served: trcc-linux (src/trcc/adapters/theme/cloud.py) carries the same six
 * prefixes and counts, and so does this file. The hosted sizes are the panel resolutions trcc-linux
 * knows, each probed once on 2026-09-29 (all 28 answered 200). See docs/backgrounds.md.
 *
 * Pure and browser-safe: the editor's thumbnail browser reads the categories from here.
 */

/** One tab of the catalogue: a prefix, a name, and how many it numbers from 001. */
export interface BackgroundCategory {
  readonly prefix: string;
  readonly name: string;
  readonly count: number;
}

export const BACKGROUND_CATEGORIES: readonly BackgroundCategory[] = Object.freeze([
  { prefix: 'a', name: 'Gallery', count: 82 },
  { prefix: 'b', name: 'Tech', count: 25 },
  { prefix: 'c', name: 'HUD', count: 72 },
  { prefix: 'd', name: 'Light', count: 55 },
  { prefix: 'e', name: 'Nature', count: 54 },
  { prefix: 'y', name: 'Aesthetic', count: 10 },
]);

/** Every id in `category`, in order: `a001` to `a082`. */
export function backgroundIds(category: BackgroundCategory): string[] {
  return Array.from(
    { length: category.count },
    (_, index) => `${category.prefix}${String(index + 1).padStart(3, '0')}`,
  );
}

/** The category `id` is numbered in, if the catalogue has that id. */
export function categoryOf(id: string): BackgroundCategory | undefined {
  const match = /^([a-z])([0-9]{3})$/.exec(id);
  if (match === null) return undefined;
  const number = Number(match[2]);
  const category = BACKGROUND_CATEGORIES.find((entry) => entry.prefix === match[1]);

  return category !== undefined && number >= 1 && number <= category.count ? category : undefined;
}

export function isCatalogued(id: string): boolean {
  return categoryOf(id) !== undefined;
}

/** What a person calls `id`: "Gallery 42". */
export function backgroundLabel(id: string): string | undefined {
  const category = categoryOf(id);

  return category === undefined ? undefined : `${category.name} ${String(Number(id.slice(1)))}`;
}

/** A size Thermalright hosts videos at, in pixels. */
export interface HostedSize {
  readonly width: number;
  readonly height: number;
}

/** `1920x440`: a size as a folder and a log line name it. */
export function sizeName(size: HostedSize): string {
  return `${String(size.width)}x${String(size.height)}`;
}

const PROBED = [
  '1280x480', '1600x720', '172x640', '176x320', '1920x440', '1920x462', '240x240', '240x320',
  '320x176', '320x240', '320x320', '320x960', '360x360', '440x1920', '462x1920', '480x1280',
  '480x480', '480x640', '480x800', '480x854', '540x960', '640x172', '640x480', '720x1600',
  '800x480', '854x480', '960x320', '960x540',
]; // prettier-ignore

/** The sizes the international server answered 200 for `a001.mp4` at, in trcc-linux's order. */
export const HOSTED_SIZES: readonly HostedSize[] = Object.freeze(
  PROBED.map((name) => {
    const [width, height] = name.split('x').map(Number);
    return Object.freeze({ width: width ?? 0, height: height ?? 0 });
  }),
);

/**
 * The hosted size a target of `width` x `height` gets (the human's rule, docs/backgrounds.md).
 *
 * A size qualifies when it is at least the target on both axes, so covering the element only ever
 * scales the video down; the least area of those wins, so the least is downloaded. With none, the
 * closest: the least `|ln(w/W)| + |ln(h/H)|`, which weighs twice as big and half as big the same on
 * each axis. Ties go to the smaller area, then to list order, so the answer is one size always.
 */
export function pickHostedSize(
  target: { readonly width: number; readonly height: number },
  sizes: readonly HostedSize[] = HOSTED_SIZES,
): HostedSize {
  const area = (size: HostedSize): number => size.width * size.height;
  const qualifying = sizes.filter(
    (size) => size.width >= target.width && size.height >= target.height,
  );
  const distance = (size: HostedSize): number =>
    Math.abs(Math.log(size.width / target.width)) + Math.abs(Math.log(size.height / target.height));

  let best: HostedSize | undefined;
  if (qualifying.length > 0) {
    for (const size of qualifying) {
      if (best === undefined || area(size) < area(best)) best = size;
    }
  } else {
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const size of sizes) {
      const away = distance(size);
      // Compared to a tolerance: two sizes the same distance away differ in the last bit of a sum
      // of logarithms, and a tie decided by rounding is a tie decided by nothing.
      const closer = away < bestDistance - 1e-9;
      const tied = Math.abs(away - bestDistance) <= 1e-9;
      if (best === undefined || closer || (tied && area(size) < area(best))) {
        best = size;
        bestDistance = Math.min(away, bestDistance);
      }
    }
  }
  if (best === undefined) throw new Error('pickHostedSize: no hosted sizes to pick from');

  return best;
}
