/**
 * Opening a named layout from the library: which loader, which options, and what a file that is not
 * a layout becomes. Its own module so the store (`store.ts`) and the editor (`app.tsx`) share it
 * without importing each other.
 */

import {
  loadLayoutJson,
  type Layout,
  type LayoutIssue,
  type LoadLayoutOptions,
} from '@perch/layout-schema';
import { normalizeSensorTopic } from '@perch/sensor-contract';
import { WIDGET_REGISTRY } from '@perch/ui-kit';
import { openDraft, type DraftState } from './draft.js';
import type { LayoutLibrary, LayoutLibraryEntry } from './layout-library.js';

/**
 * What every layout opened here is validated against.
 *
 * Identical to the runtime's `LOAD_OPTIONS`, and identical on purpose: the registry is
 * `WIDGET_REGISTRY` from `ui-kit` and the topic rule is `normalizeSensorTopic`, so the editor accepts
 * exactly the documents the runtime accepts. A stricter rule here would refuse layouts the panel can
 * draw; a looser one would let this editor save a file the panel then rejects, which is the failure
 * `SPEC.md` hard rule 2 names.
 *
 * The two apps cannot share the constant — `apps/` may not import `apps/` — so they share its
 * ingredients instead. That is the finding recorded in DECISIONS.md, not a divergence: both sides
 * name the same two exported values.
 */
const LOAD_OPTIONS: LoadLayoutOptions = Object.freeze({
  widgets: WIDGET_REGISTRY,
  isTopic: (topic: string) => normalizeSensorTopic(topic) !== null,
});

/** A layout open for editing, or the reason one is not. */
export type Opened =
  | { readonly ok: true; readonly state: DraftState }
  | {
      readonly ok: false;
      readonly name: string;
      readonly reason: string;
      readonly issues: readonly LayoutIssue[];
    };

/**
 * Open a named document from the library.
 *
 * Exported because it is the app's wiring decision — which loader, which options, what happens to a
 * file that is not a layout — and a test asserting "an invalid file shows its problems and paints
 * nothing" should be able to ask this directly rather than through a rendered tree.
 *
 * `loadLayoutJson`, not `validateLayout`: the text came from a file, so it is migrated forward first
 * and the steps are carried into the draft. See `draft.ts`.
 */
export function openLayoutByName(library: LayoutLibrary, name: string): Opened {
  const entry = library.entry(name);

  if (entry === undefined) {
    return {
      ok: false,
      name,
      reason:
        library.names.length === 0
          ? `there is no layout named "${name}", and the library is empty`
          : `there is no layout named "${name}". offered: ${library.names.join(', ')}`,
      issues: [],
    };
  }

  return openLayoutEntry(entry);
}

/**
 * Open one document's text: the loader and options of `openLayoutByName`, for a document that came
 * from somewhere other than the library's own listing (the desktop app's Open dialog).
 */
export function openLayoutEntry(entry: Pick<LayoutLibraryEntry, 'name' | 'text' | 'path'>): Opened {
  const { name } = entry;
  const loaded = loadLayoutJson(entry.text, LOAD_OPTIONS);

  if (!loaded.ok) {
    return {
      ok: false,
      name,
      reason: `${entry.path ?? `layouts/${name}.json`} is not a valid layout, so there is nothing to edit yet`,
      issues: loaded.issues,
    };
  }

  return { ok: true, state: openDraft(name, loaded.layout, LOAD_OPTIONS, loaded.migrations) };
}

/** A document that exists only here so far, New's: validated under the same options as any other. */
export function openNewLayout(name: string, layout: Layout): Opened {
  return { ok: true, state: openDraft(name, layout, LOAD_OPTIONS) };
}
