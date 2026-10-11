/**
 * A text element's template field: the text, and a button beside it that inserts a placeholder at the
 * caret, a sensor from the same picker the Add menu and a binding use, or a clock token
 * (`layout-schema`'s `template.ts` has the grammar). Typing a placeholder by hand works as well, and
 * the validator names anything wrong in it, by character, as it is typed.
 *
 * The clock list shows each token as it reads now, in this machine's locale: the layout's own
 * `locale` decides what the panel says, and the preview shows that.
 *
 * The Style tab writes the annotations: it wraps the selection in a `{#style}` span, adds a filter
 * (`fit`, `hold`, `note`, ...) to the sensor placeholder at the caret, or turns that placeholder into
 * a readout's three rows (`readoutTemplate`). Each edit is a pure function of the text and the caret,
 * so it is tested without a textarea, and the validator still judges the result as it would typing.
 */

import {
  CLOCK_TOKENS,
  TEMPLATE_STYLES,
  readoutTemplate,
  templatePlaceholders,
  type ClockToken,
  type ClockVariant,
  type TemplateStyle,
} from '@perch/layout-schema';
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

/** An edit's result: the new text, and where the caret goes. */
export interface TemplateEdit {
  readonly text: string;
  readonly caret: number;
}

/**
 * `[start, end)` wrapped in a `style` span. An empty selection opens an empty span with the caret
 * inside it, ready for what goes there.
 */
export function wrapInStyle(
  text: string,
  start: number,
  end: number,
  style: TemplateStyle,
): TemplateEdit {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  const open = `{#${style}}`;
  const close = `{/${style}}`;
  const inner = text.slice(from, to);
  return {
    text: text.slice(0, from) + open + inner + close + text.slice(to),
    caret: from + open.length + inner.length + (inner === '' ? 0 : close.length),
  };
}

/**
 * The sensor placeholder the caret is in, or just after (where an insert leaves it), with its topic;
 * `null` when the caret is in none.
 */
export function sensorAt(
  text: string,
  caret: number,
): {
  readonly start: number;
  readonly end: number;
  readonly headEnd: number;
  readonly topic: string;
} | null {
  for (const placeholder of templatePlaceholders(text)) {
    if (caret <= placeholder.start || caret > placeholder.end) continue;
    const topic = (placeholder.head.split('|')[0] ?? '').trim();
    return topic.startsWith('sensors/') ? { ...placeholder, topic } : null;
  }
  return null;
}

/**
 * The sensor at the caret with ` | filter` added after its other filters and before any `||`, and the
 * caret after its closing brace. Unchanged when it has the filter; `null` with no sensor at the caret.
 */
export function withFilter(text: string, caret: number, filter: string): TemplateEdit | null {
  const sensor = sensorAt(text, caret);
  if (sensor === null) return null;
  const head = text.slice(sensor.start + 1, sensor.headEnd);
  if (head.split('|').some((part) => part.trim() === filter)) {
    return { text, caret: sensor.end };
  }
  const at = sensor.start + 1 + head.trimEnd().length;
  const added = ` | ${filter}`;
  return {
    text: text.slice(0, at) + added + text.slice(at),
    caret: sensor.end + added.length,
  };
}

/** The sensor at the caret, replaced by a readout's three rows for its topic. */
export function asReadout(text: string, caret: number): TemplateEdit | null {
  const sensor = sensorAt(text, caret);
  if (sensor === null) return null;
  const readout = readoutTemplate(sensor.topic);
  return {
    text: text.slice(0, sensor.start) + readout + text.slice(sensor.end),
    caret: sensor.start + readout.length,
  };
}

/** What each style span looks like, in the words of the readout row it borrows from. */
const STYLE_HELP: Readonly<Record<TemplateStyle, string>> = {
  label: "a readout's caption",
  unit: 'small and dim, as a unit',
  value: "a readout's number, full size",
  note: "a readout's note, small capitals",
};

/** The filters the Style tab offers for a sensor, and what each does. */
const FILTER_HELP: readonly (readonly [string, string])[] = [
  ['fit', "a readout's number: sized to the box, unit small and dim"],
  ['hold', 'keep the last value while stale'],
  ['note', 'waiting, no reading or stale Ns, in warn and alert colours'],
  ['value', 'the number without its unit'],
  ['unit', 'the unit alone'],
  ['label', "the sensor's name"],
  ['fixed:1', 'one decimal (0 to 6)'],
];

type Tab = 'sensor' | 'clock' | 'style';

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
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const name = `insert a sensor or the clock, or a style, into ${label}`;

  const field = (): HTMLTextAreaElement | null => {
    const found = document.getElementById(ids.controlId);
    return found instanceof HTMLTextAreaElement ? found : null;
  };

  const at = (): { start: number; end: number } =>
    selection ?? { start: value.length, end: value.length };
  const insert = (placeholder: string): void => {
    const where = at();
    apply(insertAt(value, where.start, where.end, placeholder));
  };
  const apply = (next: TemplateEdit): void => {
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
          setSelection(
            textarea === null
              ? null
              : { start: textarea.selectionStart, end: textarea.selectionEnd },
          );
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
              { id: 'style', label: 'Style', title: "a readout's looks: fit, hold, note, spans" },
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
            ) : tab === 'clock' ? (
              <ClockList onChoose={insert} />
            ) : (
              <StyleList value={value} start={at().start} end={at().end} onEdit={apply} />
            )}
          </div>
          <p className="perch-template__help">
            {
              'filters: | fixed:N, | value, | unit, | label, | fit, | hold, | note. fallback while waiting: || text. styles: {#label}...{/label}. {{ and }} are braces.'
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

function StyleList({
  value,
  start,
  end,
  onEdit,
}: {
  readonly value: string;
  readonly start: number;
  readonly end: number;
  readonly onEdit: (edit: TemplateEdit) => void;
}): ReactNode {
  const sensor = sensorAt(value, end);
  const readout = asReadout(value, end);

  return (
    <div className="perch-template__clock" aria-label="styles">
      <p className="perch-template__group">wrap the selection</p>
      {TEMPLATE_STYLES.map((style) => (
        <button
          key={style}
          type="button"
          className="perch-template__token"
          onClick={() => {
            onEdit(wrapInStyle(value, start, end, style));
          }}
        >
          <span className="perch-template__name">{`{#${style}}...{/${style}}`}</span>
          <span className="perch-template__example">{STYLE_HELP[style]}</span>
        </button>
      ))}
      <p className="perch-template__group">
        {sensor === null
          ? 'put the caret in a {sensors/...} placeholder to add these'
          : `add to ${sensor.topic}`}
      </p>
      {FILTER_HELP.map(([filter, help]) => (
        <button
          key={filter}
          type="button"
          className="perch-template__token"
          disabled={sensor === null}
          onClick={() => {
            const edit = withFilter(value, end, filter);
            if (edit !== null) onEdit(edit);
          }}
        >
          <span className="perch-template__name">{`| ${filter}`}</span>
          <span className="perch-template__example">{help}</span>
        </button>
      ))}
      <button
        type="button"
        className="perch-template__token"
        disabled={readout === null}
        onClick={() => {
          if (readout !== null) onEdit(readout);
        }}
      >
        <span className="perch-template__name">readout</span>
        <span className="perch-template__example">label, fitted number held while stale, note</span>
      </button>
    </div>
  );
}

export const TEMPLATE_FIELD_STYLES = `
.perch-topic.perch-topic--tall { align-items: start; }
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
.perch-template__token:hover:not(:disabled), .perch-template__token:focus-visible { background: var(--ed-accent-fill); color: var(--ed-text); outline: none; }
.perch-template__token:disabled { cursor: default; opacity: 0.45; }
.perch-template__group { margin: 6px 8px 2px; font-size: var(--ed-font-small); color: var(--ed-quiet); }
.perch-template__name { font-family: var(--ed-mono); }
.perch-template__example { color: var(--ed-quiet); white-space: nowrap; }
.perch-template__help { margin: 0; padding: 0 8px; font-size: var(--ed-font-small); color: var(--ed-quiet); }
`;
