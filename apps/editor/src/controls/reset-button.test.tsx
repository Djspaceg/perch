/**
 * ResetButton: the one control that undoes a value, in its two shapes.
 *
 * - A revert (`↺`) where something underneath takes over. Its accessible name — and its tooltip, the
 *   same string — names the value that takes over and where it comes from, because that is the
 *   whole question a person has before pressing it.
 * - A delete (`✕`) where nothing does, which asks first, inline, naming the thing it will delete.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResetButton } from './reset-button.js';

describe('ResetButton', () => {
  it('names the inherited value it returns to: the layout theme first', () => {
    render(
      <ResetButton
        action="reset"
        subject="Reading colour"
        returnsTo={{ source: 'layout', value: '#e8f1ff' }}
        onReset={() => undefined}
      />,
    );
    const reset = screen.getByRole('button');

    expect(reset).toHaveAccessibleName('reset Reading colour to the layout theme value #e8f1ff');
    expect(reset).toHaveAttribute('title', reset.getAttribute('aria-label'));
    expect(screen.getByText('↺')).toHaveAttribute('aria-hidden', 'true');
  });

  it('names the ui-kit default when nothing above sets it', () => {
    render(
      <ResetButton
        action="reset"
        subject="Reading colour"
        returnsTo={{ source: 'default', value: '#f2f4f8' }}
        onReset={() => undefined}
      />,
    );

    expect(screen.getByRole('button')).toHaveAccessibleName(
      'reset Reading colour to the ui-kit default #f2f4f8',
    );
  });

  it('phrases the raw-document removal as a layer going, not a token going', () => {
    const onReset = vi.fn();
    render(
      <ResetButton
        action="remove"
        subject="--perch-fg"
        returnsTo={{ source: 'default', value: '#f2f4f8' }}
        onReset={onReset}
      />,
    );
    const button = screen.getByRole('button');

    expect(button).toHaveAccessibleName(
      "remove this layout's value for --perch-fg, back to the ui-kit default #f2f4f8",
    );
    fireEvent.click(button);
    // No confirm: nothing is lost by dropping an override.
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('deletes only after an inline confirm, with a different glyph, and can be kept', () => {
    const onReset = vi.fn();
    render(<ResetButton action="delete" subject="--brand-hue" onReset={onReset} />);
    const destroy = screen.getByRole('button', { name: /^delete --brand-hue/ });

    expect(screen.getByText('✕')).toBeInTheDocument();
    expect(destroy).toHaveAccessibleName(/nothing takes over/);
    expect(destroy).toHaveAttribute('title', destroy.getAttribute('aria-label'));

    fireEvent.click(destroy);
    expect(onReset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^keep --brand-hue/ }));
    expect(onReset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^delete --brand-hue/ }));
    fireEvent.click(screen.getByRole('button', { name: /^confirm: delete --brand-hue/ }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending delete on Escape', () => {
    const onReset = vi.fn();
    render(<ResetButton action="delete" subject="--brand-hue" onReset={onReset} />);

    fireEvent.click(screen.getByRole('button', { name: /^delete --brand-hue/ }));
    fireEvent.keyDown(screen.getByRole('group', { name: /delete --brand-hue\?/ }), {
      key: 'Escape',
    });
    expect(screen.queryByRole('button', { name: /^confirm/ })).toBeNull();
    expect(onReset).not.toHaveBeenCalled();
  });
});
