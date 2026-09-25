/**
 * TabStrip: the ARIA tabs pattern, with one short label per tab and the explanation in its tooltip.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { TabStrip } from './tab-strip.js';

const TABS = [
  { id: 'customize', label: 'Customize', title: 'every token, by name and type' },
  { id: 'developer', label: 'Developer', title: 'what this document holds' },
  { id: 'third', label: 'Third', title: 'a third' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function Strip({ trailing }: { readonly trailing?: ReactNode }): ReactNode {
  const [tab, setTab] = useState<TabId>('customize');

  return (
    <>
      <TabStrip
        label="theme tabs"
        idBase="t"
        tabs={TABS}
        selected={tab}
        onSelect={setTab}
        trailing={trailing}
      />
      <div role="tabpanel" id="t-panel" aria-labelledby={`t-tab-${tab}`}>
        {tab}
      </div>
    </>
  );
}

describe('TabStrip', () => {
  it('is a named tablist of tabs, one selected, each controlling the panel', () => {
    render(<Strip />);

    expect(screen.getByRole('tablist', { name: 'theme tabs' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(tabs.every((tab) => tab.getAttribute('aria-controls') === 't-panel')).toBe(true);
  });

  it('shows one short label per tab and keeps the explanation in the tooltip', () => {
    render(<Strip />);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Customize',
      'Developer',
      'Third',
    ]);
    expect(screen.getByRole('tab', { name: 'Developer' })).toHaveAttribute(
      'title',
      'what this document holds',
    );
  });

  it('has one tab stop, and moves with the arrow keys, Home and End, wrapping at the ends', () => {
    render(<Strip />);
    const [customize, developer, third] = screen.getAllByRole('tab');
    if (customize === undefined || developer === undefined || third === undefined)
      throw new Error('tabs');

    expect([customize.tabIndex, developer.tabIndex, third.tabIndex]).toEqual([0, -1, -1]);

    fireEvent.keyDown(customize, { key: 'ArrowRight' });
    expect(developer).toHaveAttribute('aria-selected', 'true');
    expect(developer).toHaveFocus();

    fireEvent.keyDown(developer, { key: 'End' });
    expect(third).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(third, { key: 'ArrowRight' });
    expect(customize).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(customize, { key: 'ArrowLeft' });
    expect(third).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(third, { key: 'Home' });
    expect(customize).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('customize');
  });

  it('selects on click', () => {
    render(<Strip />);

    fireEvent.click(screen.getByRole('tab', { name: 'Developer' }));
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 't-tab-developer');
  });

  it('carries trailing content on the strip, outside the tablist', () => {
    render(<Strip trailing={<input aria-label="search" />} />);

    expect(screen.getByRole('tablist')).not.toContainElement(screen.getByLabelText('search'));
  });
});
