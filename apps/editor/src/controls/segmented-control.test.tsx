/**
 * SegmentedControl: a few-option enum as one row of segments, the ARIA radio pattern.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SegmentedControl } from './segmented-control.js';

describe('SegmentedControl', () => {
  function renderSegmentedControl(writes: string[], value = 'break'): void {
    render(
      <SegmentedControl
        label="gap"
        value={value}
        options={[
          { value: 'break', label: 'break' },
          { value: 'bridge', label: 'bridge' },
        ]}
        onValue={(next) => {
          writes.push(next);
        }}
      />,
    );
  }

  it('is a radio group with the current choice checked', () => {
    renderSegmentedControl([]);
    const group = screen.getByRole('radiogroup', { name: 'gap' });

    expect(within(group).getByRole('radio', { name: 'break' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(group).getByRole('radio', { name: 'bridge' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('chooses by click and by arrow key, with one tab stop', () => {
    const writes: string[] = [];
    renderSegmentedControl(writes);
    const radios = screen.getAllByRole('radio');

    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1]);
    fireEvent.click(screen.getByRole('radio', { name: 'bridge' }));
    fireEvent.keyDown(screen.getByRole('radio', { name: 'break' }), { key: 'ArrowRight' });
    expect(writes).toEqual(['bridge', 'bridge']);
  });

  it('checks nothing when the value is unset, and keeps a tab stop anyway', () => {
    renderSegmentedControl([], '');

    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('aria-checked'))).toEqual(
      ['false', 'false'],
    );
    expect(screen.getAllByRole('radio').map((radio) => radio.tabIndex)).toEqual([0, -1]);
  });
});
