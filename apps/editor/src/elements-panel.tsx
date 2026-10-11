/**
 * The Elements panel's own parts, after Photoshop's Layers palette: a glyph or thumbnail per row, the
 * kind filter and the selected element's opacity across its top, and its options menu.
 *
 * - **Glyph or thumbnail.** Each row shows its kind before its name: T for text, a chart line for a
 *   chart, a gauge for a reading, and for media its own picture when it is an image the editor can
 *   already fetch (the URL the canvas paints it from, so nothing extra is loaded but a small copy of
 *   what is on screen), else a picture glyph — a video's poster would mean loading the video. A
 *   picture that fails to load falls back to the glyph. The options menu turns thumbnails off.
 * - **Kind filter.** Text, Media, Chart and Reading, as toggles after a "Kind" label: pressed ones are
 *   the only kinds the list shows. It hides rows and nothing else — the layout, the canvas and the
 *   selection are untouched — and the background row always stays. It is the editor's state for
 *   this sitting, not the document's and not a setting: a list that comes back filtered after a
 *   relaunch would read as a list with elements missing.
 * - **Opacity.** The selected element's own opacity (the background's, with it selected), in the
 *   same scrubbing number field and through the same edit as the Opacity row of its Appearance
 *   panel. With nothing selected there is nothing to set, and the field says so.
 * - **Options.** A three-line menu button in the panel's bar: Show thumbnails, Clear kind filter, and
 *   Reset panel order, which puts Global's and Selected entity's panels back in their default order.
 *
 * Every word here says "element", never "layer".
 */

import type { LayoutElement } from '@perch/layout-schema';
import { useRef, useState, type ReactNode } from 'react';
import { NumberField, usePopover } from './controls/index.js';
import { useEditorStore } from './store.js';

/** The kinds the filter knows, by what an author calls them. A widget is a live reading. */
export type FilterKind = 'text' | 'media' | 'chart' | 'reading';

export const FILTER_KINDS: readonly { readonly kind: FilterKind; readonly label: string }[] =
  Object.freeze([
    { kind: 'text', label: 'Text' },
    { kind: 'media', label: 'Media' },
    { kind: 'chart', label: 'Chart' },
    { kind: 'reading', label: 'Reading' },
  ]);

/** The filter kind an element is. */
export function filterKind(element: LayoutElement): FilterKind {
  return element.kind === 'widget' ? 'reading' : element.kind;
}

/** Whether the filter `kinds` shows `element`: an empty filter shows everything. */
export function passesFilter(element: LayoutElement, kinds: ReadonlySet<FilterKind>): boolean {
  return kinds.size === 0 || kinds.has(filterKind(element));
}

/** A kind's glyph, 12px, in the row's own colour. */
export function KindGlyph({ kind }: { readonly kind: FilterKind }): ReactNode {
  const common = {
    width: 12,
    height: 12,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };
  switch (kind) {
    case 'text':
      return (
        <svg {...common} data-perch-glyph="text">
          <path d="M3 3.5h10M8 3.5V13" />
        </svg>
      );
    case 'chart':
      return (
        <svg {...common} data-perch-glyph="chart">
          <path d="M2 12.5l3.5-4 3 2.5L14 4" />
        </svg>
      );
    case 'reading':
      return (
        <svg {...common} data-perch-glyph="gauge">
          <path d="M2.5 11.5a5.5 5.5 0 1 1 11 0" />
          <path d="M8 11.5l2.75-3.5" />
        </svg>
      );
    case 'media':
      return (
        <svg {...common} data-perch-glyph="media">
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="M2.5 11.5l3.5-3.5 3 3 2-2 2.5 2.5" />
        </svg>
      );
  }
}

/** Files a thumbnail `<img>` can show as they are. A video's first frame would mean loading the video. */
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp)$/i;

/**
 * The thumbnail slot at the start of a row: an image's own picture, or the kind's glyph. Always the
 * same box, two thirds of the row, so a row never moves when a picture arrives or fails.
 */
export function RowThumb({
  kind,
  src,
  resolveAsset,
}: {
  readonly kind: FilterKind;
  /** A media element's (or the background's) `src`, for its picture. */
  readonly src?: string | undefined;
  readonly resolveAsset?: ((src: string) => string | undefined) | undefined;
}): ReactNode {
  const thumbnails = useEditorStore((state) => state.settings.panels.thumbnails);
  const url =
    thumbnails && src !== undefined && IMAGE_FILE.test(src) ? resolveAsset?.(src) : undefined;
  const [failed, setFailed] = useState<string | null>(null);
  const picture = url !== undefined && failed !== url;

  return (
    <span className="perch-editor-element__thumb" data-perch-kind-glyph={kind} aria-hidden="true">
      {picture ? (
        <img
          className="perch-editor-thumb"
          src={url}
          alt=""
          width={16}
          height={16}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => {
            setFailed(url);
          }}
        />
      ) : (
        <KindGlyph kind={kind} />
      )}
    </span>
  );
}

/** The kind filter: a "Kind" label, a toggle per kind, and a clear while any is on. */
export function KindFilter({
  kinds,
  onKinds,
}: {
  readonly kinds: ReadonlySet<FilterKind>;
  readonly onKinds: (kinds: ReadonlySet<FilterKind>) => void;
}): ReactNode {
  return (
    <div className="perch-kind-filter" role="group" aria-label="filter elements by kind">
      <span className="perch-kind-filter__label" aria-hidden="true">
        Kind
      </span>
      {FILTER_KINDS.map(({ kind, label }) => (
        <button
          key={kind}
          type="button"
          className="perch-kind-filter__toggle"
          aria-label={label}
          aria-pressed={kinds.has(kind)}
          data-perch-tip={
            kinds.has(kind)
              ? `showing ${label.toLowerCase()} elements: press to stop`
              : `show only ${label.toLowerCase()} elements`
          }
          onClick={() => {
            const next = new Set(kinds);
            if (next.has(kind)) next.delete(kind);
            else next.add(kind);
            onKinds(next);
          }}
        >
          <KindGlyph kind={kind} />
        </button>
      ))}
      {kinds.size === 0 ? null : (
        <button
          type="button"
          className="perch-kind-filter__clear"
          aria-label="Clear the kind filter"
          data-perch-tip="show every element again"
          onClick={() => {
            onKinds(new Set());
          }}
        >
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </div>
  );
}

/** An opacity as the percentage a field shows: `0.55` is `55`. */
export function opacityPercent(opacity: number | undefined): string {
  if (opacity === undefined) return '100';

  return Number.isNaN(opacity) ? '' : String(Math.round(opacity * 10_000) / 100);
}

/**
 * The selected element's opacity at the top of the panel. `onText` takes the field's text, so
 * typing goes through the same edit, and the same validation, as the Appearance row.
 */
export function ElementsOpacity({
  opacity,
  selected,
  onText,
}: {
  readonly opacity: number | undefined;
  /** Whether anything is selected that has an opacity to set. */
  readonly selected: boolean;
  readonly onText: (text: string) => void;
}): ReactNode {
  if (!selected) {
    return (
      <span
        className="perch-elements-opacity perch-elements-opacity--off"
        aria-disabled="true"
        data-perch-tip="select an element to set its opacity here"
      >
        <span className="perch-elements-opacity__word">Opacity</span>
        <span className="perch-elements-opacity__none" aria-hidden="true">
          –
        </span>
      </span>
    );
  }

  return (
    <span className="perch-elements-opacity">
      <NumberField
        label="Opacity"
        ariaLabel="Opacity of the selected element"
        value={opacityPercent(opacity)}
        onChange={onText}
        min={0}
        max={100}
        step={1}
        unit="%"
        bar
        testId="perch-editor-elements-opacity"
      />
    </span>
  );
}

/** The panel options menu: three lines in the Elements bar. */
export function ElementsOptions({
  filtered,
  onClearFilter,
}: {
  readonly filtered: boolean;
  readonly onClearFilter: () => void;
}): ReactNode {
  const anchor = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const popover = usePopover(anchor, box);
  const thumbnails = useEditorStore((state) => state.settings.panels.thumbnails);
  const setThumbnails = useEditorStore((state) => state.setThumbnails);
  const ordered = useEditorStore((state) => Object.keys(state.settings.panels.order).length > 0);
  const setPanelOrder = useEditorStore((state) => state.setPanelOrder);
  const name = 'Elements panel options';

  const item = (
    label: string,
    run: () => void,
    options: { readonly disabled?: boolean; readonly checked?: boolean; readonly tip: string },
  ): ReactNode => (
    <button
      type="button"
      role={options.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      className="perch-menu__item"
      {...(options.checked === undefined ? {} : { 'aria-checked': options.checked })}
      {...(options.disabled === true ? { 'aria-disabled': 'true' as const } : {})}
      data-perch-tip={options.tip}
      onClick={() => {
        if (options.disabled === true) return;
        run();
        popover.close(true);
      }}
    >
      <span className="perch-menu__check" aria-hidden="true">
        {options.checked === true ? '✓' : ''}
      </span>
      {label}
    </button>
  );

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="perch-panel-options"
        aria-label={name}
        data-perch-tip={name}
        aria-haspopup="menu"
        aria-expanded={popover.open}
        {...(popover.open ? { 'aria-controls': popover.id } : {})}
        onClick={() => {
          popover.setOpen(!popover.open);
        }}
      >
        <svg
          data-perch-glyph="menu"
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
        </svg>
      </button>
      {popover.open ? (
        <div
          ref={box}
          id={popover.id}
          className="perch-popover perch-popover--menu perch-menu"
          role="menu"
          aria-label={name}
          style={popover.style}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            const items = [
              ...(box.current?.querySelectorAll<HTMLElement>('.perch-menu__item') ?? []),
            ];
            const at = items.indexOf(document.activeElement as HTMLElement);
            const next = (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            event.preventDefault();
            items[next]?.focus();
          }}
        >
          {item(
            'Show thumbnails',
            () => {
              setThumbnails(!thumbnails);
            },
            {
              checked: thumbnails,
              tip: "an image element's own picture before its name, rather than its glyph",
            },
          )}
          {item('Clear kind filter', onClearFilter, {
            disabled: !filtered,
            tip: filtered ? 'show every element again' : 'no kind filter is on',
          })}
          {item(
            'Reset panel order',
            () => {
              setPanelOrder('global', undefined);
              setPanelOrder('entity', undefined);
            },
            {
              disabled: !ordered,
              tip: ordered
                ? "put Global's and Selected entity's panels back in their default order"
                : 'the panels are in their default order',
            },
          )}
        </div>
      ) : null}
    </>
  );
}

export const ELEMENTS_PANEL_STYLES = `
.perch-elements-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 2px 4px 3px var(--ed-pad-x);
  border-bottom: 1px solid var(--ed-bar-edge);
}
.perch-kind-filter { display: flex; align-items: center; gap: 1px; min-width: 0; }
.perch-kind-filter__label { margin-right: 4px; font-size: var(--ed-font-small); color: var(--ed-quiet); }
.perch-kind-filter__toggle, .perch-kind-filter__clear, .perch-panel-options {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--ed-control);
  height: var(--ed-control);
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--ed-radius);
  background: none;
  color: var(--ed-quiet);
  font: inherit;
  font-size: var(--ed-font-small);
  cursor: pointer;
}
.perch-kind-filter__toggle:hover, .perch-kind-filter__clear:hover, .perch-panel-options:hover { background: var(--ed-hover); color: var(--ed-text); }
.perch-kind-filter__toggle[aria-pressed='true'] { border-color: var(--ed-accent-edge); background: var(--ed-accent-fill); color: var(--ed-text); }
.perch-panel-options[aria-expanded='true'] { color: var(--ed-text); border-color: var(--ed-accent); }
.perch-kind-filter__toggle:focus-visible, .perch-kind-filter__clear:focus-visible, .perch-panel-options:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: -2px; }
.perch-elements-opacity { flex: 0 1 96px; display: flex; min-width: 64px; }
.perch-elements-opacity--off { align-items: center; gap: 6px; height: var(--ed-field-h); font-size: var(--ed-font-small); color: var(--ed-faint); }
.perch-menu { width: 200px; padding: 4px; gap: 1px; }
.perch-menu__item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: var(--ed-list-row-h);
  border: 0;
  border-radius: var(--ed-radius);
  background: none;
  color: var(--ed-label);
  font: inherit;
  font-size: var(--ed-font-small);
  text-align: left;
  padding: 2px 8px 2px 4px;
  cursor: pointer;
}
.perch-menu__item:hover:not([aria-disabled='true']), .perch-menu__item:focus-visible { background: var(--ed-accent-fill); color: var(--ed-text); outline: none; }
.perch-menu__item[aria-disabled='true'] { color: var(--ed-faint); cursor: default; }
.perch-menu__check { flex: 0 0 12px; text-align: center; color: var(--ed-accent); }
.perch-editor-element__thumb {
  flex: 0 0 var(--ed-element-thumb);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--ed-element-thumb);
  height: var(--ed-element-thumb);
  overflow: hidden;
  border-radius: 2px;
  color: var(--ed-quiet);
}
.perch-editor-thumb { display: block; width: 100%; height: 100%; object-fit: cover; }
.perch-editor-element__thumb > svg { width: 70%; height: 70%; }
`;
