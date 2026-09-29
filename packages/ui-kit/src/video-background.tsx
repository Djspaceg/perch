/**
 * A video painted at a rect: a media element whose `src` is a cloud background, as pixels.
 *
 * `MediaFrame`'s video sibling, and deliberately as small: the renderer is a browser, so a background
 * video is a `<video>` that plays itself — `autoplay`, `muted` (which is also what lets autoplay
 * start without a gesture), `loop`, `playsinline`, and no controls, since nothing on a panel is
 * interacted with. It sits in the same `.perch-media` box as the image, so the element's rect, its
 * `fit` and `--perch-media-opacity` apply to it exactly as they do to an image; `cover` fills the
 * rect and crops centred, which is what a background is for.
 *
 * `src` is a URL the *caller* resolved from the layout's reference through its host's cache. This
 * component knows no reference, no cache and no network; see `background-sources.ts`.
 *
 * Paused while the page is hidden: a decoder running for a window nobody can see is the one cost of
 * a looping video worth a listener, and the desktop runner's window spends most of its life hidden.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import type { MediaFrameFit } from './media-frame.js';

export interface VideoBackgroundProps {
  /** The resolved URL of the video. */
  src: string;
  /** Defaults to `cover`, the layout format's own default for media. */
  fit?: MediaFrameFit | undefined;
}

export function VideoBackground({ src, fit = 'cover' }: VideoBackgroundProps): ReactNode {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (element === null) return undefined;
    const follow = (): void => {
      if (document.hidden) element.pause();
      // A play refused (a policy, a source still loading) is retried by `autoplay` itself.
      else element.play().catch(() => undefined);
    };
    // Mounted into a page that is already hidden (the runner's window behind the editor, or in the
    // tray): no change will come to say so, and autoplay would run it unseen.
    if (document.hidden) element.pause();
    document.addEventListener('visibilitychange', follow);
    return () => {
      document.removeEventListener('visibilitychange', follow);
    };
  }, []);

  return (
    <div className="perch-media perch-media--video" data-fit={fit}>
      <video
        ref={video}
        className="perch-media__video"
        src={src}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        aria-hidden="true"
      />
    </div>
  );
}

/**
 * The video's own declarations; the box is `MEDIA_FRAME_STYLES`'s `.perch-media`. Interpolated into
 * `LAYOUT_CANVAS_STYLES`, so every page that mounts the canvas sheet already has it.
 */
export const VIDEO_BACKGROUND_STYLES = `
.perch-media__video {
  display: block;
  width: 100%;
  height: 100%;
  object-position: center;
}
.perch-media[data-fit='cover'] .perch-media__video { object-fit: cover; }
.perch-media[data-fit='contain'] .perch-media__video { object-fit: contain; }
`;
