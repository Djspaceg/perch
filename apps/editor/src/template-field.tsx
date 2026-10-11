/**
 * A text element's template field: the text, and a button beside it that inserts a placeholder at the
 * caret, a sensor from the same picker the Add menu and a binding use, or a clock token
 * (`layout-schema`'s `template.ts` has the grammar). Typing a placeholder by hand works as well, and
 * the validator names anything wrong in it, by character, as it is typed.
 *
 * The clock list shows each token as it reads now, in this machine's locale: the layout's own
 * `locale` decides what the panel says, and the preview shows that.
 */

import { CLOCK_TOKENS, type ClockToken, type ClockVariant } from '@perch/layout-schema';
import { formatClockToken } from '@perch/ui-kit';
import { useRef, useState, type ReactNode } from 'react';
import { TabStrip, usePopover, type RowIds } from './controls/index.js';
import { SensorList } from './sensor-picker.js';

/** Every clock placeholder, bare first and then each variant: `{time}`, `{time:seconds}`. */
export const CLOCK_PLACEHOLDERS: readonly string[] = Object.freeze(
  Object.entries(CLOCK_TOKENS).flatMap(([token, variants]) => [
    `{${token}}`,
    ...variants.slice(1).map((variant) => `{${token}:${variant}}`),
  ]),
);

/**
 * `text` with `inserted` in place of the selection `[start, end)`, and where the caret goes after:
 * the end of what went in. Pure, so the splice is tested without a textarea.
 */
export function insertAt(
  text: string,
  start: number,
  end: number,
  inserted: string,
): { readonly text: string; readonly caret: number } {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));

  return { text: text.slice(0, from) + inserted + text.slice(to), caret: from + inserted.length };
}

type Tab = 'sensor' | 'clock';

export function TemplateField({
  ids,
  label,
  value,
  onValue,
  children,
}: {
  readonly ids: RowIds;
  readonly label: string;
  readonly value: string;
  readonly onValue: (value: string) => void;
  /** The text control itself, a textarea with `ids.controlId`: `property-view.tsx`'s. */
  readonly children: ReactNode;
}): ReactNode {
  const anchor = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const popover = usePopover(anchor, box);
  const [tab, setTab] = useState<Tab>('sensor');
  // Where the caret was when the picker opened: focus leaves the field for the picker.
  const selection = useRef<{ start: number; end: number } | null>(null);
  const name = `insert a sensor or the clock into ${label}`;

  const field = (): HTMLTextAreaElement | null => {
    const found = document.getElementById(ids.controlId);
    return found instanceof HTMLTextAreaElement ? found : null;
  };

  const insert = (placeholder: string): void => {
    const at = selection.current ?? { start: value.length, end: value.length };
    const next = insertAt(value, at.start, at.end, placeholder);
    onValue(next.text);
    popover.close(false);
    // After React has written the new value, put the caret after what went in.
    requestAnimationFrame(() => {
      const textarea = field();
      if (textarea === null) return;
      textarea.focus();
      textarea.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <span className="perch-topic perch-topic--tall">
      {children}
      <button
        ref={anchor}
        type="button"
        className="perch-topic__choose"
        aria-label={name}
        data-perch-tip={name}
        aria-expanded={popover.open}
        aria-haspopup="dialog"
        {...(popover.open ? { 'aria-controls': popover.id } : {})}
        onClick={() => {
          const textarea = field();
          selection.current =
            textarea === null
              ? null
              : { start: textarea.selectionStart, end: textarea.selectionEnd };
          popover.setOpen(!popover.open);
        }}
      >
        <span aria-hidden="true">{'{}'}</span>
      </button>
      {popover.open ? (
        <div
          ref={box}
          id={popover.id}
          className="perch-popover perch-popover--sensors"
          role="dialog"
          aria-label="insert a placeholder"
          style={popover.style}
        >
          <TabStrip
            label="what to insert"
            idBase={`${popover.id}-insert`}
            tabs={[
              { id: 'sensor', label: 'Sensor', title: 'a live value: {sensors/...}' },
              { id: 'clock', label: 'Clock', title: 'the date or time, in the layout locale' },
            ]}
            selected={tab}
            onSelect={setTab}
          />
          <div id={`${popover.id}-insert-panel`} role="tabpanel">
            {tab === 'sensor' ? (
              <SensorList
                onChoose={(topic) => {
                  insert(`{${topic}}`);
                }}
              />
            ) : (
              <ClockList onChoose={insert} />
            )}
          </div>
          <p className="perch-template__help">
            {
              'filters: | fixed:N, | value, | unit, | label. fallback while waiting: || text. {{ and }} are braces.'
            }
          </p>
        </div>
      ) : null}
    </span>
  );
}

function ClockList({ onChoose }: { readonly onChoose: (placeholder: string) => void }): ReactNode {
  // When the list opened: an example, not a clock, so it does not tick.
  const [now] = useState(() => Date.now());

  return (
    <ul className="perch-template__clock" aria-label="clock tokens">
      {CLOCK_PLACEHOLDERS.map((placeholder) => {
        const [token = '', variant] = placeholder.slice(1, -1).split(':');
        const variants: readonly string[] = CLOCK_TOKENS[token as ClockToken];
        const example = formatClockToken(
          token as ClockToken,
          (variant ?? variants[0] ?? '') as ClockVariant,
          now,
        );
        return (
          <li key={placeholder}>
            <button
              type="button"
              className="perch-template__token"
              onClick={() => {
                onChoose(placeholder);
              }}
            >
              <span className="perch-template__name">{placeholder}</span>
              <span className="perch-template__example">{example}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export const TEMPLATE_FIELD_STYLES = `
.perch-topic--tall { align-items: start; }
.perch-template__clock { display: flex; flex-direction: column; gap: 1px; margin: 0; padding: 4px; list-style: none; max-height: min(50vh, 360px); overflow-y: auto; }
.perch-template__token {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  border: 0;
  border-radius: var(--ed-radius);
  background: none;
  color: var(--ed-label);
  font: inherit;
  font-size: var(--ed-font-small);
  text-align: left;
  padding: 4px 8px;
  cursor: pointer;
}
.perch-template__token:hover, .perch-template__token:focus-visible { background: var(--ed-accent-fill); color: var(--ed-text); outline: none; }
.perch-template__name { font-family: var(--ed-mono); }
.perch-template__example { color: var(--ed-quiet); white-space: nowrap; }
.perch-template__help { margin: 0; padding: 0 8px; font-size: var(--ed-font-small); color: var(--ed-quiet); }
`;
