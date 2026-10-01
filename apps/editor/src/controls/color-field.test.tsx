/**
 * ColorField: a slim swatch and the literal in the row, and the picker only on demand, in a popover
 * that closes on Escape, on a press elsewhere, and on the swatch again.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ColorField, swatchStyle } from './color-field.js';

/** A ColorField holding its own value. */
function Colour({
  initial,
  writes,
}: {
  readonly initial: string;
  readonly writes: string[];
}): ReactNode {
  const [value, setValue] = useState(initial);

  return (
    <>
      <ColorField
        id="bg"
        label="Background"
        value={value}
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
    render(<Colour initial="#1a2b3c80" writes={[]} />);
    const swatch = screen.getByRole('button', { name: /colour picker for Background/ });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(swatch).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(swatch);

    const dialog = screen.getByRole('dialog', { name: /Background/ });
    expect(swatch).toHaveAttribute('aria-expanded', 'true');
    // The alpha picker: every colour takes alpha.
    expect(within(dialog).getByRole('slider', { name: /alpha/i })).toBeInTheDocument();
  });

  it('closes on Escape and hands focus back to the swatch', () => {
    render(<Colour initial="#1a2b3c" writes={[]} />);
    const swatch = screen.getByRole('button', { name: /colour picker for Background/ });

    fireEvent.click(swatch);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(swatch).toHaveFocus();
  });

  it('closes on a pointer down outside it, and not on one inside it', () => {
    render(<Colour initial="#1a2b3c" writes={[]} />);

    fireEvent.click(screen.getByRole('button', { name: /colour picker for Background/ }));
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when the swatch is pressed again', () => {
    render(<Colour initial="#1a2b3c" writes={[]} />);
    const swatch = screen.getByRole('button', { name: /colour picker for Background/ });

    fireEvent.click(swatch);
    fireEvent.click(swatch);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sets opacity as a percentage, so 50 writes the 80 pair', () => {
    const writes: string[] = [];
    render(<Colour initial="#1a2b3cff" writes={writes} />);

    fireEvent.click(screen.getByRole('button', { name: /colour picker for Background/ }));
    const opacity = within(screen.getByRole('dialog')).getByRole('spinbutton', {
      name: /opacity/i,
    });
    expect(opacity).toHaveValue('100');

    fireEvent.change(opacity, { target: { value: '50' } });
    expect(writes).toEqual(['#1a2b3c80']);
  });

  it('offers an alpha slider and an opacity for a colour with no alpha pair, as for any', () => {
    const writes: string[] = [];
    render(<Colour initial="#1a2b3c" writes={writes} />);

    fireEvent.click(screen.getByRole('button', { name: /colour picker for Background/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('slider', { name: /alpha/i })).toBeInTheDocument();
    const opacity = within(dialog).getByRole('spinbutton', { name: /opacity/i });
    expect(opacity).toHaveValue('100');

    fireEvent.change(opacity, { target: { value: '25' } });
    fireEvent.change(opacity, { target: { value: '100' } });
    // Solid again is six digits: the shortest faithful form.
    expect(writes).toEqual(['#1a2b3c40', '#1a2b3c']);
  });

  it('writes a typed or pasted rgb() or hsl() colour as hex once it is complete', () => {
    const writes: string[] = [];
    render(<Colour initial="#1a2b3c" writes={writes} />);
    const field = screen.getByLabelText('Background');

    fireEvent.change(field, { target: { value: 'rgba(26, 43, 60' } });
    fireEvent.change(field, { target: { value: 'rgba(26, 43, 60, 0.5)' } });
    fireEvent.change(field, { target: { value: 'hsl(0 100% 50% / 25%)' } });
    fireEvent.change(field, { target: { value: '#ABCD' } });

    expect(writes).toEqual(['rgba(26, 43, 60', '#1a2b3c80', '#ff000040', '#ABCD']);
    // The same field throughout: a half-typed colour does not swap the control for a text box.
    expect(screen.getByLabelText('Background')).toBe(field);
  });

  it('lays every swatch over a checkerboard, and says so when the text is not a colour', () => {
    const { rerender } = render(<Colour initial="#1a2b3c" writes={[]} />);

    // jsdom's CSS parser drops a conic gradient, so the fill is read from the function that makes it.
    expect(swatchStyle('#1a2b3c').background).toBe(
      'linear-gradient(#1a2b3c, #1a2b3c), repeating-conic-gradient(var(--ed-checker-light) 0 25%, var(--ed-checker-dark) 0 50%) 0 0 / 8px 8px',
    );
    expect(swatchStyle('#ABC8').background).toMatch(/^linear-gradient\(#aabbcc88, #aabbcc88\)/);
    expect(swatchStyle('var(--perch-fg)').background).not.toContain('var(--perch');

    rerender(<Colour key="other" initial="var(--perch-fg)" writes={[]} />);
    const none = screen.getByRole('button', { name: /colour picker for Background/ });
    expect(none).toHaveAttribute('data-perch-colour', 'none');
    expect(none).toBeDisabled();
    expect(screen.getByLabelText('Background')).toHaveValue('var(--perch-fg)');
  });

  it('keeps the hex literal in the row, editable, with the popover closed', () => {
    const writes: string[] = [];
    render(<Colour initial="#1a2b3c" writes={writes} />);

    fireEvent.change(screen.getByLabelText('Background'), { target: { value: '#ffffff' } });
    expect(writes).toEqual(['#ffffff']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
