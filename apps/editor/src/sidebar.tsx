/**
 * The sidebar's width, and whether it is showing at all.
 *
 * ```text
 * 300px  min      labels and controls shrink; nothing wraps
 * 420px  default  the middle of the range, where the chrome was designed
 * 540px  max      the label column stops growing at 180px; the rest goes to the values
 * 14px   folded   a handle on the window's right edge, which brings it back at the width it had
 * ```
 *
 * The width is the author's (`settings.panels.sidebar`, persisted). What the sidebar actually takes is
 * that width given way to the window, so the work area keeps `MIN_WORK_AREA`: `sidebarLayout` works
 * it out, and the preview is sized from the same number (`preview-viewport.ts`), so the canvas scale
 * always matches the box it is drawn in.
 *
 * ## Moving it
 *
 * The handle on the sidebar's inner edge is a window splitter (WAI-ARIA's `separator` with a value):
 * drag it, or focus it and use the arrows (10px, Shift for 50), Home for the narrowest, End for the
 * widest, Enter to fold. A double-click puts it back at 420. Dragged well past the minimum — below
 * `SNAP_BELOW` — it shows at its narrowest, faded, and folds when let go; a fold keeps the width it
 * had, so unfolding restores it.
 *
 * ## Folding on its own
 *
 * Below `AUTO_COLLAPSE_BELOW` (the minimum sidebar plus the minimum work area) the window cannot hold
 * both, so the sidebar folds without the author's setting changing. The handle opens it anyway, at
 * the narrowest it goes, for as long as the window stays that narrow; once the window is wide enough
 * again the setting is what counts.
 *
 * Nothing animates: the preview's scale is computed from the width, and a width that eased over
 * 180ms would be a canvas drawn at the wrong scale for 180ms.
 */

import { useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';

export const SIDEBAR_MIN_WIDTH = 300;
export const SIDEBAR_DEFAULT_WIDTH = 420;
export const SIDEBAR_MAX_WIDTH = 540;

/** What the folded sidebar leaves on the right edge: the handle that brings it back. */
export const SIDEBAR_HANDLE_WIDTH = 14;

/**
 * The narrowest the work area gets before the sidebar gives way: the preview's padding plus room for
 * a 1920x400 panel to show at 15%, and for the header's pinned items.
 */
export const MIN_WORK_AREA = 320;

/** A window narrower than this folds the sidebar on its own. */
export const SIDEBAR_AUTO_COLLAPSE_BELOW = SIDEBAR_MIN_WIDTH + MIN_WORK_AREA;

/** A drag that would make the sidebar narrower than this folds it instead. */
export const SNAP_BELOW = SIDEBAR_MIN_WIDTH * 0.75;

/** An arrow key's nudge, and Shift's. */
const STEP = 10;
const BIG_STEP = 50;

export interface SidebarSettings {
  /** The width the author chose, within the range. Kept while folded. */
  readonly width: number;
  readonly collapsed: boolean;
}

export const DEFAULT_SIDEBAR: SidebarSettings = Object.freeze({
  width: SIDEBAR_DEFAULT_WIDTH,
  collapsed: false,
});

/** What the sidebar takes in this window. */
export interface SidebarLayout {
  readonly collapsed: boolean;
  /** Folded by the window's width rather than by the author. */
  readonly auto: boolean;
  /** The sidebar's width when showing: the author's, given way to the window. */
  readonly width: number;
  /** What it takes from the window: its width, or the handle's. */
  readonly occupies: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** A width within the sidebar's own range, in whole pixels. */
export function clampSidebarWidth(width: number): number {
  return Math.round(clamp(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));
}

export function sidebarLayout(inputs: {
  readonly windowWidth: number;
  readonly width: number;
  readonly collapsed: boolean;
  /** The author opened it while the window was too narrow for it. */
  readonly openedNarrow: boolean;
}): SidebarLayout {
  const { windowWidth, width, collapsed, openedNarrow } = inputs;
  const auto = !collapsed && !openedNarrow && windowWidth < SIDEBAR_AUTO_COLLAPSE_BELOW;
  if (collapsed || auto) {
    return { collapsed: true, auto, width, occupies: SIDEBAR_HANDLE_WIDTH };
  }
  const room = Math.max(SIDEBAR_MIN_WIDTH, windowWidth - MIN_WORK_AREA);
  const shown = Math.round(clamp(width, SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, room)));

  return { collapsed: false, auto: false, width: shown, occupies: shown };
}

/**
 * The sidebar while its edge is dragged from `startX` to `x`, starting `startWidth` wide. It is on the
 * right, so the pointer moving left widens it. Folded, it keeps `startWidth` to come back at.
 */
export function dragSidebar(
  startWidth: number,
  startX: number,
  x: number,
): { readonly width: number; readonly collapsed: boolean } {
  const wanted = startWidth + (startX - x);
  if (wanted < SNAP_BELOW) return { width: startWidth, collapsed: true };

  return { width: clampSidebarWidth(wanted), collapsed: false };
}

/** The width a key on the focused splitter asks for, or `null` for a key it does not use. */
export function nudgeSidebar(key: string, shift: boolean, width: number): number | null {
  const step = shift ? BIG_STEP : STEP;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      return clampSidebarWidth(width + step);
    case 'ArrowRight':
    case 'ArrowDown':
      return clampSidebarWidth(width - step);
    case 'Home':
      return SIDEBAR_MIN_WIDTH;
    case 'End':
      return SIDEBAR_MAX_WIDTH;
    default:
      return null;
  }
}

/** The handle on the sidebar's inner edge. */
export function SidebarSplitter({
  sideId,
  width,
  splitterRef,
  onDrag,
  onWidth,
  onCollapse,
}: {
  /** The sidebar's id, which the splitter controls. */
  readonly sideId: string;
  /** The width the sidebar is showing at. */
  readonly width: number;
  readonly splitterRef: RefObject<HTMLDivElement | null>;
  /** The sidebar as a drag has it, or `null` once the drag is over. */
  readonly onDrag: (drag: { readonly width: number; readonly collapsed: boolean } | null) => void;
  /** A width to keep. */
  readonly onWidth: (width: number) => void;
  readonly onCollapse: () => void;
}): ReactNode {
  const drag = useRef<{ readonly id: number; readonly x: number; readonly width: number } | null>(
    null,
  );

  const finish = (target: HTMLElement, x: number): void => {
    const start = drag.current;
    if (start === null) return;
    drag.current = null;
    document.body.classList.remove('perch-resizing');
    // Feature-tested: jsdom has no pointer capture.
    if ('hasPointerCapture' in target && target.hasPointerCapture(start.id)) {
      target.releasePointerCapture(start.id);
    }
    const end = dragSidebar(start.width, start.x, x);
    onDrag(null);
    if (end.collapsed) onCollapse();
    else onWidth(end.width);
  };

  return (
    <div
      ref={splitterRef}
      className="perch-sidebar-splitter"
      role="separator"
      aria-label="sidebar width"
      aria-orientation="vertical"
      aria-controls={sideId}
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuetext={`${String(width)} pixels`}
      data-perch-tip="Drag to resize the sidebar. Double-click for its default width."
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { id: event.pointerId, x: event.clientX, width };
        if ('setPointerCapture' in event.currentTarget) {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        document.body.classList.add('perch-resizing');
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start === null) return;
        onDrag(dragSidebar(start.width, start.x, event.clientX));
      }}
      onPointerUp={(event) => {
        finish(event.currentTarget, event.clientX);
      }}
      onPointerCancel={() => {
        drag.current = null;
        document.body.classList.remove('perch-resizing');
        onDrag(null);
      }}
      onDoubleClick={() => {
        onWidth(SIDEBAR_DEFAULT_WIDTH);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onCollapse();
          return;
        }
        const next = nudgeSidebar(event.key, event.shiftKey, width);
        if (next === null) return;
        event.preventDefault();
        onWidth(next);
      }}
    />
  );
}

/** The folded sidebar: a strip on the window's right edge that brings it back. */
export function SidebarHandle({
  sideId,
  handleRef,
  onOpen,
  hint,
}: {
  readonly sideId: string;
  readonly handleRef: RefObject<HTMLButtonElement | null>;
  readonly onOpen: () => void;
  /** The shortcut, for the tooltip. */
  readonly hint: string;
}): ReactNode {
  return (
    <button
      ref={handleRef}
      type="button"
      className="perch-sidebar-handle"
      data-testid="perch-editor-sidebar-handle"
      aria-label="show sidebar"
      aria-expanded={false}
      aria-controls={sideId}
      data-perch-tip={hint}
      onClick={onOpen}
    >
      <span className="perch-sidebar-handle__glyph" aria-hidden="true" />
    </button>
  );
}

/** The sidebar's own inline size, from the layout. */
export function sidebarStyle(layout: SidebarLayout): CSSProperties {
  return { width: `${String(layout.width)}px` };
}

export const SIDEBAR_STYLES = `
.perch-sidebar-splitter {
  position: absolute;
  z-index: 2;
  top: 0;
  bottom: 0;
  left: calc(var(--ed-hit) / -2);
  width: var(--ed-hit);
  cursor: col-resize;
  touch-action: none;
}
.perch-sidebar-splitter::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--ed-hit) / 2 - 1px);
  width: 2px;
  background: transparent;
}
.perch-sidebar-splitter:hover::after, body.perch-resizing .perch-sidebar-splitter::after {
  background: var(--ed-accent);
}
.perch-sidebar-splitter:focus { outline: none; }
.perch-sidebar-splitter:focus-visible::after { background: var(--ed-focus-ring); }
/* Let go here and it folds. */
.perch-editor-side[data-perch-snapping='true'] > :not(.perch-sidebar-splitter) { opacity: 0.4; }
body.perch-resizing, body.perch-resizing * { cursor: col-resize !important; user-select: none !important; }
.perch-sidebar-handle {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: ${String(SIDEBAR_HANDLE_WIDTH)}px;
  padding: 0;
  border: 0;
  border-left: 1px solid var(--ed-toolbar-edge);
  background: var(--ed-bg);
  color: var(--ed-quiet);
  cursor: pointer;
}
/* Under a coarse pointer the handle reaches 24px into the work area, so it is a whole target without
   taking more of the window than the preview's arithmetic gives it. */
.perch-sidebar-handle::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  right: 100%;
  width: max(0px, calc(var(--ed-target) - ${String(SIDEBAR_HANDLE_WIDTH)}px));
}
.perch-sidebar-handle:hover { background: var(--ed-hover); color: var(--ed-text); }
.perch-sidebar-handle:focus-visible { outline: 2px solid var(--ed-focus-ring); outline-offset: -2px; }
/* A chevron pointing in, at the height of a row, where the sidebar will come from. */
.perch-sidebar-handle__glyph {
  width: 5px;
  height: 5px;
  border-left: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: translateX(1px) rotate(45deg);
}
`;
