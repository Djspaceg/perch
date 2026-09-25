/**
 * ResetButton: the one control that undoes a value, in the two shapes its two consequences need.
 *
 * - **`reset` / `remove`** — `↺` — where something underneath takes over: the layout theme's value
 *   first, else the ui-kit default. The accessible name, which is also the tooltip, names that value
 *   and where it comes from, because "what do I get back" is the whole question before pressing it.
 *   `reset` is the Customize phrasing (a token by its label); `remove` is the Developer phrasing (a
 *   raw name, and "this layout's value" going rather than the token going).
 * - **`delete`** — `✕`, in red — where nothing takes over: a name `ui-kit` does not declare. It asks
 *   first, inline, naming what it will delete; Escape or `keep` backs out. There is no undo in this
 *   editor, so the second click is what carries the deliberateness the word `delete` used to.
 *
 * A different glyph, colour, accessible name and number of clicks — never colour alone. The glyph is
 * `aria-hidden`; the sentence is what a screen reader reads.
 */

import { useState, type ReactNode } from 'react';

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
    };

export function ResetButton(props: ResetButtonProps): ReactNode {
  const [confirming, setConfirming] = useState(false);

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
  const ask = `delete ${subject}. ${GONE}`;

  if (!confirming) {
    return (
      <button
        type="button"
        className="perch-reset perch-reset--delete"
        aria-label={ask}
        title={ask}
        onClick={() => {
          setConfirming(true);
        }}
      >
        <span aria-hidden="true">✕</span>
      </button>
    );
  }

  return (
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
      <span className="perch-reset__ask">delete? nothing takes over.</span>
      <button
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
/* The confirm floats over the row's value, right-aligned to the slot, so the row does not reflow. */
.perch-reset__confirm {
  position: absolute;
  right: 0;
  top: 50%;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 2px 1px 6px;
  border: 1px solid #5e2323;
  border-radius: var(--ed-radius);
  background: #1a0e0e;
  transform: translateY(-50%);
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
