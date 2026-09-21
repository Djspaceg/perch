/**
 * The `text` element, checked for the two things that make it safe on a canvas of absolute rects:
 * it never grows past its box, and it breaks only where the author broke it.
 *
 * jsdom has no layout engine, so "does not grow" cannot be measured in pixels. It can be read off
 * the cascade, which jsdom does resolve: the containment is declared (`overflow: hidden`,
 * `min-width: 0`, a box that is exactly its rect) rather than emergent, which is why the declaration
 * is the thing asserted.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TEXT_BLOCK_STYLES, TextBlock } from '@perch/ui-kit';

function mount(text: string): HTMLElement {
  render(
    <>
      {/* The sheet mounted the way the page mounts it, so the cascade below is the real one. */}
      <style>{TEXT_BLOCK_STYLES}</style>
      <TextBlock text={text} />
    </>,
  );

  const element = document.querySelector('.perch-text');
  if (!(element instanceof HTMLElement)) throw new Error('no text block rendered');
  return element;
}

function bodyOf(block: HTMLElement): HTMLElement {
  const body = block.querySelector('.perch-text__body');
  if (!(body instanceof HTMLElement)) throw new Error('no body in the rendered text block');
  return body;
}

describe('<TextBlock>', () => {
  it('paints the authored string verbatim', () => {
    const block = mount('GPU CORE');

    expect(bodyOf(block).textContent).toBe('GPU CORE');
    expect(screen.getByText('GPU CORE')).toBeInTheDocument();
  });

  it('keeps the author’s line breaks and adds none of its own', () => {
    const block = mount('THERMALS\nlower is better');

    // The newline survives into the DOM, and `pre-line` is what makes it a break on screen rather
    // than collapsed whitespace. Both halves matter: the string alone would wrap wherever the rect
    // ran out, which is the responsive reflow this coordinate system exists to avoid.
    expect(bodyOf(block).textContent).toBe('THERMALS\nlower is better');
    expect(getComputedStyle(bodyOf(block)).whiteSpace).toBe('pre-line');
  });

  it('fills its rect exactly and clips rather than spilling onto its neighbour', () => {
    const block = mount('a caption far longer than the rect the layout gave it');

    const style = getComputedStyle(block);
    expect(style.width).toBe('100%');
    expect(style.height).toBe('100%');
    expect(style.overflow).toBe('hidden');
    expect(style.minWidth).toBe('0px');
  });

  it('clips hard instead of ellipsising, because a clipped word is still a word', () => {
    const block = mount('GPU CORE');

    // The opposite of the readout's rule, and deliberately so: a truncated number is a wrong
    // number, where a truncated caption is a short caption.
    expect(getComputedStyle(bodyOf(block)).textOverflow).not.toBe('ellipsis');
  });

  it('renders nothing pointer-driven and nothing focusable', () => {
    const block = mount('GPU CORE');

    expect(block).not.toHaveAttribute('tabindex');
    expect(block.outerHTML).not.toMatch(/\son[a-z]+=/);
    expect(block.querySelector('a, button, input, [tabindex]')).toBeNull();
  });

  it('paints identical markup for identical text, in two independent trees', () => {
    render(<TextBlock text="THERMALS" />);
    render(<TextBlock text="THERMALS" />);

    const [a, b] = Array.from(document.querySelectorAll('.perch-text'));
    expect(a?.outerHTML).toBe(b?.outerHTML);
  });
});

describe('TEXT_BLOCK_STYLES', () => {
  it('has no hover, focus or active affordance, because there is no pointer', () => {
    expect(TEXT_BLOCK_STYLES).not.toMatch(/:hover/);
    expect(TEXT_BLOCK_STYLES).not.toMatch(/:focus/);
    expect(TEXT_BLOCK_STYLES).not.toMatch(/:active/);
  });

  it('has no transition or animation, because a capture frame has no time for one', () => {
    expect(TEXT_BLOCK_STYLES).not.toMatch(/transition/);
    expect(TEXT_BLOCK_STYLES).not.toMatch(/animation/);
  });

  it('leaves placement to the theme, so a layout can centre a title without a schema field', () => {
    expect(TEXT_BLOCK_STYLES).toMatch(/justify-content:\s*var\(--perch-text-justify/);
    expect(TEXT_BLOCK_STYLES).toMatch(/align-items:\s*var\(--perch-text-anchor/);
  });
});
