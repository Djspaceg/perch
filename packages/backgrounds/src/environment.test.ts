/**
 * Which half is which: the entry `.` is imported by browser pages, so nothing it reaches may
 * import a Node builtin; `./node` is the cache and may.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as browserHalf from '@perch/backgrounds';

/** Every module the browser entry reaches, by its relative imports. */
function reached(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const text = readFileSync(fileURLToPath(new URL(entry, import.meta.url)), 'utf8');
  for (const match of text.matchAll(/from '\.\/([^']+)\.js'/g)) {
    reached(`./${match[1] ?? ''}.ts`, seen);
  }
  return seen;
}

describe('@perch/backgrounds', () => {
  it('keeps Node and Electron out of the browser entry', () => {
    const modules = reached('./index.ts');
    expect(modules.size).toBeGreaterThan(1);
    for (const name of modules) {
      const text = readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
      expect(text, name).not.toMatch(/from 'node:/);
      expect(text, name).not.toMatch(/from 'electron'/);
    }
    expect(browserHalf.pickHostedSize).toBeTypeOf('function');
  });

  it('keeps Electron out of the Node half too', () => {
    for (const name of reached('./node.ts')) {
      const text = readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
      expect(text, name).not.toMatch(/from 'electron'/);
    }
  });
});
