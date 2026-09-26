/**
 * Section: a full-width header bar with a disclosure triangle, and a body.
 *
 * The header is a `<button aria-expanded>` inside a real heading, and the whole section is a labelled
 * region, so the structure is navigable by heading and by landmark. The body is a `Collapse`, so it
 * slides open and shut rather than appearing, and a folded body stays mounted with `hidden`: nothing
 * inside loses its state by being folded, and the bar's `summary` still says what the body holds — so
 * a column of folded sections is still a map of the whole.
 *
 * `id` is the key the open state is remembered under, in the editor store's persisted settings
 * (`../store.ts`), so a fold survives a reload.
 * `forceOpen` shows the body without touching what is remembered; a search uses it, so clearing the
 * search puts every section back the way the author left it.
 *
 * The bar never widens its column. The title keeps its width and the summary takes what is left,
 * truncating with an ellipsis: a summary is often authored text — a text element's whole prose — and
 * one that could not shrink once painted over the title and pushed the sidebar sideways.
 *
 * `AdvancedSection` is the same thing quieter, for inside a section: the rarely tuned fields, folded
 * by default, with a count of what it hides that is set.
 */

import { useId, type ReactNode } from 'react';
import { Collapse } from './collapse.js';
import { useDisclosure } from '../store.js';

export interface SectionProps {
  readonly id: string;
  readonly title: string;
  readonly level?: 2 | 3 | 4 | 5;
  readonly defaultOpen?: boolean;
  readonly forceOpen?: boolean;
  /** Quiet text at the bar's right edge. */
  readonly summary?: ReactNode;
  /** Tints the summary: something in this section is set here. */
  readonly summaryActive?: boolean;
  readonly variant?: 'section' | 'advanced';
  readonly testId?: string | undefined;
  readonly children: ReactNode;
}

export function Section({
  id,
  title,
  level = 3,
  defaultOpen = true,
  forceOpen = false,
  summary,
  summaryActive = false,
  variant = 'section',
  testId,
  children,
}: SectionProps): ReactNode {
  const [open, setOpen] = useDisclosure(id, defaultOpen);
  const shown = open || forceOpen;
  const base = useId();
  const headingId = `${base}-heading`;
  const bodyId = `${base}-body`;
  const Heading = `h${level}` as const;
  const summaryNode =
    summary === undefined || summary === null || summary === '' ? null : (
      <span
        className="perch-section__summary"
        data-perch-active={summaryActive ? 'true' : 'false'}
        // A summary is one line that truncates, so the whole of it is the tooltip. Only for text: a
        // node has no string form worth showing.
        {...(typeof summary === 'string' ? { title: summary } : {})}
      >
        {summary}
      </span>
    );

  return (
    <section
      className={`perch-section perch-section--${variant}`}
      aria-labelledby={headingId}
      data-perch-open={shown ? 'true' : 'false'}
      data-testid={testId}
    >
      <div className="perch-section__bar">
        <Heading className="perch-section__heading" id={headingId}>
          <button
            type="button"
            className="perch-section__toggle"
            aria-expanded={shown}
            aria-controls={bodyId}
            onClick={() => {
              setOpen(!shown);
            }}
          >
            {title}
            {variant === 'advanced' ? summaryNode : null}
          </button>
        </Heading>
        {variant === 'section' ? summaryNode : null}
      </div>
      <Collapse open={shown} keepMounted id={bodyId}>
        <div className="perch-section__body">{children}</div>
      </Collapse>
    </section>
  );
}

/** The nested foldout for a section's rarely tuned fields. */
export function AdvancedSection({
  id,
  setCount,
  forceOpen = false,
  children,
}: {
  readonly id: string;
  /** How many of the hidden fields this surface sets. Shown while closed, so nothing hides silently. */
  readonly setCount: number;
  readonly forceOpen?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Section
      id={id}
      title="Advanced"
      level={4}
      defaultOpen={false}
      forceOpen={forceOpen}
      variant="advanced"
      summary={setCount === 0 ? undefined : `${setCount} set`}
      summaryActive={setCount > 0}
    >
      {children}
    </Section>
  );
}

export const SECTION_STYLES = `
.perch-section { display: flex; flex-direction: column; min-width: 0; }
.perch-section__bar {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  min-height: var(--ed-row-h);
  padding-right: var(--ed-pad-x);
  background: var(--ed-bar);
  border-top: 1px solid var(--ed-bar-edge);
  border-bottom: 1px solid var(--ed-bar-shadow);
}
.perch-section__heading { flex: 1 0 auto; margin: 0; font: inherit; }
.perch-section__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: calc(var(--ed-row-h) - 1px);
  border: 0;
  background: none;
  color: #dbe4f2;
  font: inherit;
  font-size: var(--ed-font);
  font-weight: 600;
  text-align: left;
  padding: 0 0 0 6px;
  cursor: pointer;
}
.perch-section__toggle::before {
  content: '';
  flex: none;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 4px 0 4px 6px;
  border-color: transparent transparent transparent var(--ed-quiet);
  transition: transform 80ms ease-out;
}
.perch-section__toggle[aria-expanded='true']::before { transform: rotate(90deg); }
.perch-section__toggle:hover { color: #ffffff; }
.perch-section__toggle:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: -2px; }
.perch-section__summary {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--ed-font-small);
  font-weight: 400;
  color: var(--ed-quiet);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.perch-section__summary[data-perch-active='true'] { color: var(--ed-own-text); }
.perch-section__body { display: flex; flex-direction: column; padding: 3px 0 5px; }
.perch-section--advanced .perch-section__bar { background: none; border: 0; min-height: 20px; }
.perch-section--advanced .perch-section__toggle {
  min-height: 20px;
  padding-left: calc(var(--ed-pad-x) + 6px);
  font-weight: 500;
  color: var(--ed-label);
  font-size: var(--ed-font-small);
}
.perch-section--advanced .perch-section__toggle .perch-section__summary { margin-left: 4px; }
.perch-section--advanced .perch-section__body { padding: 0; }
`;
