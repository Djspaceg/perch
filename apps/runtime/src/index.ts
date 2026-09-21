/**
 * Library entry point for `@perch/runtime`.
 *
 * The page's own entry is `src/main.tsx`, which the browser loads through `index.html` — it builds
 * the source, reads the URL and mounts, so it is deliberately not exported: importing it would mount
 * a dashboard as a side effect.
 *
 * What is exported is the page and the pieces it is assembled from, each of which takes its inputs
 * as arguments: the source, the layout catalogue and the page request are all injected, so an
 * embedder or a test supplies its own without a browser, a relay or a `layouts/` directory.
 *
 * `WIDGET_REGISTRY` is exported because it is the answer to "what widgets does this runtime have",
 * and that is a question the editor will have to ask in order to validate a layout it is editing
 * against the runtime that will show it.
 */
export {
  Dashboard,
  SOURCE_STATUS_WORDING,
  type DashboardProps,
  type LiveSourceIdentity,
} from './app.js';
export {
  LAYOUT_CANVAS_STYLES,
  LayoutCanvas,
  canvasToken,
  CANVAS_TOKEN_DEFAULTS,
  type CanvasToken,
  type LayoutCanvasProps,
} from './layout-canvas.js';
export {
  LAYOUT_CATALOGUE,
  createLayoutCatalogue,
  type LayoutCatalogue,
  type LayoutCatalogueEntry,
} from './layout-catalogue.js';
export {
  LAYOUT_PROBLEM_STYLES,
  LayoutProblem,
  invalidLayoutProblem,
  targetMismatchProblem,
  unknownLayoutProblem,
  type LayoutProblemKind,
  type LayoutProblemProps,
} from './layout-problem.js';
export { WIDGET_NAMES, WIDGET_REGISTRY, widgetFor, type WidgetName } from './widget-catalogue.js';
export {
  fitCanvas,
  parsePageRequest,
  useViewport,
  type CanvasFit,
  type PageMode,
  type PageRequest,
  type ViewportSize,
} from './viewport.js';
