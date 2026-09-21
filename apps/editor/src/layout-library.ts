/**
 * Which layout files the editor can open, and how a media path inside one becomes a fetchable URL.
 *
 * The same job `apps/runtime/src/layout-catalogue.ts` does for the runtime, and deliberately the same
 * shape: `names` sorted with the first as the default, an `entry` lookup that answers for documents
 * that are *not* offered as well as ones that are, and a `resolveAsset` the canvas is handed as a prop.
 * Following that file's conventions was the instruction, and the conventions are load-bearing — a
 * layout arrives as **text** so this app's validator sees the bytes on disk rather than a document
 * Vite's JSON parser already accepted, and the globs are **eager** so no layout needs a chunk fetched.
 * Both reasons are set out at length there; they hold here unchanged.
 *
 * ## Why this is a second implementation, and why that is not the divergence the project worries about
 *
 * `apps/` may not import `apps/`, so the editor cannot reuse the runtime's catalogue, and the two
 * files therefore both know the path from a source tree to `layouts/`. That is real duplication and it
 * is recorded in DECISIONS.md as such.
 *
 * It is worth being precise about why it is tolerable where a second `LayoutCanvas` would not be. The
 * canvas decides *what a layout looks like*, so two of them means the editor showing an author
 * something the panel will not paint — the failure `ui-kit` exists to prevent. A catalogue decides
 * *which files exist*, and the answer is a directory listing: if the two disagree, one app is missing a
 * file that is plainly there, which is visible immediately and cannot be mistaken for a correct
 * rendering. The pixels have one implementation; the directory read has two, and the honest fix is a
 * package that owns `layouts/` access, which is more than this slice should decide.
 *
 * ## `layouts/invalid/`
 *
 * Catalogued and **not offered**, exactly as in the runtime: the picker never lists one and the editor
 * never defaults to one, but `?layout=invalid/broken-desk` opens it, so the editor's own refusal path
 * can be exercised against a real file rather than only against an edit. Saving one is impossible by
 * construction — `resolveSaveTarget` refuses every name containing a separator — which is the
 * behaviour wanted: those documents exist to be refused, and an editor that could overwrite
 * `broken-desk.json` with a valid layout would delete the only fixture the runtime's refusal page has.
 */

declare global {
  interface ImportMeta {
    /**
     * Vite's build-time directory read, declared as narrowly as this file uses it.
     *
     * Declared here rather than in an ambient `.d.ts` for the reason the runtime's copy gives: this
     * module is imported by tests, and the tests program (`tsconfig.tests.json`) includes test files
     * plus whatever they import — not the ambient declarations of the package projects. A declaration
     * next to its only call site is in every program that can reach the call.
     *
     * Identical to the runtime's by signature, which is what makes having both legal: `declare global`
     * merges interfaces, and two identical method signatures merge as overloads rather than clashing.
     * Not `vite/client`, whose `ImportMetaEnv` carries an `any` index signature this repo forbids.
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
 * resolves it at build time, and a variable would silently produce an empty library.
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

const LAYOUT_ASSETS = import.meta.glob('../../../layouts/**/*.{svg,png}', {
  query: '?url',
  import: 'default',
  eager: true,
});

/** One catalogued document. Whether it is a *layout* is `loadLayout`'s answer, not this file's. */
export interface LayoutLibraryEntry {
  /** The name the picker shows and the save endpoint writes: the path under `layouts/`, no `.json`. */
  readonly name: string;
  /** The file's bytes, on their way to `loadLayoutJson`. */
  readonly text: string;
  /** Whether the picker may list it, and the editor default to it. `false` under `invalid/`. */
  readonly offered: boolean;
}

/** What the editor needs to know about the layouts on disk. Injected, so a test can supply its own. */
export interface LayoutLibrary {
  /** The layouts the picker offers, sorted. The first is the default. */
  readonly names: readonly string[];
  /** A document by name, offered or not, or `undefined` if there is no such file. */
  readonly entry: (name: string) => LayoutLibraryEntry | undefined;
  /**
   * A layout's media `src` as a fetchable URL, or `undefined` if the asset is not in the bundle.
   *
   * `src` is relative to the layout file and every layout sits directly in `layouts/`, so the
   * layout's own directory is that one — the same simplification, with the same limit, as the
   * runtime's. A `undefined` here paints `LayoutCanvas`'s missing-asset box, which is the behaviour
   * an editor wants: an author who has just typed a path that is not there should see that, in the
   * rect where the image would have gone.
   */
  readonly resolveAsset: (src: string) => string | undefined;
}

/**
 * Build a library from raw glob tables.
 *
 * Exported so a test can construct one from literals it wrote, which is the only way to exercise
 * listing and switching against documents that are not on disk — and the reason the editor takes a
 * library instead of reaching for the globs itself.
 */
export function createLayoutLibrary(options: {
  /** Name → file text for the layouts on offer. */
  readonly layouts: Readonly<Record<string, string>>;
  /** Name → file text for documents that exist only to be refused. Default none. */
  readonly invalid?: Readonly<Record<string, string>> | undefined;
  /** Media `src` as written in a layout → the URL to fetch. Default none. */
  readonly assets?: Readonly<Record<string, string>> | undefined;
}): LayoutLibrary {
  const entries = new Map<string, LayoutLibraryEntry>();

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
 * The library of what is actually on disk.
 *
 * Keys arrive from the glob as the pattern's own relative specifiers —
 * `../../../layouts/desk-1920x400.json` — so each is reduced to the name the picker shows and, for an
 * asset, to the `src` an author writes.
 */
export const LAYOUT_LIBRARY: LayoutLibrary = createLayoutLibrary({
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
