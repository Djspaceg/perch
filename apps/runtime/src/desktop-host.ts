/**
 * The page, hosted by the desktop runner: one layout document read from disk instead of the bundled
 * catalogue, and the in-process relay instead of `PERCH_BROKER_URL`.
 *
 * The runner's preload puts a bridge on `window.perchDesktop`. In a browser there is none, and
 * `main.tsx` takes exactly the path it always took, so `npm run dev` is unchanged. When there is,
 * the bridge's one document is turned into the same two inputs the page already takes — a
 * `LayoutCatalogue` and a `PageRequest` — so nothing below `main.tsx` knows which host it is in. The
 * document's text is handed over unparsed; `loadLayoutJson` refuses a malformed one on the page, in
 * the runtime's own error view, as it would a bundled one.
 *
 * The bridge's shape is restated here rather than imported: `apps/desktop` is an app, and nothing
 * imports an app. `DESKTOP_BRIDGE_GLOBAL` is pinned on the desktop side by its preload test.
 */

import { createLayoutCatalogue, type LayoutCatalogue } from './layout-catalogue.js';
import { parsePageRequest, type PageRequest } from './viewport.js';

/** The `window` property the runner's preload exposes. */
export const DESKTOP_BRIDGE_GLOBAL = 'perchDesktop';

/** A layout document as the runner hands it over. */
export interface DesktopDocument {
  /** The file name without `.json`. */
  readonly name: string;
  /** The file's text, or `null` when the file is not on disk. */
  readonly text: string | null;
  /** Each media `src` beside the document, mapped to the URL that serves it. */
  readonly assets: Readonly<Record<string, string>>;
}

export interface DesktopStart {
  /** The in-process relay's WebSocket URL. */
  readonly brokerUrl: string;
  /** The open document, or `null` when the layouts folder holds none. */
  readonly document: DesktopDocument | null;
}

export interface DesktopBridge {
  load(): Promise<DesktopStart>;
  /** Called with the document every time it changes on disk. Returns an unsubscribe. */
  onDocument(listener: (document: DesktopDocument) => void): () => void;
}

/** The bridge, if this page is in the runner. Checked structurally, since it arrives untyped. */
export function findDesktopBridge(host: object): DesktopBridge | null {
  const candidate: unknown = (host as Record<string, unknown>)[DESKTOP_BRIDGE_GLOBAL];
  if (typeof candidate !== 'object' || candidate === null) return null;

  const { load, onDocument } = candidate as Partial<Record<keyof DesktopBridge, unknown>>;
  return typeof load === 'function' && typeof onDocument === 'function'
    ? (candidate as DesktopBridge)
    : null;
}

/**
 * A catalogue of exactly this document, or of nothing when it is not on disk — which the page
 * renders as its "no such layout" refusal, naming the document.
 */
export function desktopCatalogue(document: DesktopDocument): LayoutCatalogue {
  return createLayoutCatalogue({
    layouts: document.text === null ? {} : { [document.name]: document.text },
    assets: document.assets,
  });
}

/** The URL's mode, and always this document: the runner chooses the layout, not the query string. */
export function desktopPageRequest(search: string, document: DesktopDocument): PageRequest {
  return { ...parsePageRequest(search), layout: document.name };
}
