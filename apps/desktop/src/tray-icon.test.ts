import { describe, expect, it } from 'vitest';
import { trayIcon, trayIconBitmap } from './tray-icon.js';

const BLACK = { r: 0, g: 0, b: 0 };
/** The alpha of pixel (x, y) in a `size`x`size` BGRA bitmap. */
const alpha = (bitmap: Buffer, size: number, x: number, y: number) =>
  bitmap[(y * size + x) * 4 + 3] ?? -1;

describe('trayIcon', () => {
  it('is a 16pt template image on macOS, with 1x and 2x representations', () => {
    const icon = trayIcon('darwin');

    expect(icon.template).toBe(true);
    expect(
      icon.representations.map(({ width, height, scaleFactor }) => [width, height, scaleFactor]),
    ).toEqual([
      [16, 16, 1],
      [32, 32, 2],
    ]);
    for (const { buffer, width } of icon.representations) {
      expect(buffer.length).toBe(width * width * 4);
    }
  });

  it('is black and alpha only on macOS, so the menu bar can tint it', () => {
    for (const { buffer } of trayIcon('darwin').representations) {
      const alphas = new Set<number>();
      for (let offset = 0; offset < buffer.length; offset += 4) {
        expect([buffer[offset], buffer[offset + 1], buffer[offset + 2]]).toEqual([0, 0, 0]);
        alphas.add(buffer[offset + 3] ?? -1);
      }
      // A solid silhouette with anti-aliased edges: clear, opaque, and some of the between.
      expect(alphas.has(0)).toBe(true);
      expect(alphas.has(255)).toBe(true);
      expect(alphas.size).toBeGreaterThan(4);
    }
  });

  it('is no template elsewhere, and is drawn in the chrome grey instead', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const icon = trayIcon(platform);
      expect(icon.template).toBe(false);
      const [first] = icon.representations;
      const buffer = first?.buffer ?? Buffer.alloc(0);
      const opaque = [...Array(buffer.length / 4).keys()].find(
        (pixel) => buffer[pixel * 4 + 3] === 255,
      );
      expect(opaque).toBeDefined();
      const at = (opaque ?? 0) * 4;
      // BGRA.
      expect([buffer[at + 2], buffer[at + 1], buffer[at]]).toEqual([154, 164, 178]);
    }
  });
});

describe('trayIconBitmap: the bird on its perch', () => {
  const size = 32;
  const bitmap = trayIconBitmap(size, BLACK);

  it('keeps clear corners and fills the body', () => {
    expect(alpha(bitmap, size, 0, 0)).toBe(0);
    expect(alpha(bitmap, size, size - 1, 0)).toBe(0);
    // The breast, right of centre and a little above it.
    expect(alpha(bitmap, size, 20, 13)).toBe(255);
  });

  it('cuts the eye out of the head', () => {
    // The eye, and the head just below it.
    expect(alpha(bitmap, size, 24, 5)).toBeLessThan(128);
    expect(alpha(bitmap, size, 24, 8)).toBe(255);
  });

  it('stands on a perch line, with a gap under the belly', () => {
    const perchRow = 26;
    for (let x = 13; x <= 28; x += 1) expect(alpha(bitmap, size, x, perchRow)).toBe(255);
    // Under the breast, in front of the legs, above the perch: clear.
    expect(alpha(bitmap, size, 25, 24)).toBe(0);
  });

  it('runs its tail down to the bottom left', () => {
    expect(alpha(bitmap, size, 3, 28)).toBeGreaterThan(128);
    expect(alpha(bitmap, size, 28, 30)).toBe(0);
  });
});
