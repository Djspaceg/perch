/**
 * Choosing a cloud background: a browser of Thermalright's catalogue, behind the media element's
 * background row and the Add menu's Background (docs/backgrounds.md).
 *
 * One tab per category, the same `TabStrip` the token panes use. Under it a grid of thumbnails whose
 * cells take the layout's own aspect ratio (`aspect-ratio: W / H`), so a 1920x400 panel's backgrounds
 * are shown as the strips they will be, and each thumbnail covers its cell as the video will cover
 * the element. A thumbnail is asked for only once its cell scrolls into view, since asking is a
 * download on a cold cache, and a grid of 82 is mostly off screen.
 *
 * The grid is a listbox of options named "Gallery 42", with one tab stop: arrows move by one and by
 * a row, Home and End to the ends, Enter or a click picks. A pick downloads first and says so on its
 * cell; only once the host has it cached is the reference handed over, so the document never holds a
 * background this machine could not show. A failure stays on screen, saying why, and sets nothing.
 */

import {
  BACKGROUND_CATEGORIES,
  backgroundIds,
  backgroundLabel,
  categoryOf,
  type BackgroundCategory,
} from '@perch/backgrounds';
import { backgroundRef, parseBackgroundRef } from '@perch/layout-schema';
import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { TabStrip, usePopover } from './controls/index.js';
import {
  BackgroundContext,
  NO_BACKGROUND_CACHE,
  type BackgroundHost,
  type Thumbnail,
} from './background-host.js';

interface Target {
  readonly width: number;
  readonly height: number;
}

/** About how many square pixels a cell gets, whatever its shape, and the grid's inner width. */
const CELL_AREA = 20_000;
const GRID_WIDTH = 680;
const MAX_COLUMNS = 8;

/** How many columns the grid has, so that a cell of the target's shape is about `CELL_AREA`. */
export function columnsFor(target: Target): number {
  const cellWidth = Math.sqrt(CELL_AREA * (target.width / target.height));
  return Math.min(MAX_COLUMNS, Math.max(1, Math.round(GRID_WIDTH / cellWidth)));
}

/** A cell's thumbnail, and whether a pick of it is under way or failed. */
type CellState = Thumbnail | { readonly status: 'loading' };

export function BackgroundBrowser({
  host,
  target,
  current,
  onPicked,
}: {
  readonly host: BackgroundHost;
  readonly target: Target;
  /** The element's `src` now: a reference is marked selected and opens its category. */
  readonly current: string;
  /** A background is cached: set it. */
  readonly onPicked: (ref: string) => void;
}): ReactNode {
  const currentId = parseBackgroundRef(current)?.id;
  const firstCategory = BACKGROUND_CATEGORIES[0];
  const [category, setCategory] = useState<string>(
    (currentId === undefined ? undefined : categoryOf(currentId)?.prefix) ??
      firstCategory?.prefix ??
      'a',
  );
  const shown: BackgroundCategory | undefined = BACKGROUND_CATEGORIES.find(
    (entry) => entry.prefix === category,
  );
  const ids = shown === undefined ? [] : backgroundIds(shown);
  const columns = columnsFor(target);
  const idBase = useId();

  const [thumbnails, setThumbnails] = useState<ReadonlyMap<string, CellState>>(() => new Map());
  const asked = useRef(new Set<string>());
  const [visible, setVisible] = useState<ReadonlySet<string>>(() => new Set());
  const [picking, setPicking] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ readonly id: string; readonly reason: string } | null>(
    null,
  );
  const [focusIndex, setFocusIndex] = useState(() =>
    Math.max(0, currentId === undefined ? 0 : ids.indexOf(currentId)),
  );
  const grid = useRef<HTMLDivElement>(null);

  // Which cells are on screen. Feature-tested: without an observer every cell counts as visible.
  useEffect(() => {
    const box = grid.current;
    if (box === null) return undefined;
    const cells = [...box.querySelectorAll<HTMLElement>('[data-background-id]')];
    const idOf = (element: Element): string => element.getAttribute('data-background-id') ?? '';
    if (typeof IntersectionObserver !== 'function') {
      setVisible(new Set(cells.map(idOf)));
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => idOf(entry.target));
        if (seen.length > 0) setVisible((before) => new Set([...before, ...seen]));
      },
      { root: box, rootMargin: '120px 0px' },
    );
    for (const cell of cells) observer.observe(cell);
    return () => {
      observer.disconnect();
    };
  }, [category]);

  // A thumbnail for each visible cell, asked for once while the browser is open.
  useEffect(() => {
    for (const id of visible) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      host.preview(backgroundRef(id), target).then(
        (thumbnail) => {
          setThumbnails((before) => new Map(before).set(id, thumbnail));
        },
        (error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          setThumbnails((before) => new Map(before).set(id, { status: 'failed', reason }));
        },
      );
    }
  }, [visible, host, target]);

  const pick = (id: string): void => {
    if (picking !== null) return;
    setPicking(id);
    setFailure(null);
    host.ensure(backgroundRef(id), target).then(
      (source) => {
        setPicking(null);
        if (source.status === 'ready') onPicked(backgroundRef(id));
        else
          setFailure({ id, reason: source.status === 'failed' ? source.reason : 'still loading' });
      },
      (error: unknown) => {
        setPicking(null);
        setFailure({ id, reason: error instanceof Error ? error.message : String(error) });
      },
    );
  };

  const moveTo = (index: number): void => {
    const next = Math.min(ids.length - 1, Math.max(0, index));
    setFocusIndex(next);
    grid.current?.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus();
  };

  const onKey = (event: KeyboardEvent<HTMLElement>, index: number, id: string): void => {
    const moves: Readonly<Record<string, number>> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      ArrowDown: index + columns,
      ArrowUp: index - columns,
      Home: 0,
      End: ids.length - 1,
    };
    const to = moves[event.key];
    if (to !== undefined) {
      event.preventDefault();
      moveTo(to);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(id);
    }
  };

  const busyLabel = picking === null ? null : backgroundLabel(picking);
  const failedLabel = failure === null ? null : backgroundLabel(failure.id);

  return (
    <div className="perch-backgrounds">
      <TabStrip
        label="background categories"
        idBase={idBase}
        tabs={BACKGROUND_CATEGORIES.map((entry) => ({
          id: entry.prefix,
          label: entry.name,
          title: `${entry.name}: ${String(entry.count)} backgrounds`,
        }))}
        selected={category}
        onSelect={(prefix) => {
          setCategory(prefix);
          setFocusIndex(0);
        }}
      />
      <div
        ref={grid}
        id={`${idBase}-panel`}
        role="listbox"
        aria-label={`${shown?.name ?? ''} backgrounds`}
        className="perch-backgrounds__grid"
        style={{ gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))` }}
      >
        {ids.map((id, index) => {
          const label = backgroundLabel(id) ?? id;
          const thumbnail = thumbnails.get(id);
          const state =
            picking === id
              ? 'picking'
              : failure?.id === id
                ? 'failed'
                : (thumbnail?.status ?? 'idle');
          return (
            <div
              key={id}
              role="option"
              data-background-id={id}
              data-state={state}
              aria-label={label}
              aria-selected={id === currentId}
              {...(picking === id ? { 'aria-busy': true } : {})}
              tabIndex={index === Math.min(focusIndex, ids.length - 1) ? 0 : -1}
              className="perch-backgrounds__cell"
              style={{ aspectRatio: `${String(target.width)} / ${String(target.height)}` }}
              onClick={() => {
                setFocusIndex(index);
                pick(id);
              }}
              onKeyDown={(event) => {
                onKey(event, index, id);
              }}
            >
              <CellThumbnail thumbnail={thumbnail} />
              <span className="perch-backgrounds__number" aria-hidden="true">
                {String(Number(id.slice(1)))}
              </span>
              {picking === id ? (
                <span className="perch-backgrounds__spinner" aria-hidden="true" />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="perch-backgrounds__foot">
        {busyLabel !== null ? (
          <p role="status" className="perch-backgrounds__note">{`downloading ${busyLabel}...`}</p>
        ) : null}
        {failure !== null ? (
          <p role="alert" className="perch-backgrounds__note perch-backgrounds__note--error">
            {`could not download ${failedLabel ?? failure.id}: ${failure.reason}`}
          </p>
        ) : null}
        {busyLabel === null && failure === null ? (
          <p className="perch-backgrounds__note">
            {`Thermalright's backgrounds, fetched and cached on this machine when picked. Cells are shaped like this ${String(target.width)}x${String(target.height)} canvas.`}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A thumbnail covering its cell: the image, or the video's first frame, nothing yet, or a word saying
 * there is none. Thermalright hosts each item at some sizes only, so on a given panel some cells have
 * nothing to show, and the cell says so rather than looking like one still loading.
 */
function CellThumbnail({ thumbnail }: { readonly thumbnail: CellState | undefined }): ReactNode {
  if (thumbnail?.status === 'failed') {
    return (
      <span className="perch-backgrounds__none" data-perch-tip={thumbnail.reason}>
        {thumbnail.reason.startsWith('not hosted') ? 'not at this size' : 'no preview'}
      </span>
    );
  }
  if (thumbnail?.status !== 'ready') return null;
  if (thumbnail.kind === 'image') {
    return <img className="perch-backgrounds__thumb" src={thumbnail.url} alt="" decoding="async" />;
  }
  // `#t=0.1`: a media fragment, so Chromium decodes and shows a frame rather than a blank box.
  return (
    <video
      className="perch-backgrounds__thumb"
      src={`${thumbnail.url}#t=0.1`}
      preload="metadata"
      muted
      playsInline
      aria-hidden="true"
    />
  );
}

/**
 * The media element's background row: the current background's name and a button opening the
 * browser. The host and the canvas come from `BackgroundContext`; with no host the button is off and
 * says why, since a pick could not be fetched.
 */
export function BackgroundField({
  value,
  onValue,
}: {
  readonly value: string;
  readonly onValue: (value: string) => void;
}): ReactNode {
  const { host, target } = useContext(BackgroundContext);
  const anchor = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const popover = usePopover(anchor, box);
  const id = parseBackgroundRef(value)?.id;
  const shown = id === undefined ? 'none' : (backgroundLabel(id) ?? id);

  return (
    <span className="perch-background-field">
      <button
        ref={anchor}
        type="button"
        className="perch-background-field__button"
        aria-label={`choose a background, now ${shown}`}
        data-perch-tip={host === undefined ? NO_BACKGROUND_CACHE : 'choose a cloud background'}
        disabled={host === undefined}
        aria-expanded={popover.open}
        aria-haspopup="dialog"
        {...(popover.open ? { 'aria-controls': popover.id } : {})}
        onClick={() => {
          popover.setOpen(!popover.open);
        }}
      >
        <span className="perch-background-field__name">{shown}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {popover.open && host !== undefined ? (
        <div
          ref={box}
          id={popover.id}
          className="perch-popover perch-popover--backgrounds"
          role="dialog"
          aria-label="choose a background"
          style={popover.style}
        >
          <BackgroundBrowser
            host={host}
            target={target}
            current={value}
            onPicked={(ref) => {
              onValue(ref);
              popover.close(true);
            }}
          />
        </div>
      ) : null}
    </span>
  );
}

export const BACKGROUND_PICKER_STYLES = `
.perch-background-field { flex: 1 1 auto; display: flex; min-width: 0; }
.perch-background-field__button {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  height: var(--ed-field-h);
  box-sizing: border-box;
  border: 1px solid var(--ed-field-edge);
  border-radius: var(--ed-radius);
  background: var(--ed-bar);
  color: var(--ed-text);
  font: inherit;
  font-size: var(--ed-font);
  padding: 0 6px;
  cursor: pointer;
}
.perch-background-field__button:disabled { color: var(--ed-faint); cursor: not-allowed; }
.perch-background-field__button:hover:not(:disabled) { border-color: var(--ed-field-edge-hover); }
.perch-background-field__button[aria-expanded='true'] { border-color: var(--ed-accent); }
.perch-background-field__button:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 0; }
.perch-background-field__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.perch-popover--backgrounds {
  width: min(720px, calc(100vw - 16px));
  max-height: calc(100vh - 8px);
  box-sizing: border-box;
  padding: 0 0 6px;
  gap: 0;
}
.perch-backgrounds { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
.perch-backgrounds__grid {
  display: grid;
  gap: 6px;
  align-content: start;
  max-height: min(60vh, 520px);
  overflow-y: auto;
  padding: 8px;
}
.perch-backgrounds__cell {
  position: relative;
  overflow: hidden;
  border-radius: var(--ed-radius);
  background: var(--ed-popover);
  outline: 1px solid var(--ed-bar-edge);
  cursor: pointer;
}
.perch-backgrounds__cell:hover { outline-color: var(--ed-field-edge-hover); }
.perch-backgrounds__cell:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 1px; }
.perch-backgrounds__cell[aria-selected='true'] { outline: 2px solid var(--ed-success); outline-offset: 1px; }
.perch-backgrounds__cell[data-state='failed'] { outline: 1px dashed var(--ed-danger); }
.perch-backgrounds__thumb { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center; }
.perch-backgrounds__number {
  position: absolute;
  left: 3px;
  bottom: 2px;
  padding: 0 4px;
  border-radius: 2px;
  background: var(--ed-scrim);
  color: var(--ed-text-2);
  font-size: var(--ed-font-small);
  font-variant-numeric: tabular-nums;
}
.perch-backgrounds__spinner {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 16px;
  height: 16px;
  margin: -8px 0 0 -8px;
  border: 2px solid color-mix(in srgb, var(--ed-text) 30%, transparent);
  border-top-color: var(--ed-text);
  border-radius: 50%;
  animation: perch-backgrounds-spin 0.8s linear infinite;
}
@keyframes perch-backgrounds-spin { to { transform: rotate(360deg); } }
.perch-backgrounds__none {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--ed-font-small);
  color: var(--ed-faint);
}
.perch-backgrounds__foot { padding: 0 8px; }
.perch-backgrounds__note { margin: 0; font-size: var(--ed-font-small); color: var(--ed-quiet); }
.perch-backgrounds__note--error { color: var(--ed-danger); }
`;
