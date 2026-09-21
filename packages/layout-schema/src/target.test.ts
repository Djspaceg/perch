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
  formatScalePercent,
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

/**
 * The reasons are prose a person reads and acts on, so what is asserted here is the *rendered
 * string*, not a number it was built from. A raw `0.7114583333333333` in a sentence is the defect
 * these cover, and it only shows up once the string exists.
 */
describe('the rendered reasons', () => {
  const scaleReason = (output_: OutputCapabilities, target = panel): string =>
    fitLayoutTarget(target, output_).reasons[0] ?? '';

  it('rounds an untidy scale instead of printing sixteen digits of float noise', () => {
    // 1366 / 1920 is 0.7114583333333333, the case that motivated this.
    const reason = scaleReason(output({ width: 1366, height: 768 }));

    expect(reason).toBe(
      'layout declares 1920x400 and the output is 1366x768, so the canvas is scaled down to 71.1% of its declared size',
    );
    expect(reason).not.toMatch(/\d\.\d{3}/);
  });

  it('keeps a tidy scale tidy', () => {
    expect(scaleReason(output({ width: 1440, height: 900 }))).toBe(
      'layout declares 1920x400 and the output is 1440x900, so the canvas is scaled down to 75% of its declared size',
    );
  });

  it('says a scale of exactly 1 is no scaling at all, rather than "scaled by 1"', () => {
    const reason = scaleReason(output({ width: 3840, height: 400 }));

    expect(fitLayoutTarget(panel, output({ width: 3840, height: 400 })).scale).toBe(1);
    expect(reason).toBe(
      'layout declares 1920x400 and the output is 3840x400, so the canvas is shown at its declared size',
    );
  });

  it('says a scale above 1 is scaled up, not merely scaled', () => {
    expect(scaleReason(output({ width: 2880, height: 600 }))).toBe(
      'layout declares 1920x400 and the output is 2880x600, so the canvas is scaled up to 150% of its declared size',
    );
    expect(scaleReason(output({ width: 2560, height: 1440 }))).toBe(
      'layout declares 1920x400 and the output is 2560x1440, so the canvas is scaled up to 133.3% of its declared size',
    );
  });

  it('reduces the aspect ratios it prints, so the reader is not left dividing', () => {
    const reasons = fitLayoutTarget(panel, output({ width: 1920, height: 1080 })).reasons;

    expect(reasons[1]).toBe(
      'aspect ratio differs (24:5 against 16:9), so the canvas is letterboxed',
    );
  });

  it('keeps near-identical aspect ratios distinguishable, having reduced them exactly', () => {
    // 1920:1080 and 1366:768 are within 0.1% of each other. Rounded decimals would render both as
    // "1.78:1" and the sentence would read "aspect ratio differs (1.78:1 against 1.78:1)".
    const reasons = fitLayoutTarget(
      { ...panel, width: 1920, height: 1080 },
      output({ width: 1366, height: 768 }),
    ).reasons;

    expect(reasons[1]).toBe(
      'aspect ratio differs (16:9 against 683:384), so the canvas is letterboxed',
    );
  });

  it('rounds a fractional frame rate, which is the one target field that may be fractional', () => {
    const reason = fitLayoutTarget(
      { ...panel, frameRate: 30 },
      output({ frameRate: 59.94005994005994 / 2 }),
    ).reasons[0];

    expect(reason).toBe('layout declares a 30 Hz capture ceiling and the output reaches 29.97 Hz');
  });

  it('never prints a frame rate the output did not report', () => {
    // The old `?? 0` could only have printed "reaches 0 Hz" for an output whose rate is unknown,
    // and an unknown rate is honoured rather than a shortfall, so the sentence was unreachable.
    const fit = fitLayoutTarget(panel, output());

    expect(fit.reasons).toEqual([]);
    expect(fit.frameRateHonoured).toBe(true);
  });
});

describe('formatScalePercent', () => {
  it('renders a scale factor as a percentage a person can read', () => {
    expect(formatScalePercent(1)).toBe('100%');
    expect(formatScalePercent(0.75)).toBe('75%');
    expect(formatScalePercent(0.7114583333333333)).toBe('71.1%');
    expect(formatScalePercent(1.5)).toBe('150%');
    expect(formatScalePercent(0.5)).toBe('50%');
  });

  it('never rounds a scale that is not 1 up to a flat 100%', () => {
    expect(formatScalePercent(0.999)).toBe('99.9%');
    expect(formatScalePercent(0.99999)).toBe('99.999%');
    expect(formatScalePercent(1.0001)).toBe('100.01%');
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
