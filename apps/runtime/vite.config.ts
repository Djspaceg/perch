/**
 * Vite for the runtime page.
 *
 * Vite is here for one concrete reason, and it is worth stating because the thing it replaced
 * worked: `tsc -b` emits ES modules with their import specifiers untouched, so the browser is
 * asked for `@perch/ui-kit` — a bare specifier it cannot resolve. The previous harness answered
 * that with a hand-maintained import map plus a hand-rolled static server, which meant the
 * browser ran `dist/`, one build behind the source, and adding a package meant editing HTML.
 * Vite resolves workspace packages from source, serves them over HTTP, and hot-reloads them.
 *
 * Everything below is either a consequence of the monorepo or of the frame budget.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { perchAliases } from '../../vitest.aliases.js';

export default defineConfig({
  plugins: [react()],

  /**
   * The same alias table Vitest uses, imported rather than restated.
   *
   * It maps `@perch/*` to each package's `src/index.ts`, so the page and the tests resolve
   * `ui-kit` identically — to source. Two tables would eventually disagree, and the way that
   * failure shows up is a page behaving differently from the test that passed for it. It also
   * removes the `tsc -b` step from the dev loop entirely: edit a widget, see the widget.
   */
  resolve: { alias: perchAliases },

  build: {
    /**
     * `dist/page`, not `dist`.
     *
     * `tsc -b` owns `dist/` for this package — its `.js`, `.d.ts` and `.tsbuildinfo` live there —
     * and Vite empties its `outDir` before writing. Pointed at `dist` it would delete the
     * TypeScript build output on every build, and the failure would look like a broken project
     * reference somewhere else entirely. The nested path is still covered by the existing `dist`
     * entry in `.gitignore`.
     */
    outDir: 'dist/page',

    /**
     * Source maps, because the only way this page is looked at is a real browser: a stack trace
     * pointing into a bundle is a stack trace pointing nowhere.
     */
    sourcemap: true,
  },

  server: {
    /**
     * Fail rather than silently move to another port.
     *
     * The capture tooling navigates to a fixed URL. A dev server that helpfully picks 5174 when
     * 5173 is busy turns that into a screenshot of a connection error — or worse, a screenshot of
     * whatever else is on 5173.
     */
    strictPort: true,
  },
});
