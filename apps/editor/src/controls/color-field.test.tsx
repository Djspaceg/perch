/**
 * ColorField: a slim swatch and the literal in the row, and the picker only on demand, in a popover
 * that closes on Escape, on a press elsewhere, and on the swatch again.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ColorField } from './color-field.js';

/** A ColorField holding its own value. */
function Colour({
  initial,
  alpha,
  writes,
}: {
  readonly initial: string;
  readonly alpha: boolean;
  readonly writes: string[];
}): ReactNode {
  const [value, setValue] = useState(initial);

  return (
    <>
      <ColorField
        id="bg"
        label="Background"
        value={value}
        alpha={alpha}
        onValue={(next) => {
          writes.push(next);
          setValue(next);
        }}
      />
      <button type="button">elsewhere</button>
    </>
  );
}

describe('ColorField', () => {
  it('keeps the picker closed until the swatch is pressed, then opens it in a popover', () => {
    render(<Colour initial="#1a2b3c80" alpha writes={[]} />);
    const swatch = screen.getByRole('button', { name: /colour picker for Background/ });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(swatch).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(swatch);

    const dialog = screen.getByRole('dialog', { name: /Background/ });
    expect(swatch).toHaveAttribute('aria-expanded', 'true');
    // The alpha picker, because this colour takes alpha.
    expect(within(dialog).getByRole('slider', { name: /alpha/i })).toBeInTheDocument();
  });

  it('closes on Escape and hands focus back to the swatch', () => {
    render(<Colour initial="#1a2b3c" alpha={false} writes={[]} />);
    const swatch = screen.getByRole('button', { name: /colour picker for Background/ });

    fireEvent.click(swatch);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(swatch).toHaveFocus();
  });

  it('closes on a pointer down outside it, and not on one inside it', () => {
    render(<Colour initial="#1a2b3c" alpha={false} writes={[]} />);

    fireEvent.click(screen.getByRole('button', { name: /colour picker for Background/ }));
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when the swatch is pressed again', () => {
    render(<Colour initial="#1a2b3c" alpha={false} writes={[]} />);
    const swatch = screen.getByRole('button', { name: /colour picker for Background/ });

    fireEvent.click(swatch);
    fireEvent.click(swatch);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sets opacity as a percentage, so 50 writes the 80 pair', () => {
    const writes: string[] = [];
    render(<Colour initial="#1a2b3cff" alpha writes={writes} />);

    fireEvent.click(screen.getByRole('button', { name: /colour picker for Background/ }));
    const opacity = within(screen.getByRole('dialog')).getByRole('spinbutton', {
      name: /opacity/i,
    });
    expect(opacity).toHaveValue('100');

    fireEvent.change(opacity, { target: { value: '50' } });
    expect(writes).toEqual(['#1a2b3c80']);
  });

  it('offers no opacity for a colour that takes no alpha', () => {
    render(<Colour initial="#1a2b3c" alpha={false} writes={[]} />);

    fireEvent.click(screen.getByRole('button', { name: /colour picker for Background/ }));
    expect(within(screen.getByRole('dialog')).queryByRole('spinbutton')).toBeNull();
  });

  it('keeps the hex literal in the row, editable, with the popover closed', () => {
    const writes: string[] = [];
    render(<Colour initial="#1a2b3c" alpha={false} writes={writes} />);

    fireEvent.change(screen.getByLabelText('Background'), { target: { value: '#ffffff' } });
    expect(writes).toEqual(['#ffffff']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
