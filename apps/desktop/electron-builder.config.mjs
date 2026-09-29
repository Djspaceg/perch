/**
 * electron-builder's config file. The config itself is `src/packaging.ts`, compiled, so it is typed
 * and tested; this only writes its generated resources and calls it. Run it through
 * `npm run package:mac` (or `:win`, `:linux`) at the repository root, which builds first.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { packagingConfig, writePackagingResources } from './dist/packaging.js';

const projectDir = fileURLToPath(new URL('.', import.meta.url));

writePackagingResources(projectDir);

const { version: electronVersion } = createRequire(import.meta.url)('electron/package.json');

export default packagingConfig({
  env: process.env,
  projectDir,
  arch: process.arch,
  electronVersion,
});
