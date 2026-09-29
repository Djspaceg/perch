/**
 * The background browser: tabs per category, a grid of lazily loaded thumbnails shaped like the
 * layout's canvas, keyboard navigable, and a pick that downloads before it sets anything.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundSource } from '@perch/ui-kit';
import { BackgroundBrowser, BackgroundField, columnsFor } from './background-picker.js';
import { BackgroundContext, type BackgroundHost, type Thumbnail } from './background-host.js';

const TARGET = { width: 1920, height: 400 };

/** Cells made visible by the test, as an IntersectionObserver would report them. */
let observed: Map<Element, IntersectionObserverCallback>;

class FakeObserver {
  private readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(element: Element): void {
    observed.set(element, this.callback);
  }
  unobserve(element: Element): void {
    observed.delete(element);
  }
  disconnect(): void {
    observed.clear();
  }
}

function reveal(name: string): void {
  const cell = screen.getByRole('option', { name });
  const callback = observed.get(cell);
  if (callback === undefined) throw new Error(`${name} is not observed`);
  act(() => {
    callback(
      [{ target: cell, isIntersecting: true } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

beforeEach(() => {
  observed = new Map();
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function hostWith(
  overrides: Partial<BackgroundHost> = {},
): BackgroundHost & { ensure: ReturnType<typeof vi.fn>; preview: ReturnType<typeof vi.fn> } {
  return {
    ensure: vi.fn((): Promise<BackgroundSource> =>
      Promise.resolve({ status: 'ready', url: 'perch-cache://backgrounds/x.mp4' }),
    ),
    preview: vi.fn((ref: string): Promise<Thumbnail> =>
      Promise.resolve({
        status: 'ready',
        kind: 'image',
        url: `perch-cache://backgrounds/${ref}.png`,
      }),
    ),
    ...overrides,
  } as BackgroundHost & { ensure: ReturnType<typeof vi.fn>; preview: ReturnType<typeof vi.fn> };
}

function mount(
  host: BackgroundHost,
  current = '',
  onPicked = vi.fn(),
): { onPicked: typeof onPicked } {
  render(<BackgroundBrowser host={host} target={TARGET} current={current} onPicked={onPicked} />);
  return { onPicked };
}

describe('columnsFor', () => {
  it('gives a wide panel few wide cells and a tall one many narrow ones', () => {
    expect(columnsFor({ width: 1920, height: 400 })).toBe(2);
    expect(columnsFor({ width: 480, height: 480 })).toBe(5);
    expect(columnsFor({ width: 720, height: 1280 })).toBe(6);
    expect(columnsFor({ width: 172, height: 6400 })).toBe(8);
  });
});

describe('<BackgroundBrowser>', () => {
  it('has a tab per category, opening on Gallery, each cell an option named for a person', () => {
    mount(hostWith());

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Gallery',
      'Tech',
      'HUD',
      'Light',
      'Nature',
      'Aesthetic',
    ]);
    const list = screen.getByRole('listbox', { name: 'Gallery backgrounds' });
    const options = within(list).getAllByRole('option');
    expect(options).toHaveLength(82);
    expect(options[41]).toHaveAccessibleName('Gallery 42');
  });

  it("shapes every cell like the layout's canvas", () => {
    mount(hostWith());

    const cell = screen.getByRole('option', { name: 'Gallery 1' });
    expect(cell.style.aspectRatio).toBe('1920 / 400');
    expect(screen.getByRole('listbox').style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
  });

  it('opens on the tab of the current background, marking it selected', () => {
    mount(hostWith(), 'thermalright:c007');

    expect(screen.getByRole('tab', { name: 'HUD' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'HUD 7' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'HUD 8' })).toHaveAttribute('aria-selected', 'false');
  });

  it('asks for a thumbnail only once its cell scrolls into view, and shows it covering the cell', async () => {
    const host = hostWith();
    mount(host);
    expect(host.preview).not.toHaveBeenCalled();

    reveal('Gallery 3');
    await act(async () => {
      await Promise.resolve();
    });

    expect(host.preview).toHaveBeenCalledTimes(1);
    expect(host.preview).toHaveBeenCalledWith('thermalright:a003', TARGET);
    const image = screen.getByRole('option', { name: 'Gallery 3' }).querySelector('img');
    expect(image?.getAttribute('src')).toBe('perch-cache://backgrounds/thermalright:a003.png');
  });

  it("shows a video's first frame when the thumbnail is the video", async () => {
    const host = hostWith({
      preview: vi.fn(() =>
        Promise.resolve<Thumbnail>({
          status: 'ready',
          kind: 'video',
          url: 'perch-cache://backgrounds/h.mp4',
        }),
      ),
    });
    mount(host);
    reveal('Gallery 1');
    await act(async () => {
      await Promise.resolve();
    });

    const video = screen.getByRole('option', { name: 'Gallery 1' }).querySelector('video');
    expect(video?.getAttribute('src')).toBe('perch-cache://backgrounds/h.mp4#t=0.1');
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect(video?.muted).toBe(true);
  });

  it('moves by one with left and right, by a row with up and down, and to the ends with Home and End', () => {
    mount(hostWith());
    const option = (name: string): HTMLElement => screen.getByRole('option', { name });

    option('Gallery 1').focus();
    fireEvent.keyDown(option('Gallery 1'), { key: 'ArrowRight' });
    expect(option('Gallery 2')).toHaveFocus();
    fireEvent.keyDown(option('Gallery 2'), { key: 'ArrowDown' });
    expect(option('Gallery 4')).toHaveFocus();
    fireEvent.keyDown(option('Gallery 4'), { key: 'ArrowLeft' });
    expect(option('Gallery 3')).toHaveFocus();
    fireEvent.keyDown(option('Gallery 3'), { key: 'ArrowUp' });
    expect(option('Gallery 1')).toHaveFocus();
    fireEvent.keyDown(option('Gallery 1'), { key: 'End' });
    expect(option('Gallery 82')).toHaveFocus();
    fireEvent.keyDown(option('Gallery 82'), { key: 'Home' });
    expect(option('Gallery 1')).toHaveFocus();
    // One tab stop into the grid.
    expect(option('Gallery 1')).toHaveAttribute('tabindex', '0');
    expect(option('Gallery 2')).toHaveAttribute('tabindex', '-1');
  });

  it('downloads on Enter, shows it working, and hands over the reference once it is cached', async () => {
    let finish: (value: BackgroundSource) => void = () => undefined;
    const host = hostWith({
      ensure: vi.fn(
        () =>
          new Promise<BackgroundSource>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const { onPicked } = mount(host);
    const cell = screen.getByRole('option', { name: 'Gallery 42' });

    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(host.ensure).toHaveBeenCalledWith('thermalright:a042', TARGET);
    expect(cell).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('downloading Gallery 42');
    expect(onPicked).not.toHaveBeenCalled();

    await act(async () => {
      finish({ status: 'ready', url: 'perch-cache://backgrounds/thermalright/1920x440/a042.mp4' });
      await Promise.resolve();
    });
    expect(onPicked).toHaveBeenCalledWith('thermalright:a042');
  });

  it('says why a download failed, sets nothing, and lets another be tried', async () => {
    const host = hostWith({
      ensure: vi.fn(() =>
        Promise.resolve<BackgroundSource>({
          status: 'failed',
          reason: 'international: HTTP 404; china: HTTP 404',
        }),
      ),
    });
    const { onPicked } = mount(host);

    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'Gallery 5' }));
      await Promise.resolve();
    });

    expect(onPicked).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'could not download Gallery 5: international: HTTP 404; china: HTTP 404',
    );
    expect(screen.getByRole('option', { name: 'Gallery 5' })).toHaveAttribute(
      'data-state',
      'failed',
    );
    expect(screen.getByRole('option', { name: 'Gallery 5' })).not.toHaveAttribute('aria-busy');
  });

  it('switches category with the tabs', () => {
    mount(hostWith());

    fireEvent.click(screen.getByRole('tab', { name: 'Aesthetic' }));
    expect(
      within(screen.getByRole('listbox', { name: 'Aesthetic backgrounds' })).getAllByRole('option'),
    ).toHaveLength(10);
  });
});

describe('<BackgroundField>', () => {
  function field(
    value: string,
    onValue = vi.fn(),
    // `null` for no host: an explicit `undefined` would take the default.
    host: BackgroundHost | null = hostWith(),
  ): void {
    render(
      <BackgroundContext.Provider value={{ host: host ?? undefined, target: TARGET }}>
        <BackgroundField value={value} onValue={onValue} />
      </BackgroundContext.Provider>,
    );
  }

  it('names the current background, or none', () => {
    field('thermalright:a042');
    expect(screen.getByRole('button', { name: /choose a background/ })).toHaveTextContent(
      'Gallery 42',
    );
  });

  it('says none for an image path', () => {
    field('desk.assets/rails.svg');
    expect(screen.getByRole('button', { name: /choose a background/ })).toHaveTextContent('none');
  });

  it('opens the browser, and closes it once a pick is set', async () => {
    const onValue = vi.fn();
    field('', onValue);

    fireEvent.click(screen.getByRole('button', { name: /choose a background/ }));
    expect(screen.getByRole('dialog', { name: 'choose a background' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'Gallery 2' }));
      await Promise.resolve();
    });
    expect(onValue).toHaveBeenCalledWith('thermalright:a002');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is disabled, saying why, where there is no cache to fetch into', () => {
    field('', vi.fn(), null);
    const button = screen.getByRole('button', { name: /choose a background/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringMatching(/no background cache/));
  });
});

describe('<BackgroundBrowser> — an item not hosted at this size', () => {
  it('says so in the cell, keeping the reason for the tooltip', async () => {
    const reason = 'not hosted at 1920x440 (international: HTTP 404; china: HTTP 404)';
    const host = hostWith({
      preview: vi.fn(() => Promise.resolve<Thumbnail>({ status: 'failed', reason })),
    });
    mount(host);
    reveal('Gallery 42');
    await act(async () => {
      await Promise.resolve();
    });

    const cell = screen.getByRole('option', { name: 'Gallery 42' });
    expect(cell).toHaveAttribute('data-state', 'failed');
    expect(within(cell).getByText('not at this size')).toHaveAttribute('title', reason);
  });
});
