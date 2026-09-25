/**
 * SegmentedControl: a closed choice among a few options, as one row of segments.
 *
 * The ARIA radio pattern: a radio group with one tab stop and arrow-key movement that chooses as it
 * moves. Nothing is checked when the value is unset, and the first segment keeps the tab stop so the
 * group is still reachable. Each segment's accessible name is the option's label for a person; its
 * `data-value` is the value the document gets.
 */

import type { ReactNode } from 'react';
import { focusSibling } from './focus.js';

export interface SegmentOption {
  readonly value: string;
  readonly label: string;
  /** What the segment shows, where it is shorter than the label. */
  readonly display?: string | undefined;
}

export function SegmentedControl({
  label,
  labelledBy,
  value,
  options,
  onValue,
  describedBy,
}: {
  readonly label?: string | undefined;
  readonly labelledBy?: string | undefined;
  readonly value: string | undefined;
  readonly options: readonly SegmentOption[];
  readonly onValue: (value: string) => void;
  readonly describedBy?: string | undefined;
}): ReactNode {
  const checked = options.findIndex((option) => option.value === value);
  const stop = checked === -1 ? 0 : checked;

  return (
    <div
      className="perch-segmented"
      role="radiogroup"
      {...(labelledBy === undefined ? { 'aria-label': label } : { 'aria-labelledby': labelledBy })}
      {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          className="perch-segmented__option"
          aria-checked={index === checked}
          aria-label={option.label}
          title={option.label}
          data-value={option.value}
          tabIndex={index === stop ? 0 : -1}
          onClick={() => {
            onValue(option.value);
          }}
          onKeyDown={(event) => {
            const delta =
              event.key === 'ArrowRight' || event.key === 'ArrowDown'
                ? 1
                : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                  ? -1
                  : 0;
            if (delta === 0) return;
            event.preventDefault();
            const next = (index + delta + options.length) % options.length;
            const target = options[next];
            if (target === undefined) return;
            onValue(target.value);
            focusSibling(event.currentTarget, next);
          }}
        >
          {option.display ?? option.label}
        </button>
      ))}
    </div>
  );
}

export const SEGMENTED_CONTROL_STYLES = `
.perch-segmented {
  flex: 1 1 auto;
  display: flex;
  min-width: 0;
  height: var(--ed-field-h);
  box-sizing: border-box;
  border: 1px solid var(--ed-field-edge);
  border-radius: var(--ed-radius);
  background: var(--ed-field);
  overflow: hidden;
}
.perch-segmented__option {
  flex: 1 1 0;
  min-width: 0;
  border: 0;
  border-left: 1px solid #1b2028;
  background: none;
  color: var(--ed-label);
  font: inherit;
  font-size: var(--ed-font-small);
  padding: 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.perch-segmented__option:first-child { border-left: 0; }
.perch-segmented__option:hover { color: var(--ed-text); background: var(--ed-hover); }
.perch-segmented__option[aria-checked='true'] { background: var(--ed-accent-fill); color: #eef5ff; }
.perch-segmented__option:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: -2px; }
`;
