/**
 * Collapse: a region that grows open and shrinks shut, so what is below it slides instead of jumping.
 *
 * Every place the sidebar gains or loses content goes through this one component — a section's body,
 * the selected entity's controls, a row of the Elements list, the inline delete confirm — so how
 * motion looks, how long it takes and what it does to focus are decided here, once.
 *
 * ## How it animates an unknown height
 *
 * The region is a one-row grid whose row goes `0fr` <-> `1fr`, and its one child clips. A grid track
 * interpolates between those two however tall the content is, so nothing is measured and nothing is
 * written as a pixel height: content that changes while open simply is its new height. Height and
 * opacity only, in `--ed-motion-duration` with `--ed-motion-ease` (`chrome.ts`); nothing moves
 * sideways, and the clip is lifted once open, so a focus ring or a popover is never cut off by it.
 *
 * ## Leaving takes as long as the collapse
 *
 * Shutting does not unmount. The content stays for the length of the transition — the last content
 * it was given while open, so a caller that stops rendering something (a deleted element) still
 * collapses it rather than an empty box — and goes when `transitionend` arrives, or after the
 * duration if it never does. `keepMounted` keeps it past that, `hidden`: a folded section keeps
 * whatever state its fields hold.
 *
 * While shutting, and once shut, the region is `inert` and `aria-hidden`, so a Tab never lands in
 * something on its way out and a screen reader does not read it. Focus already inside when it starts
 * to shut is handed to `focusOnClose`, rather than dropped onto the page.
 *
 * ## Instant when motion is unwanted
 *
 * `prefers-reduced-motion: reduce` sets the duration to 0 in CSS, and the component also asks the
 * media query itself. Either one, or a transition that computes to no time at all, and every change
 * lands in the same commit: nothing waits for an event that a zero-length transition never sends.
 */

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

/**
 * Where a region is. `entering` is the one unpainted frame at `0fr` that gives the browser a start
 * value to transition from; `opening` and `closing` are the transition; `open` and `closed` are rest.
 */
type Phase = 'closed' | 'entering' | 'opening' | 'open' | 'closing';

/** The media query `CHROME_STYLES` also answers. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Grace past the stated duration before a transition that sent no `transitionend` is called done. */
const TRANSITION_GRACE_MS = 50;

export interface CollapseProps {
  /** Shown, or not. A change grows or shrinks the region. */
  readonly open: boolean;
  /** Stay mounted, `hidden`, once shut, instead of unmounting. */
  readonly keepMounted?: boolean;
  /**
   * Grow open on the first render too, for content that has just arrived — a row added to a list.
   * Off by default: what is there when the page first paints is simply there.
   */
  readonly appear?: boolean;
  /** After a shut has finished and the content has gone (or been hidden). */
  readonly onExited?: () => void;
  /** Where focus goes if it is inside the region when the region starts to shut. */
  readonly focusOnClose?: RefObject<HTMLElement | null>;
  readonly as?: 'div' | 'li' | 'span';
  readonly id?: string;
  readonly className?: string;
  readonly testId?: string;
  readonly children: ReactNode;
}

export function Collapse({
  open,
  keepMounted = false,
  appear = false,
  onExited,
  focusOnClose,
  as: Tag = 'div',
  id,
  className,
  testId,
  children,
}: CollapseProps): ReactNode {
  const [phase, setPhase] = useState<Phase>(() =>
    open ? (appear ? 'entering' : 'open') : 'closed',
  );
  const [wasOpen, setWasOpen] = useState(open);
  // The content as it last was while open, for a caller that stops rendering it on close.
  const [lastOpen, setLastOpen] = useState<ReactNode>(open ? children : null);
  const node = useRef<HTMLElement>(null);
  // The latest callback, without restarting a running transition each time a caller re-renders.
  const exited = useRef(onExited);
  useLayoutEffect(() => {
    exited.current = onExited;
  });

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPhase(phase === 'closing' ? 'opening' : 'entering');
    else setPhase(phase === 'closed' ? 'closed' : 'closing');
  }
  if (open && !keepMounted && lastOpen !== children) setLastOpen(children);

  useLayoutEffect(() => {
    const region = node.current;
    if (region === null) return undefined;

    if (phase === 'entering') {
      // Read layout once at `0fr`, so the change to `1fr` below is a change the browser animates.
      region.getBoundingClientRect();
      setPhase(isInstant(region) ? 'open' : 'opening');
      return undefined;
    }
    if (phase !== 'opening' && phase !== 'closing') return undefined;

    const settle = (): void => {
      if (phase === 'opening') {
        setPhase('open');
        return;
      }
      setPhase('closed');
      exited.current?.();
    };

    if (phase === 'closing') {
      const target = focusOnClose?.current;
      if (target != null && region.contains(document.activeElement)) target.focus();
    }
    if (isInstant(region)) {
      settle();
      return undefined;
    }

    // Only the region's own transition: a child's bubbling up says nothing about this one.
    const onEnd = (event: Event): void => {
      if (event.target === region) settle();
    };
    region.addEventListener('transitionend', onEnd);
    const timer = window.setTimeout(settle, transitionMs(region) + TRANSITION_GRACE_MS);

    return () => {
      region.removeEventListener('transitionend', onEnd);
      window.clearTimeout(timer);
    };
  }, [phase, focusOnClose]);

  if (phase === 'closed' && !keepMounted) return null;
  const leaving = phase === 'closing' || phase === 'closed';
  // The clip is the grid item. Phrasing content inside a span; a div is valid inside a div or an li.
  const Clip = Tag === 'span' ? 'span' : 'div';

  return (
    <Tag
      ref={node as RefObject<never>}
      id={id}
      className={className === undefined ? 'perch-collapse' : `perch-collapse ${className}`}
      data-perch-phase={phase}
      data-testid={testId}
      hidden={phase === 'closed'}
      inert={leaving}
      aria-hidden={leaving ? 'true' : undefined}
    >
      <Clip className="perch-collapse__clip">{open || keepMounted ? children : lastOpen}</Clip>
    </Tag>
  );
}

/** Whether the author asked for no motion. Feature-tested: jsdom has no `matchMedia`. */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** No motion wanted, or none that would take any time. */
function isInstant(region: HTMLElement): boolean {
  return prefersReducedMotion() || transitionMs(region) === 0;
}

/**
 * The longest transition on the region, in milliseconds, as the browser computed it. Anything it
 * cannot read — an engine that does not resolve the custom property — is 0, which is instant.
 */
function transitionMs(region: HTMLElement): number {
  const style = window.getComputedStyle(region);
  const durations = style.transitionDuration.split(',').map(toMs);
  const delays = style.transitionDelay.split(',').map(toMs);

  return Math.max(0, ...durations.map((duration, at) => duration + (delays[at] ?? 0)));
}

function toMs(value: string): number {
  const text = value.trim();
  const amount = Number.parseFloat(text);
  if (!Number.isFinite(amount)) return 0;

  return text.endsWith('ms') ? amount : amount * 1000;
}

export const COLLAPSE_STYLES = `
.perch-collapse {
  display: grid;
  grid-template-rows: 1fr;
  min-width: 0;
  transition: grid-template-rows var(--ed-motion-duration) var(--ed-motion-ease);
}
.perch-collapse[data-perch-phase='entering'],
.perch-collapse[data-perch-phase='closing'],
.perch-collapse[data-perch-phase='closed'] { grid-template-rows: 0fr; }
.perch-collapse[hidden] { display: none; }
.perch-collapse__clip {
  display: block;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  transition: opacity var(--ed-motion-duration) var(--ed-motion-ease);
}
.perch-collapse[data-perch-phase='open'] > .perch-collapse__clip { overflow: visible; }
.perch-collapse[data-perch-phase='entering'] > .perch-collapse__clip,
.perch-collapse[data-perch-phase='closing'] > .perch-collapse__clip,
.perch-collapse[data-perch-phase='closed'] > .perch-collapse__clip { opacity: 0; }
`;
