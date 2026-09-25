/**
 * PropertyRow: every row goes through it, so the label column, the state mark and the right-edge slot
 * are decided once. It says where a value comes from twice — a mark to glance at, words to read.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { PropertyRow } from './property-row.js';

describe('PropertyRow', () => {
  it('labels its control, and carries the description as a tooltip and an accessible description', () => {
    render(
      <PropertyRow label="Reading colour" description="The big number." testId="row">
        {(ids) => <input id={ids.controlId} aria-describedby={ids.describedBy} />}
      </PropertyRow>,
    );
    const input = screen.getByLabelText('Reading colour');

    expect(screen.getByText('Reading colour')).toHaveAttribute('title', 'The big number.');
    expect(input).toHaveAccessibleDescription(expect.stringContaining('The big number.'));
  });

  it('marks where the value comes from, and says it in words', () => {
    render(
      <>
        <PropertyRow label="a" source="own" sourceText="set by this entity" testId="own">
          {(ids) => <input id={ids.controlId} aria-describedby={ids.describedBy} />}
        </PropertyRow>
        <PropertyRow
          label="b"
          source="inherited"
          sourceText="from the layout theme"
          testId="inherited"
        >
          {(ids) => <input id={ids.controlId} />}
        </PropertyRow>
        <PropertyRow label="c" source="default" sourceText="default" testId="default">
          {(ids) => <input id={ids.controlId} />}
        </PropertyRow>
      </>,
    );

    expect(screen.getByTestId('own')).toHaveAttribute('data-perch-source', 'own');
    expect(screen.getByTestId('inherited')).toHaveAttribute('data-perch-source', 'inherited');
    expect(screen.getByTestId('default')).toHaveAttribute('data-perch-source', 'default');
    expect(screen.getByLabelText('a')).toHaveAccessibleDescription(
      expect.stringContaining('set by this entity'),
    );
    // A mark only where a value is set somewhere: nothing for a default.
    expect(screen.getByTestId('own').querySelector('.perch-row__mark')).not.toBeNull();
    expect(screen.getByTestId('default').querySelector('.perch-row__mark')).toBeNull();
  });

  it('puts the right-edge slot content last in the row', () => {
    render(
      <PropertyRow label="a" testId="row" end={<button type="button">reset</button>}>
        {(ids) => <input id={ids.controlId} />}
      </PropertyRow>,
    );

    expect(screen.getByTestId('row').lastElementChild).toContainElement(
      screen.getByRole('button', { name: 'reset' }),
    );
  });

  it('turns its label into a scrub handle for a numeric control', () => {
    function Row(): ReactNode {
      const [value, setValue] = useState('10');

      return (
        <PropertyRow label="Padding" scrub={{ value, onChange: setValue, min: 0, max: 48 }}>
          {(ids) => <input id={ids.controlId} value={value} readOnly />}
        </PropertyRow>
      );
    }
    render(<Row />);
    const label = screen.getByText('Padding');

    fireEvent.pointerDown(label, { clientX: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(label, { clientX: 1000, pointerId: 1 });
    fireEvent.pointerUp(label, { clientX: 1000, pointerId: 1 });
    expect(screen.getByLabelText('Padding')).toHaveValue('48');
  });

  it('can label a group control by id instead of by `for`', () => {
    render(
      <PropertyRow label="Placement" labelAs="group">
        {(ids) => <div role="radiogroup" aria-labelledby={ids.labelId} />}
      </PropertyRow>,
    );

    expect(screen.getByRole('radiogroup', { name: 'Placement' })).toBeInTheDocument();
  });
});
