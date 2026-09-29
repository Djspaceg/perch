/**
 * The video background: a `<video>` that plays on its own, silently, forever, inside the media
 * element's box, and that stops spending a decoder while nobody can see it.
 */

import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT_CANVAS_STYLES, VIDEO_BACKGROUND_STYLES, VideoBackground } from '@perch/ui-kit';

const URL = 'perch-cache://backgrounds/thermalright/1920x440/a042.mp4';

function videoOf(container: HTMLElement): HTMLVideoElement {
  const video = container.querySelector('video');
  if (!(video instanceof HTMLVideoElement)) throw new Error('no video rendered');
  return video;
}

let hidden = false;
Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });

afterEach(() => {
  hidden = false;
  vi.restoreAllMocks();
});

describe('<VideoBackground>', () => {
  it('is a muted, looping, inline, autoplaying video at the URL it was handed, with no controls', () => {
    const { container } = render(<VideoBackground src={URL} />);
    const video = videoOf(container);

    expect(video.getAttribute('src')).toBe(URL);
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.hasAttribute('controls')).toBe(false);
    // Decorative, like a media element's image: it has no description to read out.
    expect(video).toHaveAttribute('aria-hidden', 'true');
  });

  it("sits in the media element's box, so its fit and its opacity token apply", () => {
    const { container } = render(<VideoBackground src={URL} fit="contain" />);
    const box = container.querySelector('.perch-media');

    expect(box).toHaveAttribute('data-fit', 'contain');
    expect(
      render(<VideoBackground src={URL} />).container.querySelector('.perch-media'),
    ).toHaveAttribute('data-fit', 'cover');
    expect(VIDEO_BACKGROUND_STYLES).toMatch(
      /\[data-fit='cover'\] \.perch-media__video \{ object-fit: cover; \}/,
    );
    expect(VIDEO_BACKGROUND_STYLES).toMatch(/object-position: center/);
    expect(LAYOUT_CANVAS_STYLES).toContain(VIDEO_BACKGROUND_STYLES);
  });

  it('pauses while the page is hidden and plays again when it is shown', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    render(<VideoBackground src={URL} />);
    play.mockClear();

    act(() => {
      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(pause).toHaveBeenCalledTimes(1);

    act(() => {
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('stops listening once it is gone', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const { unmount } = render(<VideoBackground src={URL} />);
    unmount();

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(pause).not.toHaveBeenCalled();
  });
});
