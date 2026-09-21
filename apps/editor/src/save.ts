/**
 * Writing a layout back to disk, from a browser.
 *
 * A page cannot write a file, so something has to. The three candidates were weighed rather than
 * defaulted to, and the choice is recorded in DECISIONS.md and in README.md; the short version:
 *
 * - **A dev-server endpoint** — a `PUT` to the Vite server, which writes the file. Chosen.
 * - **The File System Access API** — `showSaveFilePicker`, real writes, no server. Rejected for this
 *   slice: Chromium-only, needs a user gesture and a re-granted handle per session, and the author's
 *   flow becomes "pick the file again" on every reload of a page they are iterating in.
 * - **Download-and-replace** — universally available, and it puts the file in `~/Downloads` for a
 *   human to move on top of `layouts/`. A manual copy between "saved" and "what the runtime loads" is
 *   exactly where a stale layout comes from.
 *
 * The endpoint wins because the editor is a development tool for this repo: it edits `layouts/`, in
 * this checkout, next to the runtime that reads them. **It therefore only works under `npm run dev`,
 * and that limit is stated in README.md rather than implied.** A built bundle served from anywhere
 * else has no endpoint to call, and the save will fail with the server's own 404 rather than silently
 * appearing to work.
 *
 * ## The validation gate is here, before the request
 *
 * `saveDraft` refuses a draft with outstanding issues and **makes no request at all**. Not a 400 from
 * the server, not a write that is rolled back: no HTTP. `DraftState.issues` is `validateLayout`'s own
 * output over the current draft, so the check costs nothing and the property — a document the runtime
 * would reject never reaches the filesystem — holds in the one place every save goes through. The
 * server checks again anyway, because an HTTP endpoint that trusts its client is not a check, but its
 * check is deliberately shallower; see `vite.config.ts`.
 *
 * ## What gets written
 *
 * `state.rendered` — the validator's rebuild — not `state.draft`. They are the same document whenever
 * a save is permitted, and rebuilt is the better one to serialize: it is the exact object the preview
 * painted, so the file on disk is byte-for-byte the document the author was looking at.
 *
 * Serialization is `JSON.stringify(…, null, 2)` plus a trailing newline. That matches `layouts/`'s
 * indent and final newline but **not** its hand-authored line breaks: `"target": { "width": 1920, … }`
 * is one line in the file today and becomes five once saved. Nothing reads a layout as text, so this
 * is a diff-readability cost only — noted in README.md so the first large diff is not a surprise.
 */

import { formatLayoutIssues, type Layout } from '@perch/layout-schema';
import type { DraftState } from './draft.js';
import { resolveSaveTarget } from './save-target.js';

/**
 * Where the dev server listens.
 *
 * Under `/__perch/` so it cannot collide with a layout asset or a source file Vite serves, and
 * double-underscored because that prefix is a convention for "this is the tooling, not the content".
 */
export const SAVE_ENDPOINT_PREFIX = '/__perch/layout/';

/** The URL that writes `name`. */
export function saveEndpoint(name: string): string {
  return `${SAVE_ENDPOINT_PREFIX}${encodeURIComponent(name)}`;
}

/** A layout as the bytes that will be written. See the module comment on formatting. */
export function serializeLayout(layout: Layout): string {
  return `${JSON.stringify(layout, null, 2)}\n`;
}

/** A save that happened, or the reason one did not. */
export type SaveOutcome =
  | { readonly ok: true; readonly written: Layout; readonly path: string }
  | { readonly ok: false; readonly reason: string };

/**
 * The slice of `fetch` a save needs, so a test can supply a function instead of a server.
 *
 * Declared structurally rather than as `typeof fetch`: injecting a real `fetch` signature means a test
 * double has to satisfy `Request | URL | string` and return a full `Response`, and the only thing
 * being tested is *whether a request was made and with what body*. The browser's `fetch` satisfies
 * this as it is.
 */
export type SaveTransport = (
  url: string,
  init: {
    readonly method: 'PUT';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  },
) => Promise<{ readonly ok: boolean; readonly status: number; text: () => Promise<string> }>;

/**
 * Write the draft, or refuse.
 *
 * Refuses on outstanding issues and on a name that is not a legal save target, in that order, and in
 * both cases without contacting the server. A clean draft — one that validated and equals what is on
 * disk — is *not* refused: that is the case where a `schemaVersion` 1 file is being rewritten as 2
 * with no other change, which is a real save. Whether to *offer* the button is `canSave`'s call, which
 * does require a difference; this function's job is the safety property, not the UI's enablement.
 */
export async function saveDraft(state: DraftState, transport: SaveTransport): Promise<SaveOutcome> {
  if (state.issues.length > 0) {
    return {
      ok: false,
      reason: `refusing to save: this is not a valid layout\n${formatLayoutIssues(state.issues)}`,
    };
  }

  const target = resolveSaveTarget(state.name);
  if (!target.ok) {
    return { ok: false, reason: `refusing to save: ${target.reason}` };
  }

  const body = serializeLayout(state.rendered);

  const response = await transport(saveEndpoint(state.name), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
  });

  if (!response.ok) {
    // The server's own sentence, not a restatement of the status. Its refusals name the path it
    // resolved and the rule that stopped it, and that is what an author needs.
    const detail = await response.text();

    return {
      ok: false,
      reason: `the dev server refused the write (HTTP ${response.status})${detail === '' ? '' : `: ${detail.trim()}`}`,
    };
  }

  return { ok: true, written: state.rendered, path: target.path };
}

/**
 * The browser's `fetch`, as a `SaveTransport`.
 *
 * A function rather than `fetch` itself so the indirection is visible at the call site in `main.tsx`,
 * and so nothing in `src/` outside this module names `fetch` at all.
 */
export const browserSaveTransport: SaveTransport = (url, init) => fetch(url, init);
