/**
 * Direct manipulation, without touching the canvas that paints the layout.
 *
 * ## The overlay, and why the canvas is left alone
 *
 * `LayoutCanvas` is the one renderer — the editor's preview is byte-identical to the runtime's output
 * because it *is* the same component (see `app.test.tsx`, "the preview renders what the runtime
 * renders"). A drag library that wrapped each element, or added a selection border to the canvas, or
 * grew a handle inside it, would break that identity — which is precisely the failure moving the
 * canvas into `ui-kit` was meant to make structural.
 *
 * So nothing here goes near the canvas. The handles are a transparent sibling layer, sized to the same
 * `target` and carrying the same `transform` as `.perch-canvas`, positioned exactly on top of it. One
 * `<Rnd>` sits over each element at that element's rect. Because the overlay and the canvas share a
 * size and a scale and a centre, an overlay coordinate *is* a canvas (layout) coordinate, and the drag
 * library never sees a `ui-kit` component at all.
 *
 * ## Coordinates survive the scale
 *
 * The canvas is one `transform: scale(s)`, so a pointer moved by N screen pixels has moved N/s *layout*
 * pixels. `react-rnd`'s `scale` prop is documented for exactly this: given the same `s` the canvas
 * uses, it reports drag and resize results already in layout space. This was the property the research
 * spike existed to falsify, and it held — at scale 0.6146 a 120-device-pixel drag produced 195 layout
 * pixels (`round(120 / 0.6146)`), where a transform-ignorant library would have produced 160. jsdom
 * cannot measure a transform, so that half is proven by the spike rather than re-asserted here; what
 * this file's test pins is the other half — that the write-back is integers in layout space.
 *
 * ## What is written, and when
 *
 * Every rect is rounded to integers (the schema requires them) and committed on *stop*, not on every
 * move: the controlled `position`/`size` come from the same rendered layout the canvas draws, so a
 * committed edit that validates flows back through both. A drag that produced an invalid document (a
 * rect dragged entirely off-canvas, say) leaves `rendered` unchanged and the handle snaps back — the
 * same "held on the last document that validated" behaviour the field form already has.
 *
 * Selection is set on the *start* of a drag or a resize, not only on click: `react-rnd`'s resize
 * handles stop propagation, so a plain mousedown handler on the box would never fire when a handle is
 * grabbed — the finding the spike recorded. Both starts set it, so grabbing any part of any element
 * selects it.
 */

import type { Layout, Rect } from '@perch/layout-schema';
import type { ReactNode } from 'react';
import { Rnd } from 'react-rnd';

export interface CanvasHandlesProps {
  /**
   * The document the canvas is painting — always `DraftState.rendered`, the last draft that validated.
   * The handles track it so a held-still preview has held-still handles.
   */
  readonly layout: Layout;
  /** The canvas scale, from `previewFit`. The same number `LayoutCanvas` was given. */
  readonly scale: number;
  /** Which element is selected. Out of range means none, which is a valid do-nothing state. */
  readonly selected: number;
  readonly onSelect: (index: number) => void;
  /** Commit a moved or resized element's whole rect. Goes through `editDraft`, so it is validated. */
  readonly onRect: (index: number, rect: Rect) => void;
}

/**
 * The rect a finished drag writes: the element's own size, at the dragged position, rounded.
 *
 * Pure and exported so the write-back contract — integers, in layout space — is tested without driving
 * the library through a transform jsdom cannot measure.
 */
export function rectFromDrag(base: Rect, x: number, y: number): Rect {
  return { ...base, x: Math.round(x), y: Math.round(y) };
}

/** The rect a finished resize writes: the new box, rounded. See `rectFromDrag`. */
export function rectFromResize(x: number, y: number, width: number, height: number): Rect {
  return { x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) };
}

/** The transparent handle layer, one draggable box per element, laid exactly over the canvas. */
export function CanvasHandles({
  layout,
  scale,
  selected,
  onSelect,
  onRect,
}: CanvasHandlesProps): ReactNode {
  return (
    <div
      className="perch-editor-handles"
      data-testid="perch-editor-handles"
      // Sized and transformed to match `.perch-canvas` exactly; the static half is in the sheet. The
      // scale is dynamic and the translate centres the layer the way flexbox centres the canvas.
      style={{
        width: `${layout.target.width}px`,
        height: `${layout.target.height}px`,
        transform: `translate(-50%, -50%) scale(${scale})`,
      }}
    >
      {layout.elements.map((element, index) => {
        const { rect } = element;
        const isSelected = index === selected;

        return (
          <Rnd
            key={index}
            className={`perch-editor-handle${isSelected ? ' perch-editor-handle--selected' : ''}`}
            scale={scale}
            position={{ x: rect.x, y: rect.y }}
            size={{ width: rect.w, height: rect.h }}
            // The schema's floor: a rect is at least 1x1. Below it `validateLayout` would refuse, so the
            // library is stopped there rather than letting the author drag a box out of existence.
            minWidth={1}
            minHeight={1}
            onDragStart={() => {
              onSelect(index);
            }}
            onResizeStart={() => {
              onSelect(index);
            }}
            onDragStop={(_event, data) => {
              onRect(index, rectFromDrag(rect, data.x, data.y));
            }}
            onResizeStop={(_event, _direction, ref, _delta, position) => {
              // `offsetWidth`/`offsetHeight` are the element's own layout box, which an ancestor
              // transform does not change — so these are layout pixels, as `position` already is.
              onRect(
                index,
                rectFromResize(position.x, position.y, ref.offsetWidth, ref.offsetHeight),
              );
            }}
          >
            {/*
             * A body that fills the box, carrying the index the tests and the inspector agree on. It is
             * not the drag surface — `<Rnd>` is — it is the thing a person points at and what names the
             * element in the DOM the same way the inspector's list and every issue path do.
             */}
            <div className="perch-editor-handle__body" data-perch-handle-index={index} />
          </Rnd>
        );
      })}
    </div>
  );
}

/**
 * The handle layer's own styles. Nothing here paints an element or reads a layout token: the layer is
 * chrome, drawn over the canvas, and it is the one place a selection outline is allowed to live because
 * it is not part of what the runtime renders.
 */
export const CANVAS_HANDLES_STYLES = `
.perch-editor-handles {
  position: absolute;
  top: 50%;
  left: 50%;
  transform-origin: center center;
  /* The gaps between boxes let a click fall through; only the boxes below take the pointer. */
  pointer-events: none;
}
.perch-editor-handle {
  pointer-events: auto;
  box-sizing: border-box;
  border: 1px dashed rgba(143, 183, 232, 0.4);
  cursor: move;
}
.perch-editor-handle--selected {
  border: 1px solid #8fb7e8;
  background: rgba(143, 183, 232, 0.08);
}
.perch-editor-handle__body { width: 100%; height: 100%; }
`;
