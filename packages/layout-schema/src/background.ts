/**
 * A cloud background reference: how a layout names a video it does not carry.
 *
 * `thermalright:a042` is Thermalright's hosted background `a042` (see docs/backgrounds.md). It is
 * an identity, not a location: which server, which resolution and which file on this machine are
 * the host's business at render time, so a layout that names one stays movable between machines
 * and between panels of different sizes. Never a URL, never a machine path.
 *
 * One spelling per background, for the reason a media path has one: lower-case provider and id,
 * the id a category letter and three digits, and `000` refused since no category numbers from
 * zero. Which ids exist is the catalogue's to say (`@perch/backgrounds`); this is the grammar
 * only, so a category Thermalright adds later needs no schema change.
 */

/** The one provider the format knows. */
export const BACKGROUND_PROVIDER = 'thermalright';

export interface BackgroundRef {
  readonly provider: typeof BACKGROUND_PROVIDER;
  /** A category letter and three digits: `a042`. */
  readonly id: string;
}

const REFERENCE = /^thermalright:([a-z](?!000)[0-9]{3})$/;

/** The reference `src` spells, or `null` when it is not one. */
export function parseBackgroundRef(src: string): BackgroundRef | null {
  const match = REFERENCE.exec(src);
  const id = match?.[1];

  return id === undefined ? null : { provider: BACKGROUND_PROVIDER, id };
}

export function isBackgroundRef(src: string): boolean {
  return parseBackgroundRef(src) !== null;
}

/** The reference for background `id`. */
export function backgroundRef(id: string): string {
  return `${BACKGROUND_PROVIDER}:${id}`;
}
