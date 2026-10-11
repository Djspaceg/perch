/**
 * The layout's clock settings in the inspector: the locale and timeZone dropdowns under Global, and
 * the preview's clock following them as they are chosen.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from './app.js';
import { createLayoutLibrary } from './layout-library.js';

const LAYOUT: Layout = {
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  target: { width: 640, height: 400, frameRate: 30 },
  theme: {},
  locale: 'en-US',
  timeZone: 'UTC',
  elements: [{ kind: 'text', text: '{weekday} {time}', rect: { x: 10, y: 10, w: 300, h: 30 } }],
};

/** A Saturday evening in UTC, and already Sunday morning in Tokyo. Spaces are normalised: en-US puts a narrow no-break space before PM. */
const NOW = Date.UTC(2026, 9, 10, 23, 30);

function renderEditor(layout: Layout = LAYOUT): ReturnType<typeof render> {
  const source = createMockSource({ autoStart: false, seed: 1 });
  return render(
    <Editor
      platform="other"
      library={createLayoutLibrary({ layouts: { 'clock-test': JSON.stringify(layout) } })}
      source={source}
      topics={source.topics}
      transport={() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })}
    />,
  );
}

/** A clock row's dropdown: the button that shows the value and opens the list. */
const dropdown = (id: string): HTMLElement =>
  within(screen.getByTestId(`perch-editor-prop-${id}`)).getByRole('button', {
    name: id === 'locale' ? 'locale' : 'timeZone',
  });

/** Open a row's dropdown and return its list of options, by what each says. */
function open(id: string): HTMLElement {
  fireEvent.click(dropdown(id));
  return screen.getByRole('dialog', { name: `choose a ${id === 'locale' ? 'locale' : 'time zone'}` });
}

const options = (dialog: HTMLElement): string[] =>
  within(dialog)
    .getAllByRole('option')
    .map((option) => option.textContent);

const chosen = (dialog: HTMLElement): HTMLElement | undefined =>
  within(dialog)
    .getAllByRole('option')
    .find((option) => option.getAttribute('aria-selected') === 'true');

const painted = (result: ReturnType<typeof render>): string =>
  result
    .getByTestId('perch-canvas')
    .querySelector('.perch-text__body')
    ?.textContent.replace(/\s/g, ' ') ?? '';

describe('the layout clock rows', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the layout locale and time zone under Global, as dropdowns', () => {
    renderEditor();
    const global = within(screen.getByRole('region', { name: 'Global' }));

    expect(global.getByTestId('perch-editor-prop-locale')).toBeInTheDocument();
    expect(dropdown('locale')).toHaveTextContent('English (United States) - en-US');
    expect(dropdown('timeZone')).toHaveTextContent('UTC');
    expect(screen.queryByTestId('perch-editor-prop-locale')?.querySelector('input')).toBeNull();
  });

  it('lists System default first, then common locales each in its own language', () => {
    renderEditor();
    const dialog = open('locale');
    const listed = options(dialog);

    expect(listed[0]).toBe('System default');
    expect(listed).toContain('English (United Kingdom) - en-GB');
    expect(listed).toContain('Deutsch (Deutschland) - de-DE');
    expect(listed).toContain('日本語 (日本) - ja-JP');
    expect(chosen(dialog)).toHaveTextContent('en-US');
  });

  it('lists every time zone the engine knows, searchable, after System default', () => {
    renderEditor();
    const dialog = open('timeZone');
    const all = options(dialog);

    expect(all[0]).toBe('System default');
    expect(all.length).toBeGreaterThan(300);
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'tokyo' } });
    expect(options(dialog).map((text) => text.split(' ')[0])).toEqual(['Asia/Tokyo']);
  });

  it('repaints the preview clock in the locale and zone chosen', () => {
    const result = renderEditor();
    expect(painted(result)).toBe('Saturday 11:30 PM');

    fireEvent.click(within(open('locale')).getByRole('option', { name: /de-DE$/ }));
    expect(painted(result)).toBe('Samstag 23:30');
    expect(dropdown('locale')).toHaveTextContent('Deutsch (Deutschland) - de-DE');

    const zones = open('timeZone');
    fireEvent.change(within(zones).getByRole('searchbox'), { target: { value: 'tokyo' } });
    fireEvent.click(within(zones).getByRole('option', { name: /^Asia\/Tokyo/ }));
    expect(painted(result)).toBe('Sonntag 8:30');
  });

  it('removes the field when System default is chosen', () => {
    renderEditor();
    fireEvent.click(within(open('locale')).getByRole('option', { name: 'System default' }));

    expect(dropdown('locale')).toHaveTextContent('System default');
  });

  it('keeps a stored value no list has, shown and selected', () => {
    renderEditor({ ...LAYOUT, locale: 'eu-ES', timeZone: 'US/Pacific' });

    expect(dropdown('locale')).toHaveTextContent('eu-ES');
    expect(chosen(open('locale'))).toHaveTextContent('eu-ES');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(dropdown('timeZone')).toHaveTextContent('US/Pacific');
    expect(chosen(open('timeZone'))).toHaveTextContent('US/Pacific');
  });

  it('offers a typed value as "use ..." only when nothing listed matches it', () => {
    renderEditor();
    const locales = open('locale');
    fireEvent.change(within(locales).getByRole('searchbox'), { target: { value: 'deutsch' } });
    expect(options(locales).some((text) => text.startsWith('use'))).toBe(false);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    const zones = open('timeZone');
    fireEvent.change(within(zones).getByRole('searchbox'), { target: { value: 'Etc/GMT+5' } });
    fireEvent.click(within(zones).getByRole('option', { name: 'use Etc/GMT+5' }));
    expect(dropdown('timeZone')).toHaveTextContent('Etc/GMT+5');
  });
});
