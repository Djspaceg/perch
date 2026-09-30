/**
 * useRowDrag: drag a row of the Elements list to another place in it, with native pointer events.
 *
 * A press on a row does nothing until the pointer has moved `DRAG_THRESHOLD_PX` up or down, so a
 * click still selects. From there the row is held: the gap it would land in is read from the rows'
 * boxes on every move (`gapAt`) and shown by the list as a line between two rows, the sidebar scrolls
 * while the pointer is near its top or bottom edge, and letting go moves the element there in one
 * edit, which is one undo step. Escape, a cancelled pointer, or the list changing under the drag (an
 * undo pressed mid-drag) lets go without moving anything; so does a drop either side of the row's
 * own place.
 *
 * Listened to on `window`, as a scrub is (`controls/number-field.tsx`), so the drag carries on over
 * the rest of the page and past the list's ends. Not HTML5 drag and drop, which has no auto-scroll
 * a page can steer, draws its own ghost and behaves differently in each engine.
 */

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { autoscrollStep, dropTarget, gapAt } from './layers.js';

/** How far a pressed row must move before it is being dragged rather than clicked. */
export const DRAG_THRESHOLD_PX = 4;

/** The attribute each present row's button carries: its element's index in `elements`. */
export const LAYER_INDEX_ATTRIBUTE = 'data-perch-layer-index';

/** A drag in progress: which element, and the list gap it would land in. */
export interface RowDrag {
  readonly from: number;
  readonly gap: number;
}

export function useRowDrag(
  list: { readonly current: HTMLElement | null },
  count: number,
  onMove: (from: number, to: number) => void,
): {
  /** The drag in progress, for the list to draw; `null` while none is. */
  readonly drag: RowDrag | null;
  /** A row's `onPointerDown`. */
  readonly begin: (event: ReactPointerEvent, from: number) => void;
  /** Whether the click that ends a drag should be ignored; answering clears it. */
  readonly swallowClick: () => boolean;
  /** Let go of a drag in progress without moving anything: the list it was measuring has changed. */
  readonly cancel: () => void;
} {
  const [drag, setDrag] = useState<RowDrag | null>(null);
  const dragged = useRef(false);
  const active = useRef<(() => void) | null>(null);

  const begin = useCallback(
    (event: ReactPointerEvent, from: number) => {
      if (event.button !== 0) return;
      dragged.current = false;
      const startY = event.clientY;
      const scroller = list.current?.closest<HTMLElement>('.perch-editor-inspector') ?? null;
      let lastY = startY;
      let dragging = false;
      let gap: number | null = null;
      let frame = 0;

      const rows = (): HTMLElement[] => [
        ...(list.current?.querySelectorAll<HTMLElement>(`[${LAYER_INDEX_ATTRIBUTE}]`) ?? []),
      ];
      const track = (): void => {
        gap = gapAt(
          lastY,
          rows().map((row) => row.getBoundingClientRect()),
        );
        setDrag({ from, gap });
      };
      /**
       * One frame of scrolling, if the pointer is near an edge. Whether it scrolled: at the top or the
       * bottom already it does not, so a pointer held there stops asking for frames.
       */
      const scroll = (): boolean => {
        if (scroller === null) return false;
        const box = scroller.getBoundingClientRect();
        const step = autoscrollStep(lastY, box.top, box.bottom);
        if (step === 0) return false;
        const before = scroller.scrollTop;
        scroller.scrollTop = before + step;

        return scroller.scrollTop !== before;
      };
      const tick = (): void => {
        frame = 0;
        if (!dragging || !scroll()) return;
        track();
        frame = requestAnimationFrame(tick);
      };
      const move = (moved: PointerEvent): void => {
        lastY = moved.clientY;
        if (!dragging) {
          if (Math.abs(lastY - startY) < DRAG_THRESHOLD_PX) return;
          dragging = true;
          dragged.current = true;
          document.body.classList.add('perch-dragging');
        }
        moved.preventDefault();
        // The frame loop scrolls while it runs; a move only starts it, so moving is not faster.
        if (frame === 0 && scroll()) frame = requestAnimationFrame(tick);
        track();
      };
      /**
       * The click a release on the row makes is the drag's, not a selection, so it is swallowed; one
       * that never comes (released over another row) must not swallow the next real click either. Let
       * go of before the release — Escape, or the list changing — it waits for the release.
       */
      const settle = (released: boolean): void => {
        const clear = (): void => {
          window.removeEventListener('pointerup', clear);
          window.removeEventListener('pointercancel', clear);
          setTimeout(() => {
            dragged.current = false;
          }, 0);
        };
        if (released) clear();
        else {
          window.addEventListener('pointerup', clear);
          window.addEventListener('pointercancel', clear);
        }
      };
      const finish = (drop: boolean, released: boolean): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', lost);
        window.removeEventListener('keydown', key, true);
        active.current = null;
        if (frame !== 0) cancelAnimationFrame(frame);
        document.body.classList.remove('perch-dragging');
        if (!dragging) return;
        settle(released);
        setDrag(null);
        const to = drop && gap !== null ? dropTarget(from, gap, count) : null;
        if (to !== null) onMove(from, to);
      };
      const up = (): void => {
        finish(true, true);
      };
      const lost = (): void => {
        finish(false, true);
      };
      const key = (pressed: KeyboardEvent): void => {
        if (pressed.key !== 'Escape' || !dragging) return;
        // Spent here: the same Escape must not also deselect.
        pressed.preventDefault();
        finish(false, false);
      };

      active.current = () => {
        finish(false, false);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', lost);
      window.addEventListener('keydown', key, true);
    },
    [list, count, onMove],
  );

  const swallowClick = useCallback(() => {
    const swallow = dragged.current;
    dragged.current = false;

    return swallow;
  }, []);

  const cancel = useCallback(() => {
    active.current?.();
  }, []);

  return { drag, begin, swallowClick, cancel };
}
