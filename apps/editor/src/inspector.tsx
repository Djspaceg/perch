/**
 * The inspector: every field a layout already has, and nothing it does not, in the shape of a
 * property editor — folding sections, a fixed label column, fields that scrub.
 *
 * ## Nothing here is written per property
 *
 * The rect, the binding and the target are descriptors (`descriptors.ts`); the tokens are `ui-kit`'s
 * labels. Both are stamped through the primitives in `controls/` by `property-view.tsx` and
 * `token-pane.tsx`. What this file decides is the arrangement: three groups, the Elements list and its
 * bar, the selection header, and which sections start open.
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
 * Both are in the Elements list, so the list is where elements are made, ordered and removed.
 * "+ Add" in its bar offers every kind, media as an Image beside the layout or a cloud Video
 * (`new-element.ts`); the new element goes on top and is selected at once. The selected row ends in
 * Duplicate and then Delete, the red trash can the token panes also use for a removal nothing
 * replaces; it asks once, inline, even though undo brings it back. The Delete and Backspace keys ask
 * through the same confirm when the canvas has focus (`app.tsx`), never while typing in a field. The
 * background's row has no delete: it is never removed as an element is, and its source is cleared in
 * its own Content section (an empty `src`). There is no deselect button: a click on empty canvas
 * deselects, and so does Escape (`app.tsx`).
 *
 * ## Nothing appears or vanishes
 *
 * The selected entity's controls, the "nothing selected" line, each row of the Elements list and
 * every section body are `Collapse` regions, so selecting, deselecting, adding and deleting slide the
 * sidebar rather than jump it. A deleted element's controls and its row stay on screen, inert, for
 * the length of the collapse; focus inside them moves to the Selected-entity group first.
 *
 * A change of selection is not a new set of controls. Element or background, the selection is one
 * region with one header and one stack of sections, each kept by name (`EntityPanes`): what the two
 * selections share stays mounted where it was, folded or open, with only its values changed, and only
 * what does not carry over collapses away or grows in.
 *
 * ## Three groups, stacked: the layout, its layers, and the one entity being pointed at
 *
 * **Global** is everything layout-wide — the target, the clock and the theme — each of its panels
 * titled "Global ..." so it is never mistaken for the entity's own. **Elements** is the list of
 * layers, which is how an entity is chosen, with Add in its bar. **Selected entity** then holds only
 * what belongs to the one that was. All three are always on screen, as labelled regions, rather than
 * tabs of a rail: an entity's rows say which values it inherits from the theme, and an author
 * moving between the two should not have to switch a mode to see the value being inherited. Folding
 * does the work a rail would: each group is a stack of sections, and a folded section is one bar.
 *
 * Nothing is selected until something is chosen. `NOTHING_SELECTED` is a real state rather than
 * "element 0 by default": element 0 is often a full-bleed backdrop, the least likely thing an author
 * came to edit. The layout's own background is chosen from the bottom row of the layers list
 * (`BACKGROUND_SELECTED`), and Selected entity then shows its source, fit and opacity.
 *
 * ## No range control to add one
 *
 * The y-scale is shown only when the element already has one. The format requires a range exactly
 * when the widget's registry entry `drawsScale`, so "add a range" is only meaningful against a
 * particular widget: a chart made by the Add menu arrives with one (`new-element.ts`), and
 * retargeting an existing element to a widget that draws a scale is still out of this slice.
 */

import type { LayoutBackground, LayoutElement } from '@perch/layout-schema';
import { assertNever, type TokenGroup } from '@perch/ui-kit';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Collapse,
  CollapseEach,
  NumberField,
  PropertyRow,
  ResetButton,
  Section,
  usePresence,
} from './controls/index.js';
import {
  WIDGET_LIST_ID,
  backgroundProperties,
  clockProperties,
  entitySections,
  targetProperties,
  type Property,
  type PropertySection,
} from './descriptors.js';
import type { DraftState } from './draft.js';
import {
  numberFromInput,
  removeElementStyleToken,
  removeThemeToken,
  setBackgroundHidden,
  setBackgroundOpacity,
  setElementHidden,
  setElementOpacity,
  setElementStyleToken,
  setThemeToken,
  type LayoutUpdate,
} from './layout-edits.js';
import { allRows, dropTarget, layerTarget } from './layers.js';
import {
  ELEMENTS_PANEL_STYLES,
  ElementsOpacity,
  ElementsOptions,
  KindFilter,
  KindGlyph,
  RowThumb,
  filterKind,
  opacityPercent,
  passesFilter,
  type FilterKind,
} from './elements-panel.js';
import { PropertyView } from './property-view.js';
import { LAYER_INDEX_ATTRIBUTE, useRowDrag, type RowDrag } from './row-drag.js';
import { AddMenu, SensorCatalogueProvider } from './sensor-picker.js';
import { BACKGROUND_SELECTED, NOTHING_SELECTED } from './store.js';
import { TokenPane, contentPlacement } from './token-pane.js';
import { TRANSFORM_STYLES, TransformBlock } from './transform-block.js';

/** The selection when there is none, and when it is the background, kept in the editor store. */
export { BACKGROUND_SELECTED, NOTHING_SELECTED };

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
  /** Move the element at `from` to index `to` in paint order, and select it there: one edit. */
  readonly onMove: (from: number, to: number) => void;
  /** Duplicate the selected layer, and select the copy: one edit (`selection.duplicate`). */
  readonly onDuplicate: () => void;
  /** Whether the Elements list's delete is asking, for the Delete key on the canvas to open. */
  readonly deleteAsked: boolean;
  readonly onDeleteAsked: (asked: boolean) => void;
  /** Topics known to exist before any is heard: the mock source's own. Merged with what arrives. */
  readonly topics: readonly string[];
  /** Registered widget names, for suggestions. `WIDGET_NAMES` from `ui-kit`. */
  readonly widgets: readonly string[];
  /** A media `src` as the URL the canvas paints it from, for the Elements list's thumbnails. */
  readonly resolveAsset?: ((src: string) => string | undefined) | undefined;
}

/** The whole inspector. */
export function Inspector({
  state,
  selected,
  onSelect,
  onEdit,
  onAdd,
  onDelete,
  onMove,
  onDuplicate,
  deleteAsked,
  onDeleteAsked,
  topics,
  widgets,
  resolveAsset,
}: InspectorProps): ReactNode {
  const element = state.draft.elements[selected];
  const subject: Subject | null =
    element !== undefined
      ? { kind: 'element', element, index: selected }
      : selected === BACKGROUND_SELECTED
        ? { kind: 'background', background: state.draft.background }
        : null;
  const entityGroup = useRef<HTMLElement>(null);
  const elementsGroup = useRef<HTMLElement>(null);
  const inspector = useRef<HTMLDivElement>(null);
  const { target } = state.draft;
  // The Elements list's kind filter: this sitting's view of the list, never the document's.
  const [kinds, setKinds] = useState<ReadonlySet<FilterKind>>(NO_KINDS);
  const filtered = kinds.size > 0;
  const listedCount = state.draft.elements.filter((item) => passesFilter(item, kinds)).length;
  const subjectOpacity =
    subject?.kind === 'element'
      ? subject.element.opacity
      : subject?.kind === 'background'
        ? subject.background?.opacity
        : undefined;
  const opacityTarget =
    subject?.kind === 'element' ||
    (subject?.kind === 'background' && subject.background !== undefined);

  // A new selection brings its group into view. Only when something is selected: clearing the
  // selection must not yank the pane away from where the author is working. And not when it was made
  // in the sidebar itself — a row of the Elements list just above the group, or Add — where the
  // author is already looking, and a scroll would move the row out from under the pointer.
  // Feature-tested because jsdom does not implement it.
  useEffect(() => {
    const group = entityGroup.current;
    if (selected === NOTHING_SELECTED || group === null || !('scrollIntoView' in group)) return;
    if (inspector.current?.contains(document.activeElement) === true) return;
    group.scrollIntoView({ block: 'start' });
  }, [selected]);

  return (
    <SensorCatalogueProvider declared={topics}>
      <div className="perch-editor-inspector" data-testid="perch-editor-inspector" ref={inspector}>
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
            titlePrefix="Global "
            sectionsOpen={false}
            disclosureKey="theme"
            panels="global"
            onSet={(name, value) => {
              onEdit(setThemeToken(name, value));
            }}
            onRemove={(name) => {
              onEdit(removeThemeToken(name));
            }}
            leading={[
              {
                key: 'target',
                node: (
                  <Section
                    id="global/target"
                    panel="target"
                    title="Global Target"
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
                ),
              },
              {
                key: 'clock',
                // What every {time}-style token in the layout's text is written in.
                node: (
                  <Section
                    id="global/clock"
                    panel="clock"
                    title="Global Clock"
                    summary={`${state.draft.locale ?? 'system locale'} · ${state.draft.timeZone ?? 'system zone'}`}
                  >
                    {clockProperties().map((property) => (
                      <PropertyView
                        key={property.id}
                        property={property}
                        subject={state.draft}
                        index={NOTHING_SELECTED}
                        onEdit={onEdit}
                      />
                    ))}
                  </Section>
                ),
              },
            ]}
          />
        </Group>

        <Group
          id="elements"
          title={filtered ? 'Elements (filtered)' : 'Elements'}
          groupRef={elementsGroup}
          hint={
            filtered
              ? `${listedCount} of ${state.draft.elements.length} · topmost first`
              : `${state.draft.elements.length} · topmost first`
          }
          action={
            <div className="perch-editor-group__actions">
              <AddMenu target={target} onAdd={onAdd} />
              <ElementsOptions
                filtered={filtered}
                onClearFilter={() => {
                  setKinds(NO_KINDS);
                }}
              />
            </div>
          }
        >
          <div className="perch-elements-top">
            <KindFilter kinds={kinds} onKinds={setKinds} />
            <ElementsOpacity
              opacity={subjectOpacity}
              selected={opacityTarget}
              onText={(text) => {
                // The same edit as the Appearance row's: 100% removes the field.
                const opacity = numberFromInput(text) / 100;
                onEdit(
                  subject?.kind === 'element'
                    ? setElementOpacity(subject.index, opacity)
                    : setBackgroundOpacity(opacity),
                );
              }}
            />
          </div>
          {/* A different layout is a different list: it arrives whole, not row by row. */}
          <ElementList
            key={state.name}
            state={state}
            selected={selected}
            onSelect={onSelect}
            onMove={onMove}
            onEdit={onEdit}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            deleteAsked={deleteAsked}
            onDeleteAsked={onDeleteAsked}
            focusOnClose={elementsGroup}
            kinds={kinds}
            resolveAsset={resolveAsset}
          />
        </Group>

        <Group id="entity" title="Selected entity" groupRef={entityGroup}>
          {/*
           * One region for whatever is selected, element or background, so a change of selection
           * updates it in place rather than swapping one region for another.
           */}
          <Collapse open={subject !== null} focusOnClose={entityGroup}>
            {subject === null ? null : (
              <EntityPanes subject={subject} theme={state.draft.theme} onEdit={onEdit} />
            )}
          </Collapse>
          <Collapse open={subject === null}>
            <p className="perch-editor-empty">
              nothing selected. click an entity on the canvas, or pick one from Elements above.
            </p>
          </Collapse>
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

/** What the entity half of the sidebar is showing: an element, or the layout's background. */
type Subject =
  | { readonly kind: 'element'; readonly element: LayoutElement; readonly index: number }
  | { readonly kind: 'background'; readonly background: LayoutBackground | undefined };

/**
 * The selection, named: what it is, which element, what it reads; or the background, locked and
 * always lowest. One header for both, so a change of selection changes its words, not the header.
 * It holds no control: deleting is in the Elements list's bar, and deselecting is a click on empty
 * canvas or Escape.
 */
function EntityHeader({ subject }: { readonly subject: Subject }): ReactNode {
  const background = subject.kind === 'background' ? subject.background : undefined;
  const { name, detail } =
    subject.kind === 'element'
      ? identify(subject.element)
      : { name: background?.src ?? NO_BACKGROUND, detail: undefined };

  return (
    <div
      className="perch-selection"
      data-testid="perch-editor-selection"
      data-perch-kind={subject.kind === 'element' ? subject.element.kind : 'background'}
    >
      <span className="perch-selection__icon" aria-hidden="true">
        {subject.kind === 'element' ? (
          <KindGlyph kind={filterKind(subject.element)} />
        ) : (
          <LockGlyph />
        )}
      </span>
      <span className="perch-selection__text">
        <span className="perch-selection__name" data-perch-tip={name}>
          {name}
        </span>
        <span className="perch-selection__meta">
          {subject.kind === 'element' ? (
            <>
              <span className="perch-selection__kind">{subject.element.kind}</span>
              <span>{`elements[${subject.index}]`}</span>
            </>
          ) : (
            <>
              <span className="perch-selection__kind">background</span>
              <span>locked · always lowest</span>
              {background?.hidden === true ? <span>hidden</span> : null}
            </>
          )}
          {detail === undefined ? null : (
            <span className="perch-selection__detail" data-perch-tip={detail}>
              {detail}
            </span>
          )}
        </span>
      </span>
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
 * A section's rows, each kept by its label: the rows two selections share (a media element's and the
 * background's source rows, a widget's and a chart's sensor) stay mounted, and the rest grow in or
 * collapse away. Labels, not ids, because the background's rows are their own descriptors with the
 * same names.
 */
function propertyRows<Subject>(
  properties: readonly Property<Subject>[],
  subject: Subject,
  index: number,
  onEdit: (update: LayoutUpdate) => void,
): ReactNode {
  return (
    <CollapseEach
      entries={properties.map((property) => ({
        key: property.label,
        node: <PropertyView property={property} subject={subject} index={index} onEdit={onEdit} />,
      }))}
    />
  );
}

/** What the opacity row says it does. */
const OPACITY_DESCRIPTION =
  'How strongly this entity paints, everything in it together: 0% is invisible, 100% solid.';

/**
 * The element's own opacity, in percent, first in its Appearance.
 *
 * Not a token, so not stamped by the token pane: `opacity` is a field of every element kind in the
 * format, media included. The same row, the same scrubbing label and the same bar-in-the-field as a
 * token's number, and a reset where the element sets one. Typing 100 removes the field, as the reset
 * does, since an absent opacity is solid.
 */
function OpacityRow({
  opacity,
  onOpacity,
}: {
  /** The entity's own opacity, `undefined` where it sets none. */
  readonly opacity: number | undefined;
  /** Write one, or remove it with `undefined`. */
  readonly onOpacity: (opacity: number | undefined) => void;
}): ReactNode {
  const own = opacity !== undefined;
  const value = opacityPercent(opacity);
  const onValue = (text: string): void => {
    onOpacity(numberFromInput(text) / 100);
  };

  return (
    <PropertyRow
      label="Opacity"
      description={OPACITY_DESCRIPTION}
      source={own ? 'own' : 'default'}
      sourceText={own ? 'set by this entity' : 'default'}
      scrub={{ value, onChange: onValue, step: 1, min: 0, max: 100 }}
      testId="perch-editor-prop-opacity"
      attributes={{ 'data-perch-overridden': own ? 'true' : 'false' }}
      end={
        own ? (
          <ResetButton
            action="reset"
            subject="Opacity"
            returnsTo={{ source: 'default', value: '100%' }}
            onReset={() => {
              onOpacity(undefined);
            }}
          />
        ) : null
      }
    >
      {(ids) => (
        <NumberField
          id={ids.controlId}
          label="Opacity"
          labelHidden
          value={value}
          onChange={onValue}
          min={0}
          max={100}
          step={1}
          unit="%"
          bar
          describedBy={ids.describedBy}
        />
      )}
    </PropertyRow>
  );
}

/**
 * Whatever is selected, as one stack of sections with stable names: Content, then Transform, then the
 * style token sections `ui-kit` groups them into, with the entity's opacity first in Appearance.
 *
 * Every entity goes through the same token pane, so a section two selections share — Transform for
 * two elements, Content and Appearance for a media element and the background — is the same mounted
 * section, folded or open as it was, with only its values changed; the token pane is not keyed by
 * the selection. A section that does not apply to the new selection collapses away where it was, and
 * one that newly applies grows in (`CollapseEach`): a media element has no style in the format, so
 * its Placement, Typography and Colour go, and the tabs and the search fold away; the background has
 * no rect, so its Transform goes. The rows inside Content are kept by name in the same way.
 *
 * Nothing in a kept section holds a value of its own that could go stale: every field renders from
 * the draft, and the box diagram's half-typed text is tied to the value it was typed against. The
 * search is the one piece of local state, and the pane clears it on a change of selection.
 */
function EntityPanes({
  subject,
  theme,
  onEdit,
}: {
  readonly subject: Subject;
  readonly theme: Readonly<Record<string, string>> | undefined;
  readonly onEdit: (update: LayoutUpdate) => void;
}): ReactNode {
  const element = subject.kind === 'element' ? subject.element : undefined;
  const background = subject.kind === 'background' ? subject.background : undefined;
  const index = subject.kind === 'element' ? subject.index : NOTHING_SELECTED;
  const styled = element !== undefined && element.kind !== 'media';

  const sections =
    element === undefined
      ? [
          {
            key: 'content',
            node: (
              <Section
                id="entity/content"
                panel="content"
                title="Content"
                summary={background?.src ?? NO_BACKGROUND}
              >
                {propertyRows(backgroundProperties(background), background, index, onEdit)}
              </Section>
            ),
          },
        ]
      : entitySections(element).map((section) => ({
          key: section.id,
          node: (
            <Section
              id={`entity/${section.id}`}
              panel={section.id}
              title={section.title}
              summary={summarise(section, element)}
            >
              {section.id === 'transform' ? (
                <TransformBlock
                  element={element}
                  index={index}
                  properties={section.properties}
                  inherited={theme}
                  onEdit={onEdit}
                  onSet={(name, value) => {
                    onEdit(setElementStyleToken(index, name, value));
                  }}
                  onRemove={(name) => {
                    onEdit(removeElementStyleToken(index, name));
                  }}
                />
              ) : (
                propertyRows(section.properties, element, index, onEdit)
              )}
            </Section>
          ),
        }));
  // The content placement grid is drawn in Transform, so its token section is left out; unless the
  // grid cannot show the value held, when the section's own rows are where it can be read.
  const placed =
    element !== undefined &&
    contentPlacement(element.kind, styled ? (element.style ?? {}) : NO_TOKENS, theme) !== undefined;

  const opacity = element?.opacity ?? background?.opacity;
  // The background's opacity is only there to set once it has a source.
  const lead =
    element === undefined && background === undefined
      ? []
      : [
          {
            group: 'appearance' as const,
            label: 'Opacity',
            description: OPACITY_DESCRIPTION,
            set: opacity !== undefined,
            row: (
              <OpacityRow
                opacity={opacity}
                onOpacity={(value) => {
                  onEdit(
                    element === undefined
                      ? setBackgroundOpacity(value)
                      : setElementOpacity(index, value),
                  );
                }}
              />
            ),
          },
        ];

  return (
    <>
      <EntityHeader subject={subject} />
      <TokenPane
        id={element === undefined ? 'style-background' : `style-${index}`}
        title="style"
        scope="element"
        kind={element?.kind}
        styled={styled}
        searchFor={element === undefined ? 'background' : String(index)}
        tokens={styled ? (element.style ?? {}) : NO_TOKENS}
        inherited={theme}
        sectionsOpen={['appearance', 'placement']}
        omitGroups={placed ? PLACED_GROUPS : NO_GROUPS}
        disclosureKey="style"
        panels="entity"
        leading={sections}
        lead={lead}
        onSet={(name, value) => {
          if (styled) onEdit(setElementStyleToken(index, name, value));
        }}
        onRemove={(name) => {
          if (styled) onEdit(removeElementStyleToken(index, name));
        }}
      />
      <Collapse open={element?.kind === 'media'}>
        <p className="perch-editor-empty">
          a media element carries no style in the layout format, so it has no background, corner,
          padding or placement controls.
        </p>
      </Collapse>
      <Collapse open={subject.kind === 'background'}>
        <p className="perch-editor-empty">
          the background is always the lowest layer and covers the whole canvas. with no source, or
          hidden, the theme&apos;s canvas colour shows.
        </p>
      </Collapse>
    </>
  );
}

/** The token sections an element's Transform draws instead, and none. */
const PLACED_GROUPS: readonly TokenGroup[] = Object.freeze(['placement']);
const NO_GROUPS: readonly TokenGroup[] = Object.freeze([]);

/** No kind filter: every element listed. */
const NO_KINDS: ReadonlySet<FilterKind> = new Set();

/** The token map of a surface that has none. */
const NO_TOKENS: Readonly<Record<string, string>> = Object.freeze({});

/** What the background row and header say there is, with no source. */
const NO_BACKGROUND = 'none';

/** Why the background row is never dragged or dropped on, as its tooltip says. */
const BACKGROUND_LOCKED = 'locked: always lowest, under every element';

/** A padlock: the background row cannot be moved. Decoration; the row says so in words too. */
function LockGlyph(): ReactNode {
  return (
    <svg
      data-perch-glyph="lock"
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="10" height="7.5" rx="1.5" />
      <path d="M5.5 7V4.75a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}

/** An eye, open for a shown layer and struck through for a hidden one. */
function EyeGlyph({ hidden }: { readonly hidden: boolean }): ReactNode {
  return (
    <svg
      data-perch-glyph={hidden ? 'eye-closed' : 'eye'}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="2" />
      {hidden ? <path d="M2.5 13.5 13.5 2.5" /> : null}
    </svg>
  );
}

/**
 * A layer's eye: shows or hides it, everywhere, as one edit. Its own button beside the row rather than
 * inside it, so a click on it neither selects the layer nor starts a drag.
 */
function LayerEye({
  hidden,
  what,
  disabledTip,
  onToggle,
}: {
  readonly hidden: boolean;
  /** The layer, in the words of the label: `elements[3]`, `the background`. */
  readonly what: string;
  /** Set when there is nothing to show or hide: why. */
  readonly disabledTip?: string | undefined;
  readonly onToggle: () => void;
}): ReactNode {
  const label = `${hidden ? 'show' : 'hide'} ${what}`;

  return (
    <button
      type="button"
      className="perch-editor-eye"
      aria-label={label}
      data-perch-tip={disabledTip ?? label}
      data-perch-hidden={hidden ? 'true' : 'false'}
      disabled={disabledTip !== undefined}
      onClick={onToggle}
    >
      <EyeGlyph hidden={hidden} />
    </button>
  );
}

/**
 * Duplicate, at the end of the selected row: the same command as Mod+D and the desktop's Edit >
 * Duplicate, so it acts on the selection, which is why only the selected row shows it.
 */
function DuplicateButton({
  onDuplicate,
  copyIs = 'a copy directly above it',
}: {
  readonly onDuplicate: () => void;
  /** Where the copy goes, for the tooltip. */
  readonly copyIs?: string;
}): ReactNode {
  return (
    <button
      type="button"
      className="perch-editor-eye perch-editor-duplicate"
      aria-label="duplicate"
      aria-keyshortcuts="Control+D Meta+D"
      data-perch-tip={`duplicate: ${copyIs}`}
      onClick={onDuplicate}
    >
      <svg
        data-perch-glyph="duplicate"
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        aria-hidden="true"
      >
        <rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5" />
        <path d="M10.5 3.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v6.5a1 1 0 0 0 1 1h.5" />
      </svg>
    </button>
  );
}

/**
 * Where a row of the list shows the drop line of a drag, if the drag would land beside it. `row` is
 * the row's place among the rows `shown`.
 */
function dropMark(
  drag: RowDrag | null,
  row: number,
  shown: readonly number[],
): 'above' | 'below' | undefined {
  if (drag === null || row === -1 || dropTarget(drag.from, drag.gap, shown) === null) {
    return undefined;
  }
  if (drag.gap === row) return 'above';

  return drag.gap === shown.length && row === shown.length - 1 ? 'below' : undefined;
}

/**
 * Every element, as layers: the topmost — the last in `elements`, painted last — at the top of the
 * list, and the one painted first at the bottom. The index shown is still the element's place in
 * `elements`, because it is what every issue path names — `elements[3].rect.w` — so the list and the
 * problem panel agree on how to refer to an element.
 *
 * A row is dragged to reorder (`row-drag.ts`), with a line where it would land; Alt+Up and Alt+Down on
 * a focused row move it a layer. After any reorder, focus in the list stays with the element. Each is one edit through `onMove`, which also
 * selects the element where it went. The four layer commands do the same from anywhere (`app.tsx`).
 *
 * Rows are keyed by the element rather than its index (`usePresence`), so a delete collapses the row
 * that went, with the rows around it closing up, and an add grows the new row in at the top.
 *
 * Every row has an eye before it, which hides its layer everywhere (`hidden`, saved), and the last row
 * is always the layout's background: locked, never dragged or dropped below, selected as
 * `BACKGROUND_SELECTED`. It is the layout's own field rather than an element, so no reorder has to
 * remember to keep it lowest.
 */
function ElementList({
  state,
  selected,
  onSelect,
  onMove,
  onEdit,
  onDuplicate,
  onDelete,
  deleteAsked,
  onDeleteAsked,
  focusOnClose,
  kinds,
  resolveAsset,
}: {
  /** Where focus goes from a row that is leaving: a deleted element's, its confirm focused. */
  readonly focusOnClose: RefObject<HTMLElement | null>;
  /** The kind filter: the kinds shown, or every kind when empty. */
  readonly kinds: ReadonlySet<FilterKind>;
  readonly resolveAsset: ((src: string) => string | undefined) | undefined;
} & Pick<
  InspectorProps,
  | 'state'
  | 'selected'
  | 'onSelect'
  | 'onMove'
  | 'onEdit'
  | 'onDuplicate'
  | 'onDelete'
  | 'deleteAsked'
  | 'onDeleteAsked'
>): ReactNode {
  const { background } = state.draft;
  const { rows, exited } = usePresence(state.draft.elements);
  const count = state.draft.elements.length;
  const list = useRef<HTMLUListElement>(null);
  // The elements the filter leaves, top of the list first: what a drag measures and drops among.
  const visible = allRows(count).filter((index) => {
    const element = state.draft.elements[index];
    return element !== undefined && passesFilter(element, kinds);
  });
  const visibleText = visible.join(',');
  const shownRows = useMemo(
    () => (visibleText === '' ? [] : visibleText.split(',').map(Number)),
    [visibleText],
  );
  const { drag, begin, swallowClick, cancel } = useRowDrag(list, shownRows, onMove);
  // The element whose row has focus. A reorder keeps each row where it is and changes what it shows,
  // so after one — a drop, Alt+Up, a layer command — focus is moved to where that element went.
  const focused = useRef<LayoutElement | null>(null);

  useEffect(() => {
    // A drag measures the list it began on; one that changed under it (an undo mid-drag) ends it.
    cancel();
    const element = focused.current;
    const active = document.activeElement;
    const rows = list.current;
    if (element === null || rows?.contains(active) !== true) return;
    const index = state.draft.elements.indexOf(element);
    if (index === -1) return;
    const row = rows.querySelector<HTMLElement>(`[${LAYER_INDEX_ATTRIBUTE}="${index}"]`);
    if (row !== null && row !== active) row.focus();
  }, [state.draft.elements, visibleText, cancel]);

  // Top of the list first: the reverse of paint order.
  const shown = [...rows].reverse();

  return (
    <ul className="perch-editor-elements" data-testid="perch-editor-elements" ref={list}>
      {shown.map(({ key, item: element, index, present, arrived }) => {
        const listed = present && passesFilter(element, kinds);
        return (
          <Collapse
            key={key}
            as="li"
            open={listed}
            appear={arrived}
            focusOnClose={focusOnClose}
            onExited={() => {
              exited(key);
            }}
          >
            <div
              className="perch-editor-layer"
              data-perch-hidden={element.hidden === true ? 'true' : 'false'}
            >
              <LayerEye
                hidden={element.hidden === true}
                what={`elements[${index}]`}
                onToggle={() => {
                  if (present) onEdit(setElementHidden(index, element.hidden !== true));
                }}
              />
              <button
                type="button"
                className="perch-editor-element"
                aria-current={index === selected ? 'true' : undefined}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                data-perch-selected={index === selected ? 'true' : 'false'}
                {...(listed ? { [LAYER_INDEX_ATTRIBUTE]: String(index) } : {})}
                {...(drag?.from === index && listed ? { 'data-perch-dragging': 'true' } : {})}
                {...(listed ? markOf(dropMark(drag, shownRows.indexOf(index), shownRows)) : {})}
                onPointerDown={(event) => {
                  if (listed) begin(event, index);
                }}
                onFocus={() => {
                  focused.current = element;
                }}
                onBlur={() => {
                  focused.current = null;
                }}
                onClick={() => {
                  if (swallowClick()) return;
                  onSelect(index);
                }}
                onKeyDown={(event) => {
                  if (
                    !present ||
                    !event.altKey ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.shiftKey
                  ) {
                    return;
                  }
                  const move =
                    event.key === 'ArrowUp'
                      ? 'bringForward'
                      : event.key === 'ArrowDown'
                        ? 'sendBackward'
                        : null;
                  if (move === null) return;
                  event.preventDefault();
                  const to = layerTarget(move, index, count);
                  if (to !== null) onMove(index, to);
                }}
              >
                <RowThumb
                  kind={filterKind(element)}
                  src={element.kind === 'media' ? element.src : undefined}
                  resolveAsset={resolveAsset}
                />
                <span className="perch-sr-only">{element.kind}</span>
                <span
                  className="perch-editor-element__summary"
                  data-perch-tip={describeElement(element)}
                >
                  {describeElement(element)}
                </span>
                <span className="perch-editor-element__index">{index}</span>
              </button>
              {index === selected && present ? (
                <>
                  <DuplicateButton onDuplicate={onDuplicate} />
                  <ResetButton
                    action="delete"
                    label="Delete element"
                    subject={`elements[${index}]`}
                    consequence={`the ${element.kind} and everything set on it go. undo brings them back.`}
                    ask="delete?"
                    confirming={deleteAsked}
                    onConfirming={onDeleteAsked}
                    onReset={() => {
                      onDelete(index);
                    }}
                  />
                </>
              ) : null}
            </div>
          </Collapse>
        );
      })}
      {/*
       * The background, always last: below every element in paint order, so at the bottom of the
       * layers. Outside the drag's rows (it carries no layer index), so it is never dragged and never
       * measured as a gap to drop into, and nothing can be put beneath it.
       */}
      <li>
        <div
          className="perch-editor-layer perch-editor-layer--background"
          data-perch-hidden={background?.hidden === true ? 'true' : 'false'}
        >
          <LayerEye
            hidden={background?.hidden === true}
            what="the background"
            disabledTip={background === undefined ? 'no background to hide' : undefined}
            onToggle={() => {
              onEdit(setBackgroundHidden(background?.hidden !== true));
            }}
          />
          <button
            type="button"
            className="perch-editor-element"
            data-testid="perch-editor-background-row"
            aria-current={selected === BACKGROUND_SELECTED ? 'true' : undefined}
            data-perch-selected={selected === BACKGROUND_SELECTED ? 'true' : 'false'}
            data-perch-tip={BACKGROUND_LOCKED}
            onClick={() => {
              onSelect(BACKGROUND_SELECTED);
            }}
          >
            <RowThumb kind="media" src={background?.src} resolveAsset={resolveAsset} />
            <span className="perch-editor-element__name perch-editor-element__name--locked">
              Background
            </span>
            <span className="perch-editor-element__summary perch-editor-element__summary--quiet">
              {background?.src ?? NO_BACKGROUND}
            </span>
            <span className="perch-editor-element__lock" aria-label="locked">
              <LockGlyph />
            </span>
          </button>
          {selected === BACKGROUND_SELECTED && background !== undefined ? (
            <DuplicateButton onDuplicate={onDuplicate} copyIs="a media element just above it" />
          ) : null}
        </div>
      </li>
    </ul>
  );
}

/** A row's drop line as its attribute, or nothing. */
function markOf(mark: 'above' | 'below' | undefined): Readonly<Record<string, string>> {
  return mark === undefined ? {} : { 'data-perch-drop': mark };
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

export const INSPECTOR_STYLES = `${ELEMENTS_PANEL_STYLES}
${TRANSFORM_STYLES}
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
.perch-editor-group + .perch-editor-group { border-top: 1px solid var(--ed-group-divider); }
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
/* The Elements bar's Add, and the confirm a delete floats over the bar. */
.perch-editor-group__bar:has(> .perch-editor-group__actions) { position: relative; align-items: center; padding-block: 2px; }
.perch-editor-group__actions { display: flex; align-items: center; gap: 2px; margin-left: auto; margin-right: -4px; }
.perch-editor-group__actions .perch-add { margin-left: 0; }
.perch-selection {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  /* Room above, and more below before the tabs, so the header reads as a block of its own. */
  padding: var(--ed-space-sm) var(--ed-pad-x) var(--ed-space-md);
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
.perch-selection__text { flex: 1 1 auto; display: flex; flex-direction: column; gap: var(--ed-space-xs); min-width: 0; }
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
  height: var(--ed-element-row-h);
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
.perch-editor-element { position: relative; }
.perch-editor-element[data-perch-dragging='true'] { opacity: 0.45; }
/* The drop line: 2px of accent on the gap between two rows, drawn by the row below it (or, below the
   last row, by that row), and never by the row being dragged. */
.perch-editor-element[data-perch-drop]::after {
  content: '';
  position: absolute;
  left: 2px;
  right: 2px;
  height: 2px;
  border-radius: 1px;
  background: var(--ed-accent);
  pointer-events: none;
}
.perch-editor-element[data-perch-drop='above']::after { top: -1px; }
.perch-editor-element[data-perch-drop='below']::after { bottom: -1px; }
body.perch-dragging, body.perch-dragging * { cursor: grabbing !important; user-select: none; }
/* A row: thumbnail, name, and the element's index in elements, faint, at the right edge. */
.perch-editor-element__summary { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.perch-editor-element__index { flex: none; min-width: 1.4em; text-align: right; font-variant-numeric: tabular-nums; color: var(--ed-faint); }
/* The background: its name in italics, as a locked base is, its source quiet, its lock at the right. */
.perch-editor-element__name { flex: none; color: var(--ed-text-2); }
.perch-editor-element__name--locked { font-style: italic; }
.perch-editor-element__summary--quiet { color: var(--ed-quiet); }
.perch-editor-element__lock { flex: none; display: inline-flex; align-items: center; color: var(--ed-faint); }
/* Positioned: a row's delete confirm floats over the row, right-aligned, as it does over any row. */
.perch-editor-layer { position: relative; display: flex; align-items: center; min-width: 0; }
.perch-editor-layer > .perch-editor-element { flex: 1 1 auto; min-width: 0; }
.perch-editor-layer[data-perch-hidden='true'] > .perch-editor-element { color: var(--ed-faint); }
.perch-editor-eye {
  flex: 0 0 var(--ed-element-row-h);
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--ed-element-row-h);
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: none;
  color: var(--ed-quiet);
  cursor: pointer;
}
.perch-editor-eye:hover:not(:disabled) { background: var(--ed-hover); color: var(--ed-text); }
.perch-editor-eye[data-perch-hidden='true'] { color: var(--ed-faint); }
.perch-editor-eye:disabled { color: var(--ed-faint); opacity: 0.5; cursor: default; }
.perch-editor-eye:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: -2px; }
.perch-editor-empty { margin: 0; padding: 6px var(--ed-pad-x); font-size: var(--ed-font-small); color: var(--ed-quiet); }
`;
