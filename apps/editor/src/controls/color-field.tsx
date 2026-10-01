/**
 * ColorField: a slim swatch that opens the picker in a popover, then the colour as a text field. The
 * one colour control: every colour token, on the theme and on an element, is drawn with it.
 *
 * Colour first, notation second, as the pane has always ordered it. The picker does not sit open in
 * the list: it opens on demand, anchored to its swatch and placed to stay on screen (`popover.ts`),
 * and closes on Escape — focus back to the swatch — on a press anywhere outside it, or on the swatch
 * again; that behaviour is `usePopover`'s, shared with the sensor picker.
 *
 * Every colour takes alpha. The picker is react-colorful's hex-and-alpha one, whose alpha strip is
 * the slider, and the popover carries an opacity field in percent beside it, because a strip is for
 * feel and "50%" is a number. The text field takes any spelling `colour.ts` reads — `#rgba`,
 * `#rrggbbaa`, `rgb()`, `hsl()`, typed or pasted — and a finished functional colour is written as hex
 * (`normaliseTyped`). Text it cannot read as a colour (`var(--x)`, a name, half of `rgb(`) is kept as
 * typed, in the same field, and the swatch says it has no colour to show rather than the control
 * turning into another one under the caret.
 *
 * The popover is rendered in place, `position: fixed`, rather than portalled: it stays next to its
 * swatch in the reading order, and the inspector has no transformed ancestor to trap a fixed box.
 */

import { useRef, type ReactNode } from 'react';
import { HexAlphaColorPicker } from 'react-colorful';
import {
  alphaPercent,
  formatColour,
  normaliseTyped,
  parseColour,
  withAlphaPercent,
} from './colour.js';
import { NumberField } from './number-field.js';
import { usePopover } from './popover.js';

/** The checkerboard a swatch's colour is laid over. */
const CHECKERBOARD =
  'repeating-conic-gradient(var(--ed-checker-light) 0 25%, var(--ed-checker-dark) 0 50%) 0 0 / 8px 8px';

/**
 * A swatch's fill: the colour over a checkerboard, because a translucent swatch over the pane's own
 * dark grey is indistinguishable from an opaque darker colour — and the alpha is exactly what the
 * author is looking at the swatch to judge. Every colour, since every colour may carry alpha. Text that
 * is not a colour gets a struck-through empty swatch instead.
 */
export function swatchStyle(value: string): { background: string } {
  const colour = parseColour(value);
  if (colour === undefined) {
    return {
      background: `linear-gradient(to top right, transparent calc(50% - 1px), var(--ed-danger) 50%, transparent calc(50% + 1px)), var(--ed-popover)`,
    };
  }
  const hex = formatColour(colour);

  return { background: `linear-gradient(${hex}, ${hex}), ${CHECKERBOARD}` };
}

export function ColorField({
  id,
  label,
  value,
  onValue,
  describedBy,
}: {
  /** The text input's id, which the row's label points at. */
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onValue: (value: string) => void;
  readonly describedBy?: string | undefined;
}): ReactNode {
  const swatch = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const popover = usePopover(swatch, box);
  const { open, close } = popover;
  const colour = parseColour(value);
  // The picker drives hex; the text field keeps whatever spelling the document holds.
  const hex = colour === undefined ? '#000000' : formatColour(colour);
  const verb = open ? 'close' : 'open';

  return (
    <span className="perch-color">
      <button
        ref={swatch}
        type="button"
        className="perch-color__swatch"
        data-testid="perch-editor-swatch"
        aria-label={`${verb} colour picker for ${label}`}
        data-perch-tip={`${verb} colour picker for ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        {...(open ? { 'aria-controls': popover.id } : {})}
        {...(colour === undefined ? { 'data-perch-colour': 'none' } : {})}
        disabled={colour === undefined && !open}
        style={swatchStyle(value)}
        onClick={() => {
          if (open) close(false);
          else popover.setOpen(true);
        }}
      />
      <input
        id={id}
        className="perch-input perch-input--mono perch-color__hex"
        aria-label={label}
        type="text"
        spellCheck={false}
        autoComplete="off"
        value={value}
        {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
        onChange={(event) => {
          onValue(normaliseTyped(event.target.value));
        }}
      />
      {open ? (
        <div
          ref={box}
          id={popover.id}
          className="perch-popover"
          role="dialog"
          aria-label={`${label} colour`}
          style={popover.style}
        >
          <HexAlphaColorPicker
            className="perch-popover__picker"
            color={hex}
            onChange={(next) => {
              onValue(normaliseTyped(next));
            }}
          />
          <div className="perch-popover__foot">
            <span className="perch-popover__hex">{hex}</span>
            <NumberField
              label="opacity"
              value={String(alphaPercent(value))}
              min={0}
              max={100}
              step={1}
              unit="%"
              bar
              onChange={(text) => {
                const percent = text.trim() === '' ? Number.NaN : Number(text);
                if (Number.isFinite(percent)) onValue(withAlphaPercent(value, percent));
              }}
            />
          </div>
        </div>
      ) : null}
    </span>
  );
}

export const COLOR_FIELD_STYLES = `
.perch-color { flex: 1 1 auto; display: flex; align-items: center; gap: var(--ed-gap); min-width: 0; }
.perch-color__swatch {
  flex: 1 1 auto;
  min-width: 28px;
  height: var(--ed-field-h);
  box-sizing: border-box;
  border: 1px solid var(--ed-swatch-edge);
  border-radius: var(--ed-radius);
  padding: 0;
  cursor: pointer;
}
.perch-color__swatch:hover { border-color: var(--ed-faint); }
.perch-color__swatch:disabled { cursor: default; border-color: var(--ed-swatch-edge); }
.perch-color__swatch[aria-expanded='true'] { border-color: var(--ed-accent); }
.perch-color__swatch:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 0; }
.perch-color__hex { flex: 0 0 78px; }
.perch-popover {
  position: fixed;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 208px;
  padding: 8px;
  border: 1px solid var(--ed-field-edge-hover);
  border-radius: 4px;
  background: var(--ed-popover);
  box-shadow: 0 8px 24px var(--ed-popover-shadow);
}
.perch-popover .perch-popover__picker { width: 100%; height: 132px; }
.perch-popover .react-colorful__saturation { border-radius: 3px 3px 0 0; }
.perch-popover .react-colorful__last-control { border-radius: 0 0 3px 3px; }
.perch-popover .react-colorful__hue, .perch-popover .react-colorful__alpha { height: max(12px, var(--ed-target)); }
.perch-popover .react-colorful__pointer { width: max(14px, var(--ed-target)); height: max(14px, var(--ed-target)); }
.perch-popover__foot { display: flex; align-items: center; gap: 6px; }
.perch-popover__hex { flex: 1 1 auto; font-family: var(--ed-mono); font-size: var(--ed-font-small); color: var(--ed-text-2); }
.perch-popover__foot .perch-number { flex: 0 0 108px; }
`;
