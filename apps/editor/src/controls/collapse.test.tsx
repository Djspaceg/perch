/**
 * Collapse: grows open and shrinks shut, keeps leaving content until the shut is over, and never
 * lets focus or a screen reader into content on its way out.
 *
 * jsdom runs no transitions and resolves no custom properties, so a `Collapse` there computes a
 * duration of 0 and settles at once — which is what every other test in this package relies on. The
 * tests of the in-between states give the region a real duration with a plain stylesheet, and end
 * the transition by hand.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collapse, REDUCED_MOTION_QUERY } from './collapse.js';

/** A real duration on every region, as the chrome's variables give one in a browser. */
function withDuration(): () => void {
  const style = document.createElement('style');
  style.textContent = '.perch-collapse { transition-duration: 180ms; }';
  document.head.append(style);

  return () => {
    style.remove();
  };
}

function regionOf(text: string): HTMLElement {
  const region = screen.getByText(text, { ignore: false }).closest('.perch-collapse');
  if (!(region instanceof HTMLElement)) throw new Error(`no region around ${text}`);
  return region;
}

function endTransition(region: HTMLElement): void {
  act(() => {
    region.dispatchEvent(new Event('transitionend', { bubbles: true }));
  });
}

/** A toggle outside the region, and a field inside it. */
function Harness({
  keepMounted = false,
  focusBack = false,
}: {
  readonly keepMounted?: boolean;
  readonly focusBack?: boolean;
}): ReactNode {
  const [open, setOpen] = useState(true);
  const back = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={back}
        type="button"
        onClick={() => {
          setOpen(!open);
        }}
      >
        toggle
      </button>
      <Collapse
        open={open}
        keepMounted={keepMounted}
        {...(focusBack ? { focusOnClose: back } : {})}
      >
        {open || keepMounted ? (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
            }}
          >
            inside
          </button>
        ) : null}
      </Collapse>
    </>
  );
}

describe('Collapse', () => {
  let removeDuration: (() => void) | undefined;

  beforeEach(() => {
    removeDuration = undefined;
  });
  afterEach(() => {
    removeDuration?.();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('is inert, hidden from assistive tech and out of the tab order once shut', () => {
    render(<Harness keepMounted />);
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    const region = regionOf('inside');

    expect(region).toHaveAttribute('hidden');
    expect(region).toHaveAttribute('inert');
    expect(region).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('inside')).not.toBeVisible();
    // Not in the accessibility tree, so not a button anyone can reach.
    expect(screen.queryByRole('button', { name: 'inside' })).toBeNull();
  });

  it('keeps leaving content mounted, inert, until its transition ends, and only then unmounts', () => {
    removeDuration = withDuration();
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));

    // Still there, with the content it had while open, though the caller has stopped rendering it.
    const region = regionOf('inside');
    expect(region).toHaveAttribute('data-perch-phase', 'closing');
    expect(region).toHaveAttribute('inert');
    expect(region).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button', { name: 'inside' })).toBeNull();

    // A transition on something inside says nothing about the region's own.
    act(() => {
      screen.getByText('inside').dispatchEvent(new Event('transitionend', { bubbles: true }));
    });
    expect(screen.getByText('inside')).toBeInTheDocument();

    endTransition(region);
    expect(screen.queryByText('inside')).toBeNull();
  });

  it('gives up waiting for a transitionend that never comes', () => {
    removeDuration = withDuration();
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.getByText('inside')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(screen.queryByText('inside')).toBeNull();
  });

  it('collapses in the same commit when reduced motion is asked for', () => {
    removeDuration = withDuration();
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query === REDUCED_MOTION_QUERY, media: query })),
    );
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));

    expect(screen.queryByText('inside')).toBeNull();
  });

  it('moves focus out before it shuts, rather than dropping it on the page', () => {
    removeDuration = withDuration();
    render(<Harness focusBack />);
    const inside = screen.getByRole('button', { name: 'inside' });
    inside.focus();

    fireEvent.click(inside);

    expect(screen.getByRole('button', { name: 'toggle' })).toHaveFocus();
  });

  it('grows in on arrival when told to, and is interactive from the start', () => {
    removeDuration = withDuration();
    render(
      <Collapse open appear>
        <button type="button">new</button>
      </Collapse>,
    );
    const region = regionOf('new');

    expect(region).toHaveAttribute('data-perch-phase', 'opening');
    expect(region).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'new' })).toBeInTheDocument();

    endTransition(region);
    expect(region).toHaveAttribute('data-perch-phase', 'open');
  });

  it('is simply there on first paint unless told to grow in', () => {
    removeDuration = withDuration();
    render(
      <Collapse open>
        <p>present</p>
      </Collapse>,
    );

    expect(regionOf('present')).toHaveAttribute('data-perch-phase', 'open');
  });
});
