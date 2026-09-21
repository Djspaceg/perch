import { describe, expect, it } from 'vitest';

interface MinimalDocument {
  createElement(tag: string): { tagName: string };
}

describe('test environment', () => {
  it('runs under jsdom, per ARCHITECTURE.md', () => {
    expect('document' in globalThis).toBe(true);
    expect('window' in globalThis).toBe(true);
  });

  it('has a working DOM implementation, not just the global names', () => {
    const document = Reflect.get(globalThis, 'document') as MinimalDocument;
    expect(document.createElement('canvas').tagName).toBe('CANVAS');
  });
});
