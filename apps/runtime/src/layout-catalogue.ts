/**
 * Which layout files exist, and how a media path inside one becomes a URL the browser can fetch.
 *
 * `layouts/` is content, not code — it sits outside every workspace deliberately (see its README).
 * This file is the one place that knows where it is, so nothing downstream holds a path: the page
 * receives a catalogue, exactly as it receives its sensor sources, and a test hands it two strings
 * it wrote itself.
 *
 * ## Why the layout arrives as *text*
 *
 * `import.meta.glob(..., { query: '?raw' })` gives the file's bytes, which then go through
 * `loadLayoutJson`. Importing the JSON as a module instead would have Vite's parser do the parsing,
 * and the runtime would then be validating an object that had already been accepted by something
 * else — a layout file with a trailing comma would fail at build time with a bundler error instead
 * of on the page with `formatLayoutIssues`. The format's promise is that a bad layout is refused
 * *legibly*, and that requires the runtime to see the document exactly as it is on disk.
 *
 * ## Why the globs are eager
 *
 * `eager: true` inlines every layout and every asset URL into the bundle. That is not laziness
 * deferred — it is the standalone bundle's requirement working backwards: the deliverable loads cold
 * from a static directory with no build step at the far end, so a layout that arrived by dynamic
 * `import()` would need a chunk fetched over a network the panel host may not have. The whole
 * catalogue is a few kilobytes of JSON.
 *
 * ## `layouts/invalid/`
 *
 * A sibling directory of documents that are deliberately **not** layouts, for exercising the
 * refusal path on a real page rather than only in a test. They are catalogued so `?layout=` can
 * reach them and **not offered**, so the page never defaults to one and a reader browsing the
 * layout list is never shown a file that cannot render. `layouts/README.md`'s rule — a layout that
 * will not validate is not a layout — is why they live in their own directory under their own name.
 */

declare global {
  interface ImportMeta {
    /**
     * Vite's build-time directory read, declared as narrowly as this file uses it.
     *
     * Declared here rather than in `vite-env.d.ts` because this module is imported by tests, and the
     * tests program (`tsconfig.tests.json`) includes test files plus whatever they import — not the
     * ambient `.d.ts` files of the package projects. A declaration next to its only call site is in
     * every program that can reach the call.
     *
     * Not `vite/client`, which would type this correctly and bring an `any`-indexed `ImportMetaEnv`
     * with it; see `vite-env.d.ts` for why that matters here. Only the `eager: true,
     * import: 'default'` form with a string-producing query is declared, because that is the only
     * form whose result is `Record<string, string>` rather than a table of promises or of module
     * objects. A different call shape is then a compile error rather than a loosely typed value.
     */
    glob(
      pattern: string,
      options: {
        /** `?raw` yields the file's text; `?url` yields the URL the bundler copied it to. */
        readonly query: '?raw' | '?url';
        readonly import: 'default';
        readonly eager: true;
      },
    ): Readonly<Record<string, string>>;
  }
}

/**
 * Where the layout directory sits, relative to this file.
 *
 * Written out rather than computed because `import.meta.glob`'s pattern must be a literal: Vite
 * resolves it at build time, and a variable would silently produce an empty catalogue.
 */
const LAYOUTS_PREFIX = '../../../layouts/';

const LAYOUT_TEXT = import.meta.glob('../../../layouts/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const INVALID_LAYOUT_TEXT = import.meta.glob('../../../layouts/invalid/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * Every asset any layout references, as the URL the bundler gave it.
 *
 * `?url` rather than `?raw` or `?inline`: the bundler copies the file and hands back its hashed
 * path, which is what makes "media is referenced, never embedded" hold all the way to the built
 * page. The extension list is the set the layouts actually use — a format added later has to be
 * added here, and the failure is a visible missing-asset box rather than a broken image.
 */
const LAYOUT_ASSETS = import.meta.glob('../../../layouts/**/*.{svg,png}', {
  query: '?url',
  import: 'default',
  eager: true,
});

/** One catalogued document. Whether it is a *layout* is `loadLayout`'s answer, not this file's. */
export interface LayoutCatalogueEntry {
  /** The name `?layout=` uses: the path under `layouts/` without the `.json`. */
  readonly name: string;
  /** The file's bytes, on their way to `loadLayoutJson`. */
  readonly text: string;
  /**
   * Whether the page may offer or default to it.
   *
   * `false` for everything under `layouts/invalid/`, which exists to be refused.
   */
  readonly offered: boolean;
}

/**
 * What the page needs to know about the layouts on disk. Injected, so a test can supply its own.
 *
 * Both members are function-typed *properties* rather than method signatures, because the page hands
 * `resolveAsset` to a component as a prop. A method signature says "call me on my object", so passing
 * it detached is the mistake `unbound-method` exists to catch; a property whose type is a standalone
 * function says what is actually true here — neither closes over `this`.
 */
export interface LayoutCatalogue {
  /** The layouts a reader may pick, sorted. The first is the default. */
  readonly names: readonly string[];
  /** A document by name, offered or not, or `undefined` if there is no such file. */
  readonly entry: (name: string) => LayoutCatalogueEntry | undefined;
  /**
   * A layout's media `src` as a fetchable URL, or `undefined` if the asset is not in the bundle.
   *
   * `src` is relative to the layout file, and every layout file sits directly in `layouts/`, so the
   * layout's own directory is that one. A layout in a subdirectory would need its own directory
   * threaded through here; there is no such layout, and inventing the parameter now would mean
   * guessing which of two spellings the future one uses.
   */
  readonly resolveAsset: (src: string) => string | undefined;
}

/**
 * Build a catalogue from raw glob tables.
 *
 * Exported so a test can construct one from literals it wrote — which is the only way to test the
 * refusal path against a document that is *not* on disk, and the reason the page takes a catalogue
 * instead of reaching for the globs itself.
 */
export function createLayoutCatalogue(options: {
  /** Name → file text for the layouts on offer. */
  readonly layouts: Readonly<Record<string, string>>;
  /** Name → file text for documents that exist only to be refused. Default none. */
  readonly invalid?: Readonly<Record<string, string>> | undefined;
  /** Media `src` as written in a layout → the URL to fetch. Default none. */
  readonly assets?: Readonly<Record<string, string>> | undefined;
}): LayoutCatalogue {
  const entries = new Map<string, LayoutCatalogueEntry>();

  for (const [name, text] of Object.entries(options.layouts)) {
    entries.set(name, Object.freeze({ name, text, offered: true }));
  }
  for (const [name, text] of Object.entries(options.invalid ?? {})) {
    entries.set(name, Object.freeze({ name, text, offered: false }));
  }

  const names = Object.freeze(
    [...entries.values()]
      .filter((entry) => entry.offered)
      .map((entry) => entry.name)
      .sort(),
  );
  const assets = new Map(Object.entries(options.assets ?? {}));

  return Object.freeze({
    names,
    entry: (name: string) => entries.get(name),
    resolveAsset: (src: string) => assets.get(src),
  });
}

/**
 * The catalogue of what is actually on disk.
 *
 * Keys arrive from the glob as the pattern's own relative specifiers —
 * `../../../layouts/desk-1920x400.json` — so each is reduced to the name a reader types and, for an
 * asset, to the `src` an author writes.
 */
export const LAYOUT_CATALOGUE: LayoutCatalogue = createLayoutCatalogue({
  layouts: renameKeys(LAYOUT_TEXT, layoutName),
  invalid: renameKeys(INVALID_LAYOUT_TEXT, layoutName),
  assets: renameKeys(LAYOUT_ASSETS, assetPath),
});

/** `../../../layouts/desk-1920x400.json` → `desk-1920x400`; keeps any subdirectory. */
function layoutName(key: string): string {
  return stripPrefix(key).replace(/\.json$/, '');
}

/** `../../../layouts/desk.assets/grid.svg` → `desk.assets/grid.svg`, which is what a layout writes. */
function assetPath(key: string): string {
  return stripPrefix(key);
}

function stripPrefix(key: string): string {
  return key.startsWith(LAYOUTS_PREFIX) ? key.slice(LAYOUTS_PREFIX.length) : key;
}

function renameKeys(
  table: Readonly<Record<string, string>>,
  rename: (key: string) => string,
): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(table).map(([key, value]) => [rename(key), value]));
}
