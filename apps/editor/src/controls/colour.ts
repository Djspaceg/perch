/**
 * A colour as text, both ways: the spellings an author types or pastes, read into channels, and the
 * one spelling this editor writes.
 *
 * Every colour field takes alpha, so the control has to read the four ways people carry one — `#rgba`
 * and `#rrggbbaa`, `rgb()`/`rgba()`, `hsl()`/`hsla()`, in the legacy comma syntax and the modern
 * space-and-slash one — and write back one form: hex, six digits when the colour is solid and eight
 * when it is not. Hex because it is what every default in `ui-kit` is written in, what the picker
 * drives, and what a diff of a layout reads most easily; the alpha pair only when it says something.
 *
 * The popover's opacity field is a percentage, because "50%" is a number an author asks for and the
 * picker's alpha strip is for feel; `alphaPercent` and `withAlphaPercent` are the bridge. 8 bits of
 * alpha is what hex holds, so an `rgba(…, 0.55)` is written as the nearest pair, `8c`.
 *
 * Named colours (`red`) and `var()` are not read. Both are legal CSS a layout may hold; the field shows
 * them as they are, and the swatch says it cannot show them.
 */

/** A colour in channels: red, green and blue 0-255 whole, alpha 0-1. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL = /^(rgba?|hsla?)\(([^()]*)\)$/i;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** A hex colour spelled in full: `#abc` is `#aabbcc`, `#abcd` is `#aabbccdd`. */
export function expandHex(hex: string): string {
  const digits = hex.trim().replace(/^#/, '');
  if (digits.length === 3 || digits.length === 4) {
    return `#${digits.replace(/[0-9a-fA-F]/g, (digit) => digit + digit)}`;
  }

  return `#${digits}`;
}

/** `text` as channels, or `undefined` for anything this editor cannot read as a colour. */
export function parseColour(text: string): Rgba | undefined {
  const trimmed = text.trim();
  if (trimmed.toLowerCase() === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (HEX.test(trimmed)) return parseHex(trimmed);

  const match = FUNCTIONAL.exec(trimmed);
  if (match === null) return undefined;
  const parts = splitArguments(match[2] ?? '');
  if (parts === undefined) return undefined;

  return (match[1] ?? '').toLowerCase().startsWith('rgb') ? readRgb(parts) : readHsl(parts);
}

/** Channels as hex: `#rrggbb` when the alpha pair would be `ff`, else `#rrggbbaa`. Lower case. */
export function formatColour(colour: Rgba): string {
  const pair = (value: number): string =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0');
  const alpha = Math.round(Math.min(1, Math.max(0, colour.a)) * 255);

  return `#${pair(colour.r)}${pair(colour.g)}${pair(colour.b)}${alpha === 255 ? '' : pair(alpha)}`;
}

/**
 * What a colour field writes for what was typed into it: hex, once the text is a finished colour
 * that is not already the shortest hex for itself; otherwise exactly what was typed.
 *
 * A finished functional colour (its closing parenthesis typed) and `transparent` become hex, and an
 * eight-digit hex whose alpha is `ff` loses the pair. Every other hex is left as typed: `#abc` is
 * valid, shorter than `#aabbcc`, and rewriting it would jump the caret; `#abcd` may be half of
 * `#abcdef`. So the author can always finish what they started.
 */
export function normaliseTyped(text: string): string {
  const trimmed = text.trim();
  const colour = parseColour(trimmed);
  if (colour === undefined) return text;
  if (FUNCTIONAL.test(trimmed) || trimmed.toLowerCase() === 'transparent') {
    return formatColour(colour);
  }
  if (/^#[0-9a-f]{6}ff$/i.test(trimmed)) return formatColour(colour);

  return text;
}

/** The alpha as a whole percentage. A colour with none, or none this reads, is solid. */
export function alphaPercent(text: string): number {
  const colour = parseColour(text);

  return colour === undefined ? 100 : Math.round(colour.a * 100);
}

/** The same colour with its alpha set from a percentage, clamped to 0-100, written as hex. */
export function withAlphaPercent(text: string, percent: number): string {
  const colour = parseColour(text) ?? { r: 0, g: 0, b: 0, a: 1 };
  const clamped = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 100));

  return formatColour({ ...colour, a: clamped / 100 });
}

function parseHex(hex: string): Rgba {
  const full = expandHex(hex);
  const channel = (at: number): number => Number.parseInt(full.slice(at, at + 2), 16);

  return {
    r: channel(1),
    g: channel(3),
    b: channel(5),
    a: full.length === 9 ? channel(7) / 255 : 1,
  };
}

/**
 * The arguments of `rgb()` or `hsl()`, as three or four strings: `1, 2, 3, 0.5` in the legacy syntax
 * or `1 2 3 / 0.5` in the modern one. `undefined` for any other count.
 */
function splitArguments(inside: string): readonly string[] | undefined {
  const body = inside.trim();
  let parts: string[];
  if (body.includes(',')) {
    parts = body.split(',').map((part) => part.trim());
  } else {
    const [channels = '', alpha, extra] = body.split('/');
    if (extra !== undefined) return undefined;
    parts = channels.trim().split(/\s+/);
    if (alpha !== undefined) parts.push(alpha.trim());
  }
  if (parts.length < 3 || parts.length > 4 || parts.some((part) => part === '')) return undefined;

  return parts;
}

/** A number, or a percentage of `whole`, or `undefined`. */
function amount(text: string, whole: number): number | undefined {
  const percent = text.endsWith('%');
  const digits = percent ? text.slice(0, -1) : text;
  if (!NUMBER.test(digits)) return undefined;
  const value = Number(digits);

  return percent ? (value / 100) * whole : value;
}

/** The alpha argument, or 1 when there is none: a number or a percentage, clamped as CSS clamps it. */
function readAlpha(text: string | undefined): number | undefined {
  if (text === undefined) return 1;
  const value = amount(text, 1);

  return value === undefined ? undefined : Math.min(1, Math.max(0, value));
}

function readRgb(parts: readonly string[]): Rgba | undefined {
  const [red = '', green = '', blue = '', alphaText] = parts;
  const channel = (text: string): number | undefined => {
    const value = amount(text, 255);
    return value === undefined ? undefined : Math.round(Math.min(255, Math.max(0, value)));
  };
  const r = channel(red);
  const g = channel(green);
  const b = channel(blue);
  const a = readAlpha(alphaText);
  if (r === undefined || g === undefined || b === undefined || a === undefined) return undefined;

  return { r, g, b, a };
}

/** A hue in degrees, from a bare number or `deg`, `turn`, `rad` or `grad`. */
function hue(text: string): number | undefined {
  const match = /^(.*?)(deg|turn|rad|grad)?$/i.exec(text);
  const digits = match?.[1] ?? '';
  if (!NUMBER.test(digits)) return undefined;
  const value = Number(digits);
  const unit = (match?.[2] ?? 'deg').toLowerCase();
  const degrees =
    unit === 'turn'
      ? value * 360
      : unit === 'rad'
        ? (value * 180) / Math.PI
        : unit === 'grad'
          ? value * 0.9
          : value;

  return ((degrees % 360) + 360) % 360;
}

function readHsl(parts: readonly string[]): Rgba | undefined {
  const [hueText = '', saturationText = '', lightnessText = '', alphaText] = parts;
  const h = hue(hueText);
  // A saturation or lightness is a percentage, or a bare number read as one (CSS Color 4).
  const fraction = (text: string): number | undefined => {
    const value = amount(text.endsWith('%') ? text : `${text}%`, 1);
    return value === undefined ? undefined : Math.min(1, Math.max(0, value));
  };
  const s = fraction(saturationText);
  const l = fraction(lightnessText);
  const a = readAlpha(alphaText);
  if (h === undefined || s === undefined || l === undefined || a === undefined) return undefined;

  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = h / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r1, g1, b1] =
    sector < 1
      ? [chroma, second, 0]
      : sector < 2
        ? [second, chroma, 0]
        : sector < 3
          ? [0, chroma, second]
          : sector < 4
            ? [0, second, chroma]
            : sector < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const lift = l - chroma / 2;
  const channel = (value: number): number => Math.round((value + lift) * 255);

  return { r: channel(r1), g: channel(g1), b: channel(b1), a };
}
