/**
 * PropertyRow: the one row every property in the inspector is drawn in.
 *
 * A fixed grid — a right-aligned label column, the value, and a narrow slot at the right edge where a
 * reset appears on rows that are set here and nowhere else — so row height and alignment are decided
 * once, in `chrome.ts`'s variables, and every section lines up with every other. The value column is
 * `minmax(0, 1fr)` and the row and value are `min-width: 0`, so a long value truncates or wraps inside
 * its own column and never widens the sidebar. A row given `perch-row--stacked` (a text element's
 * template) has no label column: its label is a line above, and its value spans the whole row.
 *
 * Where a value comes from is said twice, for two readers: a mark in the left gutter and a tinted
 * label to glance at (filled blue for "set here", a hollow amber ring for "set one level up", nothing
 * for a default), and the same fact in words, as part of the control's accessible description. Colour
 * is never the only carrier.
 *
 * The description of the property is the label's tooltip and the control's accessible description,
 * rather than a line of text under every row: it is useful once, and a line per row is what made the
 * old list four times as tall as it needed to be.
 *
 * The control is a render prop so it receives the ids it must carry: `controlId` for a labelable
 * control, `labelId` for a group control (a radio group has no `for`), and `describedBy`.
 */

import { useId, type ReactNode } from 'react';
import { ScrubLabel, type ScrubTarget } from './number-field.js';

/** Where a row's value comes from. */
export type ValueSource = 'own' | 'inherited' | 'default';

/** The ids a control inside the row carries. */
export interface RowIds {
  readonly controlId: string;
  readonly labelId: string;
  readonly describedBy: string | undefined;
}

export interface PropertyRowProps {
  readonly label: string;
  readonly description?: string | undefined;
  readonly source?: ValueSource | undefined;
  /** The source in words, for assistive technology: `set by this entity`. */
  readonly sourceText?: string | undefined;
  /** The right-edge slot: a reset, a delete. Nothing on a row with nothing to undo. */
  readonly end?: ReactNode;
  /** For a numeric control: the label becomes a drag handle that scrubs it. */
  readonly scrub?: ScrubTarget | undefined;
  /** `group` when the control is labelled by id (a radio group) rather than by `for`. */
  readonly labelAs?: 'label' | 'group';
  /** A second line inside the row, under the value: a note that must be visible, not a tooltip. */
  readonly note?: ReactNode;
  /**
   * A second line in the label column, under the label: a grid's value in words, which the grid
   * itself shows only as a pattern of cells.
   */
  readonly labelNote?: ReactNode;
  readonly testId?: string | undefined;
  readonly className?: string | undefined;
  readonly attributes?: Readonly<Record<`data-${string}`, string>>;
  readonly children: (ids: RowIds) => ReactNode;
}

export function PropertyRow({
  label,
  description,
  source,
  sourceText,
  end,
  scrub,
  labelAs = 'label',
  note,
  labelNote,
  testId,
  className,
  attributes,
  children,
}: PropertyRowProps): ReactNode {
  const base = useId();
  const controlId = `${base}-control`;
  const labelId = `${base}-label`;
  const sourceId = `${base}-source`;
  const descriptionId = `${base}-description`;
  const described = [
    sourceText === undefined ? undefined : sourceId,
    description === undefined ? undefined : descriptionId,
  ].filter((id): id is string => id !== undefined);
  const describedBy = described.length === 0 ? undefined : described.join(' ');

  let labelNode: ReactNode;
  if (labelAs === 'group') {
    labelNode = (
      <span className="perch-row__label-text" id={labelId} data-perch-tip={description}>
        {label}
      </span>
    );
  } else if (scrub === undefined) {
    labelNode = (
      <label
        className="perch-row__label-text"
        id={labelId}
        htmlFor={controlId}
        data-perch-tip={description}
      >
        {label}
      </label>
    );
  } else {
    labelNode = (
      <ScrubLabel
        className="perch-row__label-text"
        id={labelId}
        htmlFor={controlId}
        tip={description}
        target={scrub}
      >
        {label}
      </ScrubLabel>
    );
  }

  return (
    <div
      className={`perch-row${className === undefined ? '' : ` ${className}`}`}
      data-testid={testId}
      data-perch-source={source}
      {...attributes}
    >
      <div className="perch-row__label">
        {source === 'own' || source === 'inherited' ? (
          <span className="perch-row__mark" aria-hidden="true" />
        ) : null}
        {labelNode}
        {labelNote === undefined || labelNote === null ? null : (
          <span className="perch-row__label-note">{labelNote}</span>
        )}
        {sourceText === undefined ? null : (
          <span className="perch-sr-only" id={sourceId}>
            {sourceText}
          </span>
        )}
        {description === undefined ? null : (
          <span className="perch-sr-only" id={descriptionId}>
            {description}
          </span>
        )}
      </div>
      <div className="perch-row__value">{children({ controlId, labelId, describedBy })}</div>
      <div className="perch-row__end">{end}</div>
      {note === undefined || note === null ? null : <div className="perch-row__note">{note}</div>}
    </div>
  );
}

export const PROPERTY_ROW_STYLES = `
.perch-row {
  position: relative;
  display: grid;
  grid-template-columns: var(--ed-label-col) minmax(0, 1fr) var(--ed-control);
  align-items: center;
  min-width: 0;
  column-gap: 6px;
  min-height: var(--ed-row-h);
  padding: 1px 4px 1px var(--ed-pad-x);
}
.perch-row:hover { background: var(--ed-row-hover); }
.perch-row__label {
  position: relative;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  min-width: 0;
  padding-left: 10px;
}
.perch-row__label-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--ed-font);
  color: var(--ed-label);
}
.perch-row[data-perch-source='own'] .perch-row__label-text { color: var(--ed-own-text); }
.perch-row[data-perch-source='inherited'] .perch-row__label-text { color: var(--ed-inherited-text); }
.perch-row__mark {
  position: absolute;
  left: 0;
  top: 50%;
  width: 6px;
  height: 6px;
  box-sizing: border-box;
  border-radius: 50%;
  transform: translateY(-50%);
}
.perch-row[data-perch-source='own'] .perch-row__mark { background: var(--ed-own); }
.perch-row[data-perch-source='inherited'] .perch-row__mark { border: 1.5px solid var(--ed-inherited); }
.perch-row__value { display: flex; align-items: center; gap: var(--ed-gap); min-width: 0; }
.perch-row__end { position: relative; display: flex; align-items: center; justify-content: center; }
/* A label with a line under it: both right-aligned in the label column, the mark level with the label. */
.perch-row__label:has(> .perch-row__label-note) { flex-direction: column; align-items: flex-end; justify-content: flex-start; gap: 1px; }
.perch-row__label:has(> .perch-row__label-note) > .perch-row__mark { top: calc(var(--ed-field-h) / 2); }
.perch-row__label-note { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ed-font-small); color: var(--ed-quiet); }
.perch-row__note {
  grid-column: 2 / 4;
  padding: 1px 0 2px;
  font-size: var(--ed-font-small);
  color: var(--ed-inherited-text);
}
/*
 * Stacked: no label column. The label is a line of its own, left-aligned, with the end slot beside
 * it; the value takes the full width of the row under it, and grows with the sidebar. For prose and
 * templates, which are too long for the value column.
 */
.perch-row--stacked {
  grid-template-columns: minmax(0, 1fr) var(--ed-control);
  align-items: start;
  row-gap: 2px;
  padding-top: 3px;
  padding-bottom: 4px;
}
.perch-row--stacked .perch-row__label { grid-column: 1; grid-row: 1; justify-content: flex-start; min-height: var(--ed-list-row-h); }
.perch-row--stacked .perch-row__end { grid-column: 2; grid-row: 1; }
.perch-row--stacked .perch-row__value { grid-column: 1 / -1; grid-row: 2; }
.perch-row--stacked .perch-row__note { grid-column: 1 / -1; }
`;
