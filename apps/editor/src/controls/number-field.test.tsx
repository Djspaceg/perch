/**
 * NumberField: type, nudge, scrub. Scrubbing is an addition to typing and to the arrow keys, never a
 * replacement, so every drag behaviour here has a keyboard twin. The arithmetic itself is pinned in
 * `scrub.test.ts`; this file proves the field drives it.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { NumberField } from './number-field.js';
import { PIXELS_PER_STEP } from './scrub.js';

/** A NumberField holding its own value, recording every write. */
function Scrub({
  initial,
  writes,
  ...rest
}: {
  readonly initial: string;
  readonly writes: string[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly bar?: boolean;
}): ReactNode {
  const [value, setValue] = useState(initial);

  return (
    <NumberField
      label="x"
      value={value}
      onChange={(next) => {
        writes.push(next);
        setValue(next);
      }}
      {...rest}
    />
  );
}

describe('NumberField', () => {
  it('is a spin button named by its label, carrying its bounds and its unit', () => {
    render(<Scrub initial="12" writes={[]} min={0} max={48} unit="px" bar />);
    const field = screen.getByRole('spinbutton', { name: 'x' });

    expect(field).toHaveValue('12');
    expect(field).toHaveAttribute('aria-valuenow', '12');
    expect(field).toHaveAttribute('aria-valuemin', '0');
    expect(field).toHaveAttribute('aria-valuemax', '48');
    expect(field).toHaveAttribute('aria-valuetext', '12 px');
    // The unit sits inside the field, as text a reader can see.
    expect(screen.getByText('px')).toBeInTheDocument();
  });

  it('nudges one step per arrow press, and ten with Shift', () => {
    const writes: string[] = [];
    render(<Scrub initial="34" writes={writes} />);
    const field = screen.getByRole('spinbutton', { name: 'x' });

    fireEvent.keyDown(field, { key: 'ArrowUp' });
    fireEvent.keyDown(field, { key: 'ArrowUp', shiftKey: true });
    fireEvent.keyDown(field, { key: 'ArrowDown' });

    expect(writes).toEqual(['35', '45', '44']);
  });

  it('stops a nudge at its bounds', () => {
    const writes: string[] = [];
    render(<Scrub initial="60" writes={writes} min={0} max={64} />);

    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'x' }), {
      key: 'ArrowUp',
      shiftKey: true,
    });
    expect(writes).toEqual(['64']);
  });

  it('still takes a typed value, exactly as typed', () => {
    const writes: string[] = [];
    render(<Scrub initial="34" writes={writes} min={0} max={64} />);

    fireEvent.change(screen.getByRole('spinbutton', { name: 'x' }), { target: { value: '90' } });
    // Typing may go past the scrub range: the range is a sensible span, not a rule of the format.
    expect(writes).toEqual(['90']);
  });

  it('scrubs when its label is dragged: one step per few pixels, ten with Shift', () => {
    const writes: string[] = [];
    render(<Scrub initial="34" writes={writes} />);
    const label = screen.getByText('x');

    fireEvent.pointerDown(label, { clientX: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(label, { clientX: 100 + 10 * PIXELS_PER_STEP, pointerId: 1 });
    fireEvent.pointerUp(label, { clientX: 100 + 10 * PIXELS_PER_STEP, pointerId: 1 });
    expect(writes.at(-1)).toBe('44');

    fireEvent.pointerDown(label, { clientX: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(label, {
      clientX: 100 + 2 * PIXELS_PER_STEP,
      pointerId: 1,
      shiftKey: true,
    });
    fireEvent.pointerUp(label, { clientX: 100 + 2 * PIXELS_PER_STEP, pointerId: 1 });
    expect(writes.at(-1)).toBe('64');
  });

  it('scrubs when the field itself is dragged, and a still click writes nothing', () => {
    const writes: string[] = [];
    render(<Scrub initial="34" writes={writes} min={0} max={40} />);
    const field = screen.getByRole('spinbutton', { name: 'x' });

    fireEvent.pointerDown(field, { clientX: 100, button: 0, pointerId: 1 });
    fireEvent.pointerUp(field, { clientX: 100, pointerId: 1 });
    expect(writes).toEqual([]);
    // A still click is a click to type: the field takes focus, and while it has it a press places
    // the caret rather than scrubbing.
    expect(field).toHaveFocus();
    field.blur();

    fireEvent.pointerDown(field, { clientX: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(field, { clientX: 400, pointerId: 1 });
    fireEvent.pointerUp(field, { clientX: 400, pointerId: 1 });
    // Clamped at the top of the range, however far the hand went.
    expect(writes.at(-1)).toBe('40');
  });

  it('draws a fill bar for a bounded field, at the value’s place in its range', () => {
    render(<Scrub initial="16" writes={[]} min={0} max={64} bar />);

    expect(screen.getByTestId('perch-scrub-x')).toHaveStyle({ '--perch-number-fill': '25%' });
  });
});
