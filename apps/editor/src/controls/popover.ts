/**
 * Where a popover goes.
 *
 * Under its anchor, left edges aligned, when it fits; over it when it does not; and pinned inside
 * the viewport when it fits neither — which is the ordinary case at the 1920x400 panel ratio, where a
 * picker under a swatch halfway down a 400px window has nowhere to go but up. Always on screen
 * horizontally too: the inspector is the rightmost column, so a popover aligned to a swatch's left
 * edge would otherwise run off the right.
 *
 * And how one behaves, once: `usePopover` is the open state, the placement kept current while the
 * page scrolls or resizes, dismissal on Escape (focus back to the anchor) or on a press outside, and
 * focus moved in on open. The colour picker and the sensor picker are both this hook with different
 * contents, so the two cannot drift into dismissing differently.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';

/** A client rect's edges. */
export interface AnchorEdges {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** A width and a height. */
export interface Extent {
  readonly width: number;
  readonly height: number;
}

/** The popover's top-left corner, in viewport pixels, for `position: fixed`. */
export function placePopover(
  anchor: AnchorEdges,
  size: Extent,
  viewport: Extent,
  gap = 4,
): { readonly top: number; readonly left: number } {
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  let top: number;
  if (below + size.height <= viewport.height - gap) top = below;
  else if (above >= gap) top = above;
  else top = Math.max(gap, viewport.height - size.height - gap);

  const left = Math.min(Math.max(gap, anchor.left), viewport.width - size.width - gap);

  return { top, left };
}

export interface Popover {
  readonly open: boolean;
  /** Open it, or close it without moving focus. */
  readonly setOpen: (open: boolean) => void;
  /** Close it; `refocus` hands focus back to the anchor, as Escape does. */
  readonly close: (refocus: boolean) => void;
  /** The popover's id, for the anchor's `aria-controls`. */
  readonly id: string;
  /** `top`/`left` once placed; hidden for the one frame before it is measured. */
  readonly style: CSSProperties;
}

/**
 * An anchored, dismissable popover's state and behaviour. The markup is the caller's, and so are the
 * two refs — the anchor and the box — which the caller attaches and hands in, so render never reads a
 * ref through this hook's return value.
 */
export function usePopover(
  anchorRef: RefObject<HTMLElement | null>,
  popoverRef: RefObject<HTMLElement | null>,
): Popover {
  const [open, setOpenState] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const id = useId();

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (!next) setPosition(null);
  }, []);

  const close = useCallback(
    (refocus: boolean) => {
      setOpen(false);
      if (refocus) anchorRef.current?.focus();
    },
    [setOpen, anchorRef],
  );

  // Placed against the anchor, and kept there while the page scrolls or resizes.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = (): void => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const box = popoverRef.current?.getBoundingClientRect();
      if (anchor === undefined || box === undefined) return;
      setPosition(
        placePopover(
          anchor,
          { width: box.width, height: box.height },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    // And again whenever the box itself changes size: a popover whose contents change while it is
    // open — the Add menu becoming the sensor list — would otherwise keep the place it was given
    // at its first size and run off the screen. Feature-tested: jsdom has no ResizeObserver.
    const box = popoverRef.current;
    const observer =
      box !== null && typeof ResizeObserver === 'function' ? new ResizeObserver(place) : undefined;
    if (box !== null) observer?.observe(box);

    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer?.disconnect();
    };
  }, [open, anchorRef, popoverRef]);

  // Dismissal: Escape anywhere, or a press outside both the popover and its anchor. An Escape a
  // control inside has already used — a search box clearing itself — is not also a dismissal.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      close(true);
    };
    const onPress = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        popoverRef.current?.contains(target) === true ||
        anchorRef.current?.contains(target) === true
      ) {
        return;
      }
      close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress, true);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress, true);
    };
  }, [open, close, anchorRef, popoverRef]);

  // Opened, focus goes in: a keyboard user pressed Enter on the anchor in order to use what it opens.
  useEffect(() => {
    if (!open) return;
    popoverRef.current?.querySelector<HTMLElement>('[tabindex="0"], input, button')?.focus();
  }, [open, popoverRef]);

  return {
    open,
    setOpen,
    close,
    id,
    style:
      position === null
        ? { top: 0, left: 0, visibility: 'hidden' }
        : { top: position.top, left: position.left },
  };
}
