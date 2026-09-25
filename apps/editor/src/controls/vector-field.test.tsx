/**
 * VectorField: several numbers under one row label, each a NumberField with its own axis edge.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VectorField } from './vector-field.js';

describe('VectorField', () => {
  function renderVector(writes: [string, string][]): void {
    render(
      <VectorField
        unit="px"
        fields={[
          { key: 'x', label: 'x', axis: 'x', value: '34', onChange: (v) => writes.push(['x', v]) },
          { key: 'y', label: 'y', axis: 'y', value: '96', onChange: (v) => writes.push(['y', v]) },
        ]}
      />,
    );
  }

  it('renders one labelled number per component, in order, with the axis marked', () => {
    renderVector([]);
    const fields = screen.getAllByRole('spinbutton');

    expect(fields.map((field) => field.getAttribute('id') !== null)).toEqual([true, true]);
    expect(screen.getByLabelText('x')).toHaveValue('34');
    expect(screen.getByLabelText('y')).toHaveValue('96');
    expect(screen.getByTestId('perch-scrub-x')).toHaveAttribute('data-perch-axis', 'x');
    expect(screen.getByTestId('perch-scrub-y')).toHaveAttribute('data-perch-axis', 'y');
  });

  it('writes each component through its own callback', () => {
    const writes: [string, string][] = [];
    renderVector(writes);

    fireEvent.keyDown(screen.getByLabelText('y'), { key: 'ArrowDown', shiftKey: true });
    fireEvent.change(screen.getByLabelText('x'), { target: { value: '40' } });
    expect(writes).toEqual([
      ['y', '86'],
      ['x', '40'],
    ]);
  });

  it('names a component more fully where its short label is not enough', () => {
    render(
      <VectorField
        fields={[
          {
            key: 'min',
            label: 'min',
            ariaLabel: 'range min',
            value: '0',
            onChange: () => undefined,
          },
          {
            key: 'max',
            label: 'max',
            ariaLabel: 'range max',
            value: '100',
            onChange: () => undefined,
          },
        ]}
      />,
    );

    expect(screen.getByRole('spinbutton', { name: 'range min' })).toHaveValue('0');
    expect(screen.getByRole('spinbutton', { name: 'range max' })).toHaveValue('100');
  });
});
