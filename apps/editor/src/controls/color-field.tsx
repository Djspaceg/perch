/**
 * ColorField: a slim swatch that opens the picker in a popover, then the hex literal as a text field.
 *
 * Colour first, notation second, as the pane has always ordered it. The picker does not sit open in
 * the list: it opens on demand, anchored to its swatch and placed to stay on screen (`popover.ts`),
 * and closes on Escape — focus back to the swatch — on a press anywhere outside it, or on the swatch
 * again. For a colour that takes alpha, the popover carries an opacity field in percent beside the
 * picker's alpha strip, because a strip is for feel and "50%" is a number.
 *
 * The popover is rendered in place, `position: fixed`, rather than portalled: it stays next to its
 * swatch in the reading order, and the inspector has no transformed ancestor to trap a fixed box.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { HexAlphaColorPicker, HexColorPicker } from 'react-colorful';
import { alphaPercent, withAlphaPercent } from './colour.js';
import { NumberField } from './number-field.js';
import { placePopover } from './popover.js';

/**
 * A swatch's fill. An alpha colour is laid over a checkerboard, because a translucent swatch over the
 * pane's own dark grey is indistinguishable from an opaque darker colour — and the alpha is exactly
 * what the author is looking at the swatch to judge.
 */
export function swatchStyle(value: string, alpha: boolean): { background: string } {
  const colour = value.trim();

  return {
    background: alpha
      ? `linear-gradient(${colour}, ${colour}), repeating-conic-gradient(#6b7889 0 25%, #262c36 0 50%) 0 0 / 8px 8px`
      : colour,
  };
}

export function ColorField({
  id,
  label,
  value,
  alpha,
  onValue,
  describedBy,
}: {
  /** The hex input's id, which the row's label points at. */
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly alpha: boolean;
  readonly onValue: (value: string) => void;
  readonly describedBy?: string | undefined;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const swatch = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const Picker = alpha ? HexAlphaColorPicker : HexColorPicker;
  const verb = open ? 'close' : 'open';

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setPosition(null);
    if (refocus) swatch.current?.focus();
  }, []);

  // Placed against the swatch, and kept there while the page scrolls or resizes.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = (): void => {
      const anchor = swatch.current?.getBoundingClientRect();
      const box = popover.current?.getBoundingClientRect();
      if (anchor === undefined || box === undefined) return;
      setPosition(
        placePopover(
          anchor,
          { width: box.width, height: box.height },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);

    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Dismissal: Escape anywhere, or a press outside both the popover and its swatch.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    };
    const onPress = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popover.current?.contains(target) === true || swatch.current?.contains(target) === true) {
        return;
      }
      close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress, true);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress, true);
    };
  }, [open, close]);

  // Opened, focus goes in: a keyboard user pressed Enter on the swatch in order to use the picker.
  useEffect(() => {
    if (!open) return;
    popover.current?.querySelector<HTMLElement>('[tabindex="0"], input, button')?.focus();
  }, [open]);

  return (
    <span className="perch-color">
      <button
        ref={swatch}
        type="button"
        className="perch-color__swatch"
        data-testid="perch-editor-swatch"
        aria-label={`${verb} colour picker for ${label}`}
        title={`${verb} colour picker for ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        {...(open ? { 'aria-controls': popoverId } : {})}
        style={swatchStyle(value, alpha)}
        onClick={() => {
          if (open) close(false);
          else setOpen(true);
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
          onValue(event.target.value);
        }}
      />
      {open ? (
        <div
          ref={popover}
          id={popoverId}
          className="perch-popover"
          role="dialog"
          aria-label={`${label} colour`}
          style={
            position === null
              ? { top: 0, left: 0, visibility: 'hidden' }
              : { top: position.top, left: position.left }
          }
        >
          <Picker className="perch-popover__picker" color={value.trim()} onChange={onValue} />
          <div className="perch-popover__foot">
            <span className="perch-popover__hex">{value.trim()}</span>
            {alpha ? (
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
            ) : null}
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
  border: 1px solid #2a303b;
  border-radius: var(--ed-radius);
  padding: 0;
  cursor: pointer;
}
.perch-color__swatch:hover { border-color: var(--ed-faint); }
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
  background: #151920;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
}
.perch-popover .perch-popover__picker { width: 100%; height: 132px; }
.perch-popover .react-colorful__saturation { border-radius: 3px 3px 0 0; }
.perch-popover .react-colorful__last-control { border-radius: 0 0 3px 3px; }
.perch-popover .react-colorful__hue, .perch-popover .react-colorful__alpha { height: 12px; }
.perch-popover .react-colorful__pointer { width: 14px; height: 14px; }
.perch-popover__foot { display: flex; align-items: center; gap: 6px; }
.perch-popover__hex { flex: 1 1 auto; font-family: var(--ed-mono); font-size: var(--ed-font-small); color: var(--ed-text-2); }
.perch-popover__foot .perch-number { flex: 0 0 108px; }
`;
