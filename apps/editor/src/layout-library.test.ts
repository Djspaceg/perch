/**
 * What the editor can open: **listing**, the first of the four things this slice does.
 *
 * Two halves, for the reason `apps/runtime/src/layout-catalogue.test.ts` gives about its own:
 * `createLayoutLibrary` is tested against literals, because that is the only way to assert what
 * happens with an empty library or with a name that is not there; and `LAYOUT_LIBRARY` is tested
 * against what the glob actually found, because a build-time directory read is exactly the kind of
 * wiring that silently returns nothing when a pattern is wrong. A library that resolves correctly and
 * is empty passes every test in the first half.
 */

import { describe, expect, it } from 'vitest';
import { LAYOUT_LIBRARY, createLayoutLibrary } from './layout-library.js';

describe('createLayoutLibrary — listing and switching', () => {
  const library = createLayoutLibrary({
    layouts: { 'tower-720x1280': '{"tower":true}', 'desk-1920x400': '{"desk":true}' },
    invalid: { 'invalid/broken-desk': '{' },
    assets: { 'desk-1920x400.assets/rails.svg': '/assets/rails-abc123.svg' },
  });

  it('offers every layout, sorted, so the default name is stable', () => {
    expect(library.names).toEqual(['desk-1920x400', 'tower-720x1280']);
  });

  it('hands back each layout as text, so the editor validates the bytes on disk', () => {
    expect(library.entry('desk-1920x400')?.text).toBe('{"desk":true}');
    expect(library.entry('tower-720x1280')?.text).toBe('{"tower":true}');
  });

  it('switching to another name is a different document, not a mutated one', () => {
    const first = library.entry('desk-1920x400');
    const second = library.entry('tower-720x1280');

    expect(first?.name).toBe('desk-1920x400');
    expect(second?.name).toBe('tower-720x1280');
    expect(first?.text).not.toBe(second?.text);
  });

  it('catalogues an invalid document without offering it', () => {
    expect(library.names).not.toContain('invalid/broken-desk');
    expect(library.entry('invalid/broken-desk')).toEqual({
      name: 'invalid/broken-desk',
      text: '{',
      offered: false,
    });
  });

  it('answers undefined for a name with no file, rather than an empty entry', () => {
    expect(library.entry('no-such-layout')).toBeUndefined();
  });

  it('resolves a media path to the URL the bundler produced', () => {
    expect(library.resolveAsset('desk-1920x400.assets/rails.svg')).toBe('/assets/rails-abc123.svg');
  });

  it('answers undefined for an asset that is not in the bundle, so the canvas marks it', () => {
    // `LayoutCanvas` paints its missing-asset box on `undefined`, which is what an author who just
    // mistyped a path should see — in the rect where the image would have been.
    expect(library.resolveAsset('desk-1920x400.assets/typo.svg')).toBeUndefined();
  });

  it('has no names at all when there are no layouts', () => {
    expect(createLayoutLibrary({ layouts: {} }).names).toEqual([]);
  });
});

describe('LAYOUT_LIBRARY — what the glob actually found', () => {
  it('lists both shipped layouts', () => {
    expect(LAYOUT_LIBRARY.names).toContain('desk-1920x400');
    expect(LAYOUT_LIBRARY.names).toContain('tower-720x1280');
  });

  it('reads every offered layout as JSON text, with the extension stripped from its name', () => {
    for (const name of LAYOUT_LIBRARY.names) {
      expect(name.endsWith('.json')).toBe(false);
      expect(LAYOUT_LIBRARY.entry(name)?.text).toContain('"schemaVersion"');
    }
  });

  it('catalogues the invalid fixture without offering it', () => {
    expect(LAYOUT_LIBRARY.names).not.toContain('invalid/broken-desk');
    expect(LAYOUT_LIBRARY.entry('invalid/broken-desk')?.offered).toBe(false);
  });

  it('resolves the assets the shipped layouts reference', () => {
    expect(LAYOUT_LIBRARY.resolveAsset('desk-1920x400.assets/rails.svg')).toBeDefined();
    expect(LAYOUT_LIBRARY.resolveAsset('tower-720x1280.assets/weave.svg')).toBeDefined();
  });
});
