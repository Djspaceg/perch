/**
 * The catalogue: the glob table that actually ships, and the constructor a test injects.
 *
 * Two separate claims. The constructor's behaviour — what is offered, what is merely reachable, how
 * an asset path resolves — is checked against literals. The *real* catalogue is checked for one thing
 * only: that it is not empty and that it found the files on disk. That matters because
 * `import.meta.glob` resolves at build time against a pattern reaching outside this app's Vite root,
 * and the failure mode of a pattern that stops matching is silence: an empty table, a page defaulting
 * to nothing, and every test that goes through the catalogue passing vacuously.
 */

import { describe, expect, it } from 'vitest';
import { LAYOUT_CATALOGUE, createLayoutCatalogue } from './layout-catalogue.js';

describe('createLayoutCatalogue', () => {
  const catalogue = createLayoutCatalogue({
    layouts: { second: '{"second":true}', first: '{"first":true}' },
    invalid: { 'invalid/broken': '{' },
    assets: { 'first.assets/bg.svg': '/assets/bg-abc123.svg' },
  });

  it('offers the layouts, sorted, so the default is stable', () => {
    expect(catalogue.names).toEqual(['first', 'second']);
  });

  it('hands back a document as text, not as a parsed object', () => {
    // The page validates the bytes on disk. Parsing here would mean a trailing comma was rejected by
    // whatever did the parsing rather than reported by `formatLayoutIssues` on the page.
    expect(catalogue.entry('first')?.text).toBe('{"first":true}');
  });

  it('reaches an invalid document by name but never offers it', () => {
    expect(catalogue.entry('invalid/broken')?.offered).toBe(false);
    expect(catalogue.names).not.toContain('invalid/broken');
  });

  it('knows nothing about a name that is not there', () => {
    expect(catalogue.entry('nope')).toBeUndefined();
  });

  it('resolves a media path to the URL the bundler produced', () => {
    expect(catalogue.resolveAsset('first.assets/bg.svg')).toBe('/assets/bg-abc123.svg');
  });

  it('answers undefined for an asset the bundle does not have', () => {
    // Which the canvas renders as a visible box naming the path, rather than a blank rect.
    expect(catalogue.resolveAsset('first.assets/gone.png')).toBeUndefined();
  });
});

describe('LAYOUT_CATALOGUE — what the glob actually found', () => {
  it('found the shipped layouts', () => {
    expect(LAYOUT_CATALOGUE.names).toContain('desk-1920x400');
    expect(LAYOUT_CATALOGUE.names).toContain('tower-720x1280');
  });

  it('loaded each one as the file text, schemaVersion and all', () => {
    for (const name of LAYOUT_CATALOGUE.names) {
      expect(LAYOUT_CATALOGUE.entry(name)?.text).toContain('"schemaVersion"');
    }
  });

  it('catalogued the deliberately invalid document without offering it', () => {
    expect(LAYOUT_CATALOGUE.entry('invalid/broken-desk')?.offered).toBe(false);
    expect(LAYOUT_CATALOGUE.names).not.toContain('invalid/broken-desk');
  });

  it('resolved the assets both layouts reference', () => {
    // The `src` strings exactly as the layout files write them: a glob key reduced with the wrong
    // prefix would still be a non-empty table, and the symptom would be a missing-asset box on the
    // panel rather than a failure here.
    expect(LAYOUT_CATALOGUE.resolveAsset('desk-1920x400.assets/rails.svg')).toBeDefined();
    expect(LAYOUT_CATALOGUE.resolveAsset('tower-720x1280.assets/weave.svg')).toBeDefined();
  });
});
