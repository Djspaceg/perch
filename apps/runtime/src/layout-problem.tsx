/**
 * What the page shows when it will not render a layout.
 *
 * The rule this file implements is the whole reason `layout-schema` returns a *list* of issues with
 * a field path and an element index on each one instead of throwing on the first: **the problems go
 * on the page.** A console line is not a report — the panel this runs on has no console attached, a
 * capture of a failed page shows nothing about why it failed, and the person best placed to fix a
 * layout is the one looking at the screen it refused to draw.
 *
 * Three refusals, each with its own `data-perch-problem` value so a capture harness can tell them
 * apart without reading the prose:
 *
 * - `unknown-layout` — `?layout=` named a file that is not there. Lists what is, because the
 *   overwhelmingly likely cause is a typo and the fix is one of the names shown.
 * - `invalid-layout` — the document is not a layout. Prints `formatLayoutIssues` verbatim, which is
 *   already the format's own author-facing rendering: one line per issue, `path: message [code]`.
 * - `target-mismatch` — the layout is fine and *this output* cannot honour it, which only capture
 *   mode refuses. Prints `describeTargetMismatch`'s sentence.
 *
 * ## Why the issue list is a `<pre>`
 *
 * `formatLayoutIssues` returns text whose two-space indent and one-issue-per-line shape carry
 * meaning, and the paths inside it (`elements[3].rect.w`) are strings an author will re-read
 * character by character against their file. Reflowing that into paragraphs would lose the alignment
 * that makes twelve issues scannable; splitting it into a list would mean re-implementing the
 * formatting this page was told to use. It wraps with `pre-wrap` rather than scrolling horizontally,
 * because the whole point is that the issues are *readable*: a message clipped at the right edge is
 * unreadable in a screenshot and unreadable on a panel with no scrollbar, and the two longest issue
 * messages the format emits — the theme-token grammar and the media-path rule — are longer than a
 * 1280px window. The author's newlines and indent still survive, which is what `pre` is for.
 *
 * The styling is deliberately plain and *not themed*: a refusal must render identically whatever the
 * layout's theme says, because one of the things a layout can be invalid about is its theme.
 */

import type { ReactNode } from 'react';
import { formatLayoutIssues, type LayoutIssue } from '@perch/layout-schema';

/** Which refusal this is. Also the value of `data-perch-problem`. */
export type LayoutProblemKind = 'unknown-layout' | 'invalid-layout' | 'target-mismatch';

export interface LayoutProblemProps {
  readonly kind: LayoutProblemKind;
  /** The headline: what was refused, in one line. */
  readonly summary: string;
  /** The body: the issue list, the mismatch sentence, or the available names. */
  readonly detail: string;
}

export function LayoutProblem({ kind, summary, detail }: LayoutProblemProps): ReactNode {
  return (
    <div className="perch-problem" data-testid="perch-layout-problem" data-perch-problem={kind}>
      <h1 className="perch-problem__summary">{summary}</h1>
      <pre className="perch-problem__detail">{detail}</pre>
    </div>
  );
}

/**
 * The refusal for a document that is not a layout.
 *
 * `formatLayoutIssues` is called here rather than by each caller, so the page cannot accidentally
 * ship a refusal that shows a count instead of the issues.
 */
export function invalidLayoutProblem(
  name: string,
  issues: readonly LayoutIssue[],
): LayoutProblemProps {
  return {
    kind: 'invalid-layout',
    summary: `${name} is not a layout: ${issueCount(issues.length)}`,
    detail: formatLayoutIssues(issues),
  };
}

/** The refusal for a name that is not in the catalogue. */
export function unknownLayoutProblem(
  name: string,
  available: readonly string[],
): LayoutProblemProps {
  return {
    kind: 'unknown-layout',
    summary: `no layout named ${name}`,
    detail:
      available.length === 0
        ? '  no layouts found in layouts/'
        : ['  available layouts:', ...available.map((entry) => `    ?layout=${entry}`)].join('\n'),
  };
}

/**
 * The refusal for an output that cannot honour the layout.
 *
 * Says what to do about it, because unlike the other two this one is not a mistake in a file: the
 * layout is correct and the *window* is wrong, and the reader has no way to guess that the fix is a
 * viewport rather than an edit.
 */
export function targetMismatchProblem(name: string, mismatch: string): LayoutProblemProps {
  return {
    kind: 'target-mismatch',
    summary: `capture mode will not scale ${name}`,
    detail: [
      `  ${mismatch}`,
      '',
      '  capture mode renders 1:1 or not at all, so a screenshot is never a scaled',
      '  picture of the panel. Size the viewport to the declared target, or drop',
      '  &mode=capture to view it scaled and letterboxed.',
    ].join('\n'),
  };
}

function issueCount(count: number): string {
  return count === 1 ? '1 problem' : `${count} problems`;
}

/**
 * The refusal's styles. Injected by the page like every other sheet here.
 *
 * Light-on-dark at a readable size, sized for the 1920x400 panel as much as for a tab: a refusal is
 * read across a room at least as often as a layout is.
 */
export const LAYOUT_PROBLEM_STYLES = `
.perch-problem {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100vw;
  height: 100vh;
  padding: 28px 36px;
  background: #1a1012;
  font-family: ui-sans-serif, system-ui, sans-serif;
  color: #ffd9d0;
}
.perch-problem__summary {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 650;
  letter-spacing: 0.01em;
  color: #ff9b9b;
}
.perch-problem__detail {
  margin: 0;
  flex: 1;
  min-height: 0;
  overflow: auto;
  /* Wrap only what is too long for the window; the newlines and the indent are the author's. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: ui-monospace, monospace;
  font-size: 0.875rem;
  line-height: 1.5;
  color: #ffd9d0;
}
`;
