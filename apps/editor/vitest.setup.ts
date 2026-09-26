/**
 * Vitest setup: register the jest-dom matchers.
 *
 * Deliberately at the package root rather than in `src/`. Everything under `src/` is compiled
 * into `dist/` by the package's own `tsconfig`, and a setup file that only exists to extend a
 * test assertion vocabulary has no business being published. It is typechecked by
 * `tsconfig.tests.json`, which is where every other test file is typechecked.
 *
 * The `/vitest` entry point (not the bare package) is the one that augments Vitest's `Assertion`
 * interface, so `expect(el).toBeVisible()` is typed as well as available.
 *
 * It also unmounts React trees between tests, for the reason `apps/runtime/vitest.setup.ts` states:
 * Testing Library registers that teardown itself only when Vitest's `globals` are on, and they are
 * deliberately off here — every test imports `describe` and `expect` explicitly — so it has to be
 * registered by hand. Without it each test inherits the previous test's DOM, and `screen`, which
 * queries the whole document, starts finding two of everything.
 *
 * The detached editor store is reset for the same reason: see `src/store.ts`.
 */

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DETACHED_EDITOR_STORE } from './src/store.js';

afterEach(() => {
  cleanup();
  // A primitive rendered outside an editor remembers its folds, tabs and chips in the detached store.
  // A test that folds one must not hand that fold to the next test. A mounted editor makes its own
  // store, so it needs nothing here.
  DETACHED_EDITOR_STORE.setState(DETACHED_EDITOR_STORE.getInitialState(), true);
});
