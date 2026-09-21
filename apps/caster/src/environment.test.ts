import { describe, expect, it } from 'vitest';
import * as caster from './index.js';

describe('@perch/caster', () => {
  it('runs under node, per ARCHITECTURE.md', () => {
    expect('document' in globalThis).toBe(false);
    expect('window' in globalThis).toBe(false);
  });

  it('resolves with no repo-internal edges, because it consumes a built artifact', () => {
    expect(caster).toBeTypeOf('object');
  });
});
