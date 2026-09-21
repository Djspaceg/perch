/**
 * What the page is asserted to do, as opposed to what a screenshot of it shows.
 *
 * The division of labour is deliberate. This file checks that every rendering the page claims to
 * demonstrate is *reachable* — that the tiles exist, that each one ends up in the state its caption
 * promises, and that the sources are genuinely injected. What it cannot check is whether any of it
 * is legible: column widths, the label that used to push a tile wider than its column, whether a
 * 400px-tall panel clips anything. Those are settled by captures at both viewport sizes, because
 * jsdom has no layout engine and would report every one of them as fine.
 *
 * Both sources here are seeded and hand-driven. Nothing waits on a timer it did not start.
 */

import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSource, type MockSensorSource } from '@perch/sensor-sources';
import { sensorTopic } from '@perch/sensor-contract';
import { Dashboard, type DashboardSources } from './app.js';

/** Seeded and idle: it publishes only when a test says so. */
const idleSource = (seed: number): MockSensorSource =>
  createMockSource({ seed, autoStart: false });

function mount(): { sources: DashboardSources & { live: MockSensorSource; frozen: MockSensorSource } } {
  const live = idleSource(7);
  const frozen = idleSource(1);

  render(<Dashboard sources={{ live, frozen }} />);

  return { sources: { live, frozen } };
}

/** The tile whose caption says what it is there to show. */
function tile(caption: string): HTMLElement {
  const element = screen.getByText(caption).closest('.perch-tile');
  if (element === null) throw new Error(`no tile captioned ${caption}`);
  return element as HTMLElement;
}

/** The readout inside a tile, found the way a reader finds it: by role. */
const readoutIn = (caption: string): HTMLElement => within(tile(caption)).getByRole('group');

beforeEach(() => {
  // A fake clock so staleness is advanced rather than waited out. Vitest fakes `Date` too, which
  // is what the store ages readings against.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('<Dashboard> — the tiles it hard-codes', () => {
  it('renders one readout per tile, all eight of them', () => {
    mount();

    expect(screen.getAllByRole('group')).toHaveLength(8);
  });

  it('shows live values once the injected source publishes', () => {
    const { sources } = mount();

    act(() => {
      sources.live.tick();
    });

    expect(readoutIn('live')).toHaveAttribute('data-state', 'value');
    expect(readoutIn('live · 0 decimals')).toHaveAttribute('data-state', 'value');
    expect(readoutIn('live · indexed topic')).toHaveAttribute('data-state', 'value');
    expect(readoutIn('live · dimensionless')).toHaveAttribute('data-state', 'value');
  });

  it('shows nothing at all until something publishes', () => {
    mount();

    expect(readoutIn('live')).toHaveAttribute('data-state', 'waiting');
  });

  it('keeps a sensor that reports nothing distinct from one that has not reported', () => {
    const { sources } = mount();

    act(() => {
      sources.live.tick();
    });

    // Both are "no number", and the page has to tell them apart: one sensor is present and
    // reporting null, the other is a topic nothing publishes.
    expect(readoutIn('null · reports nothing')).toHaveAttribute('data-state', 'no-reading');
    expect(readoutIn('waiting · no metadata label')).toHaveAttribute('data-state', 'waiting');
  });

  it('labels the unpublished tile with its raw topic, which is the defect the CSS had to fix', () => {
    mount();

    // Nothing publishes `psu/voltage`, so there is no metadata label and the readout falls back to
    // the canonical topic. This string is why the widget may not size itself from its label.
    expect(readoutIn('waiting · no metadata label')).toHaveAttribute(
      'aria-label',
      sensorTopic('psu', 'voltage'),
    );
  });

  it('applies an explicit decimal count where a tile asks for one', () => {
    const { sources } = mount();

    act(() => {
      sources.live.tick();
    });

    expect(readoutIn('live · 2 decimals').textContent).toMatch(/\d\.\d{2}\sW/);
  });
});

describe('<Dashboard> — the two sources', () => {
  it('feeds the frozen tile from the frozen source, not the live one', () => {
    const { sources } = mount();

    act(() => {
      sources.live.tick();
    });

    // `gpu/temperature` is published by both sources, so a tile reading from the wrong provider
    // would look correct here — except that only the frozen source has been silent.
    expect(readoutIn('stale · publisher stopped')).toHaveAttribute('data-state', 'waiting');

    act(() => {
      sources.frozen.tick();
    });

    expect(readoutIn('stale · publisher stopped')).toHaveAttribute('data-state', 'value');
  });

  it('marks the frozen tile stale once its publisher goes quiet, and leaves the live tiles alone', () => {
    const { sources } = mount();

    act(() => {
      sources.live.tick();
      sources.frozen.tick();
    });

    // Past the frozen provider's 1.5 s threshold *and* past the next staleness re-check after it:
    // the store re-checks on its own interval, so a reading is reported stale at the first check
    // after it ages out, not at the instant it does.
    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(readoutIn('stale · publisher stopped')).toHaveAttribute('data-state', 'stale');
    expect(readoutIn('stale · publisher stopped')).toHaveTextContent(/stale \ds/);
    // The live provider keeps the real 5 s default, so 3 s has not aged it out.
    expect(readoutIn('live')).toHaveAttribute('data-state', 'value');
  });
});

describe('<Dashboard> — the heartbeat', () => {
  it('reports nothing published before anything has', () => {
    mount();

    expect(screen.getByText(/last published never/)).toBeInTheDocument();
  });

  it('signals ready only once a reading has arrived', () => {
    const { sources } = mount();
    const footer = screen.getByText(/last published/);

    expect(footer).toHaveAttribute('data-perch-ready', 'false');

    act(() => {
      sources.live.tick();
    });

    expect(footer).toHaveAttribute('data-perch-ready', 'true');
    expect(footer).toHaveTextContent('source live');
  });

  it('reports the time carried by the data, so a dead page cannot look alive', () => {
    const { sources } = mount();

    act(() => {
      sources.live.tick();
    });
    const first = screen.getByText(/last published/).textContent;

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    const unchanged = screen.getByText(/last published/).textContent;

    act(() => {
      sources.live.tick();
    });
    const second = screen.getByText(/last published/).textContent;

    // Time passing alone changes nothing; a reading does.
    expect(unchanged).toBe(first);
    expect(second).not.toBe(first);
  });
});
