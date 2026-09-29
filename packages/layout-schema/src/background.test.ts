/**
 * The cloud background reference: `thermalright:<id>`, the one way a layout names hosted media.
 */

import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_PROVIDER,
  backgroundRef,
  isBackgroundRef,
  parseBackgroundRef,
} from '@perch/layout-schema';

describe('parseBackgroundRef', () => {
  it('reads a provider and an id', () => {
    expect(parseBackgroundRef('thermalright:a042')).toEqual({
      provider: 'thermalright',
      id: 'a042',
    });
    expect(BACKGROUND_PROVIDER).toBe('thermalright');
  });

  it.each([
    ['a relative path', 'backdrop.png'],
    ['an http URL', 'http://www.czhorde.cc/tr/bj1920462/a001.mp4'],
    ['an upper-case id, a second spelling', 'thermalright:A042'],
    ['an upper-case provider', 'Thermalright:a042'],
    ['two digits', 'thermalright:a42'],
    ['four digits', 'thermalright:a0042'],
    ['no prefix', 'thermalright:042'],
    ['the zero id, which no category has', 'thermalright:a000'],
    ['a trailing extension', 'thermalright:a042.mp4'],
    ['whitespace', 'thermalright: a042'],
    ['another provider', 'lianli:a042'],
    ['nothing after the colon', 'thermalright:'],
  ])('refuses %s', (_why, src) => {
    expect(parseBackgroundRef(src)).toBeNull();
    expect(isBackgroundRef(src)).toBe(false);
  });

  it('formats what it parses', () => {
    expect(backgroundRef('y010')).toBe('thermalright:y010');
    expect(isBackgroundRef(backgroundRef('y010'))).toBe(true);
  });
});
