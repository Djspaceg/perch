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
 * ## Annotations: the readout's rows, in a template
 *
 * Three more filters do what only a sensor placeholder can, since they depend on the reading:
 * `fit` paints it as a readout's number row (the value sized to the box, its unit small and dim
 * after it), `hold` keeps the last value while stale, and `note` says what a readout's note row
 * says (`waiting`, `stale 8s`). And `{#name}...{/name}` is a style span: every part inside it looks
 * like that row of a readout, by the same theme tokens. The names are closed (`TEMPLATE_STYLES`),
 * so a typo is refused, and they are names rather than CSS so a theme restyles every run.
 *
 * Both live inside the braces: `{#` and `{/` were refused before spans existed, so no caption that
 * was valid changes meaning, and `{{` stays the one escape. Spans nest and close in order, as
 * Handlebars blocks and MessageFormat 2 markup (the same spelling) do. A part carries the spans it
 * sits in as `styles`, outermost first, and only when there are any, so the parts of an unstyled
 * template are exactly what they were. `docs/template-annotations.md` has the survey behind this.
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
  | { readonly name: 'label' }
  /** The readout's note: `waiting`, `no reading`, `stale 8s`, or nothing while live. */
  | { readonly name: 'note' }
  /** The readout's number row: the value sized to the box, its unit small and dim after it. */
  | { readonly name: 'fit' }
  /** The last value while stale, rather than the fallback, which then shows only before the first. */
  | { readonly name: 'hold' };

/** The filter names, for the editor's suggestions and the error message. */
export const TEMPLATE_FILTERS = Object.freeze([
  'fixed',
  'value',
  'unit',
  'label',
  'note',
  'fit',
  'hold',
] as const);

/** The filters that say what a sensor shows instead of its value and unit. One at most. */
const SHOW_FILTERS: ReadonlySet<string> = new Set(['value', 'unit', 'label', 'note']);

/**
 * The style spans, one per row of a readout, each painted with that row's theme tokens (`ui-kit`'s
 * `text-block.tsx`): its caption, its unit, its number at full size, its note.
 */
export const TEMPLATE_STYLES = Object.freeze(['label', 'unit', 'value', 'note'] as const);

export type TemplateStyle = (typeof TEMPLATE_STYLES)[number];

/** The spans a part sits in, outermost first. Absent outside every span. */
interface Styled {
  readonly styles?: readonly TemplateStyle[];
}

/** One piece of a parsed template, in order. */
export type TemplatePart = (
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
    }
) &
  Styled;

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
  return parts.every((part) => part.kind === 'literal' && part.styles === undefined);
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
  /** The open spans, innermost last, and where each opened. */
  const open: { readonly style: TemplateStyle; readonly at: number }[] = [];
  let literal = '';
  let index = 0;

  const styled = <T extends TemplatePart>(part: T): T =>
    open.length === 0 ? part : { ...part, styles: open.map((span) => span.style) };
  const flush = (): void => {
    if (literal !== '') parts.push(styled({ kind: 'literal', text: literal }));
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
    const tag = placeholder.head.trim();
    if (tag.startsWith('#') || tag.startsWith('/')) {
      const span = parseTag(tag, placeholder.fallback, index);
      if ('message' in span) return { ok: false, error: span };
      flush();
      if (span.opens) {
        open.push({ style: span.style, at: index });
      } else {
        const innermost = open.at(-1);
        if (innermost === undefined) {
          return fail(index, `"{/${span.style}}" closes a span, but nothing is open`);
        }
        if (innermost.style !== span.style) {
          return fail(
            index,
            `"{/${span.style}}" closes "${span.style}", but "${innermost.style}" is open inside it; close "${innermost.style}" first with "{/${innermost.style}}"`,
          );
        }
        open.pop();
      }
      index = placeholder.end;
      continue;
    }
    const part = parsePlaceholder(placeholder.head, placeholder.fallback, index);
    if ('message' in part) return { ok: false, error: part };
    flush();
    parts.push(styled(part));
    index = placeholder.end;
  }

  flush();
  const unclosed = open.at(-1);
  if (unclosed !== undefined) {
    return fail(
      unclosed.at,
      `"{#${unclosed.style}}" is never closed; end the span with "{/${unclosed.style}}"`,
    );
  }
  return { ok: true, parts };
}

/** Where each placeholder in `text` is, as the editor needs to add a filter to the one at the caret. */
export interface TemplatePlaceholder {
  /** The index of its `{`. */
  readonly start: number;
  /** The index after its `}`. */
  readonly end: number;
  /** What is between the braces up to any `||`, as written. */
  readonly head: string;
  /** The index where the head ends: at the `||`, or at the closing `}`. */
  readonly headEnd: number;
}

/**
 * Every placeholder and span tag in `text`, in order, by the tokenizer `parseTextTemplate` uses, so
 * the two agree on where one ends. Stops at the first brace that does not tokenize, keeping those
 * before it: a template being typed is often half a placeholder long.
 */
export function templatePlaceholders(text: string): readonly TemplatePlaceholder[] {
  const found: TemplatePlaceholder[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if ((char === '{' || char === '}') && next === char) {
      index += 2;
      continue;
    }
    if (char === '}') break;
    if (char !== '{') {
      index += 1;
      continue;
    }
    const placeholder = readPlaceholder(text, index);
    if (!placeholder.ok) break;
    found.push({
      start: index,
      end: placeholder.end,
      head: placeholder.head,
      headEnd: index + 1 + placeholder.head.length,
    });
    index = placeholder.end;
  }
  return found;
}

/** A span tag, `#name` or `/name`, trimmed. */
function parseTag(
  tag: string,
  fallback: string | null,
  at: number,
): { readonly opens: boolean; readonly style: TemplateStyle } | TemplateError {
  const opens = tag.startsWith('#');
  const name = tag.slice(1).trim();
  if (fallback !== null) {
    return {
      offset: at,
      message: `"{${tag}}" is a style span, which takes no "||"; a fallback is for a sensor`,
    };
  }
  if (name === '') {
    return {
      offset: at,
      message: `a style name after "${opens ? '#' : '/'}"; styles are ${TEMPLATE_STYLES.join(', ')}`,
    };
  }
  if (!isTemplateStyle(name)) {
    return {
      offset: at,
      message: `unknown style "${name}"; styles are ${TEMPLATE_STYLES.join(', ')}`,
    };
  }
  return { opens, style: name };
}

function isTemplateStyle(name: string): name is TemplateStyle {
  return (TEMPLATE_STYLES as readonly string[]).includes(name);
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
    const shows = filters.filter((filter) => SHOW_FILTERS.has(filter.name));
    if (shows.length > 1) {
      return {
        offset: at,
        message: `"${shows.map((filter) => filter.name).join('" and "')}" each say what to show; use one`,
      };
    }
    for (const once of ['fixed', 'fit', 'hold'] as const) {
      if (filters.filter((filter) => filter.name === once).length > 1) {
        return { offset: at, message: `more than one "${once}"; use one` };
      }
    }
    const show = shows[0]?.name;
    if (show !== undefined && show !== 'value') {
      if (filters.some((filter) => filter.name === 'fit')) {
        return {
          offset: at,
          message: `"fit" sizes a reading to its box, so it cannot go with "${show}"`,
        };
      }
      if (filters.some((filter) => filter.name === 'hold')) {
        return {
          offset: at,
          message: `"hold" keeps a reading while it is stale, so it cannot go with "${show}"`,
        };
      }
    }
    if (show === 'note') {
      if (filters.some((filter) => filter.name === 'fixed')) {
        return { offset: at, message: '"fixed" is for a value, and a note is words' };
      }
      if (fallback !== null) {
        return {
          offset: at,
          message: '"note" always says something, so "||" would never show',
        };
      }
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
  if (
    raw === 'value' ||
    raw === 'unit' ||
    raw === 'label' ||
    raw === 'note' ||
    raw === 'fit' ||
    raw === 'hold'
  ) {
    return { name: raw };
  }
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
