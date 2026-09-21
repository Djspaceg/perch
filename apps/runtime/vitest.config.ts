import { defineConfig } from 'vitest/config';
import { perchAliases } from '../../vitest.aliases.js';

export default defineConfig({
  resolve: { alias: perchAliases },
  test: {
    // Renders a page in both modes; everything it does needs a document.
    environment: 'jsdom',
    // `.tsx` is included ahead of the first component so a React test needs no config
    // change to be picked up — only a file.
    include: ['src/**/*.test.{ts,tsx}'],
    // jest-dom's matchers, registered once per jsdom workspace. See vitest.setup.ts.
    setupFiles: ['./vitest.setup.ts'],
  },
});
