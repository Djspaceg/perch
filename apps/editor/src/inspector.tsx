/**
 * The form. Every field a layout already has, and nothing it does not.
 *
 * This slice edits the existing shape of a document: the canvas target, the theme tokens, each
 * element's rect, and per kind the fields that kind carries. It does not add or delete elements, does
 * not reorder them, and has no direct manipulation — those are named in DECISIONS.md as left out, not
 * missed. A form was chosen over dragging for a reason worth stating: every field here is authored as
 * an integer at a known name, and a form is the only editor where `rect.x = 214` is a thing you can
 * *type*. Dragging comes after there is something to drag against.
 *
 * ## Controls write straight through `layout-edits.ts`
 *
 * Nothing here holds a copy of a field's value. Each control renders from `state.draft` and, on
 * change, calls `onEdit` with the pure update for that field — so the draft is the only place a value
 * lives, and the validation in `editDraft` runs on every keystroke rather than on blur or on save.
 * That is what makes the problem list track what the author is doing instead of lagging it.
 *
 * ## Numeric fields are `type="text"`
 *
 * Deliberate, and the opposite of the obvious choice. `type="number"` hands back `''` for anything it
 * considers malformed, so a typo silently becomes an empty field with no indication of what was
 * rejected, and browsers disagree about what counts. A text input yields exactly what was typed;
 * `numberFromInput` maps it to a `number` (including `NaN`), and `validateLayout` says what is wrong
 * with it, naming the field. An author typing `1o80` sees a sentence about `elements[3].rect.w`
 * instead of a box that went blank. `inputMode` still brings up a numeric keypad where there is one.
 *
 * ## Free text with suggestions, not a closed picker
 *
 * Topics and widget names are text inputs backed by a `<datalist>`. A closed `<select>` cannot
 * represent a value the document already holds — an unregistered widget, a topic no source is
 * currently publishing — and a control that cannot show the current value is a control that hides the
 * problem the validator is reporting. The list supplies the suggestions; the validator keeps the
 * guarantee. Topic suggestions come from the mock source's own topics, which is the offline reduction
 * of SPEC.md's "populated from live topics": the sensor host is off, and authoring must not need it.
 *
 * `fit` and `gap` *are* closed selects, because their vocabularies are closed in the format itself
 * (`MEDIA_FITS`, `CHART_GAPS`) and the sets have two members each.
 *
 * ## The two token maps are one component, twice
 *
 * A layout's `theme` and an element's `style` are not rendered here. Both go through `TokenPane`, at
 * `layout` and `element` scope — see `token-pane.tsx`. They are one component because they are one
 * thing at two levels: a map of overrides of the defaults `@perch/ui-kit` declares. The pane is where
 * the labels, the per-type controls, the reset affordance and the Customize/Developer split live, and
 * keeping them in one place is what stops "remove" meaning something different in the theme section
 * from what it means in the element section.
 */

import {
  CHART_GAPS,
  CHART_MAX_WINDOW_MS,
  CHART_MIN_WINDOW_MS,
  DEFAULT_CHART_GAP,
  MEDIA_FITS,
  type ChartGap,
  type LayoutElement,
  type MediaFit,
} from '@perch/layout-schema';
import { assertNever } from '@perch/ui-kit';
import type { ReactNode } from 'react';
import type { DraftState } from './draft.js';
import {
  numberFromInput,
  numberToInput,
  removeElementStyleToken,
  removeThemeToken,
  setElementFit,
  setElementGap,
  setElementRangeBound,
  setElementRectField,
  setElementSrc,
  setElementStyleToken,
  setElementText,
  setElementTopic,
  setElementWidget,
  setElementWindowMs,
  setTargetField,
  setThemeToken,
  type LayoutUpdate,
  type RectField,
} from './layout-edits.js';
import { TokenPane } from './token-pane.js';

/** The four rect components, in the order a person reads a rect. */
const RECT_FIELDS: readonly RectField[] = ['x', 'y', 'w', 'h'];

/** The id of the topic suggestion list, referenced by every topic input. */
const TOPIC_LIST_ID = 'perch-editor-topics';

/** The id of the widget-name suggestion list. */
const WIDGET_LIST_ID = 'perch-editor-widgets';

export interface InspectorProps {
  readonly state: DraftState;
  /** Which element the element pane is showing. Out of range means "none selected". */
  readonly selected: number;
  readonly onSelect: (index: number) => void;
  /** Apply an edit. Goes through `editDraft`, so it is validated before it is anywhere else. */
  readonly onEdit: (update: LayoutUpdate) => void;
  /** Topic suggestions. The mock source's own topics; see the module comment. */
  readonly topics: readonly string[];
  /** Registered widget names, for suggestions. `WIDGET_NAMES` from `ui-kit`. */
  readonly widgets: readonly string[];
}

/** The whole form. */
export function Inspector({
  state,
  selected,
  onSelect,
  onEdit,
  topics,
  widgets,
}: InspectorProps): ReactNode {
  const element = state.draft.elements[selected];

  return (
    <div className="perch-editor-inspector" data-testid="perch-editor-inspector">
      {/*
       * The suggestion lists, once per form rather than once per input. A `<datalist>` is referenced
       * by id, so one of each serves every topic and widget control on the page.
       */}
      <datalist id={TOPIC_LIST_ID}>
        {topics.map((topic) => (
          <option key={topic} value={topic} />
        ))}
      </datalist>
      <datalist id={WIDGET_LIST_ID}>
        {widgets.map((widget) => (
          <option key={widget} value={widget} />
        ))}
      </datalist>

      <TargetFields state={state} onEdit={onEdit} />
      <ThemeFields state={state} onEdit={onEdit} />
      <ElementList state={state} selected={selected} onSelect={onSelect} />
      {element === undefined ? (
        <p className="perch-editor-empty">select an element to edit it</p>
      ) : (
        <ElementFields
          element={element}
          index={selected}
          theme={state.draft.theme}
          onEdit={onEdit}
        />
      )}
    </div>
  );
}

/** The canvas the layout declares it needs. */
function TargetFields({ state, onEdit }: Pick<InspectorProps, 'state' | 'onEdit'>): ReactNode {
  const { target } = state.draft;

  return (
    <Section title="target">
      <div className="perch-editor-row">
        <NumberField
          label="width"
          value={target.width}
          onValue={(value) => {
            onEdit(setTargetField('width', value));
          }}
        />
        <NumberField
          label="height"
          value={target.height}
          onValue={(value) => {
            onEdit(setTargetField('height', value));
          }}
        />
        <NumberField
          label="frameRate"
          value={target.frameRate}
          onValue={(value) => {
            onEdit(setTargetField('frameRate', value));
          }}
        />
      </div>
    </Section>
  );
}

/**
 * The theme: CSS custom properties applied to the whole canvas.
 *
 * Both tabs and every control live in `token-pane.tsx`, because a `theme` and an element's `style` are
 * the same kind of map — overrides of the defaults `ui-kit` declares — and the two surfaces reading
 * differently is how an author learns that `remove` means one thing here and another there.
 */
function ThemeFields({ state, onEdit }: Pick<InspectorProps, 'state' | 'onEdit'>): ReactNode {
  return (
    <TokenPane
      id="theme"
      title="theme"
      scope="layout"
      tokens={state.draft.theme}
      onSet={(name, value) => {
        onEdit(setThemeToken(name, value));
      }}
      onRemove={(name) => {
        onEdit(removeThemeToken(name));
      }}
    />
  );
}

/**
 * Every element, in paint order, as a list of buttons.
 *
 * The index is shown because it is what every issue path names — `elements[3].rect.w` — so the list
 * and the problem panel agree on how to refer to an element without either having to invent a label.
 * Paint order is array order, and the list says so rather than leaving the reader to discover it.
 */
function ElementList({
  state,
  selected,
  onSelect,
}: Pick<InspectorProps, 'state' | 'selected' | 'onSelect'>): ReactNode {
  return (
    <Section title={`elements · ${state.draft.elements.length} · painted top to bottom`}>
      <ul className="perch-editor-elements" data-testid="perch-editor-elements">
        {state.draft.elements.map((element, index) => (
          <li key={index}>
            <button
              type="button"
              className="perch-editor-element"
              aria-current={index === selected ? 'true' : undefined}
              data-perch-selected={index === selected ? 'true' : 'false'}
              onClick={() => {
                onSelect(index);
              }}
            >
              <span className="perch-editor-element__index">{index}</span>
              <span className="perch-editor-element__kind">{element.kind}</span>
              <span className="perch-editor-element__summary">{describeElement(element)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** One element's own fields: the rect every kind has, then whatever this kind carries. */
function ElementFields({
  element,
  index,
  theme,
  onEdit,
}: {
  readonly element: LayoutElement;
  readonly index: number;
  /** The layout's theme, which this element's own style sits on top of. Passed to `StyleFields`. */
  readonly theme: Readonly<Record<string, string>> | undefined;
  readonly onEdit: (update: LayoutUpdate) => void;
}): ReactNode {
  return (
    <Section title={`elements[${index}] · ${element.kind}`}>
      <div className="perch-editor-row">
        {RECT_FIELDS.map((field) => (
          <NumberField
            key={field}
            label={field}
            value={element.rect[field]}
            onValue={(value) => {
              onEdit(setElementRectField(index, field, value));
            }}
          />
        ))}
      </div>

      <KindFields element={element} index={index} onEdit={onEdit} />
      <RangeFields element={element} index={index} onEdit={onEdit} />
      <StyleFields element={element} index={index} theme={theme} onEdit={onEdit} />
    </Section>
  );
}

/** The fields that exist only on one kind. */
function KindFields({
  element,
  index,
  onEdit,
}: {
  readonly element: LayoutElement;
  readonly index: number;
  readonly onEdit: (update: LayoutUpdate) => void;
}): ReactNode {
  switch (element.kind) {
    case 'text':
      return (
        <TextField
          label="text"
          value={element.text}
          onValue={(value) => {
            onEdit(setElementText(index, value));
          }}
        />
      );

    case 'media':
      return (
        <>
          <TextField
            label="src"
            value={element.src}
            onValue={(value) => {
              onEdit(setElementSrc(index, value));
            }}
          />
          <ChoiceField
            label="fit"
            value={element.fit}
            options={MEDIA_FITS}
            unsetLabel="unset · the canvas decides"
            onValue={(value: MediaFit) => {
              onEdit(setElementFit(index, value));
            }}
          />
        </>
      );

    case 'widget':
      return (
        <>
          <TextField
            label="widget"
            value={element.widget}
            listId={WIDGET_LIST_ID}
            onValue={(value) => {
              onEdit(setElementWidget(index, value));
            }}
          />
          <TextField
            label="topic"
            value={element.topic}
            listId={TOPIC_LIST_ID}
            onValue={(value) => {
              onEdit(setElementTopic(index, value));
            }}
          />
        </>
      );

    case 'chart':
      return (
        <>
          <TextField
            label="widget"
            value={element.widget}
            listId={WIDGET_LIST_ID}
            onValue={(value) => {
              onEdit(setElementWidget(index, value));
            }}
          />
          <TextField
            label="topic"
            value={element.topic}
            listId={TOPIC_LIST_ID}
            onValue={(value) => {
              onEdit(setElementTopic(index, value));
            }}
          />
          <NumberField
            label="windowMs"
            value={element.windowMs}
            hint={`${CHART_MIN_WINDOW_MS}-${CHART_MAX_WINDOW_MS} ms`}
            onValue={(value) => {
              onEdit(setElementWindowMs(index, value));
            }}
          />
          <ChoiceField
            label="gap"
            value={element.gap}
            options={CHART_GAPS}
            unsetLabel={`unset · ${DEFAULT_CHART_GAP}`}
            onValue={(value: ChartGap) => {
              onEdit(setElementGap(index, value));
            }}
          />
        </>
      );

    default:
      return assertNever(element, 'layout element');
  }
}

/**
 * The y-scale, shown only when the element already has one.
 *
 * There is no control to add a range. The format requires one exactly when the widget's registry entry
 * says it `drawsScale` and rejects one when it does not, so "add a range" is only meaningful against a
 * particular widget name — and a button that could put a `range` on a readout would be a button whose
 * whole effect is a validation error. Retargeting a widget that needs a range is an element-creation
 * concern, and element creation is out of this slice. See DECISIONS.md.
 */
function RangeFields({
  element,
  index,
  onEdit,
}: {
  readonly element: LayoutElement;
  readonly index: number;
  readonly onEdit: (update: LayoutUpdate) => void;
}): ReactNode {
  if (element.kind === 'text' || element.kind === 'media') return null;

  const range = element.range;
  if (range === undefined) return null;

  return (
    <div className="perch-editor-row">
      <NumberField
        label="range min"
        value={range[0]}
        onValue={(value) => {
          onEdit(setElementRangeBound(index, 'min', value));
        }}
      />
      <NumberField
        label="range max"
        value={range[1]}
        onValue={(value) => {
          onEdit(setElementRangeBound(index, 'max', value));
        }}
      />
    </div>
  );
}

/**
 * An element's own style tokens.
 *
 * Absent for a media element, which carries no `style` in the format — so there is no control for it
 * rather than a control that quietly does nothing.
 *
 * The same pane as the theme, at `element` scope: an element's `style` overrides the canvas' theme
 * exactly as the theme overrides the ui-kit default, so the override-and-reset wording has to read the
 * same here. The scope drops the canvas' own two tokens, which an element box cannot change — see
 * `token-pane.tsx`. The pane is keyed by index so switching selection resets its tabs and disclosures
 * rather than carrying one element's open rows onto another's.
 *
 * The theme goes in as `inherited`, and it is not decoration: a token the layout sets and this element
 * does not is painting the layout's value, so a pane without it would answer "default" with the
 * package's number while the author is looking at the layout's.
 */
function StyleFields({
  element,
  index,
  theme,
  onEdit,
}: {
  readonly element: LayoutElement;
  readonly index: number;
  readonly theme: Readonly<Record<string, string>> | undefined;
  readonly onEdit: (update: LayoutUpdate) => void;
}): ReactNode {
  if (element.kind === 'media') return null;

  return (
    <TokenPane
      key={index}
      id={`style-${index}`}
      title="style"
      scope="element"
      tokens={element.style ?? {}}
      inherited={theme}
      onSet={(name, value) => {
        onEdit(setElementStyleToken(index, name, value));
      }}
      onRemove={(name) => {
        onEdit(removeElementStyleToken(index, name));
      }}
    />
  );
}

/** A one-line description of an element, for the list. */
export function describeElement(element: LayoutElement): string {
  switch (element.kind) {
    case 'text':
      // An empty string is a validation error, so it is named rather than rendered as a blank row —
      // a list with a gap in it looks like a rendering bug, not like the problem it is.
      return element.text === '' ? '(empty text)' : element.text;
    case 'media':
      return element.src;
    case 'widget':
    case 'chart':
      return `${element.widget} · ${element.topic}`;
    default:
      return assertNever(element, 'layout element');
  }
}

/** A titled group of controls. */
function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section className="perch-editor-section">
      <h3 className="perch-editor-title">{title}</h3>
      {children}
    </section>
  );
}

/** A numeric control. See the module comment on why it is a text input. */
function NumberField({
  label,
  value,
  onValue,
  hint,
}: {
  readonly label: string;
  readonly value: number;
  readonly onValue: (value: number) => void;
  readonly hint?: string;
}): ReactNode {
  return (
    <label className="perch-editor-field">
      <span className="perch-editor-label">
        {label}
        {hint === undefined ? null : <span className="perch-editor-hint">{hint}</span>}
      </span>
      <input
        className="perch-editor-input perch-editor-input--number"
        type="text"
        inputMode="decimal"
        value={numberToInput(value)}
        onChange={(event) => {
          onValue(numberFromInput(event.target.value));
        }}
      />
    </label>
  );
}

/** A string control, optionally backed by a suggestion list. */
function TextField({
  label,
  value,
  onValue,
  listId,
}: {
  readonly label: string;
  readonly value: string;
  readonly onValue: (value: string) => void;
  readonly listId?: string;
}): ReactNode {
  return (
    <label className="perch-editor-field">
      <span className="perch-editor-label">{label}</span>
      <input
        className="perch-editor-input"
        type="text"
        value={value}
        // Spread-or-nothing: under `exactOptionalPropertyTypes` a `list={undefined}` is a different
        // prop set from no `list` at all, and React would render the attribute as empty.
        {...(listId === undefined ? {} : { list: listId })}
        onChange={(event) => {
          onValue(event.target.value);
        }}
      />
    </label>
  );
}

/**
 * A closed vocabulary, for a field whose values the format enumerates.
 *
 * An absent optional value gets a disabled leading option naming what the format does instead, so the
 * control shows the truth — "unset, and the default is `break`" — rather than pre-selecting a value
 * the document does not contain. Choosing a real option sets it; there is no way back to unset in this
 * slice, which is noted in DECISIONS.md.
 */
function ChoiceField<Value extends string>({
  label,
  value,
  options,
  unsetLabel,
  onValue,
}: {
  readonly label: string;
  readonly value: Value | undefined;
  readonly options: readonly Value[];
  readonly unsetLabel: string;
  readonly onValue: (value: Value) => void;
}): ReactNode {
  return (
    <label className="perch-editor-field">
      <span className="perch-editor-label">{label}</span>
      <select
        className="perch-editor-input"
        value={value ?? ''}
        onChange={(event) => {
          // The empty option is disabled, so the value can only be one of `options` here. Narrowed by
          // a lookup rather than by a cast: a `find` that comes back `undefined` means the browser
          // reported a value no option carries, which is not a thing to paper over.
          const chosen = options.find((option) => option === event.target.value);
          if (chosen !== undefined) onValue(chosen);
        }}
      >
        {value === undefined ? (
          <option value="" disabled>
            {unsetLabel}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export const INSPECTOR_STYLES = `
.perch-editor-inspector {
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding: 12px;
  font-size: 0.8125rem;
}
.perch-editor-section { display: flex; flex-direction: column; gap: 6px; }
.perch-editor-title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #7f8da3;
}
.perch-editor-subsection { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.perch-editor-subtitle { margin: 0; font-size: 0.75rem; font-weight: 600; color: #7f8da3; }
.perch-editor-row { display: flex; flex-wrap: wrap; gap: 8px; }
.perch-editor-field { display: flex; flex-direction: column; gap: 2px; flex: 1 1 120px; min-width: 0; }
.perch-editor-label {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.6875rem;
  color: #9aa4b2;
  overflow-wrap: anywhere;
}
.perch-editor-hint { color: #4c586b; }
.perch-editor-input {
  min-width: 0;
  border: 1px solid #262c36;
  border-radius: 3px;
  background: #0d1016;
  color: #e8f1ff;
  font: inherit;
  padding: 3px 6px;
}
.perch-editor-input--number { font-variant-numeric: tabular-nums; }
.perch-editor-input:focus-visible { outline: 2px solid #8fb7e8; outline-offset: 0; }
.perch-editor-elements { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.perch-editor-element {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 3px;
  background: #0d1016;
  color: #9aa4b2;
  font: inherit;
  font-size: 0.75rem;
  text-align: left;
  padding: 3px 6px;
  cursor: pointer;
}
.perch-editor-element[data-perch-selected='true'] { border-color: #8fb7e8; color: #e8f1ff; background: #101a26; }
.perch-editor-element__index {
  flex: none;
  min-width: 1.5em;
  font-variant-numeric: tabular-nums;
  color: #4c586b;
}
.perch-editor-element__kind { flex: none; color: #7f8da3; }
.perch-editor-element__summary { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.perch-editor-empty { margin: 0; color: #7f8da3; }
`;
