/**
 * AlignGrid: where content sits inside its box, as one grid — columns are across, rows are down, and
 * each cell is both halves at once, so "centre it both ways" is one click rather than two dropdowns.
 *
 * A two-dimensional radio group. One tab stop (the checked cell); the arrow keys move and choose in
 * both directions and stop at the edges rather than wrapping. Each cell's accessible name is its
 * position in words, `middle centre`. A fourth option on an axis — a text element's `spread` across
 * and `fill` down — is a fourth column or row, drawn as a bar rather than a dot because it is a
 * stretch, not a position.
 */

import type { ReactNode } from 'react';
import { focusSibling } from './focus.js';

export interface AlignAxis {
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly value: string;
}

export function AlignGrid({
  label,
  labelledBy,
  across,
  down,
  onPick,
}: {
  readonly label?: string | undefined;
  readonly labelledBy?: string | undefined;
  readonly across: AlignAxis;
  readonly down: AlignAxis;
  readonly onPick: (across: string, down: string) => void;
}): ReactNode {
  const columns = across.options.length;
  const rows = down.options.length;
  const checkedColumn = across.options.findIndex((option) => option.value === across.value);
  const checkedRow = down.options.findIndex((option) => option.value === down.value);
  const stop = checkedColumn === -1 || checkedRow === -1 ? 0 : checkedRow * columns + checkedColumn;

  return (
    <div
      className="perch-align"
      role="radiogroup"
      style={{ gridTemplateColumns: `repeat(${columns}, 18px)` }}
      {...(labelledBy === undefined ? { 'aria-label': label } : { 'aria-labelledby': labelledBy })}
    >
      {down.options.map((row, rowIndex) =>
        across.options.map((column, columnIndex) => {
          const index = rowIndex * columns + columnIndex;
          const name = `${row.label} ${column.label}`;

          return (
            <button
              key={`${row.value}/${column.value}`}
              type="button"
              role="radio"
              className="perch-align__cell"
              aria-checked={columnIndex === checkedColumn && rowIndex === checkedRow}
              aria-label={name}
              title={name}
              data-across={column.value}
              data-down={row.value}
              data-perch-stretch-across={columnIndex >= 3 ? 'true' : undefined}
              data-perch-stretch-down={rowIndex >= 3 ? 'true' : undefined}
              tabIndex={index === stop ? 0 : -1}
              onClick={() => {
                onPick(column.value, row.value);
              }}
              onKeyDown={(event) => {
                let nextColumn = columnIndex;
                let nextRow = rowIndex;
                if (event.key === 'ArrowRight') nextColumn += 1;
                else if (event.key === 'ArrowLeft') nextColumn -= 1;
                else if (event.key === 'ArrowDown') nextRow += 1;
                else if (event.key === 'ArrowUp') nextRow -= 1;
                else return;
                event.preventDefault();
                if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) {
                  return;
                }
                const nextAcross = across.options[nextColumn];
                const nextDown = down.options[nextRow];
                if (nextAcross === undefined || nextDown === undefined) return;
                onPick(nextAcross.value, nextDown.value);
                focusSibling(event.currentTarget, nextRow * columns + nextColumn);
              }}
            >
              <span className="perch-align__mark" aria-hidden="true" />
            </button>
          );
        }),
      )}
    </div>
  );
}

export const ALIGN_GRID_STYLES = `
.perch-align {
  flex: none;
  display: grid;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--ed-field-edge);
  border-radius: var(--ed-radius);
  background: var(--ed-field);
}
.perch-align__cell {
  position: relative;
  width: 18px;
  height: 15px;
  border: 0;
  border-radius: 2px;
  background: #141820;
  padding: 0;
  cursor: pointer;
}
.perch-align__cell:hover { background: #1d2430; }
.perch-align__cell:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 0; }
.perch-align__mark {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 4px;
  height: 4px;
  border-radius: 1px;
  background: var(--ed-faint);
  transform: translate(-50%, -50%);
}
.perch-align__cell[data-perch-stretch-across='true'] .perch-align__mark { width: 12px; height: 3px; }
.perch-align__cell[data-perch-stretch-down='true'] .perch-align__mark { width: 3px; height: 10px; }
.perch-align__cell[data-perch-stretch-across='true'][data-perch-stretch-down='true'] .perch-align__mark { width: 12px; height: 10px; }
.perch-align__cell[aria-checked='true'] { background: var(--ed-accent-fill); }
.perch-align__cell[aria-checked='true'] .perch-align__mark { background: var(--ed-text); width: 8px; height: 7px; }
.perch-align__cell[aria-checked='true'][data-perch-stretch-across='true'] .perch-align__mark { width: 14px; height: 5px; }
.perch-align__cell[aria-checked='true'][data-perch-stretch-down='true'] .perch-align__mark { width: 6px; height: 12px; }
`;
