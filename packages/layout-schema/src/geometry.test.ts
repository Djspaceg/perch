/**
 * The coordinate system: integers, absolute, on a fixed canvas, and able to paint.
 */

import { describe, expect, it } from 'vitest';
import {
  rectIntersectsCanvas,
  validateLayout,
  type Rect,
  type ValidateLayoutOptions,
} from '@perch/layout-schema';
import {
  codesOf,
  issueAt,
  layoutOf,
  layoutWith,
  layoutWithElements,
  TEST_WIDGETS,
  without,
} from './layout-fixture.test-support.js';

const options: ValidateLayoutOptions = { widgets: TEST_WIDGETS };

const at = (rect: unknown): Record<string, unknown> => ({
  kind: 'text',
  text: 'CPU',
  rect,
});

const oneRect = (rect: unknown): ReturnType<typeof validateLayout> =>
  validateLayout(layoutWithElements([at(rect)]), options);

describe('rectIntersectsCanvas', () => {
  const canvas = { width: 1920, height: 400 };
  const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

  it.each([
    ['the whole canvas', rect(0, 0, 1920, 400)],
    ['one pixel in a corner', rect(1919, 399, 1, 1)],
    ['bleeding off the left edge', rect(-100, 0, 200, 400)],
    ['bleeding off every edge', rect(-10, -10, 2000, 500)],
    ['bleeding off the right edge', rect(1900, 0, 200, 100)],
  ])('accepts %s', (_why, value) => {
    expect(rectIntersectsCanvas(value, canvas.width, canvas.height)).toBe(true);
  });

  it.each([
    ['just past the right edge', rect(1920, 0, 100, 100)],
    ['just past the bottom edge', rect(0, 400, 100, 100)],
    ['ending exactly at x=0', rect(-100, 0, 100, 100)],
    ['ending exactly at y=0', rect(0, -100, 100, 100)],
    ['far off the canvas', rect(5000, 5000, 10, 10)],
  ])('rejects %s', (_why, value) => {
    expect(rectIntersectsCanvas(value, canvas.width, canvas.height)).toBe(false);
  });
});

describe('rect validation', () => {
  it('accepts a rect that bleeds off an edge, because the canvas clips it', () => {
    expect(layoutOf(oneRect({ x: -40, y: -10, w: 200, h: 40 })).elements).toHaveLength(1);
  });

  it('rejects a rect entirely off the canvas, naming the canvas', () => {
    const issue = issueAt(oneRect({ x: 5000, y: 0, w: 100, h: 40 }), 'elements[0].rect');

    expect(issue.code).toBe('off-canvas');
    expect(issue.message).toContain('1920x400');
    expect(issue.message).toMatch(/never paint/);
  });

  it('rejects a missing rect', () => {
    expect(
      issueAt(
        validateLayout(layoutWithElements([without(at({}), 'rect')]), options),
        'elements[0].rect',
      ).code,
    ).toBe('missing-field');
  });

  it.each([
    ['a string', '0,0,100,40'],
    ['an array', [0, 0, 100, 40]],
    ['null', null],
  ])('rejects %s where a rect belongs', (_why, rect) => {
    expect(issueAt(oneRect(rect), 'elements[0].rect').code).toBe('not-an-object');
  });

  it.each([
    ['a fractional x', { x: 0.5, y: 0, w: 100, h: 40 }, 'elements[0].rect.x'],
    ['a fractional width', { x: 0, y: 0, w: 100.5, h: 40 }, 'elements[0].rect.w'],
  ])('rejects %s, because a device pixel is not divisible', (_why, rect, path) => {
    expect(issueAt(oneRect(rect), path).code).toBe('not-an-integer');
  });

  it.each([
    ['a zero width', { x: 0, y: 0, w: 0, h: 40 }, 'elements[0].rect.w'],
    ['a negative height', { x: 0, y: 0, w: 100, h: -40 }, 'elements[0].rect.h'],
  ])('rejects %s, which is another way to spell invisible', (_why, rect, path) => {
    expect(issueAt(oneRect(rect), path).code).toBe('out-of-range');
  });

  it.each([
    ['x', { y: 0, w: 100, h: 40 }],
    ['y', { x: 0, w: 100, h: 40 }],
    ['w', { x: 0, y: 0, h: 40 }],
    ['h', { x: 0, y: 0, w: 100 }],
  ])('rejects a rect with no %s', (field, rect) => {
    expect(issueAt(oneRect(rect), `elements[0].rect.${field}`).code).toBe('missing-field');
  });

  it('accepts a negative x and y, which is how a background bleeds', () => {
    expect(layoutOf(oneRect({ x: -1, y: -1, w: 1922, h: 402 })).elements).toHaveLength(1);
  });

  it('rejects an unknown field inside a rect', () => {
    expect(issueAt(oneRect({ x: 0, y: 0, w: 100, h: 40, z: 2 }), 'elements[0].rect.z').code).toBe(
      'unknown-field',
    );
  });

  it('reports each bad component separately rather than only the first', () => {
    const codes = codesOf(oneRect({ x: 0.5, y: 0, w: 0, h: '40' }));

    expect(codes).toEqual(['not-an-integer', 'out-of-range', 'wrong-type']);
  });

  it('does not report an off-canvas cascade when it is target that is broken', () => {
    // One bad `target` must produce one issue, not one per element: there is no canvas to be off.
    const codes = codesOf(
      validateLayout(
        layoutWith({
          target: { width: 'wide', height: 400, frameRate: 30 },
          elements: [at({ x: 5000, y: 0, w: 10, h: 10 }), at({ x: 9000, y: 0, w: 10, h: 10 })],
        }),
        options,
      ),
    );

    expect(codes).toEqual(['wrong-type']);
  });
});
