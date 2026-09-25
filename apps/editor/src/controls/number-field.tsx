/**
 * NumberField: a number you can type, nudge and drag.
 *
 * - **Type**: a `type="text"` input, for the reason `inspector.tsx` gives — whatever is typed is what
 *   the document gets, and the validator names what is wrong with it.
 * - **Nudge**: ArrowUp/ArrowDown one step, Shift ten; PageUp/PageDown ten.
 * - **Drag**: on the label, or on the field while it is not being typed into. A still click on the
 *   field focuses it and selects its text, ready to type over.
 *
 * Where the value has a range (`bar`), the field draws a fill bar inside itself — the field is the
 * slider, so there is no slider beside the number. The unit is inside the field, as text. It is an
 * ARIA spin button carrying its bounds and a value text with the unit.
 *
 * `ScrubLabel` lends the drag to a label outside the field: `PropertyRow` uses it so a row's own label
 * in its column is the handle, as in every property editor this borrows from.
 */

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  SCRUB_THRESHOLD_PX,
  fillFraction,
  nudgeValue,
  scrubValue,
  stepFor,
  type NumericBounds,
} from './scrub.js';

/** What scrubbing needs to know about the value it drives. */
export interface ScrubTarget {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly step?: number | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
}

/** The drag-to-scrub behaviour, for any element acting as a field's handle. */
function useScrub(
  target: ScrubTarget,
  input: RefObject<HTMLInputElement | null>,
): {
  readonly begin: (event: ReactPointerEvent, fromField: boolean) => void;
  readonly swallowClick: (event: MouseEvent) => void;
} {
  // The latest callback and bounds, read at move time: a drag spans many renders.
  const latest = useRef(target);
  useLayoutEffect(() => {
    latest.current = target;
  });
  const scrubbed = useRef(false);

  const begin = useCallback(
    (event: ReactPointerEvent, fromField: boolean) => {
      if (event.button !== 0) return;
      const field = input.current;
      // A focused field is being typed into: a press there places the caret; it does not scrub.
      if (fromField && field !== null && field === document.activeElement) return;

      const startX = event.clientX;
      const startText = latest.current.value;
      const start = startText.trim() === '' ? Number.NaN : Number(startText);
      let scrubbing = false;
      let last = startText;

      const move = (moved: PointerEvent): void => {
        const delta = moved.clientX - startX;
        if (!scrubbing && Math.abs(delta) < SCRUB_THRESHOLD_PX) return;
        scrubbing = true;
        document.body.classList.add('perch-scrubbing');
        const current = latest.current;
        const bounds: NumericBounds = { min: current.min, max: current.max };
        const step = current.step ?? stepFor(startText);
        const next = String(scrubValue(start, delta, moved.shiftKey, step, bounds));
        if (next !== last) {
          last = next;
          current.onChange(next);
        }
      };
      const end = (): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        document.body.classList.remove('perch-scrubbing');
        if (scrubbing) {
          scrubbed.current = true;
        } else if (fromField && field !== null) {
          field.focus();
          field.select();
        }
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    },
    [input],
  );

  const swallowClick = useCallback((event: MouseEvent) => {
    // The click that ends a drag on a label would otherwise focus the field, as a label click does.
    if (scrubbed.current) {
      scrubbed.current = false;
      event.preventDefault();
    }
  }, []);

  return { begin, swallowClick };
}

export interface NumberFieldProps extends ScrubTarget {
  readonly id?: string | undefined;
  /** The visible label inside the field, which is also a drag handle. */
  readonly label: string;
  /** The accessible name, where it should say more than the visible label: `range min`. */
  readonly ariaLabel?: string | undefined;
  /** No label inside the field: the row's label, outside it, names it. */
  readonly labelHidden?: boolean;
  readonly unit?: string | undefined;
  /** How the unit is read aloud, where the short one is not enough: `layout px`. */
  readonly unitText?: string | undefined;
  readonly bar?: boolean | undefined;
  /** A thin coloured left edge naming the axis of a vector's component. */
  readonly axis?: 'x' | 'y' | 'w' | 'h' | undefined;
  readonly describedBy?: string | undefined;
  readonly testId?: string | undefined;
}

export function NumberField({
  id: givenId,
  label,
  ariaLabel,
  labelHidden = false,
  value,
  onChange,
  step,
  min,
  max,
  unit,
  unitText,
  bar = false,
  axis,
  describedBy,
  testId,
}: NumberFieldProps): ReactNode {
  const ownId = useId();
  const id = givenId ?? ownId;
  const input = useRef<HTMLInputElement>(null);
  const { begin, swallowClick } = useScrub({ value, onChange, step, min, max }, input);
  const number = value.trim() === '' ? Number.NaN : Number(value);
  const finite = Number.isFinite(number);
  const showBar = bar && min !== undefined && max !== undefined;
  const fill = showBar ? `${Math.round(fillFraction(number, min, max) * 1000) / 10}%` : undefined;
  const name = ariaLabel;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    let direction: 1 | -1 | 0 = 0;
    let coarse = event.shiftKey;
    if (event.key === 'ArrowUp') direction = 1;
    else if (event.key === 'ArrowDown') direction = -1;
    else if (event.key === 'PageUp') {
      direction = 1;
      coarse = true;
    } else if (event.key === 'PageDown') {
      direction = -1;
      coarse = true;
    }
    if (direction === 0) return;
    event.preventDefault();
    const bounds: NumericBounds = { min, max };
    onChange(String(nudgeValue(number, direction, coarse, step ?? stepFor(value), bounds)));
  };

  return (
    <span
      className={`perch-number${showBar ? ' perch-number--bar' : ''}`}
      data-testid={testId ?? `perch-scrub-${label}`}
      data-perch-axis={axis}
      style={fill === undefined ? undefined : ({ '--perch-number-fill': fill } as CSSProperties)}
      onPointerDown={(event) => {
        if (event.target === input.current) begin(event, true);
      }}
    >
      {labelHidden ? null : (
        <label
          className="perch-number__label"
          htmlFor={id}
          onPointerDown={(event) => {
            begin(event, false);
          }}
          onClick={swallowClick}
        >
          {label}
        </label>
      )}
      <input
        ref={input}
        id={id}
        className="perch-number__input"
        type="text"
        inputMode="decimal"
        role="spinbutton"
        autoComplete="off"
        spellCheck={false}
        value={value}
        {...(name === undefined ? {} : { 'aria-label': name })}
        {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
        {...(finite ? { 'aria-valuenow': number } : {})}
        {...(min === undefined ? {} : { 'aria-valuemin': min })}
        {...(max === undefined ? {} : { 'aria-valuemax': max })}
        {...(unit === undefined ? {} : { 'aria-valuetext': `${value} ${unitText ?? unit}` })}
        onMouseDown={(event) => {
          // Not focused yet: hold focus back until the press is known to be a click, not a drag.
          if (event.currentTarget !== document.activeElement) event.preventDefault();
        }}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {unit === undefined ? null : (
        <span className="perch-number__unit" aria-hidden="true">
          {unit}
        </span>
      )}
    </span>
  );
}

/** A label outside a field that scrubs it when dragged and focuses it when clicked. */
export function ScrubLabel({
  htmlFor,
  id,
  title,
  className,
  target,
  children,
}: {
  readonly htmlFor: string;
  readonly id?: string | undefined;
  readonly title?: string | undefined;
  readonly className: string;
  readonly target: ScrubTarget;
  readonly children: ReactNode;
}): ReactNode {
  const none = useRef<HTMLInputElement>(null);
  const { begin, swallowClick } = useScrub(target, none);

  return (
    <label
      className={`${className} perch-number-handle`}
      htmlFor={htmlFor}
      id={id}
      title={title}
      onPointerDown={(event) => {
        begin(event, false);
      }}
      onClick={swallowClick}
    >
      {children}
    </label>
  );
}

export const NUMBER_FIELD_STYLES = `
body.perch-scrubbing, body.perch-scrubbing * { cursor: ew-resize !important; user-select: none !important; }
.perch-number-handle { cursor: ew-resize; }
.perch-number {
  position: relative;
  flex: 1 1 0;
  display: flex;
  align-items: center;
  min-width: 0;
  height: var(--ed-field-h);
  box-sizing: border-box;
  border: 1px solid var(--ed-field-edge);
  border-radius: var(--ed-radius);
  background: var(--ed-field);
  overflow: hidden;
}
.perch-number:hover { border-color: var(--ed-field-edge-hover); }
.perch-number:focus-within { border-color: var(--ed-accent); }
.perch-number--bar {
  background: linear-gradient(90deg, var(--ed-fill-bar) 0 var(--perch-number-fill, 0%), var(--ed-field) var(--perch-number-fill, 0%));
}
.perch-number[data-perch-axis]::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
}
.perch-number[data-perch-axis='x']::before { background: var(--ed-axis-x); }
.perch-number[data-perch-axis='y']::before { background: var(--ed-axis-y); }
.perch-number[data-perch-axis='w']::before { background: var(--ed-axis-w); }
.perch-number[data-perch-axis='h']::before { background: var(--ed-axis-h); }
.perch-number__label {
  flex: none;
  padding: 0 2px 0 7px;
  font-size: var(--ed-font-small);
  color: var(--ed-quiet);
  cursor: ew-resize;
  user-select: none;
}
.perch-number__input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--ed-text);
  font: inherit;
  font-size: var(--ed-font);
  font-variant-numeric: tabular-nums;
  padding: 0 4px 0 6px;
  cursor: ew-resize;
}
.perch-number__label + .perch-number__input { padding-left: 2px; }
.perch-number__input:focus { outline: none; cursor: text; }
.perch-number__unit {
  flex: none;
  padding-right: 6px;
  font-size: var(--ed-font-small);
  color: var(--ed-faint);
  pointer-events: none;
}
`;
