/**
 * Alpha as a percentage, for the colour popover's opacity field.
 *
 * The document holds `#rrggbbaa`; an author asks for "50%". The picker's own alpha strip is fine for
 * feel but cannot land on an exact value, so the popover carries a numeric field as well, and these
 * two functions are the whole bridge between it and the hex. Only called on values `isHexColor` in
 * `token-pane.tsx` has already accepted.
 */

/** A hex colour spelled in full: `#abc` is `#aabbcc`, `#abcd` is `#aabbccdd`. */
export function expandHex(hex: string): string {
  const digits = hex.trim().replace(/^#/, '');
  if (digits.length === 3 || digits.length === 4) {
    return `#${digits.replace(/[0-9a-fA-F]/g, (digit) => digit + digit)}`;
  }

  return `#${digits}`;
}

/** The alpha pair as a whole percentage. A colour without one is solid. */
export function alphaPercent(hex: string): number {
  const full = expandHex(hex);
  if (full.length !== 9) return 100;

  return Math.round((Number.parseInt(full.slice(7, 9), 16) / 255) * 100);
}

/** The same colour with its alpha pair set from a percentage, clamped to 0-100. */
export function withAlphaPercent(hex: string, percent: number): string {
  const rgb = expandHex(hex).slice(0, 7);
  const clamped = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 100));
  const pair = Math.round((clamped / 100) * 255)
    .toString(16)
    .padStart(2, '0');

  return `${rgb}${pair}`;
}
