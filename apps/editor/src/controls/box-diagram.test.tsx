/**
 * BoxDiagram: the padding ring of a box-model diagram, with linked sides, and the same for corners.
 *
 * The human's design: top always holds a number; every other side is either linked (a chain link, no
 * number) or set (its own number and a broken link). Clicking a link unlinks that side at the value it
 * was inheriting; clicking the broken link clears it and relinks it. Links follow CSS shorthand.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { BoxDiagram } from './box-diagram.js';
import { PIXELS_PER_STEP } from './scrub.js';

function Harness({
  initial,
  writes,
  kind = 'sides',
}: {
  readonly initial: string;
  readonly writes: string[];
  readonly kind?: 'sides' | 'corners';
}): ReactNode {
  const [value, setValue] = useState(initial);

  return (
    <BoxDiagram
      id="box"
      label={kind === 'sides' ? 'Padding' : 'Corner radius'}
      kind={kind}
      value={value}
      min={0}
      max={999}
      onValue={(next) => {
        writes.push(next);
        setValue(next);
      }}
    />
  );
}

const spin = (name: string): HTMLElement => screen.getByRole('spinbutton', { name });
const button = (name: string): HTMLElement => screen.getByRole('button', { name });

describe('BoxDiagram, padding', () => {
  it('shows a one-number padding as top with every other side linked', () => {
    render(<Harness initial="8" writes={[]} />);

    expect(spin('Padding top')).toHaveValue('8');
    expect(button('Padding right, linked to top')).toBeInTheDocument();
    expect(button('Padding bottom, linked to top')).toBeInTheDocument();
    expect(button('Padding left, linked to top')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Padding right' })).toBeNull();
  });

  it('shows only the unit in the centre, not the values again', () => {
    render(<Harness initial="1 2 3 4" writes={[]} />);

    expect(screen.getByTestId('perch-box-unit-box')).toHaveTextContent(/^px$/);
    expect(screen.queryByText('1 2 3 4')).toBeNull();
  });

  it('never offers to unlink or clear top', () => {
    render(<Harness initial="8 16" writes={[]} />);

    expect(screen.queryByRole('button', { name: /padding top/i })).toBeNull();
  });

  it('unlinks a side at the value it inherited, with focus on its own number', () => {
    const writes: string[] = [];
    render(<Harness initial="8" writes={writes} />);
    fireEvent.click(button('Padding right, linked to top'));

    expect(spin('Padding right')).toHaveValue('8');
    expect(spin('Padding right')).toHaveFocus();
    expect(button('relink Padding right to top')).toBeInTheDocument();
    // Left still follows right, and nothing has been written: the value has not changed.
    expect(button('Padding left, linked to right')).toBeInTheDocument();
    expect(writes).toEqual([]);

    fireEvent.change(spin('Padding right'), { target: { value: '16' } });
    expect(writes).toEqual(['8 16']);
    expect(button('Padding left, linked to right')).toBeInTheDocument();
  });

  it('sets left first with right following left, as CSS pairs them, and bottom on top', () => {
    const writes: string[] = [];
    render(<Harness initial="8" writes={writes} />);
    fireEvent.click(button('Padding left, linked to top'));
    fireEvent.change(spin('Padding left'), { target: { value: '2' } });

    expect(writes).toEqual(['8 2']);
    expect(button('Padding right, linked to left')).toBeInTheDocument();
    expect(button('Padding bottom, linked to top')).toBeInTheDocument();
  });

  it('relinks one of a set pair to the other, and names where it goes', () => {
    const writes: string[] = [];
    render(<Harness initial="8 16 8 2" writes={writes} />);
    fireEvent.click(button('relink Padding right to left'));

    expect(writes).toEqual(['8 2']);
    expect(button('Padding right, linked to left')).toHaveFocus();
  });

  it('relinks a side with its broken link, clearing its number; what follows it follows along', () => {
    const writes: string[] = [];
    render(<Harness initial="8 16" writes={writes} />);
    fireEvent.click(button('relink Padding right to top'));

    expect(writes).toEqual(['8']);
    expect(button('Padding right, linked to top')).toHaveFocus();
    expect(button('Padding left, linked to top')).toBeInTheDocument();
  });

  it('moves every linked side with top', () => {
    const writes: string[] = [];
    render(<Harness initial="8 16" writes={writes} />);
    fireEvent.keyDown(spin('Padding top'), { key: 'ArrowUp', shiftKey: true });

    expect(writes).toEqual(['18 16']);
  });

  it('shows four numbers for four different sides', () => {
    render(<Harness initial="1 2 3 4" writes={[]} />);

    expect(
      ['top', 'right', 'bottom', 'left'].map(
        (side) => (spin(`Padding ${side}`) as HTMLInputElement).value,
      ),
    ).toEqual(['1', '2', '3', '4']);
  });

  it('refuses an invalid side with a message and writes nothing', () => {
    const writes: string[] = [];
    render(<Harness initial="1 2 3 4" writes={writes} />);
    fireEvent.change(spin('Padding bottom'), { target: { value: '2.5' } });

    expect(writes).toEqual([]);
    expect(spin('Padding bottom')).toHaveValue('2.5');
    expect(screen.getByRole('alert')).toHaveTextContent(/bottom: whole layout pixels/);
    expect(spin('Padding bottom')).toHaveAccessibleDescription(/whole layout pixels/);
  });

  it('takes a CSS shorthand typed or pasted into top', () => {
    const writes: string[] = [];
    render(<Harness initial="0" writes={writes} />);
    fireEvent.change(spin('Padding top'), { target: { value: '4px 8px 12px' } });

    expect(writes).toEqual(['4 8 12']);
  });

  it('drags a linked side, unlinking it and scrubbing from what it inherited', () => {
    const writes: string[] = [];
    render(<Harness initial="8" writes={writes} />);
    const area = screen.getByTestId('perch-box-sides-right-area');
    fireEvent.pointerDown(area, { button: 0, clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 100 + 2 * PIXELS_PER_STEP });
    fireEvent.pointerUp(window);

    expect(writes).toEqual(['8 10']);
    expect(spin('Padding right')).toHaveValue('10');
  });

  it('opens a linked side for typing on a still click of its area', () => {
    render(<Harness initial="8" writes={[]} />);
    const area = screen.getByTestId('perch-box-sides-bottom-area');
    fireEvent.pointerDown(area, { button: 0, clientX: 100 });
    fireEvent.pointerUp(window);

    expect(spin('Padding bottom')).toHaveFocus();
  });
});

describe('BoxDiagram, corners', () => {
  it('links corners as border-radius does: all to top-left, top-right and bottom-left as a pair', () => {
    render(<Harness initial="6" writes={[]} kind="corners" />);

    expect(spin('Corner radius top-left')).toHaveValue('6');
    expect(button('Corner radius top-right, linked to top-left')).toBeInTheDocument();
    expect(button('Corner radius bottom-right, linked to top-left')).toBeInTheDocument();
    expect(button('Corner radius bottom-left, linked to top-left')).toBeInTheDocument();
  });

  it('sets bottom-left alone with top-right following it', () => {
    const writes: string[] = [];
    render(<Harness initial="6" writes={writes} kind="corners" />);
    fireEvent.click(button('Corner radius bottom-left, linked to top-left'));
    fireEvent.change(spin('Corner radius bottom-left'), { target: { value: '12' } });

    expect(writes).toEqual(['6 12']);
    expect(button('Corner radius top-right, linked to bottom-left')).toBeInTheDocument();
  });

  it('writes a corner in CSS corner order', () => {
    const writes: string[] = [];
    render(<Harness initial="6" writes={writes} kind="corners" />);
    fireEvent.click(button('Corner radius bottom-right, linked to top-left'));
    fireEvent.change(spin('Corner radius bottom-right'), { target: { value: '0' } });

    expect(writes).toEqual(['6 6 0']);
  });
});
