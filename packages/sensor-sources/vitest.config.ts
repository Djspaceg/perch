import { defineConfig } from 'vitest/config';
import { perchAliases } from '../../vitest.aliases.js';

export default defineConfig({
  resolve: { alias: perchAliases },
  test: {
    // ARCHITECTURE.md puts the adapters under node. Sources must also run in a browser,
    // which the tsconfig enforces by withholding @types/node rather than by the test env.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
