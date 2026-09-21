/**
 * The runtime's target policy, which is the part `layout-schema` deliberately does not decide.
 *
 * `fitLayoutTarget` states the relationship between a canvas and a viewport; whether that
 * relationship is acceptable is this app's call. The policy under test: windowed mode always scales,
 * capture mode demands an exact viewport and refuses anything else, naming what differs.
 */

import { describe, expect, it } from 'vitest';
import type { LayoutTarget } from '@perch/layout-schema';
import { fitCanvas, parsePageRequest } from './viewport.js';

const DESK: LayoutTarget = { width: 1920, height: 400, frameRate: 30 };

describe('fitCanvas — windowed mode', () => {
  it('renders 1:1 when the window happens to be the canvas', () => {
    const fit = fitCanvas(DESK, { width: 1920, height: 400 }, 'windowed');

    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.fit.kind).toBe('exact');
    expect(fit.fit.scale).toBe(1);
  });

  it('scales without bars when the window keeps the aspect ratio', () => {
    const fit = fitCanvas(DESK, { width: 960, height: 200 }, 'windowed');

    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.fit.kind).toBe('scaled');
    expect(fit.fit.scale).toBe(0.5);
  });

  it('letterboxes a window of the wrong shape rather than refusing it', () => {
    // A 1920x400 panel in a 1440x900 browser tab: the everyday case. Refusing here would mean the
    // layout could not be developed against at all.
    const fit = fitCanvas(DESK, { width: 1440, height: 900 }, 'windowed');

    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.fit.kind).toBe('letterboxed');
    expect(fit.fit.scale).toBe(0.75);
  });

  it('never refuses, whatever the window is', () => {
    for (const viewport of [
      { width: 1, height: 1 },
      { width: 400, height: 1920 },
      { width: 5120, height: 1440 },
    ]) {
      expect(fitCanvas(DESK, viewport, 'windowed').ok, `windowed refused ${viewport.width}`).toBe(
        true,
      );
    }
  });
});

describe('fitCanvas — capture mode', () => {
  it('renders 1:1 at the declared target', () => {
    const fit = fitCanvas(DESK, { width: 1920, height: 400 }, 'capture');

    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.fit.scale).toBe(1);
  });

  it('refuses a viewport of the right shape but the wrong size', () => {
    // The dangerous case, and the reason capture mode is stricter than windowed: this one *renders*
    // correctly. A screenshot of it is a picture of the panel at half size that nothing in the image
    // says is scaled, which is exactly what must not reach evidence.
    const fit = fitCanvas(DESK, { width: 960, height: 200 }, 'capture');

    expect(fit.ok).toBe(false);
    if (fit.ok) return;
    expect(fit.mismatch).toContain('1920x400');
    expect(fit.mismatch).toContain('960x200');
  });

  it('refuses a viewport of the wrong shape, naming the aspect ratio as well', () => {
    const fit = fitCanvas(DESK, { width: 1440, height: 900 }, 'capture');

    expect(fit.ok).toBe(false);
    if (fit.ok) return;
    expect(fit.mismatch).toContain('aspect ratio differs');
  });

  it('says nothing about the frame rate, because a browser cannot report one', () => {
    const fit = fitCanvas({ ...DESK, frameRate: 240 }, { width: 800, height: 600 }, 'capture');

    expect(fit.ok).toBe(false);
    if (fit.ok) return;
    // A guessed refresh rate would make a declared ceiling look checked when it is not. The
    // capabilities deliberately omit `frameRate`, so no reason may mention hertz.
    expect(fit.mismatch).not.toMatch(/Hz/);
  });
});

describe('parsePageRequest', () => {
  it('reads a layout name and leaves the mode windowed', () => {
    expect(parsePageRequest('?layout=tower-720x1280')).toEqual({
      layout: 'tower-720x1280',
      mode: 'windowed',
    });
  });

  it('reads capture mode', () => {
    expect(parsePageRequest('?layout=desk-1920x400&mode=capture')).toEqual({
      layout: 'desk-1920x400',
      mode: 'capture',
    });
  });

  it('carries a name in a subdirectory through unchanged', () => {
    // `?layout=invalid/broken-desk` is how the refusal path is reached on a real page, so the slash
    // has to survive parsing.
    expect(parsePageRequest('?layout=invalid/broken-desk').layout).toBe('invalid/broken-desk');
  });

  it('asks for no layout when none was named', () => {
    expect(parsePageRequest('').layout).toBeNull();
    expect(parsePageRequest('?layout=').layout).toBeNull();
    expect(parsePageRequest('?mode=capture').layout).toBeNull();
  });

  it('falls back to windowed for a mode it does not know', () => {
    // A typo in a URL should show a page, not a refusal about a mode — and windowed is the mode that
    // cannot refuse.
    expect(parsePageRequest('?mode=captrue').mode).toBe('windowed');
    expect(parsePageRequest('?mode=').mode).toBe('windowed');
  });

  it('does not treat an unknown layout name as absent', () => {
    // The page answers a bad name with the list of good ones, which the parser has no access to.
    expect(parsePageRequest('?layout=nope').layout).toBe('nope');
  });
});
