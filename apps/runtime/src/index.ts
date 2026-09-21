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
 * What is *not* here any more: `LayoutCanvas`, `WIDGET_REGISTRY` and the rest of the drawing surface.
 * They were exported from here so the editor could ask "what does the runtime paint, and with which
 * widgets" — and the honest answer to that question was never "whatever this app happens to export".
 * They now live in `@perch/ui-kit`, which both apps render, so the editor imports them from there and
 * this file does not re-export them. A pass-through here would only reintroduce the idea that the
 * runtime owns the canvas.
 *
 * What is left is what the runtime genuinely owns: the page and its chrome, the `layouts/` catalogue,
 * the refusal page, and the viewport fit.
 */
export {
  Dashboard,
  SOURCE_STATUS_WORDING,
  type DashboardProps,
  type LiveSourceIdentity,
} from './app.js';
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
export {
  fitCanvas,
  parsePageRequest,
  useViewport,
  type CanvasFit,
  type PageMode,
  type PageRequest,
  type ViewportSize,
} from './viewport.js';
