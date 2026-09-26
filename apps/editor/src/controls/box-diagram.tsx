/**
 * BoxDiagram: a padding as the padding ring of a box-model diagram, and a radius as its four corners.
 *
 * The human's design, from Webflow's spacing diagram without the margin ring:
 *
 * - **Top always holds a number** (top-left, for a radius). It cannot be unlinked or cleared.
 * - **Every other side is linked or set.** Linked shows a chain link and no number: the side copies
 *   the position CSS shorthand would copy it from — right and bottom from top, left from right; for
 *   corners, top-right and bottom-right from top-left, bottom-left from top-right. Set shows its own
 *   number and a broken link. So every-side-linked is `8`, right set is `8 16`, right and bottom set is
 *   `8 16 4`, and all set is four values. Left alone may be set; right and bottom stay on top.
 * - **Clicking a link unlinks** the side at the value it was inheriting, with focus on its number.
 *   **Clicking the broken link** clears the number and relinks it; what followed it follows again.
 * - **Each side's area scrubs** its value when dragged, as Webflow's does. A drag on a linked side
 *   unlinks it and scrubs from what it inherited; a still click opens it for typing.
 *
 * The numbers are `NumberField`s, so typing, arrows (Shift for ten) and a drag on the field behave as
 * everywhere else in the inspector. Invalid input is refused out loud: nothing is written, the text
 * stays, and the reason is shown under the diagram and read as the field's description. Top also
 * takes a whole CSS shorthand, typed or pasted (`8 16`, `4px 8px 12px`), and sets every side from it.
 *
 * What is stored is only the shortest shorthand; which side is linked is read back from it, and the
 * one case that cannot be — unlinked but equal — is remembered while the field lives (`box-links.ts`).
 */

import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { formatBoxToken, parseBoxToken, type BoxQuad } from '@perch/ui-kit';
import { boxPositions, parseBoxInput, parseBoxPart, type BoxKind } from './box-input.js';
import { LINK_SOURCE, linksOf, relink, setPosition, type Linked } from './box-links.js';
import { NumberField } from './number-field.js';
import { SCRUB_THRESHOLD_PX, scrubValue } from './scrub.js';

export interface BoxDiagramProps {
  /** The first position's field id, for the row's label. */
  readonly id?: string | undefined;
  /** What the value is: `Padding`, `Corner radius`. */
  readonly label: string;
  readonly kind: BoxKind;
  /** The token value as stored: one to four unitless numbers. */
  readonly value: string;
  readonly onValue: (value: string) => void;
  /** Bounds for nudging and dragging. Typing may go past them. */
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly describedBy?: string | undefined;
}

/** Something remembered against the stored value it was made for: made for another, it is stale. */
interface Based<T> {
  readonly of: T;
  readonly base: string;
}

const NO_UNLINKS: ReadonlySet<number> = new Set();

export function BoxDiagram({
  id,
  label,
  kind,
  value,
  onValue,
  min,
  max,
  describedBy,
}: BoxDiagramProps): ReactNode {
  const stored: BoxQuad = parseBoxToken(value) ?? [0, 0, 0, 0];
  const [unlinks, setUnlinks] = useState<Based<ReadonlySet<number>> | null>(null);
  const [draft, setDraft] = useState<Based<{ index: number; text: string }> | null>(null);
  const focusNext = useRef<string | null>(null);
  const base = id ?? `perch-box-${kind}`;
  const positions = boxPositions(kind);
  const errorId = `${base}-error`;

  // A reset, the other pane or a drag on the row label wrote a value this state was not made for.
  const unlinked = unlinks !== null && unlinks.base === value ? unlinks.of : NO_UNLINKS;
  const typed = draft !== null && draft.base === value ? draft.of : null;
  const linked = linksOf(stored, unlinked);

  const fieldId = (index: number): string =>
    index === 0 && id !== undefined ? id : `${base}-${positions[index] ?? index}`;
  const linkId = (index: number): string => `${base}-${positions[index] ?? index}-link`;
  const name = (index: number): string => `${label} ${positions[index] ?? ''}`;
  const sourceOf = (index: number): string => {
    const source = LINK_SOURCE[index];
    return source === undefined ? '' : (positions[source] ?? '');
  };

  const commit = (next: Linked): void => {
    const written = formatBoxToken(next.quad);
    if (written !== value) onValue(written);
    setUnlinks({ of: next.unlinked, base: written });
  };

  // Focus follows the control the author just used as it changes shape: a link becomes a number, a
  // broken link becomes a link. Moved after the render that created the target.
  useLayoutEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    focusNext.current = null;
    const element = document.getElementById(target);
    element?.focus();
    if (element instanceof HTMLInputElement) element.select();
  });

  const unlink = (index: number): void => {
    setUnlinks({ of: new Set([...unlinked, index]), base: value });
    focusNext.current = fieldId(index);
  };

  const onField = (index: number, text: string): void => {
    const trimmed = text.trim();
    if (index === 0 && /[\s,]/.test(trimmed)) {
      const whole = parseBoxInput(trimmed, kind);
      if (whole.ok) {
        commit({ quad: whole.quad, unlinked: NO_UNLINKS });
        setDraft({ of: { index, text }, base: formatBoxToken(whole.quad) });
        return;
      }
      setDraft({ of: { index, text }, base: value });
      return;
    }
    const part = trimmed === '' ? 'type a number' : parseBoxPart(trimmed, kind);
    if (typeof part === 'string') {
      setDraft({ of: { index, text }, base: value });
      return;
    }
    commit(setPosition(stored, unlinked, index, part));
    setDraft(null);
  };

  const message = (() => {
    if (typed === null) return undefined;
    const trimmed = typed.text.trim();
    if (trimmed === '') return `${positions[typed.index] ?? ''}: type a number`;
    if (typed.index === 0 && /[\s,]/.test(trimmed)) {
      const whole = parseBoxInput(trimmed, kind);
      return whole.ok ? undefined : `${positions[0] ?? ''}: ${whole.message}`;
    }
    const part = parseBoxPart(trimmed, kind);
    return typeof part === 'string' ? `${positions[typed.index] ?? ''}: ${part}` : undefined;
  })();

  // A drag spans many renders: it reads the latest value and links, never the ones it began with.
  const latest = useRef({ stored, unlinked, linked, commit, unlink, fieldId });
  useLayoutEffect(() => {
    latest.current = { stored, unlinked, linked, commit, unlink, fieldId };
  });

  const beginScrub = (index: number, event: PointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const startX = event.clientX;
    const start = latest.current.stored[index] ?? 0;
    let scrubbing = false;
    let last = start;

    const move = (moved: globalThis.PointerEvent): void => {
      const delta = moved.clientX - startX;
      if (!scrubbing && Math.abs(delta) < SCRUB_THRESHOLD_PX) return;
      scrubbing = true;
      document.body.classList.add('perch-scrubbing');
      const next = scrubValue(start, delta, moved.shiftKey, 1, { min, max });
      if (next === last) return;
      last = next;
      const now = latest.current;
      now.commit(setPosition(now.stored, now.unlinked, index, next));
    };
    const end = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      document.body.classList.remove('perch-scrubbing');
      if (scrubbing) return;
      const now = latest.current;
      if (now.linked[index] === true) {
        now.unlink(index);
        return;
      }
      const field = document.getElementById(now.fieldId(index));
      field?.focus();
      if (field instanceof HTMLInputElement) field.select();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const slot = (index: number): ReactNode => {
    const position = positions[index] ?? '';
    if (linked[index] === true) {
      return (
        <button
          id={linkId(index)}
          type="button"
          className="perch-box-diagram__link"
          aria-label={`${name(index)}, linked to ${sourceOf(index)}`}
          title={`linked to ${sourceOf(index)}: click to give ${position} its own value`}
          onClick={() => {
            unlink(index);
          }}
        >
          <LinkGlyph broken={false} />
        </button>
      );
    }

    return (
      <>
        <NumberField
          id={fieldId(index)}
          label={name(index)}
          ariaLabel={name(index)}
          labelHidden
          testId={`perch-box-${kind}-${position}`}
          value={typed?.index === index ? typed.text : String(stored[index] ?? 0)}
          onChange={(text) => {
            onField(index, text);
          }}
          step={1}
          min={min}
          max={max}
          describedBy={message !== undefined && typed?.index === index ? errorId : describedBy}
        />
        {index === 0 ? null : (
          <button
            id={linkId(index)}
            type="button"
            className="perch-box-diagram__link perch-box-diagram__link--broken"
            aria-label={`relink ${name(index)} to ${sourceOf(index)}`}
            title={`clear ${position} and link it to ${sourceOf(index)} again`}
            onClick={() => {
              commit(relink(stored, unlinked, index));
              focusNext.current = linkId(index);
            }}
          >
            <LinkGlyph broken />
          </button>
        )}
      </>
    );
  };

  return (
    <div className="perch-box-diagram-wrap">
      <div
        className={`perch-box-diagram perch-box-diagram--${kind}`}
        role="group"
        aria-label={label}
      >
        {positions.map((position, index) => (
          <div
            key={position}
            className={`perch-box-diagram__area perch-box-diagram__area--${position}`}
            data-testid={`perch-box-${kind}-${position}-area`}
            data-perch-linked={linked[index] === true ? 'true' : 'false'}
            onPointerDown={(event) => {
              beginScrub(index, event);
            }}
          >
            {slot(index)}
          </div>
        ))}
        <span
          className="perch-box-diagram__shorthand"
          data-testid={`perch-box-shorthand-${base}`}
          title={`as CSS: ${kind === 'sides' ? 'padding' : 'border-radius'}, in layout px`}
        >
          {formatBoxToken(stored)}
          <span className="perch-box-diagram__unit"> px</span>
        </span>
      </div>
      {message === undefined ? null : (
        <span className="perch-box-diagram__error" id={errorId} role="alert">
          {message}
        </span>
      )}
    </div>
  );
}

/** A chain link, or the same link broken: linked, or set and clearable. */
function LinkGlyph({ broken }: { readonly broken: boolean }): ReactNode {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        d={
          broken
            ? 'M4.6 8.4l-1.1 1.1a1.8 1.8 0 0 1-2.5-2.5l1.5-1.5a1.8 1.8 0 0 1 2 -.4M7.4 3.6l1.1-1.1a1.8 1.8 0 0 1 2.5 2.5l-1.5 1.5a1.8 1.8 0 0 1-2 .4M3.2 1.6v1.2M1.6 3.2h1.2M8.8 10.4V9.2M10.4 8.8H9.2'
            : 'M4.8 7.2l2.4-2.4M4.6 8.4l-1.1 1.1a1.8 1.8 0 0 1-2.5-2.5l1.5-1.5a1.8 1.8 0 0 1 2.5 0M7.4 3.6l1.1-1.1a1.8 1.8 0 0 1 2.5 2.5l-1.5 1.5a1.8 1.8 0 0 1-2.5 0'
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/*
 * The ring: four areas clipped to trapezoids around a centre, with a 1px seam between them. The clip
 * is also the hit area, so a press lands on the side whose shape it is in. `--bd-w` is how wide the
 * left and right sides are, `--bd-h` how tall top and bottom are.
 */
export const BOX_DIAGRAM_STYLES = `
.perch-box-diagram-wrap { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }
.perch-box-diagram {
  --bd-w: 50px;
  --bd-h: 26px;
  position: relative;
  height: 92px;
  min-width: 0;
  border-radius: var(--ed-radius);
  background: var(--ed-bg-recessed);
}
.perch-box-diagram__area {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  box-sizing: border-box;
  background: var(--ed-bar);
  cursor: ew-resize;
}
.perch-box-diagram__area:hover { background: var(--ed-hover); }
.perch-box-diagram--sides .perch-box-diagram__area--top {
  top: 0; left: 0; right: 0; height: var(--bd-h);
  clip-path: polygon(1px 0, calc(100% - 1px) 0, calc(100% - var(--bd-w)) calc(100% - 1px), var(--bd-w) calc(100% - 1px));
}
.perch-box-diagram--sides .perch-box-diagram__area--bottom {
  bottom: 0; left: 0; right: 0; height: var(--bd-h);
  clip-path: polygon(var(--bd-w) 1px, calc(100% - var(--bd-w)) 1px, calc(100% - 1px) 100%, 1px 100%);
}
.perch-box-diagram--sides .perch-box-diagram__area--left {
  top: 0; bottom: 0; left: 0; width: var(--bd-w);
  flex-direction: column;
  clip-path: polygon(0 1px, calc(100% - 1px) var(--bd-h), calc(100% - 1px) calc(100% - var(--bd-h)), 0 calc(100% - 1px));
}
.perch-box-diagram--sides .perch-box-diagram__area--right {
  top: 0; bottom: 0; right: 0; width: var(--bd-w);
  flex-direction: column;
  clip-path: polygon(1px var(--bd-h), 100% 1px, 100% calc(100% - 1px), 1px calc(100% - var(--bd-h)));
}
.perch-box-diagram--corners { height: 60px; }
.perch-box-diagram--corners .perch-box-diagram__area {
  width: calc(50% - 1px);
  height: calc(50% - 1px);
  padding: 0 8px;
  border: 0 solid var(--ed-field-edge-hover);
}
.perch-box-diagram--corners .perch-box-diagram__area--top-left {
  top: 0; left: 0; justify-content: flex-start;
  border-top-width: 2px; border-left-width: 2px; border-top-left-radius: 12px;
}
.perch-box-diagram--corners .perch-box-diagram__area--top-right {
  top: 0; right: 0; justify-content: flex-end;
  border-top-width: 2px; border-right-width: 2px; border-top-right-radius: 12px;
}
.perch-box-diagram--corners .perch-box-diagram__area--bottom-right {
  bottom: 0; right: 0; justify-content: flex-end;
  border-bottom-width: 2px; border-right-width: 2px; border-bottom-right-radius: 12px;
}
.perch-box-diagram--corners .perch-box-diagram__area--bottom-left {
  bottom: 0; left: 0; justify-content: flex-start;
  border-bottom-width: 2px; border-left-width: 2px; border-bottom-left-radius: 12px;
}
.perch-box-diagram__area .perch-number { flex: none; width: 34px; height: 18px; }
.perch-box-diagram__area .perch-number__input { padding: 0 3px; text-align: center; }
.perch-box-diagram__link {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: var(--ed-radius);
  background: none;
  color: var(--ed-quiet);
  padding: 0;
  cursor: pointer;
}
.perch-box-diagram__link:hover { color: var(--ed-accent); background: var(--ed-bg-recessed); }
.perch-box-diagram__link--broken { width: 14px; color: var(--ed-faint); }
.perch-box-diagram__link:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 0; }
.perch-box-diagram__shorthand {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  max-width: calc(100% - 2 * var(--bd-w) - 8px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
  font-family: var(--ed-mono);
  font-size: var(--ed-font-small);
  color: var(--ed-text-2);
}
.perch-box-diagram--corners .perch-box-diagram__shorthand {
  max-width: 40%;
  padding: 1px 4px;
  border-radius: var(--ed-radius);
  background: var(--ed-bg-recessed);
}
.perch-box-diagram__unit { color: var(--ed-faint); }
.perch-box-diagram__error {
  padding-top: 2px;
  font-size: var(--ed-font-small);
  line-height: 1.35;
  color: var(--ed-danger);
}
`;
