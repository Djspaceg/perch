import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as layoutSchema from './index.js';

describe('@perch/layout-schema', () => {
  it('runs under node, per ARCHITECTURE.md', () => {
    expect('document' in globalThis).toBe(false);
    expect('window' in globalThis).toBe(false);
  });

  it('resolves as a module with no repo-internal imports, because it is a leaf', () => {
    expect(layoutSchema).toBeTypeOf('object');
  });

  it('imports nothing from the rest of the repo, asserted over the source rather than assumed', () => {
    // The dependency rule this package lives under is the one thing here that a well-meaning
    // future edit breaks silently: importing `@perch/ui-kit` for a widget list would compile, pass
    // every other test, and turn the contract into a cycle. So it is checked, not documented.
    const directory = fileURLToPath(new URL('.', import.meta.url));
    const sources = readdirSync(directory).filter(
      (name) => name.endsWith('.ts') && !name.includes('.test'),
    );

    expect(sources.length).toBeGreaterThan(5);

    for (const name of sources) {
      const text = readFileSync(`${directory}${name}`, 'utf8');
      expect(text, `${name} must not import another perch package`).not.toMatch(/from '@perch\//);
      expect(text, `${name} must not import a node builtin`).not.toMatch(/from 'node:/);
    }
  });

  it('exports the four entry points a consumer chooses between', () => {
    expect(layoutSchema.loadLayout).toBeTypeOf('function');
    expect(layoutSchema.validateLayout).toBeTypeOf('function');
    expect(layoutSchema.assertLayout).toBeTypeOf('function');
    expect(layoutSchema.isLayout).toBeTypeOf('function');
  });

  it('keeps the bare JSON parser out of the public surface', () => {
    // `parseJson` exists so `migrate.ts` and `layout.ts` share one error channel for a syntax
    // error. Exporting it would invite a caller to parse first and validate later, which is the
    // one order in which a document's version is never checked.
    expect(Object.keys(layoutSchema)).not.toContain('parseJson');
    expect(layoutSchema.parseLayoutJson).toBeTypeOf('function');
    expect(layoutSchema.loadLayoutJson).toBeTypeOf('function');
  });
});
