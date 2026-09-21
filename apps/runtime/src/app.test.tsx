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
import {
  SENSOR_SOURCE_STATUSES,
  sensorTopic,
  type SensorSource,
  type SensorSourceStatus,
  type Unsubscribe,
} from '@perch/sensor-contract';
import {
  Dashboard,
  SOURCE_STATUS_WORDING,
  type DashboardSources,
  type LiveSourceIdentity,
} from './app.js';

/** Seeded and idle: it publishes only when a test says so. */
const idleSource = (seed: number): MockSensorSource => createMockSource({ seed, autoStart: false });

/** What `main.tsx` passes when it built the mock, which is the default the tests run under. */
const MOCK_IDENTITY: LiveSourceIdentity = { kind: 'mock' };

function mount(identity: LiveSourceIdentity = MOCK_IDENTITY): {
  sources: DashboardSources & { live: MockSensorSource; frozen: MockSensorSource };
} {
  const live = idleSource(7);
  const frozen = idleSource(1);

  render(<Dashboard sources={{ live, frozen }} liveSource={identity} />);

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
    expect(readoutIn('live · 2 decimals')).toHaveAttribute('data-state', 'value');
    expect(readoutIn('live · dimensionless')).toHaveAttribute('data-state', 'value');
    expect(readoutIn('mock only · 0 decimals')).toHaveAttribute('data-state', 'value');
  });

  it('leaves the hardware-only tile empty under the mock, rather than inventing a number for it', () => {
    const { sources } = mount();

    act(() => {
      sources.live.tick();
    });

    // `gpu/throughput` is the tile that tells the two modes apart: the relay publishes it from
    // LibreHardwareMonitor's raw field and the mock does not publish it at all. A mock that filled
    // it in would make the one reliable tell useless.
    expect(readoutIn('hardware only · raw bytes/s')).toHaveAttribute('data-state', 'waiting');
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
    expect(readoutIn('mock only · reports nothing')).toHaveAttribute('data-state', 'no-reading');
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
    expect(readoutIn('stale · mock publisher stopped')).toHaveAttribute('data-state', 'waiting');

    act(() => {
      sources.frozen.tick();
    });

    expect(readoutIn('stale · mock publisher stopped')).toHaveAttribute('data-state', 'value');
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

    expect(readoutIn('stale · mock publisher stopped')).toHaveAttribute('data-state', 'stale');
    expect(readoutIn('stale · mock publisher stopped')).toHaveTextContent(/stale \ds/);
    // The live provider keeps the real 5 s default, so 3 s has not aged it out.
    expect(readoutIn('live')).toHaveAttribute('data-state', 'value');
  });
});

/**
 * A source stuck in one status, for the two statuses a mock cannot reach.
 *
 * `createMockSource` has no transport, so by design it can report `connecting`, `live` and
 * `stale` but never `error` — and the page's whole reason for showing the status is the case
 * where the link to the relay dies. That case needs a source that can say so.
 */
function sourceStuckAt(status: SensorSourceStatus): SensorSource {
  return {
    // Nothing ever publishes: this source exists to hold a status, and the page has to render
    // that status with no readings at all, which is exactly the situation it describes.
    subscribe: (): Unsubscribe => () => undefined,
    meta: () => undefined,
    status,
  };
}

function mountWith(live: SensorSource, identity: LiveSourceIdentity = MOCK_IDENTITY): void {
  render(<Dashboard sources={{ live, frozen: idleSource(1) }} liveSource={identity} />);
}

/** The badge, found by what it is rather than by the words it happens to carry. */
const badge = (): HTMLElement => screen.getByTestId('perch-status');

describe('<Dashboard> — what the source is doing', () => {
  it('says nothing has arrived yet before anything has', () => {
    mount();

    expect(badge()).toHaveAttribute('data-perch-status', 'connecting');
    // Not "no data" and not an empty badge: the distinction being drawn is that the page is
    // waiting, which is a different fact from the link having failed.
    expect(badge()).toHaveTextContent(/waiting for the first reading/i);
  });

  it('says readings are arriving once they are', () => {
    const { sources } = mount();

    act(() => {
      sources.live.tick();
    });

    expect(badge()).toHaveAttribute('data-perch-status', 'live');
    expect(badge()).toHaveTextContent(/readings arriving/i);
  });

  it('says the publisher went quiet when the transport is still up', () => {
    mountWith(sourceStuckAt('stale'));

    expect(badge()).toHaveAttribute('data-perch-status', 'stale');
    expect(badge()).toHaveTextContent(/connected/i);
    expect(badge()).not.toHaveTextContent(/unreachable/i);
  });

  it('says the link is down when the source reports an error', () => {
    mountWith(sourceStuckAt('error'));

    expect(badge()).toHaveAttribute('data-perch-status', 'error');
    expect(badge()).toHaveTextContent(/unreachable/i);
  });

  it('gives each status its own wording, so no two are read as the same problem', () => {
    // The fixes differ — "the relay stopped polling" versus "the relay is gone" versus "give it a
    // second" — so a single "no data" for all of them would be worse than the status code alone.
    const wordings = SENSOR_SOURCE_STATUSES.map((status) => SOURCE_STATUS_WORDING[status]);

    expect(new Set(wordings).size).toBe(SENSOR_SOURCE_STATUSES.length);
  });
});

describe('<Dashboard> — which source is on screen', () => {
  it('names the mock as a mock, in the page rather than only in a console', () => {
    mount();

    const provenance = screen.getByTestId('perch-source');

    expect(provenance).toHaveAttribute('data-perch-source-kind', 'mock');
    expect(provenance).toHaveTextContent(/mock/i);
    // The one sentence this page exists to make impossible to miss.
    expect(provenance).toHaveTextContent(/not hardware/i);
  });

  it('names the broker it is reading from when it is reading from one', () => {
    mountWith(idleSource(7), { kind: 'mqtt', url: 'ws://localhost:19001' });

    const provenance = screen.getByTestId('perch-source');

    expect(provenance).toHaveAttribute('data-perch-source-kind', 'mqtt');
    // The URL, not just the word "mqtt": on this machine the wrong broker on the wrong port is
    // the failure that looks like success, so the page has to show which one it dialled.
    expect(provenance).toHaveTextContent('ws://localhost:19001');
    expect(provenance).not.toHaveTextContent(/mock/i);
  });
});

describe('<Dashboard> — the heartbeat', () => {
  it('reports nothing published before anything has', () => {
    mount();

    expect(screen.getByText(/last published never/)).toBeInTheDocument();
  });

  it('watches a topic both the mock and real hardware publish', () => {
    const { sources } = mount();

    act(() => {
      sources.live.tick();
    });

    // `cpu/load`, not `cpu/temperature`. The fixture captured from the live machine has no
    // `sensors/cpu/0/temperature/0` at all — its first CPU temperature is sensor index 2 — so a
    // heartbeat on that topic reads "last published never" forever over MQTT, on a page that is
    // in fact receiving 213 readings a second. The heartbeat has to be a topic both sides publish.
    expect(screen.getByText(/cpu\/load last published/)).toHaveAttribute(
      'data-perch-ready',
      'true',
    );
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
