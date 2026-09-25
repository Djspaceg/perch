/**
 * Which sections are open, remembered for the session.
 *
 * "Session" is the browser tab: `sessionStorage`, so a reload keeps the author's layout of the
 * inspector and a new tab starts from the defaults. Storage that throws — a locked-down profile —
 * degrades to memory rather than taking the inspector down with it.
 */

import { describe, expect, it, vi } from 'vitest';
import { DISCLOSURE_KEY_PREFIX, createDisclosureStore } from './disclosure.js';

/** A `Storage` stand-in: the two methods the store uses, over a plain map. */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & {
  readonly map: Map<string, string>;
} {
  const map = new Map<string, string>();

  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('createDisclosureStore', () => {
  it('answers the default for a section nobody has touched', () => {
    const store = createDisclosureStore(memoryStorage());

    expect(store.isOpen('entity/transform', true)).toBe(true);
    expect(store.isOpen('theme/colour', false)).toBe(false);
  });

  it('remembers a toggle, over the default, in session storage', () => {
    const storage = memoryStorage();
    const store = createDisclosureStore(storage);

    store.set('entity/transform', false);
    store.set('theme/colour', true);

    expect(store.isOpen('entity/transform', true)).toBe(false);
    expect(store.isOpen('theme/colour', false)).toBe(true);
    expect(storage.map.get(`${DISCLOSURE_KEY_PREFIX}entity/transform`)).toBe('closed');
  });

  it('survives a reload: a new store over the same storage reads what the old one wrote', () => {
    const storage = memoryStorage();
    createDisclosureStore(storage).set('global/theme', false);

    expect(createDisclosureStore(storage).isOpen('global/theme', true)).toBe(false);
  });

  it('tells subscribers when a section changes, and stops when they unsubscribe', () => {
    const store = createDisclosureStore(memoryStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set('entity/box', false);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.set('entity/box', true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('falls back to memory when storage throws', () => {
    const store = createDisclosureStore({
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });

    store.set('entity/box', false);
    expect(store.isOpen('entity/box', true)).toBe(false);
  });

  it('works with no storage at all', () => {
    const store = createDisclosureStore(null);

    store.set('entity/box', false);
    expect(store.isOpen('entity/box', true)).toBe(false);
  });
});
