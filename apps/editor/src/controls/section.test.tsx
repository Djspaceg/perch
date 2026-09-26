/**
 * Section: a full-width bar with a disclosure triangle, its open state remembered in the editor
 * store, and a quieter Advanced foldout for inside one.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdvancedSection, Section } from './section.js';

describe('Section', () => {
  function renderSection(defaultOpen = true, forceOpen = false): ReturnType<typeof render> {
    return render(
      <Section
        id="test/transform"
        title="Transform"
        defaultOpen={defaultOpen}
        forceOpen={forceOpen}
      >
        <p>body</p>
      </Section>,
    );
  }

  it('is a heading holding a disclosure button that controls its body', () => {
    renderSection();
    const toggle = screen.getByRole('button', { name: 'Transform' });

    expect(screen.getByRole('heading', { level: 3, name: 'Transform' })).toContainElement(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('body')).toBeVisible();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('body')).not.toBeVisible();
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')).toHaveAttribute(
      'hidden',
    );
  });

  it('starts closed when told to', () => {
    renderSection(false);

    expect(screen.getByRole('button', { name: 'Transform' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('remembers being closed, across a remount', () => {
    const first = renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Transform' }));
    first.unmount();

    renderSection();
    expect(screen.getByRole('button', { name: 'Transform' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('opens while forced, without changing what it remembers', () => {
    const forced = renderSection(false, true);
    expect(screen.getByText('body')).toBeVisible();
    forced.unmount();

    renderSection(false, false);
    expect(screen.getByText('body')).not.toBeVisible();
  });
});

describe('AdvancedSection', () => {
  it('folds closed by default and says, while closed, how much it hides that is set', () => {
    render(
      <AdvancedSection id="test/typography/advanced" setCount={2}>
        <p>tracking</p>
      </AdvancedSection>,
    );
    const toggle = screen.getByRole('button', { name: /^Advanced/ });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('2 set');
    expect(screen.getByText('tracking')).not.toBeVisible();

    fireEvent.click(toggle);
    expect(screen.getByText('tracking')).toBeVisible();
  });
});
