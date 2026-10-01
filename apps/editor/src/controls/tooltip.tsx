/**
 * The chrome's tooltips, in place of the browser's `title`.
 *
 * Any element in the chrome says what its tooltip is with `data-perch-tip` (and, with
 * `data-perch-tip-when="truncated"`, that it is only worth showing while the element's own text is
 * cut short); one `TooltipLayer` per
 * page, mounted once by the editor and once by the Settings window, shows it. One layer rather than
 * a wrapper per control, so the thirty-odd places that had a `title` changed one attribute each and
 * no control gained a component around it.
 *
 * - **When**: after `TOOLTIP_DELAY` under a mouse or pen, and after the same delay on keyboard focus
 *   (`:focus-visible`, so a click does not leave one behind). Moving from one tip to another while
 *   one is showing, or within `TOOLTIP_GRACE` of it going, shows the next at once. Never for touch,
 *   where there is no hover to ask with.
 * - **Gone**: when the pointer leaves the target (for the tooltip itself is fine: it can be hovered,
 *   WCAG 1.4.13), on focus moving away, on a press anywhere, on scroll, and on Escape, which leaves
 *   focus where it was.
 * - **Where**: `placePopover`'s rules, the popovers' own: under the target, over it when there is no
 *   room below, and pinned inside the window either way.
 * - **For assistive technology**: while it is up — and from the moment of keyboard focus, before the
 *   picture, since a screen reader does not wait — the tooltip's id is added to the target's
 *   `aria-describedby`, after any description it already had, and taken off again afterwards. A tip
 *   that only repeats the target's own name (an icon button's) is not added, so nothing is read
 *   twice.
 *
 * Themed by the chrome's tokens, so it is the popover's surface in either scheme.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { placePopover } from './popover.js';

/** How long a pointer or focus rests on a target before its tooltip shows. */
export const TOOLTIP_DELAY = 500;

/** How soon after one tooltip goes the next shows without the delay. */
export const TOOLTIP_GRACE = 300;

const TIP = 'data-perch-tip';

/**
 * The nearest element at or above `node` that has a tip to show. One marked
 * `data-perch-tip-when="truncated"` has one only while its text is cut short: a chip's tip is its
 * own label, worth showing only once the label no longer fits.
 */
function tipTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const found = node.closest(`[${TIP}]`);
  if (!(found instanceof HTMLElement) || (found.getAttribute(TIP) ?? '') === '') return null;
  if (found.dataset['perchTipWhen'] === 'truncated' && found.scrollWidth <= found.clientWidth) {
    return null;
  }

  return found;
}

/** Whether focus on `element` came from the keyboard. jsdom's selector engine may not know it. */
function focusVisible(element: HTMLElement): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** The element's own name, as far as a tip could repeat it. */
function ownName(element: HTMLElement): string {
  return (element.getAttribute('aria-label') ?? element.textContent).trim();
}

function describe(element: HTMLElement, id: string): void {
  const ids = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  if (!ids.includes(id)) element.setAttribute('aria-describedby', [...ids, id].join(' '));
}

function undescribe(element: HTMLElement, id: string): void {
  const ids = (element.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter((each) => each !== '' && each !== id);
  if (ids.length === 0) element.removeAttribute('aria-describedby');
  else element.setAttribute('aria-describedby', ids.join(' '));
}

interface Tip {
  readonly target: HTMLElement;
  readonly text: string;
  /** Whether the picture is up; a tip only described (keyboard focus, before the delay) is not. */
  readonly visible: boolean;
}

export function TooltipLayer(): ReactNode {
  const id = `perch-tip-${useId().replace(/:/g, '')}`;
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [place, setPlace] = useState<{ readonly top: number; readonly left: number } | null>(null);

  useEffect(() => {
    /** The tip showing. */
    let current: Tip | null = null;
    let described: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hiddenAt = Number.NEGATIVE_INFINITY;

    const describeNow = (target: HTMLElement): void => {
      if (described !== null && described !== target) undescribe(described, id);
      described = null;
      const text = target.getAttribute(TIP) ?? '';
      if (current === null) setTip({ target, text, visible: false });
      if (text.trim() === ownName(target)) return;
      describe(target, id);
      described = target;
    };
    const show = (target: HTMLElement): void => {
      const text = target.getAttribute(TIP) ?? '';
      describeNow(target);
      current = { target, text, visible: true };
      setPlace(null);
      setTip(current);
    };
    const hide = (): void => {
      clearTimeout(timer);
      timer = undefined;
      if (described !== null) undescribe(described, id);
      described = null;
      if (current !== null) hiddenAt = Date.now();
      current = null;
      setTip(null);
    };
    const schedule = (target: HTMLElement): void => {
      clearTimeout(timer);
      const warm = current !== null || Date.now() - hiddenAt < TOOLTIP_GRACE;
      if (warm) {
        show(target);
        return;
      }
      timer = setTimeout(() => {
        show(target);
      }, TOOLTIP_DELAY);
    };

    const onOver = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') return;
      const target = tipTarget(event.target);
      if (target === null || target === current?.target) return;
      schedule(target);
    };
    const onOut = (event: PointerEvent): void => {
      const leaving = tipTarget(event.target);
      if (leaving === null) return;
      const to = event.relatedTarget;
      if (to instanceof Node && (leaving.contains(to) || box.current?.contains(to) === true))
        return;
      if (current === null || current.target === leaving) hide();
    };
    const onBoxOut = (event: PointerEvent): void => {
      const to = event.relatedTarget;
      if (to instanceof Node && current?.target.contains(to) === true) return;
      if (to instanceof Node && box.current?.contains(to) === true) return;
      hide();
    };
    const onFocus = (event: FocusEvent): void => {
      const target = tipTarget(event.target);
      if (target === null || !focusVisible(target)) return;
      describeNow(target);
      schedule(target);
    };
    const onBlur = (event: FocusEvent): void => {
      const target = tipTarget(event.target);
      if (target !== null && (current?.target === target || described === target)) hide();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && current !== null) hide();
    };
    const onPress = (): void => {
      hide();
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPress, true);
    window.addEventListener('scroll', onPress, true);
    const ownBox = box.current;
    ownBox?.addEventListener('pointerout', onBoxOut);

    return () => {
      hide();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('scroll', onPress, true);
      ownBox?.removeEventListener('pointerout', onBoxOut);
    };
  }, [id]);

  // Measured hidden, then placed: its size depends on its text.
  useLayoutEffect(() => {
    if (tip?.visible !== true || box.current === null) return;
    const anchor = tip.target.getBoundingClientRect();
    const size = box.current.getBoundingClientRect();
    setPlace(
      placePopover(
        anchor,
        { width: size.width, height: size.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [tip]);

  return (
    <div className="perch-tooltip-layer">
      <div
        ref={box}
        id={id}
        className="perch-tooltip"
        role="tooltip"
        hidden={tip?.visible !== true}
        style={
          place === null
            ? { top: 0, left: 0, visibility: 'hidden' }
            : { top: `${String(place.top)}px`, left: `${String(place.left)}px` }
        }
      >
        {tip?.text}
      </div>
    </div>
  );
}

export const TOOLTIP_STYLES = `
.perch-tooltip {
  position: fixed;
  z-index: 100;
  box-sizing: border-box;
  max-width: min(320px, calc(100vw - 8px));
  padding: 3px 7px 4px;
  border: 1px solid var(--ed-field-edge-hover);
  border-radius: var(--ed-radius);
  background: var(--ed-popover);
  box-shadow: 0 4px 12px var(--ed-popover-shadow);
  color: var(--ed-text);
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: var(--ed-font-small);
  line-height: 1.4;
  overflow-wrap: anywhere;
  pointer-events: auto;
}
.perch-tooltip[hidden] { display: none; }
`;
