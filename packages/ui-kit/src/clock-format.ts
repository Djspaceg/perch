/**
 * A text template's clock tokens, as words: `Intl.DateTimeFormat` in the layout's locale and time
 * zone, never a pattern of letters, so the order of fields and the 12- or 24-hour clock are the
 * locale's to decide (`layout-schema`'s `template.ts` has the why).
 *
 * Pure: the instant is an argument, so a test or a capture says exactly which time it shows.
 * Formatters are cached by locale, zone and token, since a ticking clock asks once a second and
 * building an `Intl.DateTimeFormat` is the expensive part.
 */

import type { ClockToken, ClockVariant } from '@perch/layout-schema';

type Options = Intl.DateTimeFormatOptions;

/** How each token is formatted: the whole string, or one part picked out of a fuller format. */
interface ClockFormat {
  readonly options: Options;
  /** Pick this part of `formatToParts`: a lone `minute` drops its zero in some engines. */
  readonly part?: Intl.DateTimeFormatPartTypes;
}

const TIME: Options = { hour: 'numeric', minute: '2-digit' };

function formatFor(token: ClockToken, variant: ClockVariant): ClockFormat {
  switch (token) {
    case 'time':
      return { options: variant === 'seconds' ? { ...TIME, second: '2-digit' } : TIME };
    case 'date':
      return {
        options:
          variant === 'short'
            ? { year: 'numeric', month: 'numeric', day: 'numeric' }
            : { dateStyle: variant as 'medium' | 'long' | 'full' },
      };
    case 'weekday':
      return { options: { weekday: variant as 'long' | 'short' | 'narrow' } };
    case 'month':
      return { options: { month: variant as 'long' | 'short' | 'narrow' | 'numeric' } };
    case 'day':
      return { options: { day: variant as 'numeric' | '2-digit' }, part: 'day' };
    case 'year':
      return { options: { year: variant as 'numeric' | '2-digit' }, part: 'year' };
    case 'hour':
      return { options: { ...TIME, hour: variant as 'numeric' | '2-digit' }, part: 'hour' };
    case 'minute':
      return { options: TIME, part: 'minute' };
    case 'second':
      return { options: { ...TIME, second: '2-digit' }, part: 'second' };
    case 'dayperiod':
      return { options: { hour: 'numeric' }, part: 'dayPeriod' };
  }
}

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(
  options: Options,
  locale: string | undefined,
  timeZone: string | undefined,
): Intl.DateTimeFormat {
  const key = JSON.stringify([locale, timeZone, options]);
  let found = cache.get(key);
  if (found === undefined) {
    const zoned = timeZone === undefined ? options : { ...options, timeZone };
    try {
      found = new Intl.DateTimeFormat(locale, zoned);
    } catch {
      // Validated at load, so only a host whose `Intl` lacks the locale or zone gets here: its own.
      found = new Intl.DateTimeFormat(undefined, options);
    }
    cache.set(key, found);
  }
  return found;
}

/** One clock token at `at`, in `locale` and `timeZone` (each the host's own when undefined). */
export function formatClockToken(
  token: ClockToken,
  variant: ClockVariant,
  at: Date | number,
  locale?: string,
  timeZone?: string,
): string {
  const { options, part } = formatFor(token, variant);
  const format = formatter(options, locale, timeZone);
  if (part === undefined) return format.format(at);

  return format.formatToParts(at).find((piece) => piece.type === part)?.value ?? '';
}

/** How often a clock showing `token` needs repainting, in milliseconds: each second, or minute. */
export function clockGranularityMs(token: ClockToken, variant: ClockVariant): number {
  return token === 'second' || (token === 'time' && variant === 'seconds') ? 1_000 : 60_000;
}
