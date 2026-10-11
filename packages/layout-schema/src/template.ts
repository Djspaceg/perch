/**
 * Text templates: a text element's `text`, with live values and the clock written into it.
 *
 * ```text
 * CPU {sensors/cpu/0/temperature/0} · fan {sensors/cooler/0/fan/0 | fixed:0 || Dunno!}
 * {weekday}, {date:long} {time}
 * ```
 *
 * ## The grammar
 *
 * - Outside braces, everything is literal, and `{{` and `}}` are a literal brace. A lone `}` is an
 *   error rather than a guess, so a stray brace is shown to the author instead of painted.
 * - `{sensors/...}` is a sensor: its value and unit, `61.5 °C`. Braces rather than a `$` prefix
 *   because a topic has `/` and digits in it and so no natural end; a closing brace is one.
 * - After the topic, `| filter` changes what is shown: `fixed:N` decimals, `value` (no unit),
 *   `unit` (the unit alone), `label` (the sensor's name). An unknown filter is an error, never text,
 *   so a typo cannot paint itself onto the panel.
 * - `|| text` is what the sensor shows while there is no reading to believe (nothing heard yet, or
 *   stale): everything after `||` up to the closing brace, trimmed, with `}}` for a literal `}`.
 *   `--` without one, as a readout says. `{... ||}` shows nothing.
 * - Any other name is the clock: `{time}`, `{date:long}`, `{weekday:short}`. Named fields formatted
 *   by `Intl.DateTimeFormat` in the layout's `locale` and `timeZone`, rather than pattern letters
 *   (`MMM`, `mm`): a pattern fixes field order and the 12/24-hour choice, which is exactly what a
 *   locale decides, and its letters mean different things in every library that has them.
 *
 * This file parses and checks the grammar, and nothing else: which topics exist is the injected
 * topic validator's to say (`layout.ts`), and formatting is the renderer's (`ui-kit`), which reads
 * the parts from `parseTextTemplate` so the two cannot disagree about what a template says.
 */

/** Where a sensor placeholder starts. Every topic does; nothing else may. */
const SENSOR_PREFIX = 'sensors/';

/** What a sensor shows when there is no reading to believe, unless the template says otherwise. */
export const TEMPLATE_DEFAULT_FALLBACK = '--';

/** Most decimals `fixed:N` may ask for. More is noise at any precision a sensor reports. */
export const TEMPLATE_MAX_DECIMALS = 6;

/**
 * Each clock token, and the variants it takes after a `:`; the first is what the bare token means.
 * Formatting is `ui-kit`'s (`text-template.tsx`), keyed by this same table.
 */
export const CLOCK_TOKENS = Object.freeze({
  /** The time of day, in the locale's hour cycle: `3:42 PM`, `15:42`. */
  time: ['short', 'seconds'],
  /** The date: `10/10/2026`, `Oct 10, 2026`, `October 10, 2026`, `Saturday, October 10, 2026`. */
  date: ['short', 'medium', 'long', 'full'],
  weekday: ['long', 'short', 'narrow'],
  month: ['long', 'short', 'narrow', 'numeric'],
  day: ['numeric', '2-digit'],
  year: ['numeric', '2-digit'],
  /** The hour alone, in the locale's hour cycle. */
  hour: ['numeric', '2-digit'],
  minute: ['2-digit'],
  second: ['2-digit'],
  /** AM or PM, in the locale's words; empty where the locale's clock has none. */
  dayperiod: ['short'],
} as const satisfies Readonly<Record<string, readonly string[]>>);

export type ClockToken = keyof typeof CLOCK_TOKENS;
export type ClockVariant<T extends ClockToken = ClockToken> = (typeof CLOCK_TOKENS)[T][number];

/** What a `|` filter does to a sensor placeholder. */
export type TemplateFilter =
  | { readonly name: 'fixed'; readonly places: number }
  | { readonly name: 'value' }
  | { readonly name: 'unit' }
  | { readonly name: 'label' };

/** The filter names, for the editor's suggestions and the error message. */
export const TEMPLATE_FILTERS = Object.freeze(['fixed', 'value', 'unit', 'label'] as const);

/** One piece of a parsed template, in order. */
export type TemplatePart =
  | { readonly kind: 'literal'; readonly text: string }
  | {
      readonly kind: 'sensor';
      /** As written: the authored shorthand is allowed, as in a widget's `topic`. */
      readonly topic: string;
      readonly filters: readonly TemplateFilter[];
      /** What shows with no reading to believe: `TEMPLATE_DEFAULT_FALLBACK` unless `||` said. */
      readonly fallback: string;
    }
  | {
      readonly kind: 'clock';
      readonly token: ClockToken;
      readonly variant: ClockVariant;
    };

/** Why a template is not one: what, and at which character of the text. */
export interface TemplateError {
  readonly offset: number;
  readonly message: string;
}

export type ParseTemplateResult =
  | { readonly ok: true; readonly parts: readonly TemplatePart[] }
  | { readonly ok: false; readonly error: TemplateError };

/** Whether a template has any placeholder at all, or is a plain caption. */
export function isPlainTemplate(parts: readonly TemplatePart[]): boolean {
  return parts.every((part) => part.kind === 'literal');
}

/** Whether `text` holds any clock token: what tells a renderer it has to tick. */
export function templateHasClock(parts: readonly TemplatePart[]): boolean {
  return parts.some((part) => part.kind === 'clock');
}

/** A literal string as a template that says exactly it: each brace doubled. */
export function escapeTemplateText(text: string): string {
  return text.replace(/[{}]/g, (brace) => brace + brace);
}

/** Parse a template. Total: every string is either parts or one error naming where. */
export function parseTextTemplate(text: string): ParseTemplateResult {
  const parts: TemplatePart[] = [];
  let literal = '';
  let index = 0;

  const flush = (): void => {
    if (literal !== '') parts.push({ kind: 'literal', text: literal });
    literal = '';
  };

  while (index < text.length) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if (char === '{' && next === '{') {
      literal += '{';
      index += 2;
      continue;
    }
    if (char === '}' && next === '}') {
      literal += '}';
      index += 2;
      continue;
    }
    if (char === '}') {
      return fail(index, 'a "}" with no "{" before it; write "}}" for a literal brace');
    }
    if (char !== '{') {
      literal += char;
      index += 1;
      continue;
    }

    const placeholder = readPlaceholder(text, index);
    if (!placeholder.ok) return placeholder;
    const part = parsePlaceholder(placeholder.head, placeholder.fallback, index);
    if ('message' in part) return { ok: false, error: part };
    flush();
    parts.push(part);
    index = placeholder.end;
  }

  flush();
  return { ok: true, parts };
}

/**
 * The placeholder opening at `start`: its head (before any `||`), its fallback, and the index after
 * its closing brace. The head ends at the first `}` or `||`; a fallback ends at a single `}`, with
 * `}}` inside it a literal brace.
 */
function readPlaceholder(
  text: string,
  start: number,
):
  | {
      readonly ok: true;
      readonly head: string;
      readonly fallback: string | null;
      readonly end: number;
    }
  | { readonly ok: false; readonly error: TemplateError } {
  let index = start + 1;
  let head = '';
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '}') return { ok: true, head, fallback: null, end: index + 1 };
    if (char === '{') {
      return fail(index, 'a "{" inside a placeholder; close the one before it with "}"');
    }
    if (char === '|' && text.charAt(index + 1) === '|') {
      index += 2;
      let fallback = '';
      while (index < text.length) {
        const inner = text.charAt(index);
        if (inner === '}' && text.charAt(index + 1) === '}') {
          fallback += '}';
          index += 2;
          continue;
        }
        if (inner === '}') return { ok: true, head, fallback: fallback.trim(), end: index + 1 };
        fallback += inner;
        index += 1;
      }
      break;
    }
    head += char;
    index += 1;
  }

  return fail(
    start,
    'a "{" that is never closed; end the placeholder with "}", or write "{{" for a literal brace',
  );
}

function parsePlaceholder(
  head: string,
  fallback: string | null,
  at: number,
): TemplatePart | TemplateError {
  const [rawKey = '', ...rawFilters] = head.split('|');
  const key = rawKey.trim();
  if (key === '')
    return {
      offset: at,
      message: 'an empty placeholder; put a sensor topic or a clock token between the braces',
    };

  if (key.startsWith(SENSOR_PREFIX)) {
    const filters: TemplateFilter[] = [];
    for (const raw of rawFilters) {
      const filter = parseFilter(raw.trim(), at);
      if ('message' in filter) return filter;
      filters.push(filter);
    }
    const shows = filters.filter((filter) => filter.name !== 'fixed');
    if (shows.length > 1) {
      return {
        offset: at,
        message: `"${shows.map((filter) => filter.name).join('" and "')}" each say what to show; use one`,
      };
    }
    if (filters.filter((filter) => filter.name === 'fixed').length > 1) {
      return { offset: at, message: 'more than one "fixed"; use one' };
    }
    return {
      kind: 'sensor',
      topic: key,
      filters,
      fallback: fallback ?? TEMPLATE_DEFAULT_FALLBACK,
    };
  }

  if (rawFilters.length > 0) {
    return {
      offset: at,
      message: `"${key}" is a clock token, which takes no filters; filters are for sensors`,
    };
  }
  if (fallback !== null) {
    return {
      offset: at,
      message: `"${key}" is a clock token, which always has a value, so "||" would never show`,
    };
  }
  const [name = '', variant, ...extra] = key.split(':');
  if (!isClockToken(name)) {
    return {
      offset: at,
      message: `unknown token "${key}"; a placeholder is a topic starting "sensors/" or one of ${Object.keys(CLOCK_TOKENS).join(', ')}`,
    };
  }
  const variants: readonly string[] = CLOCK_TOKENS[name];
  const chosen = variant ?? variants[0] ?? '';
  if (extra.length > 0 || !variants.includes(chosen)) {
    return {
      offset: at,
      message: `"${name}" takes ${variants.map((option) => `${name}:${option}`).join(', ')}, not "${key}"`,
    };
  }

  return { kind: 'clock', token: name, variant: chosen as ClockVariant };
}

function parseFilter(raw: string, at: number): TemplateFilter | TemplateError {
  if (raw === 'value' || raw === 'unit' || raw === 'label') return { name: raw };
  const fixed = /^fixed:(\d+)$/.exec(raw);
  if (fixed !== null) {
    const places = Number(fixed[1]);
    return places <= TEMPLATE_MAX_DECIMALS
      ? { name: 'fixed', places }
      : {
          offset: at,
          message: `"fixed" takes 0 to ${TEMPLATE_MAX_DECIMALS} decimals, got ${places}`,
        };
  }
  if (raw === '')
    return { offset: at, message: 'an empty filter after "|"; for a fallback, write "||"' };

  return {
    offset: at,
    message: `unknown filter "${raw}"; filters are ${TEMPLATE_FILTERS.map((name) => (name === 'fixed' ? 'fixed:N' : name)).join(', ')}, and a fallback follows "||"`,
  };
}

function isClockToken(name: string): name is ClockToken {
  return Object.hasOwn(CLOCK_TOKENS, name);
}

function fail(
  offset: number,
  message: string,
): { readonly ok: false; readonly error: TemplateError } {
  return { ok: false, error: { offset, message } };
}
