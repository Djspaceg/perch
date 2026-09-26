/**
 * The inspector: every field a layout already has, and nothing it does not, in the shape of a
 * property editor — folding sections, a fixed label column, fields that scrub.
 *
 * ## Nothing here is written per property
 *
 * The rect, the binding and the target are descriptors (`descriptors.ts`); the tokens are `ui-kit`'s
 * labels. Both are stamped through the primitives in `controls/` by `property-view.tsx` and
 * `token-pane.tsx`. What this file decides is the arrangement: two groups, the selection header, and
 * which sections start open.
 *
 * ## Controls write straight through `layout-edits.ts`
 *
 * Nothing holds a copy of a field's value. Each control renders from `state.draft` and on change calls
 * `onEdit` with the pure update for that field, so the draft is the only place a value lives and the
 * validation in `editDraft` runs on every keystroke — and on every step of a scrub.
 *
 * ## Numeric fields are `type="text"`
 *
 * Deliberate. `type="number"` hands back `''` for anything it considers malformed, so a typo silently
 * becomes an empty field. A text input yields exactly what was typed; `numberFromInput` maps it to a
 * `number` (including `NaN`), and `validateLayout` says what is wrong with it, naming the field. The
 * scrubbing and the arrow keys are additions on top of that text box, never a replacement for it.
 *
 * ## Free text, with a way to choose
 *
 * Topics and widget names stay text inputs: a closed `<select>` cannot show a value the document
 * holds that no list does — an unregistered widget, a topic no source is publishing — and a control
 * that cannot show the current value hides the problem the validator is reporting. Widget names are
 * suggested by a `<datalist>`. A topic has the sensor picker beside it (`sensor-picker.tsx`),
 * the same one the Add menu uses, so there is one way to choose data. `fit` and `gap` are
 * segmented controls, because their vocabularies are closed in the format and have two members each.
 *
 * ## Adding and deleting
 *
 * "+ Add" sits in the Selected-entity bar and offers the kinds that need nothing but a sensor or
 * nothing at all (`new-element.ts`); the new element is selected at once. Delete is in the selection
 * header, the red trash can the token panes also use for a removal nothing replaces, and it asks
 * once, inline, because there is no undo. The Delete and Backspace keys ask through the same confirm
 * when the canvas has focus (`app.tsx`), never while typing in a field. There is no deselect button:
 * a click on empty canvas deselects, and so does Escape (`app.tsx`).
 *
 * ## Nothing appears or vanishes
 *
 * The selected entity's controls, the "nothing selected" line, each row of the Elements list and
 * every section body are `Collapse` regions, so selecting, deselecting, adding and deleting slide the
 * sidebar rather than jump it. A deleted element's controls and its row stay on screen, inert, for
 * the length of the collapse; focus inside them moves to the Selected-entity group first.
 *
 * ## Two groups, stacked: the layout, and the one entity being pointed at
 *
 * **Global** is everything layout-wide — the target and the theme. **Selected entity** is only what
 * belongs to the element that was clicked. Both are always on screen, as labelled regions, rather than
 * two tabs of a rail: an entity's rows say which values it inherits from the theme, and an author
 * moving between the two should not have to switch a mode to see the value being inherited. Folding
 * does the work a rail would: each group is a stack of sections, and a folded section is one bar.
 *
 * Nothing is selected until something is chosen. `NOTHING_SELECTED` is a real state rather than
 * "element 0 by default": element 0 is usually the full-bleed background image, the least likely
 * thing an author came to edit.
 *
 * ## No range control to add one
 *
 * The y-scale is shown only when the element already has one. The format requires a range exactly
 * when the widget's registry entry `drawsScale`, so "add a range" is only meaningful against a
 * particular widget: a chart made by the Add menu arrives with one (`new-element.ts`), and
 * retargeting an existing element to a widget that draws a scale is still out of this slice.
 */

import type { LayoutElement } from '@perch/layout-schema';
import { assertNever } from '@perch/ui-kit';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Collapse, ResetButton, Section, usePresence } from './controls/index.js';
import {
  WIDGET_LIST_ID,
  entitySections,
  targetProperties,
  type PropertySection,
} from './descriptors.js';
import type { DraftState } from './draft.js';
import {
  removeElementStyleToken,
  removeThemeToken,
  setElementStyleToken,
  setThemeToken,
  type LayoutUpdate,
} from './layout-edits.js';
import { PropertyView } from './property-view.js';
import { AddMenu, SensorCatalogueProvider } from './sensor-picker.js';
import { TokenPane } from './token-pane.js';

/** The selection when there is none. Any out-of-range index means the same. */
export const NOTHING_SELECTED = -1;

export interface InspectorProps {
  readonly state: DraftState;
  /** Which element is selected. Out of range means "none selected". */
  readonly selected: number;
  readonly onSelect: (index: number) => void;
  /** Apply an edit. Goes through `editDraft`, so it is validated before it is anywhere else. */
  readonly onEdit: (update: LayoutUpdate) => void;
  /** Add a new element; the caller appends it and selects it. */
  readonly onAdd: (element: LayoutElement) => void;
  /** Delete the element at an index, once the author has confirmed it. */
  readonly onDelete: (index: number) => void;
  /** Whether the selection header's delete is asking, for the Delete key on the canvas to open. */
  readonly deleteAsked: boolean;
  readonly onDeleteAsked: (asked: boolean) => void;
  /** Topics known to exist before any is heard: the mock source's own. Merged with what arrives. */
  readonly topics: readonly string[];
  /** Registered widget names, for suggestions. `WIDGET_NAMES` from `ui-kit`. */
  readonly widgets: readonly string[];
}

/** The whole inspector. */
export function Inspector({
  state,
  selected,
  onSelect,
  onEdit,
  onAdd,
  onDelete,
  deleteAsked,
  onDeleteAsked,
  topics,
  widgets,
}: InspectorProps): ReactNode {
  const element = state.draft.elements[selected];
  const entityGroup = useRef<HTMLElement>(null);
  const { target } = state.draft;

  // A new selection brings its group into view. Only when something is selected: clearing the
  // selection must not yank the pane away from where the author is working. Feature-tested because
  // jsdom does not implement it.
  useEffect(() => {
    const group = entityGroup.current;
    if (selected === NOTHING_SELECTED || group === null || !('scrollIntoView' in group)) return;
    group.scrollIntoView({ block: 'start' });
  }, [selected]);

  return (
    <SensorCatalogueProvider declared={topics}>
      <div className="perch-editor-inspector" data-testid="perch-editor-inspector">
        {/* One suggestion list serves every widget control on the page. */}
        <datalist id={WIDGET_LIST_ID}>
          {widgets.map((widget) => (
            <option key={widget} value={widget} />
          ))}
        </datalist>

        <Group id="global" title="Global" hint="the whole layout">
          <TokenPane
            id="theme"
            title="theme"
            scope="layout"
            tokens={state.draft.theme}
            chips
            sectionsOpen={false}
            disclosureKey="theme"
            onSet={(name, value) => {
              onEdit(setThemeToken(name, value));
            }}
            onRemove={(name) => {
              onEdit(removeThemeToken(name));
            }}
            leading={
              <Section
                id="global/target"
                title="Target"
                summary={`${target.width} × ${target.height} · ${target.frameRate} fps`}
              >
                {targetProperties().map((property) => (
                  <PropertyView
                    key={property.id}
                    property={property}
                    subject={target}
                    index={NOTHING_SELECTED}
                    onEdit={onEdit}
                  />
                ))}
              </Section>
            }
          />
        </Group>

        <Group
          id="entity"
          title="Selected entity"
          groupRef={entityGroup}
          action={<AddMenu target={target} onAdd={onAdd} />}
        >
          <Collapse open={element !== undefined} focusOnClose={entityGroup}>
            {element === undefined ? null : (
              <>
                <SelectionHeader
                  element={element}
                  index={selected}
                  deleteAsked={deleteAsked}
                  onDeleteAsked={onDeleteAsked}
                  onDelete={() => {
                    onDelete(selected);
                  }}
                />
                <EntityPanes
                  element={element}
                  index={selected}
                  theme={state.draft.theme}
                  onEdit={onEdit}
                />
              </>
            )}
          </Collapse>
          <Collapse open={element === undefined}>
            <p className="perch-editor-empty">
              nothing selected. click an entity on the canvas, or pick one from Elements below.
            </p>
          </Collapse>
          <Section
            id="entity/elements"
            title="Elements"
            summary={`${state.draft.elements.length} · painted top to bottom`}
          >
            {/* A different layout is a different list: it arrives whole, not row by row. */}
            <ElementList key={state.name} state={state} selected={selected} onSelect={onSelect} />
          </Section>
        </Group>
      </div>
    </SensorCatalogueProvider>
  );
}

/**
 * One of the two top-level groups: a labelled region with a heading. `aria-labelledby` on a
 * `<section>` makes it a `region` landmark, so the groups are reachable by name.
 */
function Group({
  id,
  title,
  hint,
  groupRef,
  action,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly hint?: string;
  readonly groupRef?: RefObject<HTMLElement | null>;
  /** A control at the bar's right edge: the Add menu. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const headingId = `perch-editor-group-${id}`;

  return (
    <section
      className="perch-editor-group"
      aria-labelledby={headingId}
      data-testid={`perch-editor-group-${id}`}
      ref={groupRef}
      // Focusable from script only: where focus goes when what it was on collapses away.
      tabIndex={groupRef === undefined ? undefined : -1}
    >
      <div className="perch-editor-group__bar">
        <h2 className="perch-editor-group__title" id={headingId}>
          {title}
        </h2>
        {hint === undefined ? null : <span className="perch-editor-group__hint">{hint}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}

/** A glyph per kind, for the selection header and the element list. Decoration: the kind is text too. */
const KIND_GLYPH: Readonly<Record<LayoutElement['kind'], string>> = Object.freeze({
  widget: '◧',
  chart: '∿',
  text: 'T',
  media: '▣',
});

/**
 * The selection, named: what it is, which element, what it reads — and the one control on it, delete,
 * which asks first. Deselecting is a click on empty canvas or Escape, so it needs no button here.
 */
function SelectionHeader({
  element,
  index,
  onDelete,
  deleteAsked,
  onDeleteAsked,
}: {
  readonly element: LayoutElement;
  readonly index: number;
  readonly onDelete: () => void;
  readonly deleteAsked: boolean;
  readonly onDeleteAsked: (asked: boolean) => void;
}): ReactNode {
  const { name, detail } = identify(element);

  return (
    <div
      className="perch-selection"
      data-testid="perch-editor-selection"
      data-perch-kind={element.kind}
    >
      <span className="perch-selection__icon" aria-hidden="true">
        {KIND_GLYPH[element.kind]}
      </span>
      <span className="perch-selection__text">
        <span className="perch-selection__name" title={name}>
          {name}
        </span>
        <span className="perch-selection__meta">
          <span className="perch-selection__kind">{element.kind}</span>
          <span>{`elements[${index}]`}</span>
          {detail === undefined ? null : (
            <span className="perch-selection__detail" title={detail}>
              {detail}
            </span>
          )}
        </span>
      </span>
      <ResetButton
        action="delete"
        subject={`elements[${index}]`}
        consequence={`the ${element.kind} and everything set on it go, and there is no undo.`}
        ask="delete? there is no undo."
        confirming={deleteAsked}
        onConfirming={onDeleteAsked}
        onReset={onDelete}
      />
    </div>
  );
}

/** A selection's name and the one fact under it. */
function identify(element: LayoutElement): { readonly name: string; readonly detail?: string } {
  switch (element.kind) {
    case 'widget':
    case 'chart':
      return { name: element.widget, detail: element.topic };
    case 'text':
      return { name: element.text === '' ? '(empty text)' : element.text };
    case 'media':
      return { name: element.src };
    default:
      return assertNever(element, 'layout element');
  }
}

/** A section's one-line summary, for when it is folded. */
function summarise(section: PropertySection<LayoutElement>, element: LayoutElement): string {
  if (section.id === 'transform') {
    const { x, y, w, h } = element.rect;
    return `${x}, ${y} · ${w} × ${h}`;
  }
  const { name, detail } = identify(element);

  return detail ?? name;
}

/**
 * One element's sections: Transform and Content from descriptors, then its style tokens in the
 * sections `ui-kit` groups them into. A media element carries no `style` in the format, so it gets
 * Transform and Content and a sentence saying why there is nothing else.
 *
 * The token pane is keyed by index so switching selection resets its tab and search rather than
 * carrying one element's into another's. Folded sections are remembered by name, not by index, so
 * they stay folded across the switch.
 */
function EntityPanes({
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
  const sections = entitySections(element).map((section) => (
    <Section
      key={section.id}
      id={`entity/${section.id}`}
      title={section.title}
      summary={summarise(section, element)}
    >
      {section.properties.map((property) => (
        <PropertyView
          key={property.id}
          property={property}
          subject={element}
          index={index}
          onEdit={onEdit}
        />
      ))}
    </Section>
  ));

  if (element.kind === 'media') {
    return (
      <>
        {sections}
        <p className="perch-editor-empty">
          a media element carries no style in the layout format, so it has no background, corner,
          padding or placement controls.
        </p>
      </>
    );
  }

  return (
    <TokenPane
      key={index}
      id={`style-${index}`}
      title="style"
      scope="element"
      kind={element.kind}
      tokens={element.style ?? {}}
      inherited={theme}
      sectionsOpen={['appearance', 'placement']}
      disclosureKey="style"
      leading={sections}
      onSet={(name, value) => {
        onEdit(setElementStyleToken(index, name, value));
      }}
      onRemove={(name) => {
        onEdit(removeElementStyleToken(index, name));
      }}
    />
  );
}

/**
 * Every element, in paint order. The index is shown because it is what every issue path names —
 * `elements[3].rect.w` — so the list and the problem panel agree on how to refer to an element.
 *
 * Rows are keyed by the element rather than its index (`usePresence`), so a delete collapses the row
 * that went, with the rows under it sliding up, and an add grows the new row in at the bottom.
 */
function ElementList({
  state,
  selected,
  onSelect,
}: Pick<InspectorProps, 'state' | 'selected' | 'onSelect'>): ReactNode {
  const { rows, exited } = usePresence(state.draft.elements);

  return (
    <ul className="perch-editor-elements" data-testid="perch-editor-elements">
      {rows.map(({ key, item: element, index, present, arrived }) => (
        <Collapse
          key={key}
          as="li"
          open={present}
          appear={arrived}
          onExited={() => {
            exited(key);
          }}
        >
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
            <span className="perch-editor-element__glyph" aria-hidden="true">
              {KIND_GLYPH[element.kind]}
            </span>
            <span className="perch-editor-element__kind">{element.kind}</span>
            <span className="perch-editor-element__summary" title={describeElement(element)}>
              {describeElement(element)}
            </span>
          </button>
        </Collapse>
      ))}
    </ul>
  );
}

/** A one-line description of an element, for the list. */
export function describeElement(element: LayoutElement): string {
  switch (element.kind) {
    case 'text':
      // An empty string is a validation error, so it is named rather than rendered as a blank row.
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

export const INSPECTOR_STYLES = `
.perch-editor-inspector {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  /*
   * Scroll, not auto: the gutter is allocated whether or not the content overflows, so folding a
   * section never moves every row sideways by a scrollbar's width. scrollbar-gutter says the same
   * thing the modern way, for an engine with overlay scrollbars. Never sideways: nothing inside is
   * wider than the column (see controls/section.tsx and controls/property-row.tsx).
   */
  overflow-y: scroll;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  background: var(--ed-bg);
  font-size: var(--ed-font);
  color: var(--ed-text);
}
.perch-editor-group { display: flex; flex-direction: column; min-width: 0; scroll-margin-top: 0; }
.perch-editor-group:focus { outline: none; }
.perch-editor-group + .perch-editor-group { border-top: 1px solid #262c36; }
.perch-editor-group__bar {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px var(--ed-pad-x) 5px;
  background: var(--ed-bg-recessed);
}
.perch-editor-group__title {
  margin: 0;
  font-size: var(--ed-font-small);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ed-text-2);
}
.perch-editor-group__hint { font-size: var(--ed-font-small); color: var(--ed-faint); }
.perch-selection {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 4px var(--ed-pad-x) 6px;
  background: var(--ed-bg-recessed);
}
.perch-selection__icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: var(--ed-accent-fill);
  color: var(--ed-text);
  font-size: 0.875rem;
}
.perch-selection__text { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }
.perch-selection__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--ed-text);
}
.perch-selection__meta {
  display: flex;
  gap: 6px;
  min-width: 0;
  font-family: var(--ed-mono);
  font-size: var(--ed-font-small);
  color: var(--ed-quiet);
  white-space: nowrap;
}
.perch-selection__kind { color: var(--ed-accent); }
.perch-selection__detail { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.perch-editor-elements { display: flex; flex-direction: column; margin: 0; padding: 0 4px; list-style: none; }
.perch-editor-element {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 20px;
  border: 0;
  border-radius: 2px;
  background: none;
  color: var(--ed-label);
  font: inherit;
  font-size: var(--ed-font-small);
  text-align: left;
  padding: 0 6px;
  cursor: pointer;
}
.perch-editor-element:hover { background: var(--ed-hover); color: var(--ed-text); }
.perch-editor-element[data-perch-selected='true'] { background: var(--ed-accent-fill); color: var(--ed-text); }
.perch-editor-element:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: -2px; }
.perch-editor-element__index { flex: 0 0 1.4em; text-align: right; font-variant-numeric: tabular-nums; color: var(--ed-faint); }
.perch-editor-element__glyph { flex: 0 0 1em; color: var(--ed-quiet); text-align: center; }
.perch-editor-element__kind { flex: 0 0 3.6em; color: var(--ed-quiet); }
.perch-editor-element__summary { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.perch-editor-empty { margin: 0; padding: 6px var(--ed-pad-x); font-size: var(--ed-font-small); color: var(--ed-quiet); }
`;
