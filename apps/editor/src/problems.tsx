/**
 * What the editor shows when the draft is not a layout.
 *
 * Refusal is a first-class screen here, not an error toast. `apps/editor/SPEC.md` hard rule 2 says an
 * editor that can produce a layout the runtime rejects is broken, and the corollary is that when the
 * draft *is* rejected the author has to be able to fix it — which means seeing which field, in which
 * element, and what the rule was. All three are already in a `LayoutIssue`; the job of this file is to
 * not lose them.
 *
 * ## `formatLayoutIssues`, verbatim, in a `<pre>`
 *
 * The same convention as `apps/runtime/src/layout-problem.tsx`, for the same reason. The formatter
 * emits `  elements[3].rect.w: must be an integer of at least 1, got 0 [invalid-rect]` — two-space
 * indent, a dotted field path, the value it saw, the issue code — and every part of that is load-
 * bearing. Re-laying it out as a table means deciding which parts matter; printing it in a `<pre>`
 * with `white-space: pre-wrap` keeps all of them, keeps the path copyable, and means the sentence an
 * author reads here is the sentence the runtime would have shown them.
 *
 * The one thing this adds is navigation: an issue carrying an `elementIndex` gets a button that
 * selects that element in the inspector, because an editor that can name the element is an editor
 * that can take you to it. The text stays the text — the buttons are listed beside the block, not
 * spliced into it.
 */

import { formatLayoutIssues, type LayoutIssue } from '@perch/layout-schema';
import type { ReactNode } from 'react';

export interface LayoutProblemsProps {
  /** Every reason the draft is not a layout. Rendered only when non-empty; see `Inspector`. */
  readonly issues: readonly LayoutIssue[];
  /** Jump to an element. Used for the issues that name one. */
  readonly onSelectElement: (index: number) => void;
}

/** The refusal panel: a headline count, the formatter's block, and a jump per named element. */
export function LayoutProblems({ issues, onSelectElement }: LayoutProblemsProps): ReactNode {
  if (issues.length === 0) return null;

  return (
    <section className="perch-editor-problems" data-testid="perch-editor-problems">
      <h2 className="perch-editor-problems__title">
        {`this is not a valid layout · ${issues.length} ${issues.length === 1 ? 'problem' : 'problems'}`}
      </h2>
      <p className="perch-editor-problems__note">
        saving is refused until these are fixed. the preview is holding the last version that
        validated.
      </p>
      {/*
       * `formatLayoutIssues`' output, unaltered. The indent and the paths carry meaning, so the block
       * is printed rather than parsed — see the module comment.
       */}
      <pre className="perch-editor-problems__text" data-testid="perch-editor-problem-text">
        {formatLayoutIssues(issues)}
      </pre>
      <ElementJumps issues={issues} onSelectElement={onSelectElement} />
    </section>
  );
}

/**
 * One button per element an issue names, in ascending order and each listed once.
 *
 * Deduplicated because a single bad element routinely produces several issues — a rect with two bad
 * components, or an unknown widget that also invalidates its range — and four buttons pointing at
 * `elements[3]` is noise in front of the text that matters.
 */
function ElementJumps({ issues, onSelectElement }: LayoutProblemsProps): ReactNode {
  const indexes = [
    ...new Set(
      issues
        .map((issue) => issue.elementIndex)
        .filter((index): index is number => index !== undefined),
    ),
  ].sort((left, right) => left - right);

  if (indexes.length === 0) return null;

  return (
    <p className="perch-editor-problems__jumps">
      <span className="perch-editor-problems__jumps-label">go to:</span>
      {indexes.map((index) => (
        <button
          key={index}
          type="button"
          className="perch-editor-problems__jump"
          onClick={() => {
            onSelectElement(index);
          }}
        >
          {`element ${index}`}
        </button>
      ))}
    </p>
  );
}

export const LAYOUT_PROBLEMS_STYLES = `
.perch-editor-problems {
  border: 1px solid #6b2626;
  border-radius: 4px;
  background: #2a1212;
  padding: 10px 12px;
  color: #ffd7d7;
}
.perch-editor-problems__title {
  margin: 0 0 4px;
  font-size: 0.8125rem;
  font-weight: 600;
}
.perch-editor-problems__note {
  margin: 0 0 8px;
  font-size: 0.75rem;
  color: #e8a0a0;
}
/*
 * pre-wrap and anywhere: the block must not scroll sideways and must not truncate. A path is the
 * actionable half of an issue, and it is at the start of the line where a clipped line loses the
 * message and a clipped *wrap* loses nothing.
 */
.perch-editor-problems__text {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.perch-editor-problems__jumps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 8px 0 0;
  font-size: 0.75rem;
}
.perch-editor-problems__jumps-label { color: #e8a0a0; }
.perch-editor-problems__jump {
  border: 1px solid #6b2626;
  border-radius: 999px;
  background: #3a1818;
  color: #ffd7d7;
  font: inherit;
  padding: 1px 8px;
  cursor: pointer;
}
`;
