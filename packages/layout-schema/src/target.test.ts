/**
 * Hard rule 3: a layout declares what it needs, and a target that cannot honour it can say so.
 *
 * These two functions state the relationship only. The policy — refuse, warn, or letterbox and
 * carry on — belongs to the runtime, so what is asserted here is that every shortfall is *named*,
 * not that any of them is fatal.
 */

import { describe, expect, it } from 'vitest';
import {
  describeTargetMismatch,
  fitLayoutTarget,
  type LayoutTarget,
  type OutputCapabilities,
} from '@perch/layout-schema';

const panel: LayoutTarget = { width: 1920, height: 400, frameRate: 30 };

const output = (overrides: Partial<OutputCapabilities> = {}): OutputCapabilities => ({
  width: 1920,
  height: 400,
  ...overrides,
});

describe('fitLayoutTarget', () => {
  it('reports an exact fit with nothing given up', () => {
    const fit = fitLayoutTarget(panel, output());

    expect(fit.kind).toBe('exact');
    expect(fit.scale).toBe(1);
    expect(fit.frameRateHonoured).toBe(true);
    expect(fit.reasons).toEqual([]);
  });

  it('reports a uniform scale as scaled, not letterboxed', () => {
    const fit = fitLayoutTarget(panel, output({ width: 960, height: 200 }));

    expect(fit.kind).toBe('scaled');
    expect(fit.scale).toBe(0.5);
    expect(fit.reasons).toHaveLength(1);
    expect(fit.reasons[0]).toContain('1920x400');
  });

  it('compares aspect ratios exactly rather than to within a float epsilon', () => {
    // 1920/400 and 960/200 are the same ratio; a naive division comparison is where this breaks.
    expect(fitLayoutTarget(panel, output({ width: 960, height: 200 })).kind).toBe('scaled');
    expect(
      fitLayoutTarget({ ...panel, width: 1366, height: 768 }, output({ width: 683, height: 384 }))
        .kind,
    ).toBe('scaled');
  });

  it('reports a different aspect ratio as letterboxed, and says so', () => {
    const fit = fitLayoutTarget(panel, output({ width: 1920, height: 1080 }));

    expect(fit.kind).toBe('letterboxed');
    expect(fit.reasons).toHaveLength(2);
    expect(fit.reasons.join(' ')).toMatch(/letterboxed/);
  });

  it('scales to the tighter of the two dimensions', () => {
    expect(fitLayoutTarget(panel, output({ width: 3840, height: 400 })).scale).toBe(1);
    expect(fitLayoutTarget(panel, output({ width: 3840, height: 200 })).scale).toBe(0.5);
  });

  it('treats an unknown output frame rate as honoured rather than as a shortfall', () => {
    const fit = fitLayoutTarget(panel, output());

    expect(fit.frameRateHonoured).toBe(true);
    expect(fit.reasons).toEqual([]);
  });

  it('accepts an output that exceeds the declared ceiling', () => {
    expect(fitLayoutTarget(panel, output({ frameRate: 60 })).frameRateHonoured).toBe(true);
    expect(fitLayoutTarget(panel, output({ frameRate: 30 })).frameRateHonoured).toBe(true);
  });

  it('names a frame-rate shortfall with both numbers', () => {
    const fit = fitLayoutTarget(panel, output({ frameRate: 24 }));

    expect(fit.frameRateHonoured).toBe(false);
    expect(fit.reasons).toHaveLength(1);
    expect(fit.reasons[0]).toContain('30');
    expect(fit.reasons[0]).toContain('24');
  });

  it('collects every shortfall at once', () => {
    const fit = fitLayoutTarget(panel, output({ width: 1280, height: 1024, frameRate: 10 }));

    expect(fit.kind).toBe('letterboxed');
    expect(fit.reasons).toHaveLength(3);
  });
});

describe('describeTargetMismatch', () => {
  it('is null for an exact fit, so a caller has nothing to print', () => {
    expect(describeTargetMismatch(panel, output())).toBeNull();
  });

  it('joins every shortfall into one sentence', () => {
    const description = describeTargetMismatch(
      panel,
      output({ width: 1920, height: 1080, frameRate: 5 }),
    );

    expect(description).not.toBeNull();
    expect(description ?? '').toContain('; ');
    expect(description ?? '').toMatch(/aspect ratio/);
    expect(description ?? '').toMatch(/capture ceiling/);
  });
});
