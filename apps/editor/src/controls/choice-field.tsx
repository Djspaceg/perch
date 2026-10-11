/**
 * ChoiceField: a dropdown for a long closed list that may still hold a value the list does not — the
 * layout clock's locale and time zone.
 *
 * The field is a button in the shape of a text field, showing the chosen entry's words. It opens a
 * `usePopover` box like the sensor picker's: a search (`FilterBar`) that matches every word typed
 * against an entry's words, its value and its note, and the entries as a listbox, the chosen one
 * marked and scrolled into view. ArrowDown from the search moves into the list, ArrowUp and
 * ArrowDown move through it, Enter in the search takes the first match. A search that is itself a
 * value `accept` takes — a tag or zone the list leaves out — is offered as "use ...", so nothing the
 * old text field could hold is lost.
 *
 * Not a native `<select>`: one could not be searched, and the time zones are four hundred long.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FilterBar } from './filter-bar.js';
import { matchesQuery } from './filter.js';
import { usePopover } from './popover.js';

/** One entry: what is written, what it says, and a quiet note after it. */
export interface ChoiceOption {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
}

export function ChoiceField({
  id,
  describedBy,
  noun,
  value,
  options,
  accept,
  onValue,
}: {
  /** The field's id, for its row's `<label for>`. */
  readonly id: string;
  readonly describedBy?: string | undefined;
  /** What one entry is, in words: `locale`, `time zone`. Names the box and its search. */
  readonly noun: string;
  readonly value: string;
  /** Every entry, the stored value among them (`withStored`). */
  readonly options: readonly ChoiceOption[];
  /** A typed search as a value to use, or `undefined` when it is not one. */
  readonly accept?: ((text: string) => string | undefined) | undefined;
  readonly onValue: (value: string) => void;
}): ReactNode {
  const anchor = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const popover = usePopover(anchor, box);
  const [query, setQuery] = useState('');
  const current = options.find((option) => option.value === value);
  const shown = options.filter((option) =>
    matchesQuery(query, option.label, option.value, option.detail),
  );
  const typed = query.trim() === '' ? undefined : accept?.(query);
  const offerTyped = typed !== undefined && !options.some((option) => option.value === typed);

  // The chosen entry is in view when the list opens, not four hundred entries down.
  useEffect(() => {
    if (!popover.open) return;
    const selected = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (selected !== null && selected !== undefined && 'scrollIntoView' in selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [popover.open]);

  const choose = (next: string): void => {
    onValue(next);
    setQuery('');
    popover.close(true);
  };
  const entries = (): HTMLElement[] => [
    ...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []),
  ];

  return (
    <span className="perch-choice">
      <button
        ref={anchor}
        id={id}
        type="button"
        className="perch-input perch-choice__field"
        aria-haspopup="dialog"
        aria-expanded={popover.open}
        {...(popover.open ? { 'aria-controls': popover.id } : {})}
        {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
        onClick={() => {
          setQuery('');
          popover.setOpen(!popover.open);
        }}
      >
        <span className="perch-choice__label">{current?.label ?? value}</span>
        <span className="perch-choice__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {popover.open ? (
        <div
          ref={box}
          id={popover.id}
          className="perch-popover perch-popover--choice"
          role="dialog"
          aria-label={`choose a ${noun}`}
          style={popover.style}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            const all = entries();
            if (all.length === 0) return;
            event.preventDefault();
            const at = all.indexOf(document.activeElement as HTMLElement);
            const next =
              at === -1
                ? event.key === 'ArrowDown'
                  ? 0
                  : all.length - 1
                : Math.min(all.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)));
            all[next]?.focus();
          }}
        >
          <FilterBar
            label={`search ${noun}s`}
            query={query}
            onQuery={setQuery}
            onSubmit={() => {
              const first = offerTyped ? typed : shown[0]?.value;
              if (first !== undefined) choose(first);
            }}
          />
          <div className="perch-choice__list" role="listbox" aria-label={`${noun}s`} ref={list}>
            {offerTyped ? (
              <ChoiceEntry
                option={{ value: typed, label: `use ${typed}` }}
                selected={false}
                onChoose={choose}
              />
            ) : null}
            {shown.map((option) => (
              <ChoiceEntry
                key={option.value}
                option={option}
                selected={option.value === value}
                onChoose={choose}
              />
            ))}
            {shown.length === 0 && !offerTyped ? (
              <p className="perch-choice__empty">{`no ${noun} matches`}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </span>
  );
}

function ChoiceEntry({
  option,
  selected,
  onChoose,
}: {
  readonly option: ChoiceOption;
  readonly selected: boolean;
  readonly onChoose: (value: string) => void;
}): ReactNode {
  return (
    <button
      type="button"
      role="option"
      className="perch-choice__entry"
      aria-selected={selected}
      tabIndex={-1}
      onClick={() => {
        onChoose(option.value);
      }}
    >
      <span className="perch-choice__entry-label">{option.label}</span>
      {option.detail === undefined || option.detail === '' ? null : (
        <>
          {' '}
          <span className="perch-choice__entry-detail">{option.detail}</span>
        </>
      )}
    </button>
  );
}

export const CHOICE_FIELD_STYLES = `
.perch-choice { flex: 1 1 auto; display: flex; min-width: 0; }
.perch-choice__field {
  display: flex;
  align-items: center;
  gap: 4px;
  text-align: left;
  cursor: pointer;
}
.perch-choice__label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.perch-choice__chevron { flex: none; color: var(--ed-quiet); font-size: var(--ed-font-small); }
.perch-popover--choice { width: 280px; padding: 6px 0 4px; gap: 4px; }
.perch-popover--choice .perch-filter__search { max-width: none; margin: 0 6px; width: calc(100% - 12px); }
.perch-choice__list { display: flex; flex-direction: column; gap: 1px; padding: 0 4px; max-height: min(50vh, 320px); overflow-y: auto; }
.perch-choice__entry {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: var(--ed-list-row-h);
  border: 0;
  border-radius: var(--ed-radius);
  background: none;
  color: var(--ed-label);
  font: inherit;
  font-size: var(--ed-font-small);
  text-align: left;
  padding: 2px 8px;
  cursor: pointer;
}
.perch-choice__entry:hover, .perch-choice__entry:focus-visible { background: var(--ed-hover); color: var(--ed-text); outline: none; }
.perch-choice__entry[aria-selected='true'] { background: var(--ed-accent-fill); color: var(--ed-text); }
.perch-choice__entry-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.perch-choice__entry-detail { flex: none; color: var(--ed-quiet); font-variant-numeric: tabular-nums; white-space: nowrap; }
.perch-choice__empty { margin: 0; padding: 4px 8px; font-size: var(--ed-font-small); color: var(--ed-quiet); }
`;
