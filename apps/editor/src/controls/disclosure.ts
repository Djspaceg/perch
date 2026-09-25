/**
 * Which inspector sections are open, remembered for the session.
 *
 * "Session" is the browser tab, so the store writes to `sessionStorage`: a reload keeps the author's
 * arrangement of the inspector, a new tab starts from the defaults, and nothing is written into the
 * layout document — how a sidebar is folded is not a fact about a dashboard. Storage that is absent or
 * throws (a locked-down profile) degrades to memory rather than taking the inspector with it.
 *
 * A section's id names what it is, never which element is selected — `entity/transform`, not
 * `elements[3]/transform` — so folding Transform on one readout folds it on every entity, which is
 * what an author who has decided they do not need it means.
 */

import { useCallback, useSyncExternalStore } from 'react';

/** Prefix of every key this store writes. */
export const DISCLOSURE_KEY_PREFIX = 'perch-editor.disclosure.';

/** The open/closed record, and a way to hear about changes. */
export interface DisclosureStore {
  isOpen(id: string, fallback: boolean): boolean;
  set(id: string, open: boolean): void;
  subscribe(listener: () => void): () => void;
}

type SessionLike = Pick<Storage, 'getItem' | 'setItem'>;

/** A store over `storage`, or over memory alone when there is none or it refuses. */
export function createDisclosureStore(storage: SessionLike | null | undefined): DisclosureStore {
  const memory = new Map<string, boolean>();
  const listeners = new Set<() => void>();

  return {
    isOpen(id, fallback) {
      if (storage !== null && storage !== undefined) {
        try {
          const stored = storage.getItem(DISCLOSURE_KEY_PREFIX + id);
          if (stored === 'open') return true;
          if (stored === 'closed') return false;
          if (stored === null) return fallback;
        } catch {
          // Refused: memory below.
        }
      }

      return memory.get(id) ?? fallback;
    },
    set(id, open) {
      memory.set(id, open);
      try {
        storage?.setItem(DISCLOSURE_KEY_PREFIX + id, open ? 'open' : 'closed');
      } catch {
        // Memory already holds it.
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** `window.sessionStorage` where it exists and may be touched; reading it can itself throw. */
function sessionStorageOrNull(): SessionLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The page's one store. Memory is only its fallback: with storage present every read goes to storage,
 * so clearing `sessionStorage` (as the test setup does between tests) resets it.
 */
const PAGE_STORE = createDisclosureStore(sessionStorageOrNull());

/** Whether section `id` is open, and a setter. Every section with the same id shares the answer. */
export function useDisclosure(
  id: string,
  defaultOpen: boolean,
): readonly [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(
    (listener) => PAGE_STORE.subscribe(listener),
    () => PAGE_STORE.isOpen(id, defaultOpen),
    () => defaultOpen,
  );
  const set = useCallback(
    (next: boolean) => {
      PAGE_STORE.set(id, next);
    },
    [id],
  );

  return [open, set] as const;
}
