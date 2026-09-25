/**
 * TabStrip: tabs that read as tabs.
 *
 * Recessed inactive tabs on a strip with one baseline rule; the active tab is attached to the panel
 * beneath it — the same background, and it breaks the rule — so tab and content read as one surface.
 * One short label per tab, single line; the explanation is its tooltip and, where it matters, a line
 * inside the panel. No button chrome: no raised border, no pill, no hover lift.
 *
 * The ARIA tabs pattern: a `tablist`, `tab`s with `aria-selected` controlling `${idBase}-panel`, one
 * tab stop, and ArrowLeft/ArrowRight (wrapping), Home and End moving between them with automatic
 * activation — showing a tab here is cheap. `trailing` sits on the strip's right, outside the
 * tablist, where a search field goes.
 */

import type { ReactNode } from 'react';
import { focusSibling } from './focus.js';

export interface TabSpec<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly title: string;
}

export function TabStrip<Id extends string>({
  label,
  idBase,
  tabs,
  selected,
  onSelect,
  trailing,
}: {
  readonly label: string;
  readonly idBase: string;
  readonly tabs: readonly TabSpec<Id>[];
  readonly selected: Id;
  readonly onSelect: (tab: Id) => void;
  readonly trailing?: ReactNode;
}): ReactNode {
  const index = tabs.findIndex((tab) => tab.id === selected);

  return (
    <div className="perch-tabs">
      <div className="perch-tabs__list" role="tablist" aria-label={label}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${idBase}-tab-${tab.id}`}
            className="perch-tabs__tab"
            aria-selected={tab.id === selected}
            aria-controls={`${idBase}-panel`}
            title={tab.title}
            tabIndex={tab.id === selected ? 0 : -1}
            onClick={() => {
              onSelect(tab.id);
            }}
            onKeyDown={(event) => {
              let next = -1;
              if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
              else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = tabs.length - 1;
              if (next === -1) return;
              event.preventDefault();
              const target = tabs[next];
              if (target === undefined) return;
              onSelect(target.id);
              focusSibling(event.currentTarget, next);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {trailing === undefined ? null : <div className="perch-tabs__trailing">{trailing}</div>}
    </div>
  );
}

export const TAB_STRIP_STYLES = `
.perch-tabs {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 4px var(--ed-pad-x) 0;
  background: var(--ed-bg-recessed);
  border-bottom: 1px solid var(--ed-field-edge);
}
.perch-tabs__list { display: flex; align-items: flex-end; gap: 1px; }
.perch-tabs__tab {
  position: relative;
  margin-bottom: -1px;
  height: var(--ed-row-h);
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: var(--ed-radius) var(--ed-radius) 0 0;
  background: transparent;
  color: var(--ed-quiet);
  font: inherit;
  font-size: var(--ed-font);
  padding: 0 12px;
  cursor: pointer;
}
.perch-tabs__tab:hover { color: var(--ed-text-2); }
.perch-tabs__tab[aria-selected='true'] {
  height: calc(var(--ed-row-h) + 1px);
  border-color: var(--ed-field-edge);
  background: var(--ed-bg);
  color: var(--ed-text);
}
.perch-tabs__tab:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: -3px; }
.perch-tabs__trailing {
  flex: 1 1 auto;
  display: flex;
  justify-content: flex-end;
  min-width: 0;
  padding-bottom: 3px;
}
`;
