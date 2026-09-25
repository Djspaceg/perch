/**
 * AlignGrid: both halves of a placement in one grid, a two-dimensional radio group.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AlignGrid } from './align-grid.js';

describe('AlignGrid', () => {
  const ACROSS = [
    { value: 'start', label: 'left' },
    { value: 'center', label: 'centre' },
    { value: 'end', label: 'right' },
  ];
  const DOWN = [
    { value: 'start', label: 'top' },
    { value: 'center', label: 'middle' },
    { value: 'end', label: 'bottom' },
  ];

  function renderGrid(picks: [string, string][]): void {
    render(
      <AlignGrid
        label="Readout placement"
        across={{ options: ACROSS, value: 'start' }}
        down={{ options: DOWN, value: 'start' }}
        onPick={(across, down) => {
          picks.push([across, down]);
        }}
      />,
    );
  }

  it('is a 3x3 radio group named by position, with the current one checked', () => {
    renderGrid([]);
    const grid = screen.getByRole('radiogroup', { name: 'Readout placement' });
    const cells = within(grid).getAllByRole('radio');

    expect(cells.map((cell) => cell.getAttribute('aria-label'))).toEqual([
      'top left',
      'top centre',
      'top right',
      'middle left',
      'middle centre',
      'middle right',
      'bottom left',
      'bottom centre',
      'bottom right',
    ]);
    expect(within(grid).getByRole('radio', { name: 'top left' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(cells.filter((cell) => cell.tabIndex === 0)).toHaveLength(1);
  });

  it('centres both ways in one click', () => {
    const picks: [string, string][] = [];
    renderGrid(picks);

    fireEvent.click(screen.getByRole('radio', { name: 'middle centre' }));
    expect(picks).toEqual([['center', 'center']]);
  });

  it('moves in two dimensions with the arrow keys', () => {
    const picks: [string, string][] = [];
    renderGrid(picks);
    const topLeft = screen.getByRole('radio', { name: 'top left' });

    fireEvent.keyDown(topLeft, { key: 'ArrowRight' });
    fireEvent.keyDown(topLeft, { key: 'ArrowDown' });
    // At an edge, an arrow stays put rather than wrapping to the far side.
    fireEvent.keyDown(topLeft, { key: 'ArrowLeft' });
    expect(picks).toEqual([
      ['center', 'start'],
      ['start', 'center'],
    ]);
  });
});
