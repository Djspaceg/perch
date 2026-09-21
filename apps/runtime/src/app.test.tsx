/**
 * What the page is asserted to do, as opposed to what a screenshot of it shows.
 *
 * The division of labour is deliberate. This file checks that the pipeline behind the page reaches
 * every outcome it can reach — a layout painted, a name that is not a layout, a document that is not
 * a layout, a viewport that cannot honour one — and that the page says where its numbers came from in
 * all of them. What it cannot check is whether any of it is legible: scale, letterboxing, whether a
 * 400px-tall panel clips a tile. jsdom has no layout engine and would report every one of those as
 * fine, so they are settled by captures at both target sizes.
 *
 * Every layout here is a string this file wrote, handed over as a catalogue. The shipped layouts are
 * exercised in `layouts.test.ts`; mixing the two would make a page test fail because someone edited
 * content, which is the wrong signal on the wrong file.
 */

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSource, type MockSensorSource } from '@perch/sensor-sources';
import {
  SENSOR_SOURCE_STATUSES,
  sensorTopic,
  type SensorSource,
  type SensorSourceStatus,
  type Unsubscribe,
} from '@perch/sensor-contract';
import { Dashboard, SOURCE_STATUS_WORDING, type LiveSourceIdentity } from './app.js';
import { createLayoutCatalogue } from './layout-catalogue.js';
import type { PageRequest } from './viewport.js';

/** A layout at the viewport the tests run in, so `mode=capture` fits exactly by default. */
const CAPTURE_VIEWPORT = { width: 1024, height: 768 };

const PANEL = JSON.stringify({
  schemaVersion: 1,
  target: { ...CAPTURE_VIEWPORT, frameRate: 30 },
  theme: { '--perch-canvas-bg': '#0b0e13' },
  elements: [
    { kind: 'media', src: 'panel.assets/bg.svg', rect: { x: 0, y: 0, w: 1024, h: 768 } },
    { kind: 'text', text: 'mock source · not hardware', rect: { x: 16, y: 16, w: 400, h: 32 } },
    {
      kind: 'widget',
      widget: 'readout',
      topic: sensorTopic('cpu', 'load'),
      rect: { x: 16, y: 64, w: 300, h: 200 },
    },
    {
      kind: 'widget',
      widget: 'readout',
      topic: sensorTopic('psu', 'voltage'),
      rect: { x: 340, y: 64, w: 300, h: 200 },
    },
  ],
});

/** Same shape, a canvas no viewport here can match exactly. */
const OVERSIZE = JSON.stringify({
  schemaVersion: 1,
  target: { width: 1920, height: 400, frameRate: 30 },
  theme: {},
  elements: [
    {
      kind: 'widget',
      widget: 'readout',
      topic: sensorTopic('cpu', 'load'),
      rect: { x: 0, y: 0, w: 400, h: 200 },
    },
  ],
});

/** Refused for its contents rather than its syntax, which is the interesting refusal. */
const NOT_A_LAYOUT = JSON.stringify({
  schemaVersion: 1,
  target: { width: 1024, height: 768, frameRate: 30 },
  theme: { colour: 'steelblue' },
  elements: [
    {
      kind: 'widget',
      widget: 'sparkline',
      topic: sensorTopic('cpu', 'load'),
      rect: { x: 0, y: 0, w: 400, h: 200 },
    },
    { kind: 'text', rect: { x: 0, y: 300, w: 400, h: 40 } },
  ],
});

const CATALOGUE = createLayoutCatalogue({
  layouts: { panel: PANEL, oversize: OVERSIZE },
  invalid: { 'invalid/not-a-layout': NOT_A_LAYOUT },
  assets: { 'panel.assets/bg.svg': '/assets/bg-abc123.svg' },
});

/** What `main.tsx` passes when it built the mock, which is the default the tests run under. */
const MOCK_IDENTITY: LiveSourceIdentity = { kind: 'mock' };

function mount(
  request: Partial<PageRequest> = {},
  options: { readonly source?: SensorSource; readonly identity?: LiveSourceIdentity } = {},
): { source: SensorSource } {
  // Seeded and idle: it publishes only when a test says so.
  const source = options.source ?? createMockSource({ seed: 7, autoStart: false });

  render(
    <Dashboard
      source={source}
      liveSource={options.identity ?? MOCK_IDENTITY}
      catalogue={CATALOGUE}
      request={{ layout: 'panel', mode: 'windowed', ...request }}
    />,
  );

  return { source };
}

/** The mock, for the tests that drive it. */
function mountMock(request: Partial<PageRequest> = {}): MockSensorSource {
  const source = createMockSource({ seed: 7, autoStart: false });
  mount(request, { source });
  return source;
}

const page = (): HTMLElement => {
  const element = document.getElementById('perch-page');
  if (element === null) throw new Error('the page did not render');
  return element;
};

const problem = (): HTMLElement => screen.getByTestId('perch-layout-problem');
const canvas = (): HTMLElement => screen.getByTestId('perch-canvas');

beforeEach(() => {
  // jsdom reports 1024x768, and `useViewport` reads it. Stated rather than assumed, because the
  // capture-mode assertions turn on the viewport being exactly the layout's target.
  vi.stubGlobal('innerWidth', CAPTURE_VIEWPORT.width);
  vi.stubGlobal('innerHeight', CAPTURE_VIEWPORT.height);
  // A fake clock so staleness is advanced rather than waited out. Vitest fakes `Date` too, which is
  // what the store ages readings against.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('<Dashboard> — painting a layout', () => {
  it('renders the layout named in the request, at its own canvas size', () => {
    mount();

    expect(canvas()).toHaveAttribute('data-perch-canvas-width', '1024');
    expect(page()).toHaveAttribute('data-perch-layout', 'panel');
  });

  it('renders every element of it, in paint order', () => {
    mount();

    expect(
      [...canvas().querySelectorAll('.perch-element')].map((element) =>
        element.getAttribute('data-perch-element-kind'),
      ),
    ).toEqual(['media', 'text', 'widget', 'widget']);
  });

  it('shows live values once the injected source publishes', () => {
    const source = mountMock();

    expect(screen.getAllByRole('group')[0]).toHaveAttribute('data-state', 'waiting');

    act(() => {
      source.tick();
    });

    expect(screen.getAllByRole('group')[0]).toHaveAttribute('data-state', 'value');
  });

  it('leaves a topic this source never publishes waiting, rather than inventing a number', () => {
    const source = mountMock();

    act(() => {
      source.tick();
    });

    // `psu/voltage` is the deliberate gap every shipped layout carries: the mock does not publish it,
    // and a page that filled it in would make the waiting state unreachable.
    const [load, voltage] = screen.getAllByRole('group');
    expect(load).toHaveAttribute('data-state', 'value');
    expect(voltage).toHaveAttribute('data-state', 'waiting');
    expect(voltage).toHaveAttribute('aria-label', sensorTopic('psu', 'voltage'));
  });

  it('defaults to the first layout in the catalogue when none was asked for', () => {
    mount({ layout: null });

    // Sorted, so the default is stable: `oversize` before `panel`.
    expect(page()).toHaveAttribute('data-perch-layout', 'oversize');
    expect(screen.queryByTestId('perch-layout-problem')).not.toBeInTheDocument();
  });

  it('scales a layout too large for the window instead of refusing it', () => {
    mount({ layout: 'oversize' });

    // 1920x400 in a 1024x768 window: letterboxed at 1024/1920. Windowed mode cannot refuse, which is
    // what makes the layout developable in a browser tab at all.
    expect(canvas().style.transform).toBe(`scale(${1024 / 1920})`);
    expect(screen.queryByTestId('perch-layout-problem')).not.toBeInTheDocument();
  });
});

describe('<Dashboard> — a document that is not a layout', () => {
  it('puts the issues on the page rather than in a console', () => {
    mount({ layout: 'invalid/not-a-layout' });

    expect(problem()).toHaveAttribute('data-perch-problem', 'invalid-layout');
    // The panel has no console attached, so the report has to be pixels. Each of these is a distinct
    // mistake in the document, and all of them have to be legible at once.
    expect(problem()).toHaveTextContent('unknown widget');
    expect(problem()).toHaveTextContent('sparkline');
    expect(problem()).toHaveTextContent('missing required field "text"');
    expect(problem()).toHaveTextContent('custom property');
  });

  it('shows the field path of every issue, so an author can find each one', () => {
    mount({ layout: 'invalid/not-a-layout' });

    expect(problem()).toHaveTextContent('elements[0].widget');
    expect(problem()).toHaveTextContent('elements[1].text');
    expect(problem()).toHaveTextContent('theme["colour"]');
  });

  it('counts the problems in the headline', () => {
    mount({ layout: 'invalid/not-a-layout' });

    expect(screen.getByRole('heading')).toHaveTextContent(
      /invalid\/not-a-layout is not a layout: \d+ problems/,
    );
  });

  it('paints no canvas at all, rather than a partial one', () => {
    mount({ layout: 'invalid/not-a-layout' });

    // A layout is all-or-nothing: rendering the elements that happened to validate would put a
    // half-built dashboard on a wall, which is harder to diagnose than a refusal.
    expect(screen.queryByTestId('perch-canvas')).not.toBeInTheDocument();
  });

  it('never offers an invalid document as a layout', () => {
    mount({ layout: null });

    // Catalogued so `?layout=` can reach it, not offered so the page cannot default to it.
    expect(CATALOGUE.names).not.toContain('invalid/not-a-layout');
  });
});

describe('<Dashboard> — a name that is not a layout', () => {
  it('lists the layouts it does have', () => {
    mount({ layout: 'desk-1920x4000' });

    expect(problem()).toHaveAttribute('data-perch-problem', 'unknown-layout');
    expect(problem()).toHaveTextContent('no layout named desk-1920x4000');
    // A typo is the overwhelmingly likely cause, so the fix is on screen: the query strings that work.
    expect(problem()).toHaveTextContent('?layout=panel');
    expect(problem()).toHaveTextContent('?layout=oversize');
  });
});

describe('<Dashboard> — a viewport that cannot honour the layout', () => {
  it('renders 1:1 in capture mode at the declared target', () => {
    mount({ layout: 'panel', mode: 'capture' });

    expect(canvas().style.transform).toBe('scale(1)');
    expect(screen.queryByTestId('perch-layout-problem')).not.toBeInTheDocument();
  });

  it('refuses to capture a layout it would have to scale', () => {
    mount({ layout: 'oversize', mode: 'capture' });

    expect(problem()).toHaveAttribute('data-perch-problem', 'target-mismatch');
    expect(problem()).toHaveTextContent('1920x400');
    expect(problem()).toHaveTextContent('1024x768');
    // The refusal has to say what to do about it: unlike the other two, nothing is wrong with the
    // file, so a reader has no way to guess that the fix is a viewport rather than an edit.
    expect(problem()).toHaveTextContent(/size the viewport to the declared target/i);
  });

  it('paints it anyway in windowed mode, which is the same layout and the same viewport', () => {
    mount({ layout: 'oversize', mode: 'windowed' });

    expect(screen.queryByTestId('perch-layout-problem')).not.toBeInTheDocument();
    expect(canvas()).toBeInTheDocument();
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
    mount({}, { identity: { kind: 'mqtt', url: 'ws://localhost:19001' } });

    const provenance = screen.getByTestId('perch-source');

    expect(provenance).toHaveAttribute('data-perch-source-kind', 'mqtt');
    // The URL, not just the word "mqtt": on this machine the wrong broker on the wrong port is the
    // failure that looks like success, so the page has to show which one it dialled.
    expect(provenance).toHaveTextContent('ws://localhost:19001');
    expect(provenance).not.toHaveTextContent(/mock/i);
  });

  it('says so in capture mode too, which is the mode a screenshot comes from', () => {
    mount({ mode: 'capture' });

    // A mock-fed capture must be impossible to mistake for hardware later. The strip is fixed to the
    // viewport and cannot be themed or hidden by a layout, so it is in every image.
    expect(screen.getByTestId('perch-source')).toHaveTextContent(/not hardware/i);
  });

  it('says so on a refusal too, since a capture of a refusal is still evidence', () => {
    mount({ layout: 'invalid/not-a-layout' });

    expect(screen.getByTestId('perch-source')).toHaveTextContent(/not hardware/i);
    expect(screen.getByTestId('perch-layout-name')).toHaveTextContent('invalid/not-a-layout');
  });
});

/**
 * A source stuck in one status, for the two statuses a mock cannot reach.
 *
 * `createMockSource` has no transport, so by design it can report `connecting`, `live` and `stale`
 * but never `error` — and the page's whole reason for showing the status is the case where the link
 * to the relay dies. That case needs a source that can say so.
 */
function sourceStuckAt(status: SensorSourceStatus): SensorSource {
  return {
    // Nothing ever publishes: this source exists to hold a status, and the page has to render that
    // status with no readings at all, which is exactly the situation it describes.
    subscribe: (): Unsubscribe => () => undefined,
    meta: () => undefined,
    status,
  };
}

const badge = (): HTMLElement => screen.getByTestId('perch-status');

describe('<Dashboard> — what the source is doing', () => {
  it('says nothing has arrived yet before anything has', () => {
    mount();

    expect(badge()).toHaveAttribute('data-perch-status', 'connecting');
    // Not "no data" and not an empty badge: the distinction being drawn is that the page is waiting,
    // which is a different fact from the link having failed.
    expect(badge()).toHaveTextContent(/waiting for the first reading/i);
  });

  it('says readings are arriving once they are', () => {
    const source = mountMock();

    act(() => {
      source.tick();
    });

    expect(badge()).toHaveAttribute('data-perch-status', 'live');
    expect(badge()).toHaveTextContent(/readings arriving/i);
  });

  it('says the publisher went quiet when the transport is still up', () => {
    mount({}, { source: sourceStuckAt('stale') });

    expect(badge()).toHaveAttribute('data-perch-status', 'stale');
    expect(badge()).toHaveTextContent(/connected/i);
    expect(badge()).not.toHaveTextContent(/unreachable/i);
  });

  it('says the link is down when the source reports an error', () => {
    mount({}, { source: sourceStuckAt('error') });

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

describe('<Dashboard> — the ready signal', () => {
  it('reports nothing published before anything has', () => {
    mount();

    expect(page()).toHaveAttribute('data-perch-ready', 'false');
    expect(screen.getByText(/cpu\/load never published/)).toBeInTheDocument();
  });

  it('flips once a reading arrives, so a capture knows the page has numbers in it', () => {
    const source = mountMock();

    act(() => {
      source.tick();
    });

    expect(page()).toHaveAttribute('data-perch-ready', 'true');
  });

  it('watches a topic both the mock and real hardware publish', () => {
    const source = mountMock({ layout: 'oversize' });

    act(() => {
      source.tick();
    });

    // `cpu/load`, not `cpu/temperature`. The fixture captured from the live machine has no
    // `sensors/cpu/0/temperature/0` at all — its first CPU temperature is sensor index 2 — so a
    // heartbeat on that topic reads "never published" forever on a page that is in fact receiving
    // 213 readings a second. It also has to be independent of the layout: the provider subscribes to
    // the whole sensor tree, so the signal works for a layout that names no widget at all.
    expect(page()).toHaveAttribute('data-perch-ready', 'true');
  });

  it('reports the time carried by the data, so a dead page cannot look alive', () => {
    const source = mountMock();

    act(() => {
      source.tick();
    });
    const first = screen.getByText(/cpu\/load /).textContent;

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    const unchanged = screen.getByText(/cpu\/load /).textContent;

    act(() => {
      source.tick();
    });
    const second = screen.getByText(/cpu\/load /).textContent;

    // Time passing alone changes nothing; a reading does.
    expect(unchanged).toBe(first);
    expect(second).not.toBe(first);
  });

  it('is on the page root, so it covers a refusal as well as a canvas', () => {
    mount({ layout: 'invalid/not-a-layout' });

    // A harness waiting for `true` on a refused page would otherwise wait forever and time out with
    // no picture of the refusal it was sent to capture.
    expect(page()).toHaveAttribute('data-perch-ready', 'false');
    expect(page()).toHaveAttribute('data-perch-mode', 'windowed');
  });
});
