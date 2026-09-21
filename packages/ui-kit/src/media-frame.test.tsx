/**
 * The `media` element, checked for what a capture depends on: the asset is an `<img>` (so its
 * arrival is observable), the `src` is used exactly as given (so path resolution stays the
 * caller's job), and each fit is actually implemented rather than merely accepted.
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  MEDIA_FRAME_FITS,
  MEDIA_FRAME_STYLES,
  MediaFrame,
  type MediaFrameFit,
} from '@perch/ui-kit';

const ASSET = '/assets/grid-abc123.svg';

function mount(props: { src?: string; fit?: MediaFrameFit; alt?: string } = {}): HTMLElement {
  render(
    <>
      <style>{MEDIA_FRAME_STYLES}</style>
      <MediaFrame
        src={props.src ?? ASSET}
        {...(props.fit === undefined ? {} : { fit: props.fit })}
        {...(props.alt === undefined ? {} : { alt: props.alt })}
      />
    </>,
  );

  const element = document.querySelector('.perch-media');
  if (!(element instanceof HTMLElement)) throw new Error('no media frame rendered');
  return element;
}

function imageOf(frame: HTMLElement): HTMLImageElement {
  const image = frame.querySelector('img');
  if (!(image instanceof HTMLImageElement)) throw new Error('no image in the rendered media frame');
  return image;
}

describe('<MediaFrame>', () => {
  it('paints the URL it was handed, untouched', () => {
    const frame = mount({ src: ASSET });

    // The attribute, not `image.src`: the DOM property resolves against the document base and would
    // hide a component that had prefixed or rewritten the path. This component must not.
    expect(imageOf(frame).getAttribute('src')).toBe(ASSET);
  });

  it('uses an <img>, so the capture path can observe the asset arriving', () => {
    const frame = mount();

    // A CSS background would render the same and be unobservable — there is no load event for one,
    // and the page's ready signal is built on that event.
    expect(imageOf(frame).tagName).toBe('IMG');
    expect(MEDIA_FRAME_STYLES).not.toMatch(/background-image/);
  });

  it('defaults to cover, matching the layout format’s own default', () => {
    const frame = mount();

    expect(frame).toHaveAttribute('data-fit', 'cover');
  });

  it.each(MEDIA_FRAME_FITS)('marks and implements the %s fit', (fit) => {
    const frame = mount({ fit });

    expect(frame).toHaveAttribute('data-fit', fit);
    // Declared, not just labelled: a `data-fit` with no matching rule would paint as the default and
    // an author would have no way to tell their `fit` was ignored.
    expect(getComputedStyle(imageOf(frame)).objectFit).toBe(fit);
  });

  it('marks the image decorative by default, because the format has no description field', () => {
    const frame = mount();

    // An empty `alt` is the removal from the accessibility tree, and it must be present-and-empty
    // rather than absent — an absent `alt` makes a screen reader read the filename.
    expect(imageOf(frame).getAttribute('alt')).toBe('');
  });

  it('uses a description when the caller knows one', () => {
    const frame = mount({ alt: 'a faint dot grid' });

    expect(imageOf(frame).getAttribute('alt')).toBe('a faint dot grid');
  });

  it('fills its rect exactly and clips the overflow a cover fit produces', () => {
    const frame = mount({ fit: 'cover' });

    const style = getComputedStyle(frame);
    expect(style.width).toBe('100%');
    expect(style.height).toBe('100%');
    expect(style.overflow).toBe('hidden');
  });

  it('renders nothing pointer-driven and nothing focusable', () => {
    const frame = mount();

    expect(frame).not.toHaveAttribute('tabindex');
    expect(frame.outerHTML).not.toMatch(/\son[a-z]+=/);
    expect(frame.querySelector('a, button, input, [tabindex]')).toBeNull();
  });
});

describe('MEDIA_FRAME_FITS', () => {
  it('enumerates exactly the fits the type allows', () => {
    // The list a consumer checks its own vocabulary against — `ui-kit` may not import
    // `layout-schema`, so this array is one half of the pair that stops the two drifting.
    const asRecord: Record<MediaFrameFit, true> = { cover: true, contain: true };
    expect([...MEDIA_FRAME_FITS].sort()).toEqual(Object.keys(asRecord).sort());
  });

  it('is frozen, so a consumer cannot widen the vocabulary at runtime', () => {
    expect(Object.isFrozen(MEDIA_FRAME_FITS)).toBe(true);
  });
});

describe('MEDIA_FRAME_STYLES', () => {
  it('has no hover, focus or active affordance, because there is no pointer', () => {
    expect(MEDIA_FRAME_STYLES).not.toMatch(/:hover/);
    expect(MEDIA_FRAME_STYLES).not.toMatch(/:focus/);
    expect(MEDIA_FRAME_STYLES).not.toMatch(/:active/);
  });

  it('has no transition or animation, because a capture frame has no time for one', () => {
    expect(MEDIA_FRAME_STYLES).not.toMatch(/transition/);
    expect(MEDIA_FRAME_STYLES).not.toMatch(/animation/);
  });

  it('lets a theme hold a background image back without a second asset', () => {
    expect(MEDIA_FRAME_STYLES).toMatch(/opacity:\s*var\(--perch-media-opacity/);
  });
});
