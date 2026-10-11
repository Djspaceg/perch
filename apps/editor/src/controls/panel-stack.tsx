/**
 * PanelStack: a group's panels, in the order the author dragged them into.
 *
 * Every top-level `Section` given a `panel` key inside a stack gets a grip just before its
 * disclosure triangle, and its whole header becomes a drag source (`usePanelDrag`). A press that
 * stays within the drag threshold is a click, and folds the panel; one that moves past it drags: a faint copy of its
 * header follows the pointer (`useListDrag`'s ghost, at 0.3 opacity), a 2px line in the accent marks
 * the gap it would drop into, and letting go puts it there. With the grip focused, Alt+ArrowUp and
 * Alt+ArrowDown move it one place, and focus stays on its grip. Escape lets go of a drag.
 *
 * A panel moves only among its own group's: Global's among Global's, the selected entity's among the
 * entity's. The order is remembered per group in the editor settings (`settings.panels.order`, beside
 * the sidebar's width), so it survives a relaunch, and the entity's is one order for every element:
 * a panel one element lacks keeps its place for the next that has it (`panel-order.ts`). "Reset
 * panel order", in the Elements panel's options menu (`elements-panel.tsx`), puts both groups'
 * default orders back.
 *
 * Nothing animates: a drop moves the panel at once, so there is nothing for reduced motion to turn
 * off, and the line and the ghost are drawn in chrome tokens, in either scheme.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { applyOrder, mergeOrder, moveKey, panelDropTarget } from '../panel-order.js';
import { useListDrag } from '../row-drag.js';
import { useEditorStore } from '../store.js';
import { CollapseEach, type CollapseEntry } from './collapse.js';

/** The attribute a stacked panel's section carries: its key. */
export const PANEL_ATTRIBUTE = 'data-perch-panel';

interface PanelStackContext {
  readonly begin: (event: ReactPointerEvent, key: string) => void;
  readonly step: (key: string, by: -1 | 1) => void;
  /** Where the drop line is drawn, on which panel, while a drag would move something. */
  readonly mark: (key: string) => 'above' | 'below' | undefined;
  readonly dragging: (key: string) => boolean;
  /** Whether the click a drag's release makes should be ignored; answering clears it. */
  readonly swallowClick: () => boolean;
}

const StackContext = createContext<PanelStackContext | null>(null);

/** The stack of `entries`, each a Section with `panel` set to its key, in the remembered order. */
export function PanelStack({
  group,
  entries,
}: {
  /** The group the order is remembered under: `global`, `entity`. */
  readonly group: string;
  /** The panels shown, in their default order. */
  readonly entries: readonly CollapseEntry[];
}): ReactNode {
  const stored = useEditorStore((state) => state.settings.panels.order[group]);
  const setPanelOrder = useEditorStore((state) => state.setPanelOrder);
  const keys = applyOrder(
    entries.map((entry) => entry.key),
    stored,
  );
  const ordered = keys.flatMap((key) => entries.filter((entry) => entry.key === key));
  const box = useRef<HTMLDivElement>(null);
  /** The grip to put focus back on after a keyboard move, once the panel has moved. */
  const refocus = useRef<string | null>(null);
  const keyText = keys.join('\n');

  const rows = useCallback(
    (): readonly HTMLElement[] =>
      [...(box.current?.querySelectorAll<HTMLElement>(`[${PANEL_ATTRIBUTE}]`) ?? [])].filter(
        // A panel on its way out is inert, and is not a place to drop.
        (row) => row.closest('[inert]') === null,
      ),
    [],
  );
  // The panels shown, in the order drawn: the same order as the present rows `rows()` measures.
  const shown = useMemo(() => (keyText === '' ? [] : keyText.split('\n')), [keyText]);
  const onMove = useCallback(
    (from: number, to: number) => {
      setPanelOrder(group, mergeOrder(stored, moveKey(shown, from, to)));
    },
    [group, stored, setPanelOrder, shown],
  );
  const target = useCallback(
    (from: number, gap: number) => panelDropTarget(from, gap, shown.length),
    [shown],
  );
  const ghost = useCallback(
    (pressed: HTMLElement) => pressed.closest<HTMLElement>('.perch-section__bar'),
    [],
  );
  const { drag, begin, cancel, swallowClick } = useListDrag({
    list: box,
    rows,
    target,
    onMove,
    ghost,
  });

  // A drag measures the panels it began over; any change to them ends it. And after a keyboard
  // move, focus goes back to the grip that was pressed, wherever its panel went.
  useEffect(() => {
    cancel();
    const key = refocus.current;
    refocus.current = null;
    if (key === null) return;
    box.current
      ?.querySelector<HTMLElement>(`[${PANEL_ATTRIBUTE}="${key}"] .perch-panel-grip`)
      ?.focus();
  }, [keyText, cancel]);

  const context = useMemo<PanelStackContext>(() => {
    const dropping =
      drag === null || panelDropTarget(drag.from, drag.gap, shown.length) === null ? null : drag;

    return {
      begin: (event, key) => {
        const from = shown.indexOf(key);
        if (from !== -1) begin(event, from);
      },
      step: (key, by) => {
        const from = shown.indexOf(key);
        const to = from + by;
        if (from === -1 || to < 0 || to >= shown.length) return;
        refocus.current = key;
        setPanelOrder(group, mergeOrder(stored, moveKey(shown, from, to)));
      },
      mark: (key) => {
        if (dropping === null) return undefined;
        const at = shown.indexOf(key);
        if (at === dropping.gap) return 'above';

        return dropping.gap === shown.length && at === shown.length - 1 ? 'below' : undefined;
      },
      dragging: (key) => drag !== null && shown[drag.from] === key,
      swallowClick,
    };
  }, [drag, begin, shown, group, stored, setPanelOrder, swallowClick]);

  return (
    <StackContext.Provider value={context}>
      <div className="perch-panels" ref={box}>
        <CollapseEach entries={ordered} />
      </div>
    </StackContext.Provider>
  );
}

/** What a stacked Section carries on its own element: its key, and the drag's marks on it. */
export function usePanelAttributes(key: string | undefined): Readonly<Record<string, string>> {
  const stack = useContext(StackContext);
  if (stack === null || key === undefined) return {};
  const mark = stack.mark(key);

  return {
    [PANEL_ATTRIBUTE]: key,
    ...(mark === undefined ? {} : { 'data-perch-drop': mark }),
    ...(stack.dragging(key) ? { 'data-perch-dragging': 'true' } : {}),
  };
}

/** The controls in a header that are not the title or the grip: pressing one never drags. */
const OWN_CONTROLS =
  'button:not(.perch-section__toggle):not(.perch-panel-grip), a, input, select, textarea';

/**
 * A stacked Section's header as a drag source: the whole bar, title and summary included, so a
 * press there that moves past the drag threshold drags the panel, and one that does not is still a
 * click that folds it. A control of the header's own (a reset, an action) stays a control.
 * `swallowClick` is for the title's click handler: true for the click a drag's release makes.
 */
export function usePanelDrag(panel: string | undefined): {
  readonly barProps: Readonly<Record<string, unknown>>;
  readonly swallowClick: () => boolean;
} {
  const stack = useContext(StackContext);
  if (stack === null || panel === undefined) return { barProps: {}, swallowClick: () => false };

  return {
    barProps: {
      'data-perch-drag-source': 'true',
      onPointerDown: (event: ReactPointerEvent) => {
        const target = event.target;
        if (target instanceof Element && target.closest(OWN_CONTROLS) !== null) return;
        stack.begin(event, panel);
      },
    },
    swallowClick: stack.swallowClick,
  };
}

/** The grip on a stacked Section's bar, or nothing outside a stack. */
export function PanelGrip({
  panel,
  title,
}: {
  readonly panel: string | undefined;
  readonly title: string;
}): ReactNode {
  const stack = useContext(StackContext);
  if (stack === null || panel === undefined) return null;
  const name = `move the ${title} panel`;

  return (
    <button
      type="button"
      className="perch-panel-grip"
      aria-label={name}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      data-perch-tip="drag to move this panel, or Alt+Up and Alt+Down"
      onKeyDown={(event: ReactKeyboardEvent) => {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        stack.step(panel, event.key === 'ArrowUp' ? -1 : 1);
      }}
    >
      <svg
        data-perch-glyph="grip"
        width="6"
        height="10"
        viewBox="0 0 6 10"
        fill="currentColor"
        aria-hidden="true"
      >
        <circle cx="1.25" cy="1.5" r="1" />
        <circle cx="4.75" cy="1.5" r="1" />
        <circle cx="1.25" cy="5" r="1" />
        <circle cx="4.75" cy="5" r="1" />
        <circle cx="1.25" cy="8.5" r="1" />
        <circle cx="4.75" cy="8.5" r="1" />
      </svg>
    </button>
  );
}

export const PANEL_STACK_STYLES = `
.perch-panels { display: flex; flex-direction: column; min-width: 0; }
.perch-section[${PANEL_ATTRIBUTE}] { position: relative; }
/* The drop line: 2px of accent across the gap a dragged panel would land in. */
.perch-section[data-perch-drop]::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  z-index: 3;
  height: 2px;
  background: var(--ed-accent);
  pointer-events: none;
}
.perch-section[data-perch-drop='above']::after { top: 0; }
.perch-section[data-perch-drop='below']::after { bottom: 0; }
.perch-section[data-perch-dragging='true'] > .perch-section__bar { opacity: 0.45; }
/* The whole header drags; the title keeps the pointer of the click that folds it. */
.perch-section__bar[data-perch-drag-source] { cursor: grab; }
.perch-panel-grip {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: calc(var(--ed-row-h) - 2px);
  margin-right: -6px;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: none;
  color: var(--ed-faint);
  cursor: grab;
  touch-action: none;
}
.perch-panel-grip:hover { color: var(--ed-text-2); }
.perch-panel-grip:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: -2px; color: var(--ed-text-2); }
/* The ghost: a copy of the held panel's header, faint, under the pointer. */
.perch-drag-ghost {
  position: fixed;
  z-index: 60;
  margin: 0;
  box-sizing: border-box;
  opacity: 0.3;
  pointer-events: none;
  font-size: var(--ed-font);
  color: var(--ed-text);
}
`;
