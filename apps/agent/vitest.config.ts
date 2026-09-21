import { defineConfig } from 'vitest/config';
import { perchAliases } from '../../vitest.aliases.js';

export default defineConfig({
  resolve: { alias: perchAliases },
  test: {
    // A background service. There is no page here.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
