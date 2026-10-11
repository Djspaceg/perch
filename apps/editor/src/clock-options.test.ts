import { describe, expect, it } from 'vitest';
import {
  SYSTEM_DEFAULT,
  acceptLocale,
  acceptTimeZone,
  localeOptions,
  withStored,
  zoneOffset,
} from './clock-options.js';

describe('the clock dropdowns’ options', () => {
  it('put a stored value no list has after System default, noted', () => {
    const options = withStored(localeOptions(), 'eu-ES');

    expect(options[0]).toBe(SYSTEM_DEFAULT);
    expect(options[1]).toEqual({ value: 'eu-ES', label: 'eu-ES', detail: 'not in the list' });
    expect(withStored(localeOptions(), 'en-GB')).toEqual(localeOptions());
    expect(withStored(localeOptions(), '')).toEqual(localeOptions());
  });

  it('take a typed tag or zone only when the engine can use it', () => {
    expect(acceptLocale('en-gb')).toBe('en-GB');
    expect(acceptLocale('not a locale')).toBeUndefined();
    expect(acceptTimeZone('US/Pacific')).toBe('US/Pacific');
    expect(acceptTimeZone('Mars/Olympus')).toBeUndefined();
    expect(acceptTimeZone(' ')).toBeUndefined();
  });

  it('give a zone its offset at an instant', () => {
    expect(zoneOffset('Asia/Tokyo', Date.UTC(2026, 0, 1))).toBe('GMT+9');
    expect(zoneOffset('Nowhere/Else', 0)).toBe('');
  });
});
