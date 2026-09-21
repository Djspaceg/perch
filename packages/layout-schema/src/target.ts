/**
 * Hard rule 3, made executable: **a layout must declare what it needs**, so a target that cannot
 * honour it refuses cleanly and loudly rather than rendering wrong and being discovered on the
 * panel.
 *
 * `target` is the declaration. These two functions are what a consumer compares it against. They
 * state the *relationship* between a layout and an output and stop there — whether a letterbox is
 * acceptable or a frame-rate shortfall is fatal is the runtime's policy, and baking a refusal in
 * here would put output-adapter behaviour inside a contract.
 *
 * Both follow from coordinate decision 1: the canvas is fixed at `target` size and the *whole*
 * canvas is scaled to fit its viewport, letterboxed. So a size difference is a scale factor, never
 * a reflow, and the only thing an aspect-ratio difference costs is bars.
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
  /** Canvas pixels to output pixels. `1` for `exact`; below 1 when the viewport is smaller. */
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
      `layout declares ${target.width}x${target.height} and the output is ${output.width}x${output.height}, so the canvas is scaled by ${scale}`,
    );
  }
  if (!sameAspect) {
    reasons.push(
      `aspect ratio differs (${target.width}:${target.height} against ${output.width}:${output.height}), so the canvas is letterboxed`,
    );
  }

  const frameRateHonoured = output.frameRate === undefined || output.frameRate >= target.frameRate;
  if (!frameRateHonoured) {
    reasons.push(
      `layout declares a ${target.frameRate} Hz capture ceiling and the output reaches ${output.frameRate ?? 0} Hz`,
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
