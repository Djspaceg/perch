/**
 * Shared Vitest alias table.
 *
 * Every package resolves `@perch/<name>` to the other package's TypeScript source
 * rather than to its built `dist/`, so `npm test` needs no prior `npm run build`
 * and a test always exercises the code in the working tree.
 *
 * Plain JS on purpose: Vite loads config files through esbuild, and a `.js`
 * specifier here resolves identically whether or not the config importing it is
 * TypeScript.
 */
import { fileURLToPath } from 'node:url';

/** @param {string} relative */
const src = (relative) => fileURLToPath(new URL(relative, import.meta.url));

/** @type {Record<string, string>} */
export const perchAliases = {
  '@perch/sensor-contract': src('./packages/sensor-contract/src/index.ts'),
  '@perch/layout-schema': src('./packages/layout-schema/src/index.ts'),
  '@perch/ui-kit': src('./packages/ui-kit/src/index.ts'),
  '@perch/sensor-sources': src('./packages/sensor-sources/src/index.ts'),
};
