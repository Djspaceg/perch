/**
 * An image painted at a rect — the `media` element of a layout, as pixels.
 *
 * Referenced, never embedded: `src` is a URL the *caller* resolved. This component does not know
 * what a layout file is, where one lives, or that media paths are relative to it — the layout
 * format's rule that an asset sits beside its layout is enforced by `layout-schema` and resolved
 * by the runtime, which is the only party that knows both the layout's location and how its
 * bundler names the copied asset. A widget that tried to resolve a path itself would have to hold
 * one of those two facts wrongly.
 *
 * ## Why `fit` is this package's own union and not the schema's
 *
 * `layout-schema` exports `MEDIA_FITS`, and importing it here would be the obvious way to keep one
 * vocabulary. It is also forbidden: `ui-kit` depends on `sensor-contract` and nothing else
 * (ARCHITECTURE.md's dependency table), because the editor and the runtime both render this package
 * and neither may reach a layout type through it. So the two spellings of "cover or contain" are
 * independent by construction, and the runtime pins them together with an exhaustive map — a
 * `Record` keyed by the schema's union, which stops compiling the moment either side gains a
 * member. Two lists that cannot drift silently beat one list in the wrong package.
 *
 * ## The frame budget
 *
 * The skeleton is fixed and the element never updates: a media element's props come from the layout
 * and are constant for the life of the page. `<img>` rather than a CSS background, because a
 * background image has no load event — a capture would have no way to know the asset had arrived,
 * and the ready signal the capture path depends on cannot be built on something unobservable.
 */

import type { ReactNode } from 'react';
import { token } from './tokens.js';

/**
 * How the image fills its rect.
 *
 * `cover` crops to fill; `contain` fits whole and leaves the rest of the rect empty. No `fill` and
 * no `none`: distorting a photograph's aspect ratio is never what an author meant, and an image
 * painted at its intrinsic size inside a rect authored for it is the same thing as `contain` with
 * an extra way to be wrong.
 */
export type MediaFrameFit = 'cover' | 'contain';

/** Every fit, so a consumer can check its own vocabulary against this one. */
export const MEDIA_FRAME_FITS: readonly MediaFrameFit[] = Object.freeze(['cover', 'contain']);

export interface MediaFrameProps {
  /** The resolved URL. The caller turns the layout's relative path into this. */
  src: string;
  /** Defaults to `cover`, matching the layout format's own default. */
  fit?: MediaFrameFit | undefined;
  /**
   * What the image is, for a reader who cannot see it.
   *
   * Defaults to `''`, which marks the image decorative and removes it from the accessibility tree.
   * That is the honest default rather than a lazy one: the layout format has no field for a
   * description, so anything this component invented — a filename, "media element" — would be
   * noise a screen reader reads out in place of silence. A consumer that *does* know what the
   * image means passes it.
   */
  alt?: string | undefined;
}

export function MediaFrame({ src, fit = 'cover', alt = '' }: MediaFrameProps): ReactNode {
  return (
    <div className="perch-media" data-fit={fit}>
      {/*
       * `decoding="sync"` and `fetchPriority="high"` are both about the capture: an image decoded
       * asynchronously can be photographed as an empty box on the very frame the page reports itself
       * ready, and a deprioritised background asset is exactly the one a browser defers longest.
       */}
      <img
        className="perch-media__image"
        src={src}
        alt={alt}
        decoding="sync"
        fetchPriority="high"
      />
    </div>
  );
}

/**
 * The media element's styles, as a string for the page to inject once.
 *
 * `object-fit` is driven by `data-fit` rather than by an inline style so that the sheet stays the
 * one description of how this element paints, and so the two fits can be asserted present the way
 * the readout's four states are.
 *
 * `--perch-media-opacity` exists because the common use of a media element is a *background* under
 * the numbers, and an author needs to hold it back without editing the asset — a 40%-opacity grid
 * is a theme decision that should not require a second PNG.
 */
export const MEDIA_FRAME_STYLES = `
.perch-media {
  width: 100%;
  height: 100%;
  overflow: hidden;
  opacity: ${token('--perch-media-opacity')};
}
.perch-media__image {
  display: block;
  width: 100%;
  height: 100%;
}
.perch-media[data-fit='cover'] .perch-media__image { object-fit: cover; }
.perch-media[data-fit='contain'] .perch-media__image { object-fit: contain; }
`;
