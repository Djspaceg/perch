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
/**
 * Every colour the chrome paints, by role, as `--ed-<name>`. The names are DESIGN.md's roles where
 * the two differ only in spelling (`bg` is its `panel`, `text` its `ink`, `accent` its `primary`).
 */
export const CHROME_PALETTE = {
  canvas: '#07080a',
  bg: '#0f1217',
  'bg-recessed': '#0a0c10',
  bar: '#171b23',
  'bar-edge': '#1f242e',
  'bar-shadow': '#0a0c10',
  field: '#0a0c10',
  'field-edge': '#232933',
  'field-edge-hover': '#2e3542',
  hover: '#1a1f28',
  'row-hover': '#12161c',
  popover: '#151920',
  'popover-shadow': 'rgba(0, 0, 0, 0.55)',
  header: '#0d1016',
  'header-text': '#9aa4b2',
  'toolbar-edge': '#1b2028',
  'group-divider': '#262c36',
  'swatch-edge': '#2a303b',
  scrim: 'rgba(7, 8, 10, 0.7)',

  text: '#e8f1ff',
  'text-2': '#b7c2d2',
  heading: '#dbe4f2',
  'heading-hover': '#ffffff',
  label: '#8f9aab',
  quiet: '#6b7889',
  faint: '#4c586b',

  accent: '#8fb7e8',
  'accent-fill': '#2a3f5c',
  'accent-edge': '#3b5f8c',
  'on-accent': '#eef5ff',
  'focus-ring': '#8fb7e8',
  'fill-bar': '#22344d',
  own: '#6f9fd8',
  'own-text': '#9cc2ee',
  inherited: '#b8955c',
  'inherited-text': '#c9ad7d',

  danger: '#e8a08f',
  'danger-fill': '#2a1414',
  'danger-strong': '#ffc2b4',
  'danger-surface': '#1a0e0e',
  'danger-edge': '#5e2323',
  success: '#7ee2a8',
  'success-fill': '#10241a',
  'success-edge': '#23503a',
  warning: '#e8c98f',
  'warning-fill': '#261e10',
  'warning-edge': '#5e4a23',

  'axis-x': '#c8645c',
  'axis-y': '#72a85a',
  'axis-w': '#5b8fd0',
  'axis-h': '#c8a04e',

  'checker-light': '#6b7889',
  'checker-dark': '#262c36',
  'scroll-thumb': '#2e3542',
  'scroll-thumb-hover': '#4c586b',
  'scroll-track': '#0a0c10',
} as const satisfies Readonly<Record<string, string>>;

export type ChromeColour = keyof typeof CHROME_PALETTE;

/** The palette as declarations, one per line. */
function declarations(palette: Readonly<Record<string, string>>): string {
  return Object.entries(palette)
    .map(([name, value]) => `  --ed-${name}: ${value};`)
    .join('\n');
}

/**
 * The search field's magnifier, in the scheme's quiet colour. A data URI cannot read a custom
 * property, so the icon is a token of its own.
 */
function searchIcon(stroke: string): string {
  const colour = stroke.replace('#', '%23');

  return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Ccircle cx='4' cy='4' r='3' fill='none' stroke='${colour}' stroke-width='1.3'/%3E%3Cpath d='M6.3 6.3 9 9' stroke='${colour}' stroke-width='1.3'/%3E%3C/svg%3E")`;
}

export const CHROME_STYLES = `
:root {
  --ed-row-h: 22px;
  --ed-field-h: 20px;
  --ed-control: 18px;
  --ed-list-row-h: 20px;
  --ed-label-col: 38%;
  --ed-pad-x: 8px;
  --ed-gap: 4px;
  --ed-radius: 3px;
  --ed-font: 0.71875rem;
  --ed-font-small: 0.65625rem;
  --ed-mono: ui-monospace, SFMono-Regular, Menlo, monospace;

${declarations(CHROME_PALETTE)}
  --ed-search-icon: ${searchIcon(CHROME_PALETTE.quiet)};

  --ed-motion-duration: 180ms;
  --ed-motion-ease: cubic-bezier(0.2, 0, 0, 1);

  --ed-scroll-size: 10px;

  color-scheme: dark;
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
