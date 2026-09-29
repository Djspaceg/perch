/**
 * The dev servers' background endpoint, as a Vite plugin both `vite.config.ts` files mount.
 *
 * Plain JS beside the other shared build helpers, for the reason `vitest.aliases.js` gives. The
 * endpoint itself is `@perch/backgrounds/node` (`dev-endpoint.ts`); this only builds its cache and
 * mounts it. It is imported lazily, inside `configureServer`, so `vite build` never needs it, and
 * a dev server whose package is not built yet says so once and serves pages without backgrounds
 * (`npm run dev` builds it first; see `dev-stack.mjs`).
 */

import { fileURLToPath } from 'node:url';

/** The repository root: one directory up from `tools/`. */
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** @returns {import('vite').Plugin} */
export function backgroundsDevPlugin() {
  return {
    name: 'perch-backgrounds',
    apply: 'serve',
    async configureServer(server) {
      let backgrounds;
      try {
        backgrounds = await import('@perch/backgrounds/node');
      } catch (error) {
        server.config.logger.warn(
          `perch: no background endpoint: @perch/backgrounds is not built (npm run build -w @perch/backgrounds): ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      const root = backgrounds.devBackgroundsRoot(process.env, REPO_ROOT);
      const cache = backgrounds.createBackgroundCache({
        root,
        fetch: (url, init) => fetch(url, init),
        urlFor: backgrounds.devCacheUrlFor,
        log: (line) => {
          server.config.logger.info(line);
        },
      });
      server.config.logger.info(`perch: background cache ${root}`);
      void cache.sweep();
      server.middlewares.use(backgrounds.devBackgroundsMiddleware(cache));
    },
  };
}
