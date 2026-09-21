/**
 * Which file a layout name is allowed to write to, decided without touching a filesystem.
 *
 * The editor's save path ends in a dev-server middleware that writes a file on the machine running
 * `npm run dev`. That is an HTTP endpoint accepting a name from a browser, so the name is untrusted
 * by construction and the containment rule has to be a *function* rather than a comment beside an
 * `fs.writeFile` — one that can be tested against `../`, an absolute path and a URL-encoded
 * separator without a temp directory in sight.
 *
 * The rule is deliberately tighter than "stays inside `layouts/`":
 *
 * - **No directory separators at all.** Every layout the editor offers sits directly in `layouts/`
 *   (`layouts/README.md`), so a name containing `/` is not a layout this slice can have loaded. That
 *   also means `invalid/broken-desk` cannot be saved over, which matters: it is *deliberately not a
 *   layout*, and the runtime's refusal page is exercised against it. An editor that could overwrite
 *   it with a valid document would quietly delete the only real fixture for that path.
 * - **No `..`, no leading dot, no backslash.** `..` is the traversal; a leading dot hides the file;
 *   a backslash is a separator on the platform this repo is not developed on, which is exactly the
 *   kind of difference that turns a containment check into a containment check on one OS.
 * - **The name must already exist as a layout.** Enforced by the caller, not here, because only the
 *   caller can see the directory — but stated here because it is the other half of the rule: this
 *   slice edits the layouts that are there and does not create files. See README.md.
 *
 * Returning a refusal rather than throwing, for the same reason `layout-schema` collects issues: the
 * middleware turns it into a 400 with the sentence in the body, and the editor shows the sentence.
 */

/** Where every layout lives, relative to the repository root. */
export const LAYOUTS_DIRECTORY = 'layouts';

/** The extension a layout file carries. */
export const LAYOUT_FILE_EXTENSION = '.json';

/**
 * A name that may be written, or the reason it may not.
 *
 * `path` is repo-relative and always `layouts/<name>.json`, built here rather than by the caller so
 * there is one expression of the join and nothing downstream is holding a fragment to concatenate.
 */
export type SaveTarget =
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string };

/**
 * A layout name, as written by `?layout=` and by the editor's picker: lower-case-ish alphanumerics
 * with hyphens, dots and underscores, starting with an alphanumeric.
 *
 * Anchored at both ends and applied to the whole name, so there is no substring for a separator or a
 * control character to hide in. The dot is allowed because `desk-1920x400` has none but a future
 * `desk-1920x400.v2` plausibly would; the leading character is excluded from it so `.hidden` and
 * `..` both fail on the first character rather than on a special case further down.
 */
const LAYOUT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * How long a name may be.
 *
 * Not a security boundary — the character class is — but a filesystem one: a name past this is a
 * mistake or a probe, and refusing it here beats an `ENAMETOOLONG` surfacing as a 500.
 */
const LAYOUT_NAME_MAX_LENGTH = 128;

/**
 * The file `name` may be saved to, or why it may not be.
 *
 * Total: every input produces an answer, and no input produces a path outside `layouts/`.
 */
export function resolveSaveTarget(name: string): SaveTarget {
  if (name === '') {
    return { ok: false, reason: 'a layout name is required' };
  }
  if (name.length > LAYOUT_NAME_MAX_LENGTH) {
    return {
      ok: false,
      reason: `layout name must be at most ${LAYOUT_NAME_MAX_LENGTH} characters, got ${name.length}`,
    };
  }
  if (!LAYOUT_NAME.test(name)) {
    return {
      ok: false,
      reason: `layout name must be alphanumerics, "-", "_" or "." starting with an alphanumeric, and must name a file directly in ${LAYOUTS_DIRECTORY}/ — got ${JSON.stringify(name)}`,
    };
  }

  return { ok: true, path: `${LAYOUTS_DIRECTORY}/${name}${LAYOUT_FILE_EXTENSION}` };
}
