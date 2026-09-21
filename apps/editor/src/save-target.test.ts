/**
 * The containment rule, exercised against the inputs an HTTP endpoint actually receives.
 *
 * `resolveSaveTarget` is the only thing standing between a name typed into a URL and a `writeFile`, so
 * the cases below are traversal, absolute paths, separators in both spellings, and the names of real
 * files that must stay unreachable. A rule like this is worth a test per refusal rather than one
 * "rejects bad input" case: each spelling below is a separate way the regex could have been wrong.
 */

import { describe, expect, it } from 'vitest';
import { LAYOUTS_DIRECTORY, resolveSaveTarget } from './save-target.js';

describe('resolveSaveTarget — names it accepts', () => {
  it('resolves a shipped layout to its file', () => {
    expect(resolveSaveTarget('desk-1920x400')).toEqual({
      ok: true,
      path: 'layouts/desk-1920x400.json',
    });
  });

  it('allows dots and underscores inside the name', () => {
    expect(resolveSaveTarget('desk_panel.v2')).toEqual({
      ok: true,
      path: 'layouts/desk_panel.v2.json',
    });
  });

  it('puts every accepted name directly in the layouts directory', () => {
    for (const name of ['a', 'tower-720x1280', 'Z9']) {
      const target = resolveSaveTarget(name);

      expect(target.ok).toBe(true);
      expect(target.ok ? target.path : '').toBe(`${LAYOUTS_DIRECTORY}/${name}.json`);
    }
  });
});

describe('resolveSaveTarget — names it refuses', () => {
  /**
   * Each of these is a distinct mechanism, not a variation: traversal, an absolute path, the two
   * separators, a hidden file, a percent-decoded separator arriving as a real one, and the empty
   * name a bare `PUT /__perch/layout/` produces.
   */
  const refused = [
    '',
    '.',
    '..',
    '../secrets',
    '../../etc/passwd',
    '/etc/passwd',
    'layouts/desk-1920x400',
    'sub/desk',
    'sub\\desk',
    '.hidden',
    'desk 1920',
    'desk\u0000',
    'desk\n',
    'a'.repeat(129),
  ];

  for (const name of refused) {
    it(`refuses ${JSON.stringify(name)}`, () => {
      const target = resolveSaveTarget(name);

      expect(target.ok).toBe(false);
      // Every refusal carries a sentence, because the middleware returns it as the response body and
      // the editor shows it to the author. A refusal with an empty reason is a dead end on screen.
      expect(target.ok ? '' : target.reason).not.toBe('');
    });
  }

  /**
   * The one refusal that protects a file rather than a boundary.
   *
   * `layouts/invalid/broken-desk.json` is deliberately not a layout: it is the fixture the runtime's
   * refusal page is exercised against. The editor can open it — that is how its own refusal path gets
   * a real document — and must never be able to save over it, which falls out of separators being
   * refused rather than from a special case.
   */
  it('cannot write to anything under layouts/invalid/', () => {
    expect(resolveSaveTarget('invalid/broken-desk').ok).toBe(false);
  });
});
