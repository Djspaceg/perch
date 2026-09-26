/**
 * The editor chrome's own design tokens, as CSS custom properties every primitive reads.
 *
 * Row height, the label column, spacing and the chrome palette are decided here, once. A density
 * change — 22px rows to 20px, a wider label column — is one edit to this block, not a sweep through
 * ten components. These are the *editor's* variables (`--ed-*`), deliberately a different prefix from
 * the layout's `--perch-*` tokens: nothing here styles a dashboard, and a layout's theme cannot reach
 * the inspector.
 *
 * ## Motion
 *
 * `--ed-motion-duration` and `--ed-motion-ease` are the whole of the sidebar's motion: every region
 * that grows or shrinks (`collapse.tsx`) reads them, so tuning it is one edit here. Short and
 * ease-out, height and opacity only. `prefers-reduced-motion: reduce` sets the duration to zero, and
 * `Collapse` asks the same query, so with it set every change lands at once.
 *
 * ## The scrollbar
 *
 * Thumb and track are chrome colours like any other. `scrollbar-color` inherits, so declared on the
 * root it reaches every scroller in the editor — the sidebar, the problems list, a textarea, a
 * picker's list — with none of them opting in. Safari reads only the `::-webkit-scrollbar`
 * pseudo-elements, which do not inherit, so those are unscoped; Chromium ignores them wherever the
 * standard properties apply, so the two never fight.
 */
export const CHROME_STYLES = `
:root {
  --ed-row-h: 22px;
  --ed-field-h: 20px;
  --ed-label-col: 38%;
  --ed-pad-x: 8px;
  --ed-gap: 4px;
  --ed-radius: 3px;
  --ed-font: 0.71875rem;
  --ed-font-small: 0.65625rem;
  --ed-mono: ui-monospace, SFMono-Regular, Menlo, monospace;

  --ed-bg: #0f1217;
  --ed-bg-recessed: #0a0c10;
  --ed-bar: #171b23;
  --ed-bar-edge: #1f242e;
  --ed-bar-shadow: #0a0c10;
  --ed-field: #0a0c10;
  --ed-field-edge: #232933;
  --ed-field-edge-hover: #2e3542;
  --ed-hover: #1a1f28;

  --ed-text: #e8f1ff;
  --ed-text-2: #b7c2d2;
  --ed-label: #8f9aab;
  --ed-quiet: #6b7889;
  --ed-faint: #4c586b;

  --ed-accent: #8fb7e8;
  --ed-accent-fill: #2a3f5c;
  --ed-fill-bar: #22344d;
  --ed-own: #6f9fd8;
  --ed-own-text: #9cc2ee;
  --ed-inherited: #b8955c;
  --ed-inherited-text: #c9ad7d;
  --ed-danger: #e8a08f;
  --ed-danger-fill: #2a1414;

  --ed-axis-x: #c8645c;
  --ed-axis-y: #72a85a;
  --ed-axis-w: #5b8fd0;
  --ed-axis-h: #c8a04e;

  --ed-motion-duration: 180ms;
  --ed-motion-ease: cubic-bezier(0.2, 0, 0, 1);

  --ed-scroll-size: 10px;
  --ed-scroll-thumb: #2e3542;
  --ed-scroll-thumb-hover: #4c586b;
  --ed-scroll-track: #0a0c10;

  scrollbar-color: var(--ed-scroll-thumb) var(--ed-scroll-track);
  scrollbar-width: thin;
}
@media (prefers-reduced-motion: reduce) {
  :root { --ed-motion-duration: 0ms; }
}
::-webkit-scrollbar { width: var(--ed-scroll-size); height: var(--ed-scroll-size); }
::-webkit-scrollbar-track { background-color: var(--ed-scroll-track); }
::-webkit-scrollbar-thumb {
  background-color: var(--ed-scroll-thumb);
  border: 2px solid var(--ed-scroll-track);
  border-radius: 5px;
}
::-webkit-scrollbar-thumb:hover { background-color: var(--ed-scroll-thumb-hover); }
::-webkit-scrollbar-corner { background-color: var(--ed-scroll-track); }
.perch-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.perch-input {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--ed-field-h);
  box-sizing: border-box;
  border: 1px solid var(--ed-field-edge);
  border-radius: var(--ed-radius);
  background: var(--ed-field);
  color: var(--ed-text);
  font: inherit;
  font-size: var(--ed-font);
  padding: 0 6px;
}
.perch-input:hover { border-color: var(--ed-field-edge-hover); }
.perch-input:focus { outline: none; border-color: var(--ed-accent); }
select.perch-input { padding: 0 2px; }
.perch-input--mono { font-family: var(--ed-mono); font-size: var(--ed-font-small); }
`;
