/**
 * The placeholder app icon: the tray's perch mark, light on a dark rounded tile, as a PNG.
 *
 * Generated at packaging time (`packaging.ts` writes it where electron-builder looks, and
 * electron-builder makes the .icns, .ico and Linux sizes from it), for the reason `tray-icon.ts`
 * gives: no binary asset to keep in step. A designed icon replaces this by replacing the file.
 *
 * Pure: returns PNG bytes, so it is testable without Electron.
 */

import { crc32, deflateSync } from 'node:zlib';
import { trayIconBitmap, type Rgb } from './tray-icon.js';

const TILE: Rgb = { r: 27, g: 31, b: 39 };
const MARK: Rgb = { r: 230, g: 233, b: 239 };

/** A `size`x`size` RGBA PNG of the icon. macOS's grid: a tile inset by a tenth, round corners. */
export function appIconPng(size: number): Buffer {
  const margin = size * 0.1;
  const radius = size * 0.18;
  const markSize = Math.round(size * 0.62);
  const markOffset = Math.round((size - markSize) / 2);
  const mark = trayIconBitmap(markSize, MARK);
  const samples = 4;

  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    // Each row starts with its filter type, 0: the bytes as they are.
    raw[y * stride] = 0;
    for (let x = 0; x < size; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          if (inRoundedSquare(px, py, margin, size - margin, radius)) covered += 1;
        }
      }

      const mx = x - markOffset;
      const my = y - markOffset;
      const inMark = mx >= 0 && my >= 0 && mx < markSize && my < markSize;
      const markAlpha = inMark ? (mark[(my * markSize + mx) * 4 + 3] ?? 0) / 255 : 0;

      const offset = y * stride + 1 + x * 4;
      raw[offset] = blend(TILE.r, MARK.r, markAlpha);
      raw[offset + 1] = blend(TILE.g, MARK.g, markAlpha);
      raw[offset + 2] = blend(TILE.b, MARK.b, markAlpha);
      raw[offset + 3] = Math.round((covered / (samples * samples)) * 255);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function inRoundedSquare(x: number, y: number, low: number, high: number, radius: number): boolean {
  if (x < low || x > high || y < low || y > high) return false;
  const cx = Math.min(Math.max(x, low + radius), high - radius);
  const cy = Math.min(Math.max(y, low + radius), high - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

function blend(under: number, over: number, alpha: number): number {
  return Math.round(under + (over - under) * alpha);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
