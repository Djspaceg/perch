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
 * once, inline, even though undo brings it back. The Delete and Backspace keys ask through the same confirm
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
import { assertNever } from '@perch/ui-kit';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import {
  Collapse,
  NumberField,
  PropertyRow,
  ResetButton,
  Section,
  usePresence,
} from './controls/index.js';
import {
  WIDGET_LIST_ID,
  backgroundProperties,
  entitySections,
  targetProperties,
  type PropertySection,
} from './descriptors.js';
import type { DraftState } from './draft.js';
import {
  clearBackground,
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
import { dropTarget, layerTarget, listRow } from './layers.js';
import { PropertyView } from './property-view.js';
import { LAYER_INDEX_ATTRIBUTE, useRowDrag, type RowDrag } from './row-drag.js';
import { AddMenu, SensorCatalogueProvider } from './sensor-picker.js';
import { BACKGROUND_SELECTED, NOTHING_SELECTED } from './store.js';
import { TokenPane } from './token-pane.js';

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
  onMove,
  deleteAsked,
  onDeleteAsked,
  topics,
  widgets,
}: InspectorProps): ReactNode {
  const element = state.draft.elements[selected];
  const onBackground = selected === BACKGROUND_SELECTED;
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
          <Collapse open={onBackground} focusOnClose={entityGroup}>
            {onBackground ? (
              <>
                <BackgroundHeader background={state.draft.background} onEdit={onEdit} />
                <BackgroundPanes background={state.draft.background} onEdit={onEdit} />
              </>
            ) : null}
          </Collapse>
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
          <Collapse open={element === undefined && !onBackground}>
            <p className="perch-editor-empty">
              nothing selected. click an entity on the canvas, or pick one from Elements below.
            </p>
          </Collapse>
          <Section
            id="entity/elements"
            title="Elements"
            summary={`${state.draft.elements.length} · topmost first`}
          >
            {/* A different layout is a different list: it arrives whole, not row by row. */}
            <ElementList
              key={state.name}
              state={state}
              selected={selected}
              onSelect={onSelect}
              onMove={onMove}
              onEdit={onEdit}
            />
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
        <span className="perch-selection__name" data-perch-tip={name}>
          {name}
        </span>
        <span className="perch-selection__meta">
          <span className="perch-selection__kind">{element.kind}</span>
          <span>{`elements[${index}]`}</span>
          {detail === undefined ? null : (
            <span className="perch-selection__detail" data-perch-tip={detail}>
              {detail}
            </span>
          )}
        </span>
      </span>
      <ResetButton
        action="delete"
        subject={`elements[${index}]`}
        consequence={`the ${element.kind} and everything set on it go. undo brings them back.`}
        ask="delete?"
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

/** What the opacity row says it does. */
const OPACITY_DESCRIPTION =
  'How strongly this entity paints, everything in it together: 0% is invisible, 100% solid.';

/** An opacity as the percentage the row shows: `0.55` is `55`. */
function opacityPercent(opacity: number | undefined): string {
  if (opacity === undefined) return '100';

  return Number.isNaN(opacity) ? '' : String(Math.round(opacity * 10_000) / 100);
}

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
 * One element's sections: Content and Transform from descriptors, then its style tokens in the
 * sections `ui-kit` groups them into, with the element's opacity first in Appearance. A media element
 * carries no `style` in the format, so it gets Content, Transform and an Appearance holding only its
 * opacity, and a sentence saying why there is nothing else.
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

  const opacity = (
    <OpacityRow
      opacity={element.opacity}
      onOpacity={(value) => {
        onEdit(setElementOpacity(index, value));
      }}
    />
  );

  if (element.kind === 'media') {
    return (
      <>
        {sections}
        {/* The id every element's Appearance folds under, so folding it here folds it there. */}
        <Section
          id="style/appearance"
          title="Appearance"
          testId="perch-editor-appearance"
          summary={element.opacity === undefined ? undefined : '1 set'}
          summaryActive={element.opacity !== undefined}
        >
          {opacity}
        </Section>
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
      lead={[
        {
          group: 'appearance',
          label: 'Opacity',
          description: OPACITY_DESCRIPTION,
          set: element.opacity !== undefined,
          row: opacity,
        },
      ]}
      onSet={(name, value) => {
        onEdit(setElementStyleToken(index, name, value));
      }}
      onRemove={(name) => {
        onEdit(removeElementStyleToken(index, name));
      }}
    />
  );
}

/** What the background row and header say there is, with no source. */
const NO_BACKGROUND = 'none';

/** Why the background row is never dragged or dropped on, as its tooltip says. */
const BACKGROUND_LOCKED = 'locked: always the lowest layer, under every element';

/**
 * The background, named, as the selection header names an element: locked, always lowest, and the
 * one control on it, which removes its source (asking first) so the theme's canvas colour shows.
 */
function BackgroundHeader({
  background,
  onEdit,
}: {
  readonly background: LayoutBackground | undefined;
  readonly onEdit: (update: LayoutUpdate) => void;
}): ReactNode {
  const name = background?.src ?? NO_BACKGROUND;

  return (
    <div
      className="perch-selection"
      data-testid="perch-editor-selection"
      data-perch-kind="background"
    >
      <span className="perch-selection__icon" aria-hidden="true">
        <LockGlyph />
      </span>
      <span className="perch-selection__text">
        <span className="perch-selection__name" data-perch-tip={name}>
          {name}
        </span>
        <span className="perch-selection__meta">
          <span className="perch-selection__kind">background</span>
          <span>locked · always lowest</span>
          {background?.hidden === true ? <span>hidden</span> : null}
        </span>
      </span>
      {background === undefined ? null : (
        <ResetButton
          action="delete"
          subject="the background"
          consequence="its source, fit, opacity and eye go, and the canvas colour shows. undo brings them back."
          ask="remove?"
          onReset={() => {
            onEdit(clearBackground());
          }}
        />
      )}
    </div>
  );
}

/**
 * The background's sections: its source, chosen from the cloud catalogue or the files beside the
 * layout or typed as a path, and its fit; then an Appearance holding its opacity. It has no rect,
 * since it always covers the canvas, and no style, as a media element has none.
 */
function BackgroundPanes({
  background,
  onEdit,
}: {
  readonly background: LayoutBackground | undefined;
  readonly onEdit: (update: LayoutUpdate) => void;
}): ReactNode {
  return (
    <>
      <Section id="entity/background" title="Source" summary={background?.src ?? NO_BACKGROUND}>
        {backgroundProperties(background).map((property) => (
          <PropertyView
            key={property.id}
            property={property}
            subject={background}
            index={NOTHING_SELECTED}
            onEdit={onEdit}
          />
        ))}
      </Section>
      {background === undefined ? null : (
        <Section
          id="style/appearance"
          title="Appearance"
          testId="perch-editor-appearance"
          summary={background.opacity === undefined ? undefined : '1 set'}
          summaryActive={background.opacity !== undefined}
        >
          <OpacityRow
            opacity={background.opacity}
            onOpacity={(value) => {
              onEdit(setBackgroundOpacity(value));
            }}
          />
        </Section>
      )}
      <p className="perch-editor-empty">
        the background is always the lowest layer and covers the whole canvas. with no source, or
        hidden, the theme&apos;s canvas colour shows.
      </p>
    </>
  );
}

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

/** Where a row of the list shows the drop line of a drag, if the drag would land beside it. */
function dropMark(drag: RowDrag | null, row: number, count: number): 'above' | 'below' | undefined {
  if (drag === null || dropTarget(drag.from, drag.gap, count) === null) return undefined;
  if (drag.gap === row) return 'above';

  return drag.gap === count && row === count - 1 ? 'below' : undefined;
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
}: Pick<InspectorProps, 'state' | 'selected' | 'onSelect' | 'onMove' | 'onEdit'>): ReactNode {
  const { background } = state.draft;
  const { rows, exited } = usePresence(state.draft.elements);
  const count = state.draft.elements.length;
  const list = useRef<HTMLUListElement>(null);
  const { drag, begin, swallowClick, cancel } = useRowDrag(list, count, onMove);
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
  }, [state.draft.elements, cancel]);

  // Top of the list first: the reverse of paint order.
  const shown = [...rows].reverse();

  return (
    <ul className="perch-editor-elements" data-testid="perch-editor-elements" ref={list}>
      {shown.map(({ key, item: element, index, present, arrived }) => (
        <Collapse
          key={key}
          as="li"
          open={present}
          appear={arrived}
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
              {...(present ? { [LAYER_INDEX_ATTRIBUTE]: String(index) } : {})}
              {...(drag?.from === index && present ? { 'data-perch-dragging': 'true' } : {})}
              {...(present ? markOf(dropMark(drag, listRow(index, count), count)) : {})}
              onPointerDown={(event) => {
                if (present) begin(event, index);
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
                if (!present || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
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
              <span className="perch-editor-element__index">{index}</span>
              <span className="perch-editor-element__glyph" aria-hidden="true">
                {KIND_GLYPH[element.kind]}
              </span>
              <span className="perch-editor-element__kind">{element.kind}</span>
              <span
                className="perch-editor-element__summary"
                data-perch-tip={describeElement(element)}
              >
                {describeElement(element)}
              </span>
            </button>
          </div>
        </Collapse>
      ))}
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
            <span className="perch-editor-element__index" aria-label="locked">
              <LockGlyph />
            </span>
            <span className="perch-editor-element__glyph" aria-hidden="true">
              {KIND_GLYPH.media}
            </span>
            <span className="perch-editor-element__kind">background</span>
            <span className="perch-editor-element__summary">
              {background?.src ?? NO_BACKGROUND}
            </span>
          </button>
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
  height: var(--ed-list-row-h);
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
.perch-editor-element__index { flex: 0 0 1.4em; text-align: right; font-variant-numeric: tabular-nums; color: var(--ed-faint); }
.perch-editor-element__glyph { flex: 0 0 1em; color: var(--ed-quiet); text-align: center; }
.perch-editor-element__kind { flex: 0 0 3.6em; color: var(--ed-quiet); }
.perch-editor-element__summary { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.perch-editor-layer { display: flex; align-items: center; min-width: 0; }
.perch-editor-layer > .perch-editor-element { flex: 1 1 auto; min-width: 0; }
.perch-editor-layer[data-perch-hidden='true'] > .perch-editor-element { color: var(--ed-faint); }
.perch-editor-layer--background .perch-editor-element__kind { flex-basis: 5.6em; }
.perch-editor-eye {
  flex: 0 0 var(--ed-list-row-h);
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--ed-list-row-h);
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
