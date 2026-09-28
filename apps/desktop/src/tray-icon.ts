/**
 * The tray icon, drawn in code: a ring with a bar through it, a perch.
 *
 * Drawn rather than shipped as a PNG so there is no binary asset to keep in step with a size list,
 * and so one function yields the 1x and 2x bitmaps Electron wants. On macOS the image is a
 * *template*: only its alpha is used and the menu bar colours it, so it reads on light and dark
 * bars alike. Elsewhere it is drawn in the runtime chrome's grey.
 *
 * Pure: returns BGRA bytes for `nativeImage.createFromBitmap`, so it is testable without Electron.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** A `size`x`size` BGRA bitmap of the icon, anti-aliased by 4x4 supersampling. */
export function trayIconBitmap(size: number, colour: Rgb): Buffer {
  const pixels = Buffer.alloc(size * size * 4);
  const centre = size / 2;
  const outer = size * 0.44;
  const inner = size * 0.3;
  const barHalf = size * 0.07;
  const samples = 4;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples - centre;
          const py = y + (sy + 0.5) / samples - centre;
          const distance = Math.hypot(px, py);
          const ring = distance <= outer && distance >= inner;
          const bar = Math.abs(py) <= barHalf && Math.abs(px) <= outer;
          if (ring || bar) covered += 1;
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
