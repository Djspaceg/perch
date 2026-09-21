import { defineConfig } from 'vitest/config';
import { perchAliases } from '../../vitest.aliases.js';

export default defineConfig({
  resolve: { alias: perchAliases },
  test: {
    // A contract with zero runtime dependencies, exercised the way the wire uses it.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
