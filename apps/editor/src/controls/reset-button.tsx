/**
 * ResetButton: the one control that undoes a value, in the two shapes its two consequences need.
 *
 * - **`reset` / `remove`** — `↺` — where something underneath takes over: the layout theme's value
 *   first, else the ui-kit default. The accessible name, which is also the tooltip, names that value
 *   and where it comes from, because "what do I get back" is the whole question before pressing it.
 *   `reset` is the Customize phrasing (a token by its label); `remove` is the Developer phrasing (a
 *   raw name, and "this layout's value" going rather than the token going).
 * - **`delete`** — a trash can, in red — where nothing takes over: a name `ui-kit` does not
 *   declare, or a whole element. One symbol for one meaning: every real, unrecoverable delete in the
 *   editor is this button, so the can never means anything gentler. It asks first, inline, naming
 *   what it will delete, with focus on the confirm; Escape or `keep` backs out and hands focus back
 *   to the can. The second press is what carries the deliberateness the word `delete` used to,
 *   undo notwithstanding. `consequence` and `ask` say what is lost where it is
 *   not a token; `confirming` lets a caller open the ask from elsewhere — the Delete key on the
 *   canvas asks through the same confirm as the button. The ask unfolds and folds away through
 *   `Collapse`, like every other region that comes and goes.
 *
 * A different glyph, colour, accessible name and number of clicks — never colour alone. The glyph is
 * `aria-hidden`; the sentence is what a screen reader reads.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Collapse } from './collapse.js';

/** What takes over when the value goes. */
export interface ReturnsTo {
  readonly source: 'layout' | 'default';
  readonly value: string;
}

const GONE = 'ui-kit declares no default for it, so nothing takes over: the value is gone.';

function underneath(returnsTo: ReturnsTo): string {
  return `${returnsTo.source === 'layout' ? 'the layout theme value' : 'the ui-kit default'} ${returnsTo.value}`;
}

export type ResetButtonProps =
  | {
      readonly action: 'reset' | 'remove';
      readonly subject: string;
      readonly returnsTo: ReturnsTo;
      readonly onReset: () => void;
    }
  | {
      readonly action: 'delete';
      readonly subject: string;
      readonly onReset: () => void;
      /** The sentence after `delete <subject>.`: what is lost. Defaults to a token's. */
      readonly consequence?: string | undefined;
      /** The words shown in the confirm. Defaults to a token's. */
      readonly ask?: string | undefined;
      /** Controlled confirm, for a caller that also opens it another way. */
      readonly confirming?: boolean | undefined;
      readonly onConfirming?: ((confirming: boolean) => void) | undefined;
    };

export function ResetButton(props: ResetButtonProps): ReactNode {
  const [ownConfirming, setOwnConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const asked = props.action === 'delete' ? props.confirming : undefined;
  const controlled = asked !== undefined;
  const confirming = asked ?? ownConfirming;
  const setConfirming = (next: boolean): void => {
    if (props.action === 'delete') props.onConfirming?.(next);
    if (!controlled) setOwnConfirming(next);
  };

  // The ask takes focus when it opens, so the key that opened it is followed by Enter or Escape and
  // focus is never dropped onto the page as the button it replaced unmounts.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  if (props.action !== 'delete') {
    const name =
      props.action === 'reset'
        ? `reset ${props.subject} to ${underneath(props.returnsTo)}`
        : `remove this layout's value for ${props.subject}, back to ${underneath(props.returnsTo)}`;

    return (
      <button
        type="button"
        className="perch-reset perch-reset--revert"
        aria-label={name}
        title={name}
        onClick={props.onReset}
      >
        <span aria-hidden="true">↺</span>
      </button>
    );
  }

  const { subject, onReset } = props;
  const ask = `delete ${subject}. ${props.consequence ?? GONE}`;

  return (
    <>
      {confirming ? null : (
        <button
          ref={deleteRef}
          type="button"
          className="perch-reset perch-reset--delete"
          aria-label={ask}
          title={ask}
          onClick={() => {
            setConfirming(true);
          }}
        >
          <TrashGlyph />
        </button>
      )}
      <Collapse
        open={confirming}
        appear
        as="span"
        className="perch-reset__unfold"
        focusOnClose={deleteRef}
      >
        <span
          className="perch-reset__confirm"
          role="group"
          aria-label={`delete ${subject}?`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setConfirming(false);
            }
          }}
        >
          <span className="perch-reset__ask">{props.ask ?? 'delete? nothing takes over.'}</span>
          <button
            ref={confirmRef}
            type="button"
            className="perch-reset__word perch-reset__word--delete"
            aria-label={`confirm: ${ask}`}
            title={`confirm: ${ask}`}
            onClick={() => {
              setConfirming(false);
              onReset();
            }}
          >
            delete
          </button>
          <button
            type="button"
            className="perch-reset__word"
            aria-label={`keep ${subject}`}
            title={`keep ${subject}`}
            onClick={() => {
              setConfirming(false);
            }}
          >
            keep
          </button>
        </span>
      </Collapse>
    </>
  );
}

/**
 * The delete glyph: a trash can, stroked in `currentColor` so it is the button's own red, and
 * redrawn crisp at any zoom where a text glyph would be the font's idea of a bin.
 */
function TrashGlyph(): ReactNode {
  return (
    <svg
      className="perch-reset__glyph"
      data-perch-glyph="trash"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.5 4.25h11" />
      <path d="M6 4.25V2.75a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 .75.75v1.5" />
      <path d="M3.75 4.25l.7 8.85a1 1 0 0 0 1 .9h5.1a1 1 0 0 0 1-.9l.7-8.85" />
      <path d="M6.75 7v4.25M9.25 7v4.25" />
    </svg>
  );
}

export const RESET_BUTTON_STYLES = `
.perch-reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: var(--ed-radius);
  background: none;
  font: inherit;
  font-size: 0.8125rem;
  line-height: 1;
  padding: 0;
  cursor: pointer;
}
.perch-reset:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 0; }
.perch-reset--revert { color: var(--ed-accent); }
.perch-reset--revert:hover { background: var(--ed-hover); color: var(--ed-text); }
.perch-reset--delete { color: var(--ed-danger); }
.perch-reset--delete:hover { background: var(--ed-danger-fill); color: #ffc2b4; }
/*
 * The confirm floats over the row's value, right-aligned to the slot, so the row does not reflow; it
 * unfolds from the row's middle, through Collapse, rather than appearing.
 */
.perch-reset__unfold {
  position: absolute;
  right: 0;
  top: 50%;
  z-index: 2;
  transform: translateY(-50%);
}
.perch-reset__glyph { display: block; }
.perch-reset__confirm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 2px 1px 6px;
  border: 1px solid #5e2323;
  border-radius: var(--ed-radius);
  background: #1a0e0e;
  white-space: nowrap;
}
.perch-reset__ask { font-size: var(--ed-font-small); color: var(--ed-danger); }
.perch-reset__word {
  border: 1px solid var(--ed-field-edge);
  border-radius: var(--ed-radius);
  background: var(--ed-bar);
  color: var(--ed-text-2);
  font: inherit;
  font-size: var(--ed-font-small);
  padding: 0 6px;
  height: 16px;
  cursor: pointer;
}
.perch-reset__word--delete { border-color: #5e2323; background: #241010; color: var(--ed-danger); }
.perch-reset__word:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 0; }
`;
