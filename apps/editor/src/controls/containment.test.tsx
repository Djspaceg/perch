/**
 * Nothing in the sidebar may push it sideways: a long value truncates inside its own box.
 *
 * jsdom lays nothing out, so it cannot see one element painting over another, and it cannot measure a
 * `scrollWidth`. What it does compute is the cascade: `getComputedStyle` resolves the sheets below
 * onto the real elements. So these tests pin the containment rules themselves, on the elements the
 * primitives actually render — a `min-width: 0` on every flex and grid child between the sidebar and
 * a value, and truncation with an ellipsis on the one-line texts that carry authored content — and
 * leave the visible overlap to the screenshot in the evidence, which is the check that can see it.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { CHROME_STYLES } from './chrome.js';
import { CONTROLS_STYLES } from './index.js';
import { PropertyRow } from './property-row.js';
import { Section } from './section.js';

/** The prose from the reported screenshot, long enough to overflow any bar. */
const LONG =
  'psu voltage is not published by this source, so its tile waits by design every other tile on this panel reads a live value';

beforeEach(() => {
  const style = document.createElement('style');
  style.textContent = CONTROLS_STYLES;
  document.head.append(style);

  return () => {
    style.remove();
  };
});

describe('Section keeps a long summary inside its own bar', () => {
  it('truncates the summary with an ellipsis, and keeps the whole text as its tooltip', () => {
    render(
      <Section id="test/content" title="Content" summary={LONG}>
        <p>body</p>
      </Section>,
    );
    const summary = screen.getByText(LONG);
    const style = getComputedStyle(summary);

    expect(summary).toHaveClass('perch-section__summary');
    expect(summary).toHaveAttribute('title', LONG);
    expect(style.overflow).toBe('hidden');
    expect(style.textOverflow).toBe('ellipsis');
    expect(style.whiteSpace).toBe('nowrap');
    // It may shrink, and below its content: `flex: none` is what let it paint over the title.
    expect(style.flexShrink).toBe('1');
    expect(style.minWidth).toBe('0px');
  });

  it('never lets the summary squeeze the title: the heading keeps its width', () => {
    render(
      <Section id="test/content" title="Content" summary={LONG}>
        <p>body</p>
      </Section>,
    );
    const heading = screen.getByRole('heading', { name: 'Content' });

    expect(heading).toHaveClass('perch-section__heading');
    expect(getComputedStyle(heading).flexShrink).toBe('0');
    // The bar and the section are flex children of a column; both must be allowed to be narrower
    // than their content, or the content widens the scroller instead of truncating.
    expect(getComputedStyle(heading.parentElement ?? heading).minWidth).toBe('0px');
    expect(getComputedStyle(heading.closest('section') ?? heading).minWidth).toBe('0px');
  });

  it('gives a summary that is not a string no tooltip, rather than "[object Object]"', () => {
    render(
      <Section id="test/content" title="Content" summary={<b>two set</b>}>
        <p>body</p>
      </Section>,
    );

    expect(screen.getByText('two set').closest('.perch-section__summary')).not.toHaveAttribute(
      'title',
    );
  });
});

describe('PropertyRow keeps a long value inside the value column', () => {
  it('lets the row and its value column be narrower than what they hold', () => {
    render(
      <PropertyRow label="text" testId="row">
        {(ids) => <input id={ids.controlId} className="perch-input" defaultValue={LONG} />}
      </PropertyRow>,
    );
    const row = screen.getByTestId('row');
    const value = row.querySelector('.perch-row__value');
    if (!(value instanceof HTMLElement)) throw new Error('no value column');

    expect(row).toHaveClass('perch-row');
    expect(getComputedStyle(row).minWidth).toBe('0px');
    expect(getComputedStyle(row).gridTemplateColumns).toContain('minmax(0, 1fr)');
    expect(getComputedStyle(value).minWidth).toBe('0px');
    expect(getComputedStyle(screen.getByLabelText('text')).minWidth).toBe('0px');
  });
});

describe('the editor scrollbar', () => {
  /** Every rule in a sheet, as `[selector, declarations]`. */
  function rules(css: string): readonly (readonly [string, CSSStyleDeclaration])[] {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    const found = [...(style.sheet?.cssRules ?? [])]
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
      .map((rule) => [rule.selectorText, rule.style] as const);
    style.remove();

    return found;
  }

  it('declares its thumb and track as chrome variables', () => {
    const root = rules(CHROME_STYLES).find(([selector]) => selector === ':root')?.[1];

    expect(root?.getPropertyValue('--ed-scroll-thumb')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(root?.getPropertyValue('--ed-scroll-thumb-hover')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(root?.getPropertyValue('--ed-scroll-track')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('paints every scroller in the editor with them, standard properties and WebKit alike', () => {
    const sheet = rules(CHROME_STYLES);
    const declared = (selector: string, property: string): string =>
      sheet.find(([name]) => name === selector)?.[1].getPropertyValue(property) ?? '';

    // `scrollbar-color` inherits, so set at the root it reaches every scroller on the page — the
    // sidebar, the problems list, a textarea — without each one opting in.
    expect(declared(':root', 'scrollbar-color')).toBe(
      'var(--ed-scroll-thumb) var(--ed-scroll-track)',
    );
    expect(declared(':root', 'scrollbar-width')).toBe('thin');
    // Safari reads only the pseudo-elements, and they do not inherit, so they are unscoped.
    expect(declared('::-webkit-scrollbar-thumb', 'background-color')).toBe(
      'var(--ed-scroll-thumb)',
    );
    expect(declared('::-webkit-scrollbar-thumb:hover', 'background-color')).toBe(
      'var(--ed-scroll-thumb-hover)',
    );
    expect(declared('::-webkit-scrollbar-track', 'background-color')).toBe(
      'var(--ed-scroll-track)',
    );
    expect(declared('::-webkit-scrollbar', 'width')).not.toBe('');
  });
});
