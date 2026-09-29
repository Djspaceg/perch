/**
 * Cloud backgrounds on the desktop: where the cache lives, the scheme pages read it through, and
 * what a page is told about a download (docs/backgrounds.md).
 *
 * ```text
 * <userData>/backgrounds/thermalright/<w>x<h>/<id>.mp4    the cache (`@perch/backgrounds/node`)
 * perch-cache://backgrounds/thermalright/<w>x<h>/<file>    how a page reads one file of it
 * ```
 *
 * A scheme of its own rather than a host of `app://`, because a `<video>` reads through it: Electron
 * streams media from a custom protocol only when the scheme is registered with `stream`, and the
 * pages' own scheme has no reason to carry that. The handler serves a file only when its name is a
 * cache name (`BackgroundCache.fileFor`), so nothing else in the folder, and nothing outside it, is
 * reachable; a page cannot name a server or a path, only a reference and a target, which the main
 * process checks.
 *
 * Pure apart from reading files: the Electron registration is `main.ts`'s.
 */

import { join } from 'node:path';
import {
  serveCachedFile,
  type BackgroundCache,
  type EnsureResult,
  type PreviewResult,
} from '@perch/backgrounds/node';

export const CACHE_SCHEME = 'perch-cache';

/** The one origin the scheme serves: the content security policies name it. */
export const BACKGROUNDS_ORIGIN = `${CACHE_SCHEME}://backgrounds`;

/** The cache folder, inside the app's data folder so it goes where the settings go. */
export function backgroundsRoot(userDataPath: string): string {
  return join(userDataPath, 'backgrounds');
}

/** A cache name, `thermalright/1920x440/a042.mp4`, as the URL a page reads it at. */
export function cacheUrlFor(relative: string): string {
  return `${BACKGROUNDS_ORIGIN}/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * The cache name a `perch-cache://` URL asks for, or `null`. Decoded segment by segment, refusing a
 * query, a fragment, and any segment that decodes to a dot segment or holds a separator, before the
 * cache's own grammar is asked.
 */
export function cacheName(url: string): string | null {
  const match = /^perch-cache:\/\/backgrounds(\/[^?#]*)$/i.exec(url);
  if (match === null) return null;
  const segments: string[] = [];
  for (const raw of (match[1] ?? '').split('/').slice(1)) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === '' || segment === '.' || segment === '..' || /[/\\\0]/.test(segment)) {
      return null;
    }
    segments.push(segment);
  }
  return segments.join('/');
}

/** A `perch-cache://` request, answered from the cache or refused with a 404. */
export async function serveCacheRequest(
  request: Request,
  cache: BackgroundCache,
): Promise<Response> {
  const name = cacheName(request.url);
  const path = name === null ? null : cache.fileFor(name);
  if (path === null) return new Response('not found', { status: 404 });

  return serveCachedFile(path, request.method, request.headers.get('range'));
}

/** What a page is told: the URL or the failure, never the file's path or which server sent it. */
export type PageBackgroundResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: true; readonly kind: 'image' | 'video'; readonly url: string }
  | { readonly ok: false; readonly code: string; readonly reason: string };

export function forPage(result: EnsureResult | PreviewResult): PageBackgroundResult {
  if (!result.ok) return { ok: false, code: result.code, reason: result.reason };
  return 'kind' in result
    ? { ok: true, kind: result.kind, url: result.url }
    : { ok: true, url: result.url };
}
