/**
 * The live preview: **`LayoutCanvas`, and a box to put it in.**
 *
 * That is the whole of it, and the shortness is the point. `LayoutCanvas` was moved out of the
 * runtime and into `@perch/ui-kit` precisely so this file could not become a second renderer, so
 * nothing here decides what an element looks like, where inside the canvas it sits, or what a missing
 * asset paints. Every one of those is the canvas's, and an author judging a layout in this pane is
 * looking at the same component tree the panel will run.
 *
 * What this file adds is the two things the canvas deliberately does not do: pick the scale, and
 * supply the surface the scaled canvas is centred on.
 *
 * ## Why the pane is not `.perch-stage`
 *
 * `LAYOUT_CANVAS_STYLES` ships a stage rule, and reusing it was the first thing tried. It cannot be:
 * `.perch-stage` is `width: 100vw; height: 100vh`, which is correct for the runtime — a page whose
 * entire job is one canvas filling the display — and wrong for an editor, where the canvas shares the
 * window with a header and an inspector. Applied here it makes the pane overlap the chrome and the
 * canvas centre on the window rather than on the pane.
 *
 * So the pane below is the editor's own rule. It copies the stage's *centring* — flex, `overflow:
 * hidden`, `canvasToken('--perch-letterbox-bg')` for the bars — because that is the coordinate model
 * the canvas assumes about whatever contains it: `.perch-canvas` is `flex: none` with
 * `transform-origin: center center`, so a transformed canvas stays its untransformed size as far as
 * layout is concerned and the container has to centre it. Reaching the same arrangement through the
 * same tokens is consumption, not divergence; the pixels inside the canvas are still one
 * implementation. The finding is recorded in DECISIONS.md: a stage that took its size from its
 * parent would have been reusable by both apps.
 *
 * ## The scale is capped at 1
 *
 * A layout smaller than the pane could be blown up to fill it, and is not. Above 1 every edge in the
 * preview is a resample, so an author nudging a 2 px gap is judging an artefact — and the panel this
 * is authored for runs the canvas at its declared size or scaled *down* to a display. Nothing in the
 * pipeline upscales, so neither does the preview. A layout larger than the pane still scales down,
 * which is the ordinary case and is reported as a percentage rather than left to be guessed.
 */

import {
  fitLayoutTarget,
  formatScalePercent,
  type Layout,
  type LayoutTarget,
  type Rect,
} from '@perch/layout-schema';
import { LayoutCanvas, canvasToken } from '@perch/ui-kit';
import type { ReactNode } from 'react';
import { CanvasHandles } from './canvas-handles.js';
import { NOTHING_SELECTED } from './inspector.js';
import type { PreviewViewport } from './preview-viewport.js';

/** How a layout's canvas is shown in the pane. */
export interface PreviewFit {
  /** Canvas pixels to pane pixels, never above 1. */
  readonly scale: number;
  /** `fitLayoutTarget`'s own classification of the relationship, uncapped. */
  readonly kind: 'exact' | 'scaled' | 'letterboxed';
}

/**
 * The scale the preview draws at, from `layout-schema`'s own fitting rule.
 *
 * `fitLayoutTarget` rather than a division of this file's own, for the reason the runtime's chrome
 * uses `formatScalePercent` rather than a local percent format: the relationship between a declared
 * target and an actual output is a schema concept, it is already exported, and a second
 * implementation of it would agree until one of them changed.
 */
export function previewFit(target: LayoutTarget, viewport: PreviewViewport): PreviewFit {
  const fit = fitLayoutTarget(target, viewport);

  return { scale: Math.min(fit.scale, 1), kind: fit.kind };
}

export interface LayoutPreviewProps {
  /**
   * The document to paint.
   *
   * Always `DraftState.rendered` — the last draft that validated, as the validator rebuilt it. The
   * caller enforces that; see `draft.ts` for why painting the raw draft would be dishonest.
   */
  readonly layout: Layout;
  /** Passed straight to the canvas. Detached from the library, hence a property and not a method. */
  readonly resolveAsset: (src: string) => string | undefined;
  /** How much room there is. Measured once by the shell and passed down. */
  readonly viewport: PreviewViewport;
  /**
   * Whether the draft currently fails validation, so this canvas is a held-still older document.
   *
   * Reflected onto the pane as `data-perch-preview-stale` and marked visibly, because the preview
   * silently not moving is indistinguishable from an edit that had no visual effect.
   */
  readonly stale: boolean;
  /** Which element the handle layer draws as selected. Shared with the inspector's element list. */
  readonly selected: number;
  readonly onSelect: (index: number) => void;
  /** Commit a dragged or resized element's rect. Threaded to `editDraft`, so it is validated. */
  readonly onRect: (index: number, rect: Rect) => void;
  /** Delete or Backspace pressed while the canvas itself has focus. */
  readonly onDeleteKey: () => void;
}

/**
 * The pane: the shared canvas, and a handle layer laid over it.
 *
 * The two are siblings, deliberately. `CanvasHandles` is a transparent overlay, not a wrapper, so
 * `LayoutCanvas` renders exactly as the runtime renders it and the "one renderer" property holds; see
 * that file's comment. The handles are given the same `layout` and the same `scale` as the canvas, so
 * they sit on top of it pixel for pixel.
 */
export function LayoutPreview({
  layout,
  resolveAsset,
  viewport,
  stale,
  selected,
  onSelect,
  onRect,
  onDeleteKey,
}: LayoutPreviewProps): ReactNode {
  const fit = previewFit(layout.target, viewport);

  return (
    <div
      className="perch-editor-preview"
      data-testid="perch-editor-preview"
      data-perch-preview-fit={fit.kind}
      data-perch-preview-scale={fit.scale}
      data-perch-preview-stale={stale ? 'true' : 'false'}
      // Inline, from the same numbers the scale was derived from. See `preview-viewport.ts`.
      style={{ width: `${viewport.width}px`, height: `${viewport.height}px` }}
      // Focusable, so a press on the canvas gives it focus and the Delete key has somewhere to land
      // that is not a field. Only a key on the pane itself counts: nothing inside it is focusable.
      tabIndex={0}
      role="group"
      aria-label="canvas"
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== 'Delete' && event.key !== 'Backspace') return;
        event.preventDefault();
        onDeleteKey();
      }}
      // A click that lands on no handle — the letterbox, or canvas no element covers — deselects,
      // which is the convention every canvas editor follows. Every element has a handle over its whole
      // rect, so "not in a handle" is exactly "not on an entity". A drag ends in a click on its own
      // handle, so moving an element never deselects it. The keyboard route is Escape (`app.tsx`).
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('.perch-editor-handle') === null
        ) {
          onSelect(NOTHING_SELECTED);
        }
      }}
    >
      <LayoutCanvas layout={layout} scale={fit.scale} resolveAsset={resolveAsset} />
      <CanvasHandles
        layout={layout}
        scale={fit.scale}
        selected={selected}
        onSelect={onSelect}
        onRect={onRect}
      />
    </div>
  );
}

/** The scale, as the editor prints it. One formatter, shared with the runtime's chrome. */
export function describePreviewFit(layout: Layout, viewport: PreviewViewport): string {
  const fit = previewFit(layout.target, viewport);

  return `${layout.target.width}x${layout.target.height} · ${fit.kind} · ${formatScalePercent(fit.scale)}`;
}

/**
 * The pane only.
 *
 * Nothing here styles an element or reads a theme token of the layout's: those belong to the canvas
 * and to the layout file. The one token this borrows is the letterbox colour, deliberately, so the
 * bars around a preview are the bars around the runtime's canvas.
 */
export const PREVIEW_STYLES = `
.perch-editor-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 4px;
  background: ${canvasToken('--perch-letterbox-bg')};
}
/*
 * The held-still marker. A dashed warm border rather than a dimmed canvas: dimming changes the
 * colours an author is in the middle of choosing, which is the one thing a preview must not do.
 */
.perch-editor-preview:focus { outline: none; }
.perch-editor-preview:focus-visible { outline: 1px solid rgba(143, 183, 232, 0.5); outline-offset: -1px; }
.perch-editor-preview[data-perch-preview-stale='true'] {
  outline: 2px dashed #d08770;
  outline-offset: -2px;
}
`;
