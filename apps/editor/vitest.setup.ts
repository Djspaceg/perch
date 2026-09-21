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
 */

import '@testing-library/jest-dom/vitest';
