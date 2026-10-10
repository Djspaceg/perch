import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ICON_MASTER, APP_ICON_PNG } from './app-icon.js';

const projectDir = resolve(import.meta.dirname, '..');

describe('the app icon', () => {
  it('is committed as an SVG master on the 1024 macOS grid', () => {
    const svg = readFileSync(join(projectDir, APP_ICON_MASTER), 'utf8');

    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 1024 1024"/);
    expect(svg).toMatch(/width="1024" height="1024"/);
  });

  it('is committed as its 1024 RGBA PNG, which electron-builder makes every size from', () => {
    const png = readFileSync(join(projectDir, APP_ICON_PNG));

    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.toString('latin1', 12, 16)).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(1024);
    expect(png[24]).toBe(8); // bits per channel
    expect(png[25]).toBe(6); // RGBA: the corners outside the tile are clear
  });
});
