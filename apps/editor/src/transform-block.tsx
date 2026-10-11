/**
 * The entity's Placement panel, laid out as Affinity's Transform panel is: where the box is and how
 * big, about a resize anchor, and under that, where the content sits inside the box.
 *
 * ## The resize band: an anchor, and x/y and w/h about it
 *
 * A three-by-three anchor grid at the left, and x/y and w/h beside it as two rows of fields with no
 * label column. The anchor chosen is the reference point (`anchor.ts`): x and y show where that
 * point of the box is, typing them moves the box so the point lands there, and w and h resize about
 * it, so it stays put. The layout still stores every rect as its top-left x/y and its w/h, so the
 * anchor is an editor setting (`settings.anchor`), one for every element, top-left by default, which
 * shows exactly the numbers the file holds. The canvas's own resize handles are unaffected: each
 * handle drags its own edge or corner and holds the opposite one, as before.
 *
 * ## The content band: content alignment
 *
 * On a band of its own under the fields, labelled "Content alignment": the text or readout placement
 * pair as its four-by-four (or three-by-three) grid, where the element's CONTENT sits inside its box
 * — a text's lines, a readout's number, unit and caption — never where the box sits. Beside the grid,
 * its value in words, tinted and marked like a row's source, with one reset for whatever half is
 * set here. A kind with no placement (media, a chart) has no such band; Placement is one section for
 * every element, kept mounted across a change of selection, and the band grows in or collapses away
 * (`Collapse`) as the selection changes kind, in height and opacity only.
 *
 * Below `TRANSFORM_STACK_BELOW_PX` of block width (narrower than any sidebar allows) the anchor grid
 * stacks above its fields, as a guard.
 */

import type { LayoutElement } from '@perch/layout-schema';
import type { ReactNode } from 'react';
import {
  ACROSS_WORDS,
  ANCHOR_EDGES,
  DOWN_WORDS,
  anchoredPosition,
  anchorWords,
  placeAt,
  resizeAbout,
  type AnchorEdge,
} from './anchor.js';
import { AlignGrid, Collapse, ResetButton, VectorField } from './controls/index.js';
import { optionLabel, type Property } from './descriptors.js';
import {
  numberFromInput,
  numberToInput,
  setElementRect,
  type LayoutUpdate,
} from './layout-edits.js';
import { useEditorStore } from './store.js';
import { contentPlacement, type ContentPlacement } from './token-pane.js';

/** Below this width the block stacks the anchor grid above its fields. */
export const TRANSFORM_STACK_BELOW_PX = 200;

/** What the content is, in the content grid's tooltip. */
function contentOf(kind: LayoutElement['kind']): string {
  return kind === 'widget' ? 'the number, unit and caption sit' : 'the text sits';
}

const ANCHOR_ACROSS = ANCHOR_EDGES.map((edge) => ({ value: edge, label: ACROSS_WORDS[edge] }));
const ANCHOR_DOWN = ANCHOR_EDGES.map((edge) => ({ value: edge, label: DOWN_WORDS[edge] }));

function isEdge(value: string): value is AnchorEdge {
  return ANCHOR_EDGES.some((edge) => edge === value);
}

export function TransformBlock({
  element,
  index,
  properties,
  inherited,
  onEdit,
  onSet,
  onRemove,
}: {
  readonly element: LayoutElement;
  readonly index: number;
  /** The rect's two rows: position (x, y) and size (w, h), for their labels, axes and bounds. */
  readonly properties: readonly Property<LayoutElement>[];
  /** The layout theme, which a placement half not set here is inherited from. */
  readonly inherited: Readonly<Record<string, string>> | undefined;
  readonly onEdit: (update: LayoutUpdate) => void;
  readonly onSet: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
}): ReactNode {
  const anchor = useEditorStore((state) => state.settings.anchor);
  const setAnchor = useEditorStore((state) => state.setAnchor);
  const tokens = element.kind === 'media' ? {} : (element.style ?? {});
  const placement = contentPlacement(element.kind, tokens, inherited);
  const { rect } = element;
  const point = anchoredPosition(rect, anchor);
  const where = anchorWords(anchor);

  /** A field's value and write, about the anchor: x/y are the anchor point, w/h resize about it. */
  const about = (key: string): { value: string; onChange: (text: string) => void } => {
    const write = (next: typeof rect): void => {
      onEdit(setElementRect(index, next));
    };
    switch (key) {
      case 'x':
      case 'y':
        return {
          value: numberToInput(point[key]),
          onChange: (text) => {
            write(placeAt(rect, anchor, key, numberFromInput(text)));
          },
        };
      case 'w':
      case 'h':
        return {
          value: numberToInput(rect[key]),
          onChange: (text) => {
            write(resizeAbout(rect, anchor, key, numberFromInput(text)));
          },
        };
      default:
        return { value: '', onChange: () => undefined };
    }
  };

  return (
    <div className="perch-transform">
      <div className="perch-transform__inner">
        <div className="perch-transform__anchor">
          <AlignGrid
            label={`Resize anchor: ${where}`}
            tip={`Resize anchor: ${where}. x and y are this point's position, and w and h resize about it.`}
            across={{ options: ANCHOR_ACROSS, value: anchor.across }}
            down={{ options: ANCHOR_DOWN, value: anchor.down }}
            onPick={(across, down) => {
              if (isEdge(across) && isEdge(down)) setAnchor({ across, down });
            }}
          />
        </div>
        <div className="perch-transform__fields">
          {properties.map((property) =>
            property.kind === 'vector' ? (
              <div
                key={property.id}
                className="perch-transform__row"
                role="group"
                aria-label={property.label}
                data-testid={`perch-editor-prop-${property.id}`}
              >
                <VectorField
                  unit={property.unit}
                  step={1}
                  fields={property.fields.map((field) => ({
                    key: field.key,
                    label: field.label,
                    ariaLabel: field.ariaLabel,
                    axis: field.axis,
                    min: field.min,
                    ...about(field.key),
                  }))}
                />
              </div>
            ) : null,
          )}
        </div>
      </div>
      <Collapse open={placement !== undefined}>
        {placement === undefined ? null : (
          <div className="perch-transform__content">
            <ContentGrid placement={placement} content={contentOf(element.kind)} onSet={onSet} />
            <div className="perch-transform__content-text">
              <span className="perch-transform__content-label">Content alignment</span>
              <Caption placement={placement} onRemove={onRemove} />
            </div>
          </div>
        )}
      </Collapse>
    </div>
  );
}

/** The two halves in words: `left, top`. */
function inWords(placement: ContentPlacement): string {
  const { across, down } = placement;

  return `${optionLabel(across.entry, across.value)}, ${optionLabel(down.entry, down.value)}`;
}

function ContentGrid({
  placement,
  content,
  onSet,
}: {
  readonly placement: ContentPlacement;
  /** What sits where the grid says: `the text sits`. */
  readonly content: string;
  readonly onSet: (name: string, value: string) => void;
}): ReactNode {
  const { across, down } = placement;
  const name = `Content alignment: ${inWords(placement)}`;
  const axis = (state: ContentPlacement['across']) => ({
    options: (state.entry.options ?? []).map((value) => ({
      value,
      label: optionLabel(state.entry, value),
    })),
    value: state.value,
  });

  return (
    <AlignGrid
      label={name}
      tip={`${name}. Where ${content} inside its box, not where the box sits.`}
      across={axis(across)}
      down={axis(down)}
      onPick={(x, y) => {
        // Only the half that changed is written, as in the token pane's grid.
        if (x !== across.value) onSet(across.name, x);
        if (y !== down.value) onSet(down.name, y);
      }}
    />
  );
}

/** The content grid's value in words, with its source mark and one reset. */
function Caption({
  placement,
  onRemove,
}: {
  readonly placement: ContentPlacement;
  readonly onRemove: (name: string) => void;
}): ReactNode {
  const { across, down } = placement;
  const own = [across, down].filter((half) => half.source === 'own');
  const source =
    own.length > 0
      ? 'own'
      : across.source === 'inherited' || down.source === 'inherited'
        ? 'inherited'
        : 'default';
  const after = (half: ContentPlacement['across']): string =>
    half.source === 'own' ? half.returnsTo.value : optionLabel(half.entry, half.value);
  const returnsFrom = own[0]?.returnsTo.source ?? 'default';

  return (
    <div className="perch-transform__caption" data-perch-source={source}>
      {source === 'default' ? null : <span className="perch-row__mark" aria-hidden="true" />}
      <span className="perch-transform__caption-text">{inWords(placement)}</span>
      <span className="perch-sr-only">
        {source === 'own'
          ? 'set by this entity'
          : source === 'inherited'
            ? 'from the layout theme'
            : 'default'}
      </span>
      {own.length === 0 ? null : (
        <ResetButton
          action="reset"
          subject="Content alignment"
          returnsTo={{ source: returnsFrom, value: `${after(across)}, ${after(down)}` }}
          onReset={() => {
            for (const half of own) onRemove(half.name);
          }}
        />
      )}
    </div>
  );
}

export const TRANSFORM_STYLES = `
.perch-transform { container-type: inline-size; min-width: 0; padding: 2px 4px 3px var(--ed-pad-x); }
.perch-transform__inner { display: flex; align-items: center; gap: 8px; min-width: 0; }
.perch-transform__anchor { flex: none; display: flex; }
.perch-transform__fields { flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.perch-transform__row { display: flex; align-items: center; min-width: 0; min-height: var(--ed-row-h); }
/* Content alignment: a band of its own under the resize fields, its grid and its value in words. */
.perch-transform__content {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  margin-top: var(--ed-space-sm);
  padding-top: var(--ed-space-sm);
  border-top: 1px solid var(--ed-bar-edge);
}
.perch-transform__content-text { flex: 1 1 auto; display: flex; flex-direction: column; gap: var(--ed-space-xs); min-width: 0; }
.perch-transform__content-label { font-size: var(--ed-font); color: var(--ed-label); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.perch-transform__caption {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: var(--ed-list-row-h);
  padding-left: 10px;
  font-size: var(--ed-font-small);
  color: var(--ed-quiet);
  white-space: nowrap;
}
.perch-transform__caption-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.perch-transform__caption[data-perch-source='own'] .perch-transform__caption-text { color: var(--ed-own-text); }
.perch-transform__caption[data-perch-source='inherited'] .perch-transform__caption-text { color: var(--ed-inherited-text); }
.perch-transform__caption .perch-row__mark {
  position: absolute;
  left: 0;
  top: 50%;
  width: 6px;
  height: 6px;
  box-sizing: border-box;
  border-radius: 50%;
  transform: translateY(-50%);
}
.perch-transform__caption[data-perch-source='own'] .perch-row__mark { background: var(--ed-own); }
.perch-transform__caption[data-perch-source='inherited'] .perch-row__mark { border: 1.5px solid var(--ed-inherited); }
/* Too narrow for the anchor grid beside the fields: it goes on its own row above them. */
@container (max-width: ${TRANSFORM_STACK_BELOW_PX}px) {
  .perch-transform__inner { flex-direction: column; align-items: flex-start; gap: 4px; }
  .perch-transform__fields { width: 100%; }
}
`;
