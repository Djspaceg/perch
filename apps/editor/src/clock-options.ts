/**
 * What the layout clock's two dropdowns offer: a locale, and a time zone.
 *
 * Both start with "System default", which is no field at all: the panel writes the clock in its own
 * locale and zone. Locales are a curated list of common BCP 47 tags, each named in its own language
 * (`Intl.DisplayNames`) with its tag after it, since the tag is what the file holds. Time zones are
 * every one the engine knows (`Intl.supportedValuesOf`), each with its offset now.
 *
 * A layout can hold a value neither list has — a tag written by hand, a zone link like `US/Pacific`
 * — and a dropdown that could not show it would hide what the document says. So `withStored` puts it
 * in the list, after System default, and it shows and stays selected.
 */

import type { ChoiceOption } from './controls/index.js';


/** The empty value: no field, the panel's own. */
export const SYSTEM_DEFAULT: ChoiceOption = Object.freeze({ value: '', label: 'System default' });

/** Common locales, by tag. Ordered by tag, so a language's regions sit together. */
export const CURATED_LOCALES: readonly string[] = Object.freeze([
  'ar-SA',
  'cs-CZ',
  'da-DK',
  'de-AT',
  'de-CH',
  'de-DE',
  'el-GR',
  'en-AU',
  'en-CA',
  'en-GB',
  'en-IE',
  'en-IN',
  'en-NZ',
  'en-US',
  'es-AR',
  'es-ES',
  'es-MX',
  'fi-FI',
  'fr-BE',
  'fr-CA',
  'fr-CH',
  'fr-FR',
  'he-IL',
  'hi-IN',
  'hu-HU',
  'id-ID',
  'it-IT',
  'ja-JP',
  'ko-KR',
  'nb-NO',
  'nl-BE',
  'nl-NL',
  'pl-PL',
  'pt-BR',
  'pt-PT',
  'ro-RO',
  'ru-RU',
  'sk-SK',
  'sv-SE',
  'th-TH',
  'tr-TR',
  'uk-UA',
  'vi-VN',
  'zh-CN',
  'zh-HK',
  'zh-TW',
]);

/** A locale's name in its own language: `English (United Kingdom)`, or the tag if none is known. */
export function localeName(tag: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: 'language', languageDisplay: 'standard' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** The locale dropdown: System default, then each curated locale as `name - tag`. */
export function localeOptions(): readonly ChoiceOption[] {
  return [
    SYSTEM_DEFAULT,
    ...CURATED_LOCALES.map((tag) => ({ value: tag, label: `${localeName(tag)} - ${tag}` })),
  ];
}

/** Every time zone the engine knows, with `UTC` sure to be one of them. */
export function knownTimeZones(): readonly string[] {
  const listed =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

  return listed.includes('UTC') ? listed : [...listed, 'UTC'];
}

/** A zone's offset from UTC now, as the engine writes it: `GMT+9`. Empty if it cannot say. */
export function zoneOffset(zone: string, at: number): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'shortOffset',
    }).formatToParts(at);
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/** The time zone dropdown: System default, then every known zone with its offset at `at`. */
export function timeZoneOptions(at: number): readonly ChoiceOption[] {
  return [
    SYSTEM_DEFAULT,
    ...knownTimeZones().map((zone) => ({ value: zone, label: zone, detail: zoneOffset(zone, at) })),
  ];
}

/**
 * `options`, with `stored` in it after System default if it is a value they do not list, so the
 * dropdown can show what the document holds.
 */
export function withStored(
  options: readonly ChoiceOption[],
  stored: string,
  label: (value: string) => string = (value) => value,
): readonly ChoiceOption[] {
  if (stored === '' || options.some((option) => option.value === stored)) return options;
  const [first, ...rest] = options;
  const kept: ChoiceOption = { value: stored, label: label(stored), detail: 'not in the list' };

  return first === undefined ? [kept] : [first, kept, ...rest];
}

/** A typed locale tag, canonicalised, or `undefined` if it is not one. */
export function acceptLocale(text: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(text.trim())[0];
  } catch {
    return undefined;
  }
}

/** A typed time zone the engine can use, as typed, or `undefined`. */
export function acceptTimeZone(text: string): string | undefined {
  const zone = text.trim();
  if (zone === '') return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

/** What a dropdown row lists, and how it takes a typed value: the spec's half of a ChoiceField. */
export interface ChoiceSource {
  /** One entry, in words: `locale`. */
  readonly noun: string;
  /** Every entry for a row holding `stored`, the stored value among them. */
  readonly options: (stored: string) => readonly ChoiceOption[];
  readonly accept: (text: string) => string | undefined;
}

/** The layout clock's locale row. */
export const LOCALE_CHOICES: ChoiceSource = Object.freeze({
  noun: 'locale',
  options: (stored: string) =>
    withStored(localeOptions(), stored, (tag) => `${localeName(tag)} - ${tag}`),
  accept: acceptLocale,
});

/** The layout clock's time zone row. Offsets are read when the row renders, so they follow DST. */
export const TIME_ZONE_CHOICES: ChoiceSource = Object.freeze({
  noun: 'time zone',
  options: (stored: string) => withStored(timeZoneOptions(Date.now()), stored),
  accept: acceptTimeZone,
});
