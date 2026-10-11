/**
 * Transform as one block, the way Affinity lays its Transform panel out: the content alignment grid
 * at the left, and x/y and w/h beside it as two rows of fields with no label column, so the panel is
 * about the grid's height.
 *
 * The grid is where the element's CONTENT sits inside its box — a text's lines, a readout's number,
 * unit and caption — and not where the box sits: it is the text or readout placement token pair,
 * which the Placement panel used to hold. It is not a transform anchor, and its name and tooltip say
 * so ("Content alignment: left, top. Where the text sits inside its box, ..."). Under the fields, a
 * caption line says the same in words, tinted and marked like a row's source, with one reset for
 * whatever half is set here.
 *
 * A kind with no placement (media, a chart) shows only the fields, which then take the full width.
 * Transform is one section for every element, kept mounted across a change of selection, so the grid
 * folds out sideways and back in (`grid-template-columns` between `0fr` and `1fr`, as `Collapse` does
 * with rows) rather than the block being swapped; instant under reduced motion. The leaving grid is
 * inert and hidden while it folds.
 *
 * Measured at 300, 420 and 540px sidebars, mouse and coarse pointer (see DECISIONS.md): the grid and
 * both fields fit on one band at every width without truncating a number, so nothing is shrunk. A
 * block narrower than any sidebar allows (a container under `TRANSFORM_STACK_BELOW_PX`) stacks the grid
 * above the fields, as a guard rather than a layout anyone sees at the supported widths.
 */

import type { LayoutElement } from '@perch/layout-schema';
import { useState, type ReactNode } from 'react';
import { AlignGrid, ResetButton, VectorField } from './controls/index.js';
import { optionLabel, type Property } from './descriptors.js';
import type { LayoutUpdate } from './layout-edits.js';
import { contentPlacement, type ContentPlacement } from './token-pane.js';

/** Below this width the block stacks the grid above its fields. */
export const TRANSFORM_STACK_BELOW_PX = 200;

/** What the content is, in the grid's tooltip. */
function contentOf(kind: LayoutElement['kind']): string {
  return kind === 'widget' ? 'the number, unit and caption sit' : 'the text sits';
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
  /** The rect's two rows: position (x, y) and size (w, h). */
  readonly properties: readonly Property<LayoutElement>[];
  /** The layout theme, which a placement half not set here is inherited from. */
  readonly inherited: Readonly<Record<string, string>> | undefined;
  readonly onEdit: (update: LayoutUpdate) => void;
  readonly onSet: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
}): ReactNode {
  const tokens = element.kind === 'media' ? {} : (element.style ?? {});
  const placement = contentPlacement(element.kind, tokens, inherited);
  // The kind whose grid was last shown: a grid on its way out is still drawn, inert, as it folds.
  const [kept, setKept] = useState<LayoutElement['kind'] | null>(
    placement === undefined ? null : element.kind,
  );
  if (placement !== undefined && kept !== element.kind) setKept(element.kind);
  const leaving =
    placement === undefined && kept !== null ? contentPlacement(kept, {}, inherited) : undefined;
  const shown = placement ?? leaving;
  const open = placement !== undefined;

  return (
    <div className="perch-transform" data-perch-grid={open ? 'true' : 'false'}>
      <div className="perch-transform__inner">
        <div
          className="perch-transform__grid"
          data-perch-open={open ? 'true' : 'false'}
          {...(open ? {} : { inert: true, 'aria-hidden': 'true' as const })}
        >
          <div className="perch-transform__clip">
            {shown === undefined ? null : (
              <ContentGrid
                placement={shown}
                content={contentOf(open ? element.kind : (kept ?? element.kind))}
                onSet={onSet}
              />
            )}
          </div>
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
                    value: field.get(element),
                    onChange: (text) => {
                      onEdit(field.write(text, index));
                    },
                  }))}
                />
              </div>
            ) : null,
          )}
          {placement === undefined ? null : <Caption placement={placement} onRemove={onRemove} />}
        </div>
      </div>
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

/** The grid's value in words under the fields, with its source mark and one reset. */
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
.perch-transform__inner { display: flex; align-items: flex-start; min-width: 0; }
/* The grid folds sideways, by its column, as Collapse folds a region by its row. */
.perch-transform__grid {
  flex: none;
  display: grid;
  grid-template-columns: 1fr;
  transition: grid-template-columns var(--ed-motion-duration) var(--ed-motion-ease);
}
.perch-transform__grid[data-perch-open='false'] { grid-template-columns: 0fr; }
.perch-transform__clip {
  min-width: 0;
  overflow: hidden;
  transition: opacity var(--ed-motion-duration) var(--ed-motion-ease);
}
.perch-transform__grid[data-perch-open='false'] > .perch-transform__clip { opacity: 0; }
/* The gap to the fields is inside the clip, so it folds away with the grid. */
.perch-transform__clip > .perch-align { margin-right: 8px; }
.perch-transform__fields { flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.perch-transform__row { display: flex; align-items: center; min-width: 0; min-height: var(--ed-row-h); }
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
/* Too narrow for the grid beside the fields: it goes on its own row above them. */
@container (max-width: ${TRANSFORM_STACK_BELOW_PX}px) {
  .perch-transform__inner { flex-direction: column; gap: 4px; }
  .perch-transform__fields { width: 100%; }
}
`;
