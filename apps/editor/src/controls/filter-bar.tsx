/**
 * FilterBar: a search box, and optionally one row of category chips with one pressed at a time.
 *
 * The chips are toggle buttons in a named group rather than a radio group: "All" is a chip like the
 * others, and a pressed state reads right for "show me only this". Escape in the search box clears
 * it. What a query *matches* is `filter.ts`'s; this is only the control, so the pane can apply the
 * same query to its own grouping.
 */

import type { ReactNode } from 'react';

export interface FilterChip {
  readonly id: string;
  readonly label: string;
}

export function FilterBar({
  label,
  query,
  onQuery,
  chips,
  chip,
  onChip,
}: {
  /** The search box's accessible name: `search theme tokens`. */
  readonly label?: string | undefined;
  readonly query?: string | undefined;
  /** Absent: no search box, only chips — for a pane that puts its search somewhere else. */
  readonly onQuery?: ((query: string) => void) | undefined;
  readonly chips?: readonly FilterChip[] | undefined;
  readonly chip?: string | undefined;
  readonly onChip?: ((chip: string) => void) | undefined;
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
          }}
        />
      )}
      {chips === undefined || chips.length === 0 ? null : (
        <div className="perch-filter__chips" role="group" aria-label="filter by sections">
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
        </div>
      )}
    </>
  );
}

export const FILTER_BAR_STYLES = `
.perch-filter__search {
  width: 100%;
  max-width: 180px;
  height: 18px;
  box-sizing: border-box;
  border: 1px solid var(--ed-field-edge);
  border-radius: 9px;
  background: var(--ed-field) no-repeat 7px 50% / 9px 9px
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Ccircle cx='4' cy='4' r='3' fill='none' stroke='%236b7889' stroke-width='1.3'/%3E%3Cpath d='M6.3 6.3 9 9' stroke='%236b7889' stroke-width='1.3'/%3E%3C/svg%3E");
  color: var(--ed-text);
  font: inherit;
  font-size: var(--ed-font-small);
  padding: 0 8px 0 20px;
}
.perch-filter__search:focus { outline: none; border-color: var(--ed-accent); }
.perch-filter__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 5px var(--ed-pad-x) 4px;
}
.perch-filter__chip {
  height: 18px;
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
.perch-filter__chip[aria-pressed='true'] { border-color: #3b5f8c; background: var(--ed-accent-fill); color: #eef5ff; }
.perch-filter__chip:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 0; }
`;
