import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { perchAliases } from '../../vitest.aliases.js';

export default defineConfig({
  resolve: {
    alias: {
      ...perchAliases,
      // An app, so not in the shared table: this is the one workspace allowed to import it. To
      // source, like every other alias, so `npm test` needs no prior build of the relay.
      '@perch/agent': fileURLToPath(new URL('../agent/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // The main process. Nothing here that is tested may import `electron`, which only exists
    // inside the Electron binary; the modules that do are thin and are exercised by a launch.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
