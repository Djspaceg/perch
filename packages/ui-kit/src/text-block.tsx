/**
 * A literal string painted at a rect — the `text` element of a layout, as pixels.
 *
 * It holds no topic, no subscription and no state: its content arrives as a prop from the layout
 * and cannot change while the page is up. That makes the frame-budget rules `<Readout>` works hard
 * for free here, and it is why this is a separate component rather than a readout with no sensor:
 * a widget that *cannot* update is a different thing from one that happens not to, and conflating
 * them would mean carrying a subscription for a caption.
 *
 * ## The shape is fixed, and the rect is the shape
 *
 * The element fills the rect the layout gave it and never asks for more. Two consequences:
 *
 * - **It cannot push anything.** Every element on the canvas is absolutely positioned at authored
 *   coordinates, so a string longer than its rect must clip rather than grow — a caption that
 *   widened its box would move nothing (there is nothing to move) but would paint over its
 *   neighbour, which on a panel reads as two broken widgets rather than one long caption.
 * - **The author controls the break, not the renderer.** Lines break where the authored string has
 *   a newline (`white-space: pre-line`) and nowhere else by default. A caption that reflowed at a
 *   width the author never saw is the responsive-layout failure this project's coordinate system
 *   exists to avoid.
 *
 * Placement inside the rect is a theme token pair rather than a prop, because it is presentation:
 * `--perch-text-justify` and `--perch-text-anchor` are the flex values, so a layout can centre a
 * title in its band or pin a footnote to the bottom-left without a schema field for either.
 */

import type { ReactNode } from 'react';
import { token } from './tokens.js';

export interface TextBlockProps {
  /**
   * The string to paint. Required and non-empty by the layout format's own rule: an element with
   * nothing to say paints a blank rectangle, which on a panel is indistinguishable from a broken
   * binding, so it is rejected at load rather than rendered as air.
   */
  text: string;
}

export function TextBlock({ text }: TextBlockProps): ReactNode {
  return (
    <div className="perch-text">
      <span className="perch-text__body">{text}</span>
    </div>
  );
}

/**
 * The text element's styles, as a string for the page to inject once — the same shape and for the
 * same reasons as `READOUT_STYLES`.
 *
 * No hover, focus or active rule: the panel has no pointer. No transition or keyframe: a capture
 * samples one frame, and anything mid-flight is photographed half-done.
 *
 * `overflow: hidden` on the outer box with `min-width: 0` is the containment guarantee — a string
 * that does not fit is clipped inside its own rect instead of painting over the element beside it.
 * It is deliberately a hard clip rather than an ellipsis: a truncated *number* must look truncated
 * (which is why the readout ellipsises), but a caption reading `GPU` where the author wrote
 * `GPU CORE` is still a correct word, and an ellipsis on a centred title looks like a defect in the
 * layout rather than in the text.
 */
export const TEXT_BLOCK_STYLES = `
.perch-text {
  display: flex;
  min-width: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  justify-content: ${token('--perch-text-justify')};
  align-items: ${token('--perch-text-anchor')};
  font-family: ${token('--perch-font')};
}
.perch-text__body {
  min-width: 0;
  white-space: pre-line;
  text-align: ${token('--perch-text-align')};
  font-size: ${token('--perch-text-size')};
  font-weight: ${token('--perch-text-weight')};
  line-height: ${token('--perch-text-line-height')};
  letter-spacing: ${token('--perch-text-tracking')};
  text-transform: ${token('--perch-text-transform')};
  color: ${token('--perch-text-color')};
}
`;
