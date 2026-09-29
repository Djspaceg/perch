/**
 * `@perch/backgrounds`, the browser half: the static catalogue and the hosted-size rule.
 *
 * Imports no Node builtin (a test holds it to that), so the editor's thumbnail browser can read the
 * categories. The cache that downloads is `@perch/backgrounds/node`. See docs/backgrounds.md.
 */

export {
  BACKGROUND_CATEGORIES,
  HOSTED_SIZES,
  backgroundIds,
  backgroundLabel,
  categoryOf,
  isCatalogued,
  pickHostedSize,
  sizeName,
  type BackgroundCategory,
  type HostedSize,
} from './catalogue.js';
