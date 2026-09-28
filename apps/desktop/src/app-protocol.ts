/**
 * The `app://` scheme: how each window gets its page, and each page its media.
 *
 * ```text
 * app://runtime/…                the built runtime page, apps/runtime/dist/page
 * app://document/…               files beside the runner's open document, for its media
 * app://editor/…                 the built editor page, apps/editor/dist/page
 * app://editor-document/<key>/…  files beside the editor's document <key>, for its media
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
 * under `app://runtime/` with no change to its build; the editor's the same, under `app://editor/`.
 *
 * The editor may have documents from several folders open over a session (the folder's, and any
 * opened from elsewhere), so its media host names the document by the key the main process gave it,
 * and only a key the main process gave out resolves to a folder.
 *
 * Pure: the Electron registration lives in `main.ts`, so this is testable without the binary.
 */

import { join, sep } from 'node:path';

export const APP_SCHEME = 'app';

/** The runner window's one page. */
export const RUNTIME_PAGE_URL = `${APP_SCHEME}://runtime/index.html`;

/** Prefix of every media URL in a `DocumentPayload`. */
export const DOCUMENT_ASSET_ORIGIN = `${APP_SCHEME}://document`;

/** The editor window's one page. */
export const EDITOR_PAGE_URL = `${APP_SCHEME}://editor/index.html`;

/** Prefix of every media URL the editor is handed. */
export const EDITOR_DOCUMENT_ASSET_ORIGIN = `${APP_SCHEME}://editor-document`;

/** Where each host's files come from. `document` is the open document's folder, if one is open. */
export interface AppRoots {
  readonly runtime: string;
  readonly document: string | null;
  readonly editor: string;
  /** The folder of the editor document with this key, or `null` for a key never given out. */
  readonly editorDocument: (key: string) => string | null;
}

/** The URL an editor document's media `src` is served at. */
export function editorAssetUrl(key: string, src: string): string {
  return `${EDITOR_DOCUMENT_ASSET_ORIGIN}/${[key, ...src.split('/')].map(encodeURIComponent).join('/')}`;
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

  let root: string | null;
  if (host === 'editor-document') {
    // The first segment is the document's key; there must be a file after it.
    const key = segments.shift();
    root = key === undefined || key === '' ? null : roots.editorDocument(key);
    if (segments.length === 0 || segments[segments.length - 1] === '') return null;
  } else {
    root =
      host === 'runtime'
        ? roots.runtime
        : host === 'document'
          ? roots.document
          : host === 'editor'
            ? roots.editor
            : null;
  }
  if (root === null) return null;

  // `app://runtime/` and any other trailing slash mean the directory's index, as a web server would.
  if (segments.length === 0 || segments[segments.length - 1] === '') {
    segments.splice(-1, 1, 'index.html');
  }
  if (segments.some((segment) => segment === '')) return null;

  const path = join(root, ...segments);
  return path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`) ? path : null;
}

function isPage(url: string, host: 'runtime' | 'editor'): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  return (
    parsed.protocol === `${APP_SCHEME}:` &&
    parsed.host === host &&
    (parsed.pathname === '/' || parsed.pathname === '/index.html')
  );
}

/** Whether `url` is the runtime page: the only sender the runner's IPC answers. */
export function isRuntimePage(url: string): boolean {
  return isPage(url, 'runtime');
}

/** Whether `url` is the editor page: the only sender the editor's IPC answers. */
export function isEditorPage(url: string): boolean {
  return isPage(url, 'editor');
}

/** Whether a window may be at `url`: one of the app's two pages, and nothing else. */
export function isAppPage(url: string): boolean {
  return isRuntimePage(url) || isEditorPage(url);
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
export function contentSecurityPolicy(
  brokerUrl: string,
  mediaOrigin: string = DOCUMENT_ASSET_ORIGIN,
): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${mediaOrigin} 'self' data:`,
    "font-src 'self'",
    `connect-src ${brokerUrl}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** The editor page's policy: the runtime page's, with its own documents' media. */
export function editorContentSecurityPolicy(brokerUrl: string): string {
  return contentSecurityPolicy(brokerUrl, EDITOR_DOCUMENT_ASSET_ORIGIN);
}
