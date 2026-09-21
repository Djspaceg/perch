import { describe, expect, it } from 'vitest';

describe('test environment', () => {
  it('runs under node, per ARCHITECTURE.md', () => {
    expect('document' in globalThis).toBe(false);
    expect('window' in globalThis).toBe(false);
  });
});
