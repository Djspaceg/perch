/**
 * FilterBar: a search box, and optionally one row of category chips with one pressed at a time.
 * What a query matches is `filter.ts`'s; this is the control.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { FilterBar } from './filter-bar.js';

const CHIPS = [
  { id: 'all', label: 'All' },
  { id: 'colour', label: 'Colour' },
  { id: 'type', label: 'Typography' },
] as const;

function Bar({ log }: { readonly log: string[] }): ReactNode {
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<string>('all');

  return (
    <FilterBar
      label="search theme tokens"
      query={query}
      onQuery={(next) => {
        log.push(`q:${next}`);
        setQuery(next);
      }}
      chips={CHIPS}
      chip={chip}
      onChip={(next) => {
        log.push(`c:${next}`);
        setChip(next);
      }}
    />
  );
}

describe('FilterBar', () => {
  it('is a named search box', () => {
    const log: string[] = [];
    render(<Bar log={log} />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'search theme tokens' }), {
      target: { value: 'chart' },
    });
    expect(log).toEqual(['q:chart']);
  });

  it('clears on Escape, and says nothing when already empty', () => {
    const log: string[] = [];
    render(<Bar log={log} />);
    const box = screen.getByRole('searchbox');

    fireEvent.change(box, { target: { value: 'chart' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(log).toEqual(['q:chart', 'q:']);
  });

  it('offers chips as toggle buttons, one pressed at a time', () => {
    const log: string[] = [];
    render(<Bar log={log} />);
    const chips = screen.getByRole('group', { name: /sections/i });

    expect(within(chips).getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(chips).getByRole('button', { name: 'Colour' }));
    expect(within(chips).getByRole('button', { name: 'Colour' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(chips).getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(log).toEqual(['c:colour']);
  });

  it('renders no chips when given none', () => {
    render(<FilterBar label="search" query="" onQuery={() => undefined} />);

    expect(screen.queryByRole('group')).toBeNull();
  });

  it('hands the query to onSubmit on Enter, for a pane where a search picks something', () => {
    const submitted: string[] = [];
    render(
      <FilterBar
        label="search sensors"
        query="gpu"
        onQuery={() => undefined}
        onSubmit={(query) => {
          submitted.push(query);
        }}
      />,
    );

    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'search sensors' }), { key: 'Enter' });

    expect(submitted).toEqual(['gpu']);
  });
});
