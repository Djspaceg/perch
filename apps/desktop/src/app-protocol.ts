/**
 * The `app://` scheme: how the runner's window gets its page, and the page its media.
 *
 * ```text
 * app://runtime/…    the built runtime page, apps/runtime/dist/page
 * app://document/…   files beside the open layout document, for its media
 * ```
 *
 * ## Why a custom scheme rather than `file://`
 *
 * The built page is a module script, and Chromium refuses module scripts from `file://` (their
 * origin is opaque, so the CORS check a module load makes can never pass) — the page stays blank,
 * silently, as `apps/runtime/index.html` warns. A privileged standard scheme gives the page a real
 * origin, so its scripts load, `'self'` in a content security policy means something, and the only
 * files the window can reach are the ones this module maps: `file://` would expose the whole disk
 * to any navigation that slipped through.
 *
 * The runtime is built with Vite's default base, `/`, so its absolute `/assets/…` URLs resolve
 * under `app://runtime/` with no change to its build. A later editor window is a third host here.
 *
 * Pure: the Electron registration lives in `main.ts`, so this is testable without the binary.
 */

import { join, sep } from 'node:path';

export const APP_SCHEME = 'app';

/** The runner window's one page. */
export const RUNTIME_PAGE_URL = `${APP_SCHEME}://runtime/index.html`;

/** Prefix of every media URL in a `DocumentPayload`. */
export const DOCUMENT_ASSET_ORIGIN = `${APP_SCHEME}://document`;

/** Where each host's files come from. `document` is the open document's folder, if one is open. */
export interface AppRoots {
  readonly runtime: string;
  readonly document: string | null;
}

/**
 * The file an `app://` URL names, or `null` when it names nothing this app serves.
 *
 * Works on the raw path segment by segment rather than trusting URL normalisation: a segment that
 * decodes to `.`, `..`, or anything holding a separator or a NUL is refused outright, and the
 * joined result must still sit inside its root. So neither `..` nor `%2e%2e` nor `%2F` escapes.
 */
export function resolveAppRequest(url: string, roots: AppRoots): string | null {
  const match = /^app:\/\/([^/?#]+)(\/[^?#]*)?/i.exec(url);
  if (match === null) return null;

  const host = (match[1] ?? '').toLowerCase();
  const root = host === 'runtime' ? roots.runtime : host === 'document' ? roots.document : null;
  if (root === null) return null;

  const segments: string[] = [];
  for (const raw of (match[2] ?? '/').split('/').slice(1)) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === '.' || segment === '..' || /[/\\\0]/.test(segment)) return null;
    segments.push(segment);
  }

  // `app://runtime/` and any other trailing slash mean the directory's index, as a web server would.
  if (segments.length === 0 || segments[segments.length - 1] === '') {
    segments.splice(-1, 1, 'index.html');
  }
  if (segments.some((segment) => segment === '')) return null;

  const path = join(root, ...segments);
  return path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`) ? path : null;
}

/** Whether the window may be at `url`: the runtime page, and nothing else. */
export function isRuntimePage(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  return (
    parsed.protocol === `${APP_SCHEME}:` &&
    parsed.host === 'runtime' &&
    (parsed.pathname === '/' || parsed.pathname === '/index.html')
  );
}

/**
 * The page's content security policy.
 *
 * Its own scripts and nothing inline; inline styles, because React hoists `ui-kit`'s sheets as
 * `<style>` elements and widgets set `style` attributes; images from the document's folder; and
 * exactly one connection, the in-process relay.
 *
 * `worker-src blob:` is for mqtt.js, which runs its keepalive timer in a worker built from a blob so
 * the timer is not throttled in a hidden window. Refused, the first launch showed the page's client
 * dropped by the broker for a missed keepalive: the runner's window is hidden most of its life.
 */
export function contentSecurityPolicy(brokerUrl: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${DOCUMENT_ASSET_ORIGIN} 'self' data:`,
    "font-src 'self'",
    `connect-src ${brokerUrl}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
