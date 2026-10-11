/**
 * A label's text as a template in the editor: the insert picker puts a sensor or a clock token at the
 * caret, the preview paints it live, and a malformed template is refused by character.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Editor } from './app.js';
import { createLayoutLibrary } from './layout-library.js';
import { CLOCK_PLACEHOLDERS, insertAt } from './template-field.js';

const LAYOUT: Layout = {
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  target: { width: 640, height: 400, frameRate: 30 },
  theme: {},
  locale: 'en-US',
  timeZone: 'UTC',
  elements: [{ kind: 'text', text: 'fan ', rect: { x: 10, y: 10, w: 300, h: 30 } }],
};

type Result = ReturnType<typeof render>;

function renderEditor(): { result: Result; source: ReturnType<typeof createMockSource> } {
  const source = createMockSource({ autoStart: false, seed: 1 });
  const result = render(
    <Editor
      platform="other"
      library={createLayoutLibrary({ layouts: { 'tpl-test': JSON.stringify(LAYOUT) } })}
      source={source}
      topics={source.topics}
      transport={() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })}
    />,
  );
  const row = result
    .getByTestId('perch-editor-elements')
    .querySelector<HTMLElement>('[data-perch-layer-index="0"]');
  if (row === null) throw new Error('no element row');
  fireEvent.click(row);
  return { result, source };
}

const textField = (): HTMLTextAreaElement => {
  const field = within(screen.getByTestId('perch-editor-prop-text')).getByRole('textbox');
  if (!(field instanceof HTMLTextAreaElement)) throw new Error('text is not a textarea');
  return field;
};
const painted = (result: Result): string =>
  result.getByTestId('perch-canvas').querySelector('.perch-text__body')?.textContent ?? '';
const openPicker = (): void => {
  fireEvent.click(screen.getByRole('button', { name: /^insert a sensor or the clock/ }));
};

describe('insertAt', () => {
  it('replaces the selection and puts the caret after what went in', () => {
    expect(insertAt('ab cd', 3, 5, '{time}')).toEqual({ text: 'ab {time}', caret: 9 });
    expect(insertAt('ab', 9, 9, 'x')).toEqual({ text: 'abx', caret: 3 });
  });
});

describe('CLOCK_PLACEHOLDERS', () => {
  it('lists each token bare, then each further variant', () => {
    expect(CLOCK_PLACEHOLDERS.slice(0, 3)).toEqual(['{time}', '{time:seconds}', '{date}']);
    expect(CLOCK_PLACEHOLDERS).toContain('{month:short}');
    expect(CLOCK_PLACEHOLDERS).not.toContain('{time:short}');
  });
});

describe('the text field as a template', () => {
  it('inserts a clock token at the caret, and the preview paints it', () => {
    const { result } = renderEditor();
    textField().setSelectionRange(0, 0);

    openPicker();
    fireEvent.click(screen.getByRole('tab', { name: 'Clock' }));
    fireEvent.click(screen.getByRole('button', { name: /^\{year\}/ }));

    expect(textField().value).toBe('{year}fan ');
    expect(painted(result)).toBe(`${new Date().getUTCFullYear()}fan `);
  });

  it('inserts a sensor, which paints its fallback until it reads, then its value', () => {
    const { result, source } = renderEditor();
    textField().setSelectionRange(4, 4);

    openPicker();
    const sensors = screen.getByRole('dialog', { name: 'insert a placeholder' });
    const topic = source.topics[0];
    if (topic === undefined) throw new Error('the mock source has no topics');
    fireEvent.change(within(sensors).getByRole('searchbox'), { target: { value: topic } });
    fireEvent.keyDown(within(sensors).getByRole('searchbox'), { key: 'Enter' });

    expect(textField().value).toBe(`fan {${topic}}`);
    expect(painted(result)).toBe('fan --');
    act(() => {
      source.tick();
    });
    expect(painted(result)).not.toBe('fan --');
  });

  it('refuses a malformed template by character, and keeps painting the last good one', () => {
    const { result } = renderEditor();

    fireEvent.change(textField(), { target: { value: 'fan {mmm}' } });

    expect(result.container.textContent).toContain('at character 5: unknown token "mmm"');
    expect(painted(result)).toBe('fan ');
  });
});
