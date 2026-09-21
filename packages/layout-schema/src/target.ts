/**
 * Hard rule 3, made executable: **a layout must declare what it needs**, so a target that cannot
 * honour it refuses cleanly and loudly rather than rendering wrong and being discovered on the
 * panel.
 *
 * `target` is the declaration. `fitLayoutTarget` and `describeTargetMismatch` are what a consumer
 * compares it against. They state the *relationship* between a layout and an output and stop there —
 * whether a letterbox is acceptable or a frame-rate shortfall is fatal is the runtime's policy, and
 * baking a refusal in here would put output-adapter behaviour inside a contract.
 *
 * Both follow from coordinate decision 1: the canvas is fixed at `target` size and the *whole*
 * canvas is scaled to fit its viewport, letterboxed. So a size difference is a scale factor, never
 * a reflow, and the only thing an aspect-ratio difference costs is bars.
 *
 * `TargetFit.reasons` are sentences a person reads and acts on, so every number in one is *rendered*
 * rather than interpolated raw: a scale factor is a percentage, an aspect ratio is in lowest terms,
 * and a frame rate is the rate it is known by. The exact numbers stay on `TargetFit` for callers that
 * compute with them. `formatScalePercent` is exported because the scale is printed outside this file
 * too, and one convention beating three is the point.
 */

import type { LayoutTarget } from './layout.js';

/** What an output can actually do. `frameRate` omitted means "unknown, do not check". */
export interface OutputCapabilities {
  width: number;
  height: number;
  frameRate?: number;
}

/** How a layout's canvas lands in a given viewport. */
export interface TargetFit {
  /**
   * `exact` — the viewport is the canvas, so output is pixel-identical to the editor.
   * `scaled` — same aspect ratio, uniformly scaled, no bars.
   * `letterboxed` — different aspect ratio, so scaled to fit with bars on two sides.
   */
  kind: 'exact' | 'scaled' | 'letterboxed';
  /**
   * Canvas pixels to output pixels. `1` for `exact`; below 1 when the viewport is smaller.
   *
   * Exact, and deliberately unrounded: the canvas transform is derived from it, so rounding here
   * would move rendered geometry to save a printed digit. `formatScalePercent` is the rounding.
   */
  scale: number;
  /** Whether the output can reach the declared capture ceiling. `true` when it is unknown. */
  frameRateHonoured: boolean;
  /**
   * Every way this output falls short of the declaration, in author-readable form. Empty for an
   * exact fit. A consumer that wants hard rule 3's clean refusal refuses on a non-empty list; one
   * that wants a warning logs it.
   */
  reasons: readonly string[];
}

/**
 * How `target` lands in `output`, and everything it gives up doing so.
 *
 * Pure and total: there is no invalid input, because a layout reaching here has already been
 * validated and the capabilities come from the caller's own output.
 */
export function fitLayoutTarget(target: LayoutTarget, output: OutputCapabilities): TargetFit {
  const scale = Math.min(output.width / target.width, output.height / target.height);
  const exact = output.width === target.width && output.height === target.height;
  // Compared as a cross-product rather than as two divisions, so 1920/400 and 960/200 are the same
  // aspect ratio exactly instead of to within a float epsilon.
  const sameAspect = target.width * output.height === target.height * output.width;

  const reasons: string[] = [];
  if (!exact) {
    reasons.push(
      `layout declares ${target.width}x${target.height} and the output is ${output.width}x${output.height}, so the canvas is ${describeScaling(scale)}`,
    );
  }
  if (!sameAspect) {
    reasons.push(
      `aspect ratio differs (${formatAspectRatio(target.width, target.height)} against ${formatAspectRatio(output.width, output.height)}), so the canvas is letterboxed`,
    );
  }

  const outputFrameRate = output.frameRate;
  const frameRateHonoured = outputFrameRate === undefined || outputFrameRate >= target.frameRate;
  // Spelled out rather than written as `!frameRateHonoured` so the narrowing is real: an unknown rate
  // cannot reach the sentence, so the sentence has no rate it has to invent. It used to say `?? 0`,
  // which would have reported an output that "reaches 0 Hz" had it ever been reachable.
  if (outputFrameRate !== undefined && outputFrameRate < target.frameRate) {
    reasons.push(
      `layout declares a ${formatDecimal(target.frameRate)} Hz capture ceiling and the output reaches ${formatDecimal(outputFrameRate)} Hz`,
    );
  }

  return {
    kind: exact ? 'exact' : sameAspect ? 'scaled' : 'letterboxed',
    scale,
    frameRateHonoured,
    reasons,
  };
}

/**
 * One sentence naming every way `output` cannot honour `target`, or `null` when it can exactly.
 *
 * The message a consumer puts in a refusal. Separate from `fitLayoutTarget` so a caller choosing
 * to accept a scaled fit is not obliged to build a string it will not print.
 */
export function describeTargetMismatch(
  target: LayoutTarget,
  output: OutputCapabilities,
): string | null {
  const fit = fitLayoutTarget(target, output);
  if (fit.reasons.length === 0) return null;

  return fit.reasons.join('; ');
}

/**
 * A scale factor as a percentage, for anywhere a person reads it.
 *
 * A percentage rather than a decimal because the question a reader is answering is "how much of the
 * canvas am I getting", and `71.1%` answers it where `0.7114583333333333` has to be rounded and
 * converted first. It also makes the direction legible: `150%` is obviously bigger, where `1.5` is a
 * number you have to compare against 1 to know that.
 *
 * Precision is one decimal place, extended only as far as it takes for a scale that is not 1 to avoid
 * rendering as a flat `100%`. Telling 1 from 0.999 is most of why the number is printed at all: an
 * exact fit is pixel-identical to the editor and a 99.9% one is resampled.
 */
export function formatScalePercent(scale: number): string {
  if (scale === 1) return '100%';

  const percent = scale * 100;
  let places = 1;
  while (places < 6 && Number(percent.toFixed(places)) === 100) places += 1;

  return `${String(Number(percent.toFixed(places)))}%`;
}

/** What the scale factor does to the canvas, named in the direction it happens. */
function describeScaling(scale: number): string {
  if (scale === 1) return 'shown at its declared size';

  return `${scale < 1 ? 'scaled down' : 'scaled up'} to ${formatScalePercent(scale)} of its declared size`;
}

/**
 * An aspect ratio in lowest terms: `24:5`, not `1920:400`.
 *
 * Reduced rather than divided out to a decimal, because the reduction is exact and a decimal is not:
 * 1920:1080 and 1366:768 both round to `1.78:1`, and a sentence reading "aspect ratio differs
 * (1.78:1 against 1.78:1)" contradicts itself where the cross-product above has just established
 * that they differ. `16:9 against 683:384` is ugly for that pair but true, and the pairs this is
 * mostly read for — `24:5 against 16:9` — come out in the form people already recognise.
 *
 * Non-integer dimensions cannot be reduced, so they are printed as they are. Nothing in this repo
 * produces one; a viewport measured in CSS pixels could.
 */
function formatAspectRatio(width: number, height: number): string {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return `${formatDecimal(width)}:${formatDecimal(height)}`;
  }

  const divisor = greatestCommonDivisor(width, height);

  return `${String(width / divisor)}:${String(height / divisor)}`;
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = a;
  let right = b;
  while (right !== 0) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }

  return left;
}

/**
 * A number as a person would write it: at most two decimals, and no trailing zeroes.
 *
 * Two decimals because the fractional quantity these sentences carry is a frame rate — the one
 * `target` field that may be fractional, and so the one that can arrive measured as
 * `29.97002997002997` rather than as the `29.97` it is known by.
 */
function formatDecimal(value: number): string {
  return String(Number(value.toFixed(2)));
}
