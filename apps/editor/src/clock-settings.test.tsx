/**
 * The layout's clock settings in the inspector: the locale and timeZone rows under Global, and the
 * preview's clock following them as they are typed.
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

function renderEditor(): ReturnType<typeof render> {
  const source = createMockSource({ autoStart: false, seed: 1 });
  return render(
    <Editor
      platform="other"
      library={createLayoutLibrary({ layouts: { 'clock-test': JSON.stringify(LAYOUT) } })}
      source={source}
      topics={source.topics}
      transport={() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })}
    />,
  );
}

const field = (id: string): HTMLInputElement => {
  const input = within(screen.getByTestId(`perch-editor-prop-${id}`)).getByRole('textbox');
  if (!(input instanceof HTMLInputElement)) throw new Error(`${id} is not an input`);
  return input;
};
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

  it('shows the layout locale and time zone under Global', () => {
    renderEditor();
    const global = within(screen.getByRole('region', { name: 'Global' }));

    expect(global.getByTestId('perch-editor-prop-locale')).toBeInTheDocument();
    expect(field('locale').value).toBe('en-US');
    expect(field('timeZone').value).toBe('UTC');
  });

  it('repaints the preview clock in the locale and zone typed', () => {
    const result = renderEditor();
    expect(painted(result)).toBe('Saturday 11:30 PM');

    fireEvent.change(field('locale'), { target: { value: 'de-DE' } });
    expect(painted(result)).toBe('Samstag 23:30');

    fireEvent.change(field('timeZone'), { target: { value: 'Asia/Tokyo' } });
    expect(painted(result)).toBe('Sonntag 8:30');
  });
});
