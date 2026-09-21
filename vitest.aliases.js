/**
 * Shared Vitest alias table.
 *
 * Every package resolves `@perch/<name>` to the other package's TypeScript source
 * rather than to its built `dist/`, so `npm test` needs no prior `npm run build`
 * and a test always exercises the code in the working tree.
 *
 * Plain JS on purpose: Vite transpiles config files before loading them — Oxc
 * since Vite 8, esbuild before it — and a `.js` specifier here resolves
 * identically whether or not the config importing it is TypeScript. Naming the
 * transpiler rather than assuming it is the point: the guarantee this file relies
 * on is the specifier, which survived that swap.
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
