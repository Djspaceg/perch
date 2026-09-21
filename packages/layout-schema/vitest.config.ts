import { defineConfig } from 'vitest/config';
import { perchAliases } from '../../vitest.aliases.js';

export default defineConfig({
  resolve: { alias: perchAliases },
  test: {
    // A contract with zero runtime dependencies; no DOM involved in reading a layout file.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
