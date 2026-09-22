import { defineConfig } from 'vitest/config';

/**
 * The one test config outside a workspace.
 *
 * `tools/` is not an npm workspace — it is two scripts the repo root runs directly — so
 * `npm test --workspaces` cannot reach it, and the root `test` script runs this config after the
 * workspace fan-out. Making `tools/` a workspace to avoid that would mean a `package.json` and a
 * `package-lock.json` change for two files with no dependencies.
 *
 * No alias table: nothing here imports `@perch/*`, and the point of `dev-startup.mjs` is that it
 * imports nothing at all.
 */
export default defineConfig({
  test: {
    // A process launcher. There is no page here.
    environment: 'node',
    include: ['*.test.mjs'],
  },
});
