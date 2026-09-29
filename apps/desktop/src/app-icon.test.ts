import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { appIconPng } from './app-icon.js';

/** The PNG's chunks, by type, in order. */
function chunks(png: Buffer): { type: string; data: Buffer }[] {
  const found: { type: string; data: Buffer }[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    found.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return found;
}

describe('appIconPng', () => {
  it('is a square RGBA PNG of the size asked for', () => {
    const png = appIconPng(64);

    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const [header, ...rest] = chunks(png);
    expect(header?.type).toBe('IHDR');
    expect(header?.data.readUInt32BE(0)).toBe(64);
    expect(header?.data.readUInt32BE(4)).toBe(64);
    expect(header?.data[8]).toBe(8); // bit depth
    expect(header?.data[9]).toBe(6); // RGBA
    expect(rest.map((chunk) => chunk.type)).toEqual(['IDAT', 'IEND']);
  });

  it('draws the mark on an opaque tile with transparent corners', () => {
    const size = 64;
    const idat = chunks(appIconPng(size)).find((chunk) => chunk.type === 'IDAT');
    const raw = inflateSync(idat?.data ?? Buffer.alloc(0));
    const stride = size * 4 + 1;
    const alpha = (x: number, y: number) => raw[y * stride + 1 + x * 4 + 3];
    const red = (x: number, y: number) => raw[y * stride + 1 + x * 4];

    expect(raw.length).toBe(stride * size);
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(size / 2, size / 2)).toBe(255);
    // The bar through the centre is light, the tile around the ring dark.
    expect(red(size / 2, size / 2)).toBeGreaterThan(200);
    expect(red(size / 2, Math.round(size * 0.17))).toBeLessThan(60);
  });
});
