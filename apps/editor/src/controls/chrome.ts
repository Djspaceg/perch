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
 * ## Schemes
 *
 * Two palettes for the same names: `DARK`, which the editor was designed in, and `LIGHT`. Which one
 * applies is decided in CSS, so nothing has to run before the first paint:
 *
 * ```text
 * <html>                        the system's: light under prefers-color-scheme: light, else dark
 * <html data-ed-scheme=light>   light, whatever the system says
 * <html data-ed-scheme=dark>    dark, whatever the system says
 * ```
 *
 * The attribute is the author's pick (`settings.scheme`, `useChromeScheme`). In the desktop app the
 * pick is made in the Settings window and applied to Electron's `nativeTheme` instead, which is what
 * `prefers-color-scheme` reports in every window, so the editor there leaves the attribute off.
 * `color-scheme` follows, so native selects and scrollbars match. Only `--ed-*` changes: the layout
 * being edited reads `--perch-*`, and the preview pins the scheme it has always been drawn under.
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
 * Every colour the chrome paints, by role, as `--ed-<name>`: the dark scheme, which the editor was
 * designed in. The names are DESIGN.md's roles where the two differ only in spelling (`bg` is its
 * `panel`, `text` its `ink`, `accent` its `primary`).
 */
const DARK = {
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

export type ChromeColour = keyof typeof DARK;

/**
 * The same roles for a light desktop. Not an inversion of the dark ladder: the window is a mid grey
 * so a light panel reads as a panel, fields are white wells with an edge (a recess cannot be drawn
 * darker than a light panel without looking like a hole), and raised bars are lighter than the panel
 * with a darker edge below. Every text role is at least 4.5:1 on every surface it is drawn on and
 * every control edge and the focus ring at least 3:1, which `scheme.test.ts` checks pair by pair.
 */
const LIGHT: Readonly<Record<ChromeColour, string>> = {
  canvas: '#d5dae1',
  bg: '#f5f6f8',
  'bg-recessed': '#e9ecf0',
  bar: '#fbfcfd',
  'bar-edge': '#ffffff',
  'bar-shadow': '#d6dae1',
  field: '#ffffff',
  'field-edge': '#7a8391',
  'field-edge-hover': '#5a6473',
  hover: '#e2e6ec',
  'row-hover': '#eceff3',
  popover: '#ffffff',
  'popover-shadow': 'rgba(20, 26, 35, 0.18)',
  header: '#e9ecf0',
  'header-text': '#454f5e',
  'toolbar-edge': '#cdd2da',
  'group-divider': '#d5d9e0',
  'swatch-edge': '#7a8391',
  scrim: 'rgba(245, 246, 248, 0.7)',

  text: '#141a23',
  'text-2': '#2e3846',
  heading: '#1b2330',
  'heading-hover': '#000000',
  label: '#454f5e',
  quiet: '#505a68',
  faint: '#5a6473',

  accent: '#1f5fae',
  'accent-fill': '#d3e2f6',
  'accent-edge': '#2f6fc0',
  'on-accent': '#0d2747',
  'focus-ring': '#1f5fae',
  'fill-bar': '#dce7f5',
  own: '#2f6fc0',
  'own-text': '#1d5aa6',
  inherited: '#9a6a1c',
  'inherited-text': '#7f5512',

  danger: '#b3261e',
  'danger-fill': '#fbe7e5',
  'danger-strong': '#8c1d18',
  'danger-surface': '#fdf1f0',
  'danger-edge': '#c9605a',
  success: '#1b6e3f',
  'success-fill': '#e1f3e8',
  'success-edge': '#3f8a5f',
  warning: '#805200',
  'warning-fill': '#fbf0d6',
  'warning-edge': '#a5781f',

  'axis-x': '#c0453c',
  'axis-y': '#3f8a2c',
  'axis-w': '#2f6fc0',
  'axis-h': '#a87a1a',

  'checker-light': '#ffffff',
  'checker-dark': '#d3d8df',
  'scroll-thumb': '#b4bbc6',
  'scroll-thumb-hover': '#8f98a6',
  'scroll-track': '#eceff3',
};

/** Both schemes, by name. */
export const CHROME_SCHEMES: {
  readonly dark: Readonly<Record<ChromeColour, string>>;
  readonly light: Readonly<Record<ChromeColour, string>>;
} = { dark: DARK, light: LIGHT };

/** The schemes an author can pick, and `system`, which follows the operating system. */
export type ChromeScheme = 'system' | 'light' | 'dark';

/** WCAG 2's contrast ratio of two opaque `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r = 0, g = 0, bl = 0] = [1, 3, 5].map((at) => {
      const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;

      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });

    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

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

/** The light values under `selector`. */
function lightRule(selector: string): string {
  return `${selector} {
${declarations(LIGHT)}
  --ed-search-icon: ${searchIcon(LIGHT.quiet)};
  color-scheme: light;
}`;
}

export const CHROME_STYLES = `
:root {
  --ed-row-h: 22px;
  --ed-field-h: 20px;
  /* Icon buttons, chips, the search pill, the row's end slot. */
  --ed-control: 18px;
  /* A list row: the Elements list, a sensor, a folded Advanced bar. */
  --ed-list-row-h: 20px;
  /* The least a text button may be: nothing extra under a mouse. */
  --ed-target: 0px;
  /* The splitter's grab zone, straddling the sidebar's edge. */
  --ed-hit: 8px;
  /* 38% of the row, which is about 150px at the default width, held between 96px and 180px so a
     narrow sidebar keeps a readable label and a wide one gives its extra room to the values. */
  --ed-label-col: clamp(96px, 38%, 180px);
  --ed-pad-x: 8px;
  --ed-gap: 4px;
  --ed-radius: 3px;
  --ed-font: 0.71875rem;
  --ed-font-small: 0.65625rem;
  --ed-mono: ui-monospace, SFMono-Regular, Menlo, monospace;

${declarations(DARK)}
  --ed-search-icon: ${searchIcon(DARK.quiet)};

  --ed-motion-duration: 180ms;
  --ed-motion-ease: cubic-bezier(0.2, 0, 0, 1);

  --ed-scroll-size: 10px;

  color-scheme: dark;
  scrollbar-color: var(--ed-scroll-thumb) var(--ed-scroll-track);
  scrollbar-width: thin;
}
${lightRule(":root[data-ed-scheme='light']")}
@media (prefers-color-scheme: light) {
${lightRule(":root:not([data-ed-scheme='dark'])")}
}
/*
 * Touch, and only touch: every target at least 24px (WCAG 2.2, 2.5.8), rows to match. A mouse keeps
 * the density above.
 */
@media (pointer: coarse) {
  :root {
    --ed-row-h: 30px;
    /* 26, so the input inside a field's 1px edge is itself 24. */
    --ed-field-h: 26px;
    --ed-control: 24px;
    --ed-list-row-h: 24px;
    --ed-target: 24px;
    --ed-hit: 24px;
    /* A little less label, so the wider controls still fit a 300px sidebar's value column. */
    --ed-label-col: clamp(88px, 34%, 180px);
  }
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
