/**
 * `@perch/backgrounds/node`: the download cache and the file server over it, for the desktop main
 * process and the Vite dev servers. Node only, and no Electron: each host injects its own `fetch`
 * and names its own URLs. The browser half is re-exported, so a host needs one import.
 */

export * from './index.js';

export {
  BACKGROUND_SERVERS,
  DEFAULT_BACKGROUND_LIMITS,
  createBackgroundCache,
  type BackgroundCache,
  type BackgroundCacheLimits,
  type BackgroundCacheOptions,
  type BackgroundFailure,
  type BackgroundFailureCode,
  type BackgroundServer,
  type EnsureResult,
  type FetchLike,
  type PreviewResult,
  type TargetSize,
} from './cache.js';

export { serveCachedFile } from './serve.js';
