/**
 * Library entry point for `@perch/runtime`.
 *
 * The page's own entry is `src/main.tsx`, which the browser loads through `index.html` — it builds
 * the sources and mounts, so it is deliberately not exported: importing it would mount a
 * dashboard as a side effect.
 *
 * What is exported is the page itself, which takes its sources as a prop. That is what makes it
 * testable, and what will make it embeddable once the runtime reads layouts instead of hard-coding
 * tiles. Windowed and capture mode, the ready signal and the standalone bundle build are described
 * in README.md and still to come.
 */
export { Dashboard, type DashboardSources } from './app.js';
