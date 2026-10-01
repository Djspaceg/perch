/**
 * FilterBar: a search box, and optionally one row of category chips with one pressed at a time.
 *
 * The chips are toggle buttons in a named group rather than a radio group: "All" is a chip like the
 * others, and a pressed state reads right for "show me only this". Escape in the search box clears
 * it; Enter hands the query to `onSubmit`, for a pane where a search picks something. What a query *matches* is `filter.ts`'s; this is only the control, so the pane can apply the
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
        <div className="perch-filter__chips" role="group" aria-label={chipsLabel}>
          {chips.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="perch-filter__chip"
              aria-pressed={entry.id === chip}
              data-perch-tip={entry.label}
              data-perch-tip-when="truncated"
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
}
.perch-filter__chip {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
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
