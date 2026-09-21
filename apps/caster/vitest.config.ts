import { defineConfig } from 'vitest/config';
import { perchAliases } from '../../vitest.aliases.js';

export default defineConfig({
  resolve: { alias: perchAliases },
  test: {
    // Launches and measures a surface from the outside; no document of its own.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
