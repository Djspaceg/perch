/**
 * Public surface of `@perch/layout-schema` — what a dashboard is.
 *
 * The pivot of the whole project: the editor writes this format, the runtime reads it, and both
 * validate it. A layout that will not validate is not a layout, so the whole surface below is
 * organised around one question — is this a layout, and if not, exactly what is wrong with it and
 * where.
 *
 * ## Which entry point
 *
 * - `loadLayout` / `loadLayoutJson` — a document from outside: a file, a fetch, a paste. Migrates
 *   forward first, then validates, and reports which migrations ran.
 * - `validateLayout` / `parseLayoutJson` — a document already known to be at the current version:
 *   the editor's in-memory state on its way to disk.
 * - `assertLayout` — the same, throwing `LayoutValidationError` for a caller with nowhere to
 *   render a list of problems.
 * - `isLayout` — the guard, for a caller that only needs the answer.
 *
 * Every one of them takes a `WidgetRegistry`. That is the single point at which this leaf package
 * accepts knowledge from outside: it must not know `ui-kit` exists (`ARCHITECTURE.md`'s dependency
 * rules, and this SPEC's hard rule 5), so the widget vocabulary is injected rather than imported
 * and an unknown widget name still fails loudly instead of rendering as nothing.
 */

export {
  LAYOUT_MAX_DIMENSION,
  LAYOUT_MAX_FRAME_RATE,
  LAYOUT_SCHEMA_VERSION,
  assertLayout,
  isLayout,
  parseLayoutJson,
  validateLayout,
  type Layout,
  type LayoutTarget,
  type ValidateLayoutResult,
} from './layout.js';

export {
  ELEMENT_KINDS,
  isElementKind,
  type ChartElement,
  type ElementKind,
  type LayoutElement,
  type MediaElement,
  type Range,
  type TextElement,
  type WidgetElement,
} from './element.js';

export {
  CHART_GAPS,
  CHART_MAX_WINDOW_MS,
  CHART_MIN_WINDOW_MS,
  DEFAULT_CHART_GAP,
  type ChartGap,
} from './chart.js';

export { rectIntersectsCanvas, type Rect } from './geometry.js';

export { MEDIA_FITS, type MediaFit } from './media.js';

export { type Style, type ThemeTokens } from './theme.js';

export {
  EMPTY_WIDGET_REGISTRY,
  createWidgetRegistry,
  isWidgetName,
  type WidgetRegistry,
  type WidgetSpec,
} from './registry.js';

export { isTopicShaped, type TopicValidator, type ValidateLayoutOptions } from './options.js';

export {
  LAYOUT_ISSUE_CODES,
  LayoutValidationError,
  formatLayoutIssues,
  type LayoutIssue,
  type LayoutIssueCode,
} from './issues.js';

export {
  LAYOUT_MIGRATIONS,
  assertLayoutMigrationTable,
  earliestMigratableVersion,
  formatMigrationReport,
  loadLayout,
  loadLayoutJson,
  migrateLayoutDocument,
  type LayoutMigration,
  type LayoutMigrationStep,
  type LoadLayoutOptions,
  type LoadLayoutResult,
  type MigrateLayoutOptions,
  type MigrateLayoutResult,
} from './migrate.js';

export {
  describeTargetMismatch,
  fitLayoutTarget,
  type OutputCapabilities,
  type TargetFit,
} from './target.js';
