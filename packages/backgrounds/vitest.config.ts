import { defineConfig } from 'vitest/config';
import { perchAliases } from '../../vitest.aliases.js';

export default defineConfig({
  resolve: { alias: perchAliases },
  test: {
    // The cache is Node; the catalogue is pure. Neither needs a DOM.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
