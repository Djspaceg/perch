/**
 * Media references, and hard rule 2: **media is referenced by path, never embedded.**
 *
 * Base64 in a layout file makes it undiffable and unreviewable — the one artifact that outlives
 * every other decision here becomes a blob nobody can read a change to. So `src` is a path
 * relative to the layout file, the asset lives in a sibling `<name>.assets/` directory, and the
 * bundle build copies it in.
 *
 * "Relative path" is enforced rather than assumed, and each rejection below is a specific way
 * the rule gets broken in practice:
 *
 * - **A `data:` URL** is the rule itself, so it gets its own issue code and its own message.
 * - **Any other scheme** (`http:`, `file:`) is an asset the bundle build cannot copy. It renders
 *   in the editor on a machine with network access and is missing on the panel.
 * - **An absolute path**, POSIX or Windows drive-lettered, is machine-specific. A layout is a
 *   file in a repo that has to move between the authoring machine and the panel host.
 * - **A `..` segment** escapes the layout's own directory, which breaks "a layout and its assets
 *   are movable as a unit" and makes the bundle build's copy set unbounded.
 * - **A backslash, a `.` segment, an empty segment, a trailing slash** are second spellings of a
 *   path that already has one. A path is an identity, the same way a topic is.
 */

import { hasControlCharacter } from './checks.js';
import { type IssueCollector } from './issues.js';

/** How a media element fills its rect. */
export const MEDIA_FITS = ['cover', 'contain'] as const;
export type MediaFit = (typeof MEDIA_FITS)[number];

/** `scheme:` — RFC 3986's production, which also matches a Windows drive letter. */
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
/** Characters no portable filename contains, plus the Windows-reserved set. */
const FORBIDDEN_IN_PATH = /[\\*?"<>|]/;
const MEDIA_PATH_MAX_LENGTH = 512;

/**
 * Validate a media `src`, returning it unchanged or `null` having reported why not.
 *
 * `src` is already known to be a non-empty string; this adds only the path rules.
 */
export function validateMediaPath(
  src: string,
  path: string,
  collect: IssueCollector,
  elementIndex: number,
): string | null {
  const reject = (code: 'malformed-media-path' | 'embedded-media', message: string): null => {
    collect.add(code, path, message, elementIndex);
    return null;
  };

  if (src.length > MEDIA_PATH_MAX_LENGTH) {
    return reject(
      'malformed-media-path',
      `media path must be at most ${MEDIA_PATH_MAX_LENGTH} characters, got ${src.length}`,
    );
  }

  // Drive letters first, so `C:/wallpaper.png` is reported as the absolute path it is rather
  // than as a URL with the scheme `c`.
  if (WINDOWS_DRIVE.test(src)) {
    return reject(
      'malformed-media-path',
      `media src must be a path relative to the layout file, not an absolute path — got ${JSON.stringify(src)}`,
    );
  }

  const scheme = SCHEME.exec(src);
  if (scheme !== null) {
    const name = (scheme[1] ?? '').toLowerCase();
    if (name === 'data') {
      return reject(
        'embedded-media',
        'media must be referenced by path, never embedded: a data: URL makes the layout file undiffable and unreviewable',
      );
    }

    return reject(
      'malformed-media-path',
      `media src must be a path relative to the layout file, not a ${name}: URL — the bundle build copies assets in, and cannot copy what it cannot see`,
    );
  }

  if (src.startsWith('/')) {
    return reject(
      'malformed-media-path',
      `media src must be a path relative to the layout file, not an absolute path — got ${JSON.stringify(src)}`,
    );
  }

  if (FORBIDDEN_IN_PATH.test(src) || hasControlCharacter(src)) {
    return reject(
      'malformed-media-path',
      `media src may not contain a backslash, a control character, or any of * ? " < > | — use "/" as the separator, and got ${JSON.stringify(src)}`,
    );
  }

  if (src.trim() !== src) {
    return reject(
      'malformed-media-path',
      `media src may not have leading or trailing whitespace — got ${JSON.stringify(src)}`,
    );
  }

  const segments = src.split('/');
  for (const segment of segments) {
    if (segment.length === 0) {
      return reject(
        'malformed-media-path',
        `media src may not contain an empty path segment, so no doubled or trailing "/" — got ${JSON.stringify(src)}`,
      );
    }
    if (segment === '..') {
      return reject(
        'malformed-media-path',
        `media src may not leave the layout's own directory, so no ".." segment — got ${JSON.stringify(src)}`,
      );
    }
    if (segment === '.') {
      return reject(
        'malformed-media-path',
        `media src may not contain a "." segment, which is a second spelling of the same path — got ${JSON.stringify(src)}`,
      );
    }
  }

  return src;
}
