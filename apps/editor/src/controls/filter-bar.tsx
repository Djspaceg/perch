/**
 * FilterBar: a search box, and optionally one row of category chips with one pressed at a time.
 *
 * The chips are toggle buttons in a named group rather than a radio group: "All" is a chip like the
 * others, and a pressed state reads right for "show me only this". Each chip is as wide as its whole
 * label and never truncates — a device is called `embedded-controller`, and "em..." names nothing —
 * so the strip is one line that scrolls sideways when they do not fit: a wheel or a trackpad scrolls
 * it, focus scrolls a chip into view, and the edge with more chips past it fades out. Escape in the search box clears
 * it; Enter hands the query to `onSubmit`, for a pane where a search picks something. What a query *matches* is `filter.ts`'s; this is only the control, so the pane can apply the
 * same query to its own grouping.
 */

import { useEffect, useRef, type ReactNode } from 'react';

export interface FilterChip {
  readonly id: string;
  readonly label: string;
}

/** Which edges of a sideways-scrolling strip have more past them, and so fade. */
export type ChipFades = 'none' | 'start' | 'end' | 'both';

/** The edges to fade for a strip scrolled `scrollLeft` into `scrollWidth`, showing `clientWidth`. */
export function chipFades(scrollLeft: number, clientWidth: number, scrollWidth: number): ChipFades {
  // A pixel of slack: a zoomed page scrolls to fractions, and never quite reaches either end.
  const before = scrollLeft > 1;
  const after = scrollLeft + clientWidth < scrollWidth - 1;

  return before ? (after ? 'both' : 'start') : after ? 'end' : 'none';
}

/** Pixels per wheel line, for a wheel that reports lines (Firefox) rather than pixels. */
const WHEEL_LINE_PX = 16;

/**
 * The chips, one line. A vertical wheel over the strip scrolls it sideways while it overflows, since
 * a mouse has no other way to; a sideways gesture (a trackpad) is the browser's own, and a strip with
 * nothing to scroll leaves the wheel to the list behind it. The fades are written straight onto the
 * strip as it scrolls, so a scroll never re-renders the chips.
 */
function ChipStrip({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactNode {
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = strip.current;
    if (element === null) return undefined;
    const fade = (): void => {
      element.dataset['perchFade'] = chipFades(
        element.scrollLeft,
        element.clientWidth,
        element.scrollWidth,
      );
    };
    const wheel = (event: WheelEvent): void => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      if (element.scrollWidth <= element.clientWidth) return;
      event.preventDefault();
      const step = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PX : 1;
      element.scrollLeft += event.deltaY * step;
      fade();
    };
    fade();
    element.addEventListener('scroll', fade, { passive: true });
    // Not passive: a wheel turned into a sideways scroll must not also scroll the list behind.
    element.addEventListener('wheel', wheel, { passive: false });
    // Feature-tested: jsdom has no ResizeObserver.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fade) : undefined;
    observer?.observe(element);

    return () => {
      element.removeEventListener('scroll', fade);
      element.removeEventListener('wheel', wheel);
      observer?.disconnect();
    };
  }, []);

  return (
    <div className="perch-filter__chips" role="group" aria-label={label} ref={strip}>
      {children}
    </div>
  );
}

export function FilterBar({
  label,
  query,
  onQuery,
  chips,
  chip,
  onChip,
  onSubmit,
  chipsLabel = 'filter by sections',
}: {
  /** The search box's accessible name: `search theme tokens`. */
  readonly label?: string | undefined;
  readonly query?: string | undefined;
  /** Absent: no search box, only chips — for a pane that puts its search somewhere else. */
  readonly onQuery?: ((query: string) => void) | undefined;
  readonly chips?: readonly FilterChip[] | undefined;
  readonly chip?: string | undefined;
  readonly onChip?: ((chip: string) => void) | undefined;
  /** Enter in the search box: take the best match. Absent, Enter does nothing. */
  readonly onSubmit?: ((query: string) => void) | undefined;
  /** The chip group's accessible name. */
  readonly chipsLabel?: string | undefined;
}): ReactNode {
  return (
    <>
      {onQuery === undefined ? null : (
        <input
          className="perch-filter__search"
          type="search"
          aria-label={label}
          placeholder="Search"
          autoComplete="off"
          spellCheck={false}
          value={query ?? ''}
          onChange={(event) => {
            onQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query !== '' && query !== undefined) {
              event.preventDefault();
              onQuery('');
            }
            if (event.key === 'Enter' && onSubmit !== undefined) {
              event.preventDefault();
              onSubmit(query ?? '');
            }
          }}
        />
      )}
      {chips === undefined || chips.length === 0 ? null : (
        <ChipStrip label={chipsLabel}>
          {chips.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="perch-filter__chip"
              aria-pressed={entry.id === chip}
              onClick={() => {
                if (entry.id !== chip) onChip?.(entry.id);
              }}
            >
              {entry.label}
            </button>
          ))}
        </ChipStrip>
      )}
    </>
  );
}

export const FILTER_BAR_STYLES = `
.perch-filter__search {
  width: 100%;
  max-width: 180px;
  height: var(--ed-control);
  box-sizing: border-box;
  border: 1px solid var(--ed-field-edge);
  border-radius: 9px;
  background: var(--ed-field) no-repeat 7px 50% / 9px 9px var(--ed-search-icon);
  color: var(--ed-text);
  font: inherit;
  font-size: var(--ed-font-small);
  padding: 0 8px 0 20px;
}
.perch-filter__search:focus { outline: none; border-color: var(--ed-accent); }
.perch-filter__chips {
  display: flex;
  min-width: 0;
  gap: 3px;
  padding: 5px var(--ed-pad-x) 4px;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  --perch-fade: 16px;
}
.perch-filter__chips::-webkit-scrollbar { display: none; }
/* The edge with more chips past it fades out, so a strip cut by the sidebar's edge says so. A mask
   reads only alpha: black is opaque here, in either scheme, not a colour painted. */
.perch-filter__chips[data-perch-fade='end'] { mask-image: linear-gradient(to right, black calc(100% - var(--perch-fade)), transparent); }
.perch-filter__chips[data-perch-fade='start'] { mask-image: linear-gradient(to left, black calc(100% - var(--perch-fade)), transparent); }
.perch-filter__chips[data-perch-fade='both'] { mask-image: linear-gradient(to right, transparent, black var(--perch-fade), black calc(100% - var(--perch-fade)), transparent); }
.perch-filter__chip {
  flex: none;
  white-space: nowrap;
  height: var(--ed-control);
  border: 1px solid var(--ed-field-edge);
  border-radius: var(--ed-radius);
  background: var(--ed-bar);
  color: var(--ed-label);
  font: inherit;
  font-size: var(--ed-font-small);
  padding: 0 8px;
  cursor: pointer;
}
.perch-filter__chip:hover { color: var(--ed-text); }
.perch-filter__chip[aria-pressed='true'] { border-color: var(--ed-accent-edge); background: var(--ed-accent-fill); color: var(--ed-on-accent); }
.perch-filter__chip:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 0; }
`;
