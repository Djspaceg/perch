/**
 * Hard rule 2: media is referenced by path, never embedded.
 */

import { describe, expect, it } from 'vitest';
import { MEDIA_FITS, validateLayout, type ValidateLayoutOptions } from '@perch/layout-schema';
import {
  issueAt,
  layoutOf,
  layoutWithElements,
  TEST_WIDGETS,
} from './layout-fixture.test-support.js';

const options: ValidateLayoutOptions = { widgets: TEST_WIDGETS };

const withSrc = (src: unknown): ReturnType<typeof validateLayout> =>
  validateLayout(
    layoutWithElements([{ kind: 'media', src, rect: { x: 0, y: 0, w: 1920, h: 400 } }]),
    options,
  );

const issue = (src: unknown): ReturnType<typeof issueAt> =>
  issueAt(withSrc(src), 'elements[0].src');

describe('MEDIA_FITS', () => {
  it('is the two fits v1 defines', () => {
    expect(MEDIA_FITS).toEqual(['cover', 'contain']);
  });
});

describe('media paths that are references beside the layout file', () => {
  it.each([
    ['a sibling file', 'backdrop.png'],
    ['the assets directory convention', 'desk-1920x400.assets/backdrop.png'],
    ['a nested path', 'assets/video/loop.webm'],
    ['a name with spaces, which a real asset has', 'assets/desk backdrop.png'],
    ['a name with a hyphen and a dot', 'assets/logo.dark-v2.svg'],
  ])('accepts %s', (_why, src) => {
    expect(layoutOf(withSrc(src)).elements).toHaveLength(1);
  });
});

describe('embedded media is the rule, and gets its own code', () => {
  it('rejects a data URL, saying why the rule exists', () => {
    const found = issue('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');

    expect(found.code).toBe('embedded-media');
    expect(found.message).toMatch(/undiffable|unreviewable/);
  });

  it('rejects a data URL whatever the case of the scheme', () => {
    expect(issue('DATA:image/png;base64,iVBOR').code).toBe('embedded-media');
  });
});

describe('everything else that is not a relative path', () => {
  it.each([
    ['an http URL', 'http://example.test/backdrop.png'],
    ['an https URL', 'https://example.test/backdrop.png'],
    ['a file URL', 'file:///Users/someone/backdrop.png'],
    ['an absolute POSIX path', '/Users/someone/backdrop.png'],
    ['a Windows drive path with a slash', 'C:/Users/someone/backdrop.png'],
    ['a Windows drive path with a backslash', 'C:\\Users\\someone\\backdrop.png'],
    ['a parent-directory escape', '../shared/backdrop.png'],
    ['a parent-directory escape mid-path', 'assets/../../backdrop.png'],
    ['a redundant dot segment', './backdrop.png'],
    ['a doubled separator', 'assets//backdrop.png'],
    ['a trailing separator', 'assets/backdrop.png/'],
    ['a leading space', ' backdrop.png'],
    ['a trailing space', 'backdrop.png '],
    ['a backslash separator', 'assets\\backdrop.png'],
    ['a glob character', 'assets/*.png'],
    ['a control character', 'assets/backdrop\u0001.png'],
  ])('rejects %s', (_why, src) => {
    expect(issue(src).code).toBe('malformed-media-path');
  });

  it('names the scheme it rejected, so the fix is obvious', () => {
    expect(issue('https://example.test/x.png').message).toContain('https');
  });

  it('reads a drive letter as an absolute path rather than as a one-letter URL scheme', () => {
    expect(issue('C:/x.png').message).toMatch(/absolute path/);
  });

  it('rejects a path longer than the ceiling, naming it', () => {
    const found = issue(`${'a'.repeat(513)}.png`);

    expect(found.code).toBe('malformed-media-path');
    expect(found.message).toContain('512');
  });
});
