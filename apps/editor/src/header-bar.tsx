/**
 * The header's one line: it never wraps and never clips. Each item says how readily it can go
 * (`drop`, lowest first; `Infinity` never), and what does not fit in the window moves into a "more"
 * popover at the end of the line, in the same order, and comes back as soon as there is room.
 *
 * ```text
 * goes first   the brand, the fit, the source badge, the connection, revert, redo, undo, the picker
 * never        the unsaved mark, Save, and more itself
 * ```
 *
 * Measured, not guessed: each item's width is read while it is in the header and remembered while it
 * is not, and the header is re-measured whenever it or an item changes size (a `ResizeObserver`
 * where there is one, the window's resize where there is not). `fitHeader` is the arithmetic, apart,
 * so it is tested without a layout engine. jsdom lays nothing out, every width is 0, and so in tests
 * everything fits unless a test says otherwise.
 *
 * The popover holds the items themselves, not copies: an item is one React element rendered in one
 * place or the other, so its state is the store's or its own either way. It is also where the browser
 * keeps the colour scheme (`extra`); with nothing to hold, there is no more button.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ChromeScheme } from './controls/chrome.js';
import { SegmentedControl, usePopover } from './controls/index.js';

export interface HeaderItem {
  readonly key: string;
  /** Which goes first when the line is full: lower first. `Infinity` never goes. */
  readonly drop: number;
  /** Starts the right-hand group: the gap before it takes up the slack. */
  readonly end?: boolean;
  readonly node: ReactNode;
}

/** Which items, by key, go into more, in the order they went. */
export function fitHeader(inputs: {
  readonly available: number;
  readonly gap: number;
  readonly items: readonly {
    readonly key: string;
    readonly width: number;
    readonly drop: number;
  }[];
  /** The more button's width. */
  readonly more: number;
  /** More is there whatever fits: it holds something of its own. */
  readonly moreAlways: boolean;
}): string[] {
  const { available, gap, items, more, moreAlways } = inputs;
  const line = (count: number, width: number): number => width + gap * Math.max(0, count - 1);
  let count = items.length + (moreAlways ? 1 : 0);
  let width = items.reduce((sum, item) => sum + item.width, 0) + (moreAlways ? more : 0);
  if (line(count, width) <= available) return [];
  if (!moreAlways) {
    count += 1;
    width += more;
  }
  const dropped: string[] = [];
  const order = [...items]
    .filter((item) => Number.isFinite(item.drop))
    .sort((a, b) => a.drop - b.drop);
  for (const item of order) {
    if (line(count, width) <= available) break;
    dropped.push(item.key);
    count -= 1;
    width -= item.width;
  }

  return dropped;
}

function pixels(text: string, fallback: number): number {
  const value = Number.parseFloat(text);

  return Number.isFinite(value) ? value : fallback;
}

export function HeaderBar({
  items,
  extra,
}: {
  readonly items: readonly HeaderItem[];
  /** What more holds whatever fits, or `null`. */
  readonly extra: ReactNode;
}): ReactNode {
  const header = useRef<HTMLElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const popover = usePopover(anchor, box);
  const widths = useRef(new Map<string, number>());
  const [overflow, setOverflow] = useState<readonly string[]>([]);
  /** Counts the resizes reported, so a resize re-measures. */
  const [tick, setTick] = useState(0);

  // Measure what is showing, remember it, and work out what fits: whenever the items are handed in
  // again (an item that changed its words changed its width) and whenever a resize was reported.
  useLayoutEffect(() => {
    const bar = header.current;
    if (bar === null) return;
    for (const element of bar.querySelectorAll<HTMLElement>('[data-perch-header-item]')) {
      const key = element.dataset['perchHeaderItem'];
      if (key !== undefined) widths.current.set(key, element.offsetWidth);
    }
    const moreElement = bar.querySelector<HTMLElement>('[data-perch-header-more]');
    if (moreElement !== null) widths.current.set('\u0000more', moreElement.offsetWidth);
    // A header with no width is not laid out (jsdom, or a hidden window): nothing to fit into.
    if (bar.clientWidth === 0) {
      setOverflow((current) => (current.length === 0 ? current : []));
      return;
    }
    const style = getComputedStyle(bar);
    const available =
      bar.clientWidth - pixels(style.paddingLeft, 0) - pixels(style.paddingRight, 0);
    const next = fitHeader({
      available,
      gap: pixels(style.columnGap, 10),
      items: items.map((item) => ({
        key: item.key,
        width: widths.current.get(item.key) ?? 0,
        drop: item.drop,
      })),
      more: widths.current.get('\u0000more') ?? 28,
      moreAlways: extra !== null,
    });
    setOverflow((current) => (current.join('\n') === next.join('\n') ? current : next));
  }, [items, extra, tick]);

  // Re-measured when the header or anything in it changes size.
  useLayoutEffect(() => {
    const bar = header.current;
    const again = (): void => {
      setTick((count) => count + 1);
    };
    window.addEventListener('resize', again);
    const observer =
      bar !== null && typeof ResizeObserver === 'function' ? new ResizeObserver(again) : undefined;
    if (bar !== null && observer !== undefined) {
      observer.observe(bar);
      for (const child of bar.children) observer.observe(child);
    }

    return () => {
      window.removeEventListener('resize', again);
      observer?.disconnect();
    };
    // Not on `tick`: an observer reports once as it starts observing, and re-subscribing on each
    // report would never stop. On `overflow`, since the items in the header changed.
  }, [overflow]);

  const moved = new Set(overflow);
  const shown = items.filter((item) => !moved.has(item.key));
  const hidden = overflow
    .map((key) => items.find((item) => item.key === key))
    .filter((item): item is HeaderItem => item !== undefined)
    // In the popover, in the header's own order.
    .sort((a, b) => items.indexOf(a) - items.indexOf(b));
  const hasMore = hidden.length > 0 || extra !== null;
  const firstEnd = shown.find((item) => item.end === true)?.key;

  return (
    <header ref={header} className="perch-editor-header" data-testid="perch-editor-header">
      {shown.map((item) => (
        <span
          key={item.key}
          className={`perch-editor-header__item${item.key === firstEnd ? ' perch-editor-header__item--end' : ''}`}
          data-perch-header-item={item.key}
        >
          {item.node}
        </span>
      ))}
      {hasMore ? (
        <span
          className={`perch-editor-header__item${firstEnd === undefined ? ' perch-editor-header__item--end' : ''}`}
          data-perch-header-more=""
        >
          <button
            ref={anchor}
            type="button"
            className="perch-editor-button perch-editor-more"
            aria-label="more"
            data-perch-tip={hidden.length === 0 ? 'Appearance' : 'More controls, and appearance'}
            aria-expanded={popover.open}
            aria-haspopup="dialog"
            {...(popover.open ? { 'aria-controls': popover.id } : {})}
            onClick={() => {
              if (popover.open) popover.close(false);
              else popover.setOpen(true);
            }}
          >
            <span aria-hidden="true">⋯</span>
          </button>
        </span>
      ) : null}
      {popover.open ? (
        <div
          ref={box}
          id={popover.id}
          className="perch-popover perch-editor-more__box"
          role="dialog"
          aria-label="more"
          style={popover.style}
        >
          {hidden.map((item) => (
            <div key={item.key} className="perch-editor-more__item">
              {item.node}
            </div>
          ))}
          {extra === null ? null : <div className="perch-editor-more__extra">{extra}</div>}
        </div>
      ) : null}
    </header>
  );
}

/** The scheme control's choices, in the order the platforms list them. */
export const SCHEME_OPTIONS: readonly { readonly value: ChromeScheme; readonly label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function isScheme(value: string): value is ChromeScheme {
  return SCHEME_OPTIONS.some((option) => option.value === value);
}

/** System, Light or Dark: the Settings window's and, in a browser, the header's more. */
export function SchemeControl({
  value,
  onValue,
}: {
  readonly value: ChromeScheme;
  readonly onValue: (scheme: ChromeScheme) => void;
}): ReactNode {
  return (
    <SegmentedControl
      label="colour scheme"
      value={value}
      options={SCHEME_OPTIONS}
      onValue={(next) => {
        if (isScheme(next)) onValue(next);
      }}
    />
  );
}

export const HEADER_BAR_STYLES = `
.perch-editor-header__item { flex: none; display: flex; align-items: center; min-width: 0; }
.perch-editor-header__item--end { margin-left: auto; }
/* The connection's status is the one long, changing text in the line: kept short here, whole in its
   tooltip, so the line keeps its other items at ordinary widths. */
.perch-editor-header .perch-connection__status { max-width: 160px; }
.perch-editor-more { min-width: 28px; padding: 3px 6px; line-height: 1; }
.perch-popover.perch-editor-more__box { width: max-content; max-width: min(420px, calc(100vw - 8px)); gap: 8px; color: var(--ed-header-text); font-size: 0.75rem; }
.perch-editor-more__item { display: flex; align-items: center; gap: 6px; min-width: 0; }
.perch-editor-more__item .perch-connection { flex-wrap: wrap; row-gap: 6px; }
.perch-editor-more__extra { display: flex; flex-direction: column; gap: 4px; padding-top: 6px; border-top: 1px solid var(--ed-group-divider); }
.perch-editor-more__extra .perch-segmented { width: 200px; }
.perch-editor-more__label { font-weight: 600; color: var(--ed-text); }
`;
