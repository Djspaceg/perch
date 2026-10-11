/**
 * FilterBar: a search box, and optionally one row of category chips with one pressed at a time.
 * What a query matches is `filter.ts`'s; this is the control.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { FILTER_BAR_STYLES, FilterBar, chipFades } from './filter-bar.js';

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

describe('the chip strip', () => {
  /** The CSS block for one selector, whitespace folded. */
  function rule(selector: string): string {
    const css = FILTER_BAR_STYLES.replace(/\s+/g, ' ');
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`no rule for ${selector}`);
    return css.slice(at, css.indexOf('}', at));
  }

  it('sizes each chip to its whole label, never truncating it', () => {
    const chip = rule('.perch-filter__chip');

    expect(chip).toMatch(/flex: none/);
    expect(chip).not.toMatch(/text-overflow/);
    expect(chip).not.toMatch(/overflow: hidden/);
    expect(chip).toMatch(/white-space: nowrap/);
  });

  it('scrolls sideways in one line instead of wrapping', () => {
    const strip = rule('.perch-filter__chips');

    expect(strip).toMatch(/overflow-x: auto/);
    expect(strip).not.toMatch(/flex-wrap: wrap/);
  });

  it('fades whichever edge has more chips past it', () => {
    expect(chipFades(0, 200, 200)).toBe('none');
    expect(chipFades(0, 200, 500)).toBe('end');
    expect(chipFades(150, 200, 500)).toBe('both');
    expect(chipFades(300, 200, 500)).toBe('start');
    // Sub-pixel scroll positions at the end still count as the end.
    expect(chipFades(299.5, 200, 500)).toBe('start');
  });

  it('turns a vertical wheel into a sideways scroll while the chips overflow', () => {
    render(<Bar log={[]} />);
    const strip = screen.getByRole('group', { name: 'filter by sections' });
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 100 });
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 400 });

    fireEvent.wheel(strip, { deltaY: 60, deltaX: 0 });
    expect(strip.scrollLeft).toBe(60);
    expect(strip).toHaveAttribute('data-perch-fade', 'both');

    // A trackpad's own sideways swipe is left to the browser.
    fireEvent.wheel(strip, { deltaY: 2, deltaX: 30 });
    expect(strip.scrollLeft).toBe(60);
  });

  it('shows the whole label in the chip, with no truncation tooltip', () => {
    render(<Bar log={[]} />);
    const chip = screen.getByRole('button', { name: 'Typography' });

    expect(chip).not.toHaveAttribute('data-perch-tip-when');
  });
});
