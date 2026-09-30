---
version: alpha
name: Dense-inspector-panel
description: |
  A dark, dense, quiet inspector language for desktop authoring tools: one-line property rows (label left, control right) in folding sections, on a cool near-black ladder where fields are recessed wells and section bars are faintly raised. System sans at 11.5px and 10.5px, 22px rows, 20px fields, 3px corners. One blue accent means "this one"; two muted colours mean "set here" and "inherited"; a soft red is kept for deletion. Motion is short, height and opacity only, and off under reduced motion. Every value is both typeable and directly manipulable.

colors:
  primary: "#8fb7e8"
  on-primary: "#eef5ff"
  primary-fill: "#2a3f5c"
  primary-edge: "#3b5f8c"
  canvas: "#07080a"
  panel: "#0f1217"
  panel-recessed: "#0a0c10"
  bar: "#171b23"
  bar-edge: "#1f242e"
  bar-shadow: "#0a0c10"
  field: "#0a0c10"
  field-edge: "#232933"
  field-edge-hover: "#2e3542"
  hover: "#1a1f28"
  row-hover: "#12161c"
  popover: "#151920"
  toolbar-edge: "#1b2028"
  group-divider: "#262c36"
  swatch-edge: "#2a303b"
  ink: "#e8f1ff"
  ink-2: "#b7c2d2"
  heading: "#dbe4f2"
  heading-hover: "#ffffff"
  label: "#8f9aab"
  quiet: "#6b7889"
  faint: "#4c586b"
  fill-bar: "#22344d"
  own: "#6f9fd8"
  own-text: "#9cc2ee"
  inherited: "#b8955c"
  inherited-text: "#c9ad7d"
  danger: "#e8a08f"
  danger-fill: "#2a1414"
  danger-strong: "#ffc2b4"
  danger-surface: "#1a0e0e"
  danger-edge: "#5e2323"
  success: "#7ee2a8"
  success-fill: "#10241a"
  success-edge: "#23503a"
  warning: "#e8c98f"
  warning-fill: "#261e10"
  warning-edge: "#5e4a23"
  checker-light: "#6b7889"
  checker-dark: "#262c36"
  scroll-thumb: "#2e3542"
  scroll-track: "#0a0c10"
  focus-ring: "#8fb7e8"
  popover-shadow: "rgba(0, 0, 0, 0.55)"

typography:
  group-title:
    fontFamily: ui-sans-serif
    fontSize: 10.5px
    fontWeight: 700
    lineHeight: normal
    letterSpacing: 0.1em
  section-title:
    fontFamily: ui-sans-serif
    fontSize: 11.5px
    fontWeight: 600
    lineHeight: normal
    letterSpacing: 0
  body:
    fontFamily: ui-sans-serif
    fontSize: 11.5px
    fontWeight: 400
    lineHeight: normal
    letterSpacing: 0
  number:
    fontFamily: ui-sans-serif
    fontSize: 11.5px
    fontWeight: 400
    lineHeight: normal
    letterSpacing: 0
    fontFeature: tnum
  caption:
    fontFamily: ui-sans-serif
    fontSize: 10.5px
    fontWeight: 400
    lineHeight: normal
    letterSpacing: 0
  help:
    fontFamily: ui-sans-serif
    fontSize: 10.5px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0
  mono:
    fontFamily: ui-monospace
    fontSize: 10.5px
    fontWeight: 400
    lineHeight: normal
    letterSpacing: 0
  title:
    fontFamily: ui-sans-serif
    fontSize: 13px
    fontWeight: 600
    lineHeight: normal
    letterSpacing: 0
  toolbar:
    fontFamily: ui-sans-serif
    fontSize: 12px
    fontWeight: 400
    lineHeight: normal
    letterSpacing: 0
  toolbar-strong:
    fontFamily: ui-sans-serif
    fontSize: 12px
    fontWeight: 600
    lineHeight: normal
    letterSpacing: 0

rounded:
  none: 0px
  xs: 2px
  sm: 3px
  md: 4px
  search: 9px
  pill: 999px
  full: 50%

spacing:
  xxs: 2px
  xs: 3px
  gap: 4px
  sm: 6px
  pad-x: 8px
  md: 10px
  lg: 12px
  xl: 16px
  control: 18px
  field-height: 20px
  row-height: 22px
  label-column: 38%
  sidebar-width: 420px

components:
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    width: 420px
    borderColor: "{colors.toolbar-edge}"
  panel-group-bar:
    backgroundColor: "{colors.panel-recessed}"
    textColor: "{colors.ink-2}"
    typography: "{typography.group-title}"
    padding: 6px 8px 5px
  section-bar:
    backgroundColor: "{colors.bar}"
    textColor: "{colors.heading}"
    typography: "{typography.section-title}"
    rounded: "{rounded.none}"
    height: 22px
    padding: 0 8px 0 6px
    borderColor: "{colors.bar-edge}"
  section-summary:
    textColor: "{colors.quiet}"
    typography: "{typography.caption}"
  section-summary-set:
    textColor: "{colors.own-text}"
    typography: "{typography.caption}"
  property-row:
    textColor: "{colors.label}"
    typography: "{typography.body}"
    height: 22px
    padding: 1px 4px 1px 8px
  property-row-set:
    textColor: "{colors.own-text}"
  property-row-inherited:
    textColor: "{colors.inherited-text}"
  source-mark-set:
    backgroundColor: "{colors.own}"
    rounded: "{rounded.full}"
    size: 6px
  source-mark-inherited:
    borderColor: "{colors.inherited}"
    rounded: "{rounded.full}"
    size: 6px
  text-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: 20px
    padding: 0 6px
    borderColor: "{colors.field-edge}"
  text-field-focus:
    borderColor: "{colors.primary}"
  text-field-invalid:
    borderColor: "{colors.danger}"
  number-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    typography: "{typography.number}"
    rounded: "{rounded.sm}"
    height: 20px
    padding: 0 4px 0 6px
    borderColor: "{colors.field-edge}"
  number-field-fill:
    backgroundColor: "{colors.fill-bar}"
  segmented-control:
    backgroundColor: "{colors.field}"
    textColor: "{colors.label}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    height: 20px
    borderColor: "{colors.field-edge}"
  segmented-option-checked:
    backgroundColor: "{colors.primary-fill}"
    textColor: "{colors.on-primary}"
  button-primary:
    backgroundColor: "{colors.success-fill}"
    textColor: "{colors.success}"
    typography: "{typography.toolbar}"
    rounded: "{rounded.sm}"
    padding: 3px 10px
    borderColor: "{colors.success-edge}"
  button-quiet:
    backgroundColor: "{colors.bar}"
    textColor: "{colors.ink-2}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    height: 20px
    padding: 0 10px
    borderColor: "{colors.field-edge}"
  button-icon:
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    size: 18px
  button-destructive:
    textColor: "{colors.danger}"
    rounded: "{rounded.sm}"
    size: 18px
  button-destructive-hover:
    backgroundColor: "{colors.danger-fill}"
    textColor: "{colors.danger-strong}"
  inline-confirm:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.danger}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: 1px 2px 1px 6px
    borderColor: "{colors.danger-edge}"
  chip:
    backgroundColor: "{colors.bar}"
    textColor: "{colors.label}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    height: 18px
    padding: 0 8px
    borderColor: "{colors.field-edge}"
  chip-pressed:
    backgroundColor: "{colors.primary-fill}"
    textColor: "{colors.on-primary}"
    borderColor: "{colors.primary-edge}"
  search-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.search}"
    height: 18px
    padding: 0 8px 0 20px
    borderColor: "{colors.field-edge}"
  swatch:
    rounded: "{rounded.sm}"
    height: 20px
    width: 28px
    borderColor: "{colors.swatch-edge}"
  swatch-open:
    borderColor: "{colors.primary}"
  popover:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 8px
    borderColor: "{colors.field-edge-hover}"
    shadow: "0 8px 24px {colors.popover-shadow}"
  list-row:
    textColor: "{colors.label}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    height: 20px
    padding: 0 6px
  list-row-selected:
    backgroundColor: "{colors.primary-fill}"
    textColor: "{colors.ink}"
  status-dot:
    backgroundColor: "{colors.faint}"
    rounded: "{rounded.full}"
    size: 7px
  badge-warning:
    backgroundColor: "{colors.warning-fill}"
    textColor: "{colors.warning}"
    typography: "{typography.toolbar-strong}"
    rounded: "{rounded.pill}"
    padding: 1px 8px
    borderColor: "{colors.warning-edge}"
  tab:
    textColor: "{colors.quiet}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: 22px
    padding: 0 12px
  tab-selected:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    height: 23px
    borderColor: "{colors.field-edge}"
  focus-ring:
    border: "2px solid {colors.focus-ring}"
---

## Overview

A working surface, not a showcase: the inspector of a design tool, a game engine or a settings pane, for people who adjust many small values quickly and want to see them all at once. Dark, cool, dense and calm. The chrome stays out of the way of the content, and every element earns its place by holding a value or saying where that value comes from.

The mood comes from restraint. The only accent, `{colors.primary}`, always means "this one". Two muted provenance colours, `{colors.own}` and `{colors.inherited}`, answer the question every inspector raises: is this value mine, or am I seeing a default? Everything else is a ladder of near-black blue-greys.

**Key characteristics:**
- One property per 22px row: label left, control right, an end slot for undoing it.
- Fields are recessed wells and section bars are faintly raised. Only floating boxes cast a shadow.
- Two type sizes, 11.5px and 10.5px, in the platform's own sans.
- Every value is typeable and directly manipulable, and a set value is one click from reset.
- Motion is brief, vertical and optional.

## Colors

The values are in the front matter; this section gives each colour's role.

- **Surface ladder**: from darkest to lightest:
  - `{colors.canvas}`: the window.
  - `{colors.field}` and `{colors.panel-recessed}`: input wells, group headers and tab strips.
  - `{colors.panel}`: the sidebar, with `{colors.group-divider}` between its top-level groups.
  - `{colors.bar}`: section headers, chips and quiet buttons. Each has a 1px light edge above and a 1px dark edge below.
  - `{colors.popover}`: floating boxes.
- **Edges and hover**: field borders go from `{colors.field-edge}` to `{colors.field-edge-hover}` under the pointer. Buttons and rows fill with `{colors.hover}`. Whole property rows use the fainter `{colors.row-hover}`.
- **Text**: from strongest to weakest, `{colors.ink}`, `{colors.ink-2}`, `{colors.heading}`, `{colors.label}`, `{colors.quiet}` and `{colors.faint}`, which is also the disabled colour.
- **Accent**: `{colors.primary}` means "this one": focus, a focused border, icon buttons, an open anchor. `{colors.primary-fill}` and `{colors.on-primary}` show a chosen segment, chip or row.
- **Provenance**: `{colors.own}` means set here, `{colors.inherited}` means set by a parent, and a default uses neither. Each has a lighter text tint for its label.
- **Semantic**:
  - `{colors.danger}` is used for deletion and refusal.
  - `{colors.success}` is used for commit and "connected".
  - `{colors.warning}` is used for unsaved work.
  - Each of these has a dark fill and an edge.
- **Checkerboard**: 8px squares of `{colors.checker-light}` and `{colors.checker-dark}`, behind any colour that may be translucent.
- **Focus**: `{colors.focus-ring}`, 2px on `:focus-visible`, inset on controls that fill their row. Text fields show focus with a Primary border instead.
- **Scrollbar**: thin, `{colors.scroll-thumb}` on `{colors.scroll-track}`, set once at the root.

## Typography

- **Families**: `ui-sans-serif, system-ui, sans-serif` for everything, so the chrome feels like the platform's own tool windows. `ui-monospace, SFMono-Regular, Menlo, monospace` for identifiers and colour codes.
- **Two sizes** carry the panel, in rem so they follow the user's font size:
  - 11.5px (`0.71875rem`) for `{typography.body}`, `{typography.number}` and `{typography.section-title}`.
  - 10.5px (`0.65625rem`) for `{typography.caption}`, `{typography.mono}`, `{typography.help}` and the uppercase, 0.1em-tracked `{typography.group-title}`.
- **Larger text** is limited to the selected object's name, in `{typography.title}` (13px/600), and to the window header and badges, in `{typography.toolbar}` and `{typography.toolbar-strong}` (12px).
- **Weight** marks structure, never emphasis: 700 for groups, 600 for sections and names, 400 for every value.
- **Tabular figures** on changing numbers, so they don't jitter.
- **Line height** stays `normal`, because row height sets the rhythm.
- **Long text** truncates with an ellipsis and shows in full as a tooltip.

## Layout

- **Rhythm**: the base unit is 4px (`{spacing.gap}`), with 2px, 3px and 6px for tight gaps. Controls are 18px, fields 20px and rows 22px. Every row, header and paragraph is inset 8px from the left (`{spacing.pad-x}`). There is no vertical scale: rows stack edge to edge, and a section body adds 3px above and 5px below.
- **Row grid**: three columns. A 38% label column, right-aligned so every label sits next to its control; a value column (`minmax(0, 1fr)`); and an 18px end slot. The columns are 6px apart, and every cell can shrink to zero, so a long value truncates in its own column.
- **Panel**: a fixed sidebar (`{spacing.sidebar-width}`) of groups, each a stack of folding sections. A folded section is one bar with a summary, so folded sections still map the whole. Rarely used properties go behind a nested "Advanced" fold, which says how many hidden values are set.
- **Scrolling**: the scroll gutter is always reserved, so rows never shift sideways, and nothing scrolls horizontally.

## Elevation & Depth

Four levels, and one shadow:

- **Recessed** (`{colors.field}`): wells, group headers, tab strips.
- **Flat** (`{colors.panel}`): rows.
- **Raised** (`{colors.bar}`, 1px `{colors.bar-edge}` above and `{colors.bar-shadow}` below): section headers, chips, quiet buttons.
- **Floating** (`{colors.popover}`, 1px `{colors.field-edge-hover}`, `0 8px 24px rgba(0,0,0,0.55)`): popovers and menus.

Depth elsewhere comes from the surface ladder and 1px edges, never blur.

## Shapes

`{rounded.sm}` (3px) is the default for fields, buttons, chips, swatches, segment groups and tab tops. Other radii:

- `{rounded.xs}` (2px) for list rows.
- `{rounded.md}` (4px) for popovers.
- `{rounded.search}` (9px) for the search pill.
- `{rounded.pill}` for badges.
- `{rounded.full}` for marks and dots.
- `{rounded.none}` for panels and bars.

Softness comes from low contrast, not from rounding. Icons are thin strokes in `currentColor` and are `aria-hidden`; the button's name says what it does.

## Components

### Motion
- **Timing**: every region that appears or disappears (a section body, a new row, an inline confirm) grows or shrinks in 180ms with `cubic-bezier(0.2, 0, 0, 1)`.
- **Properties**: only height and opacity change.
- **Focus**: a closing region is inert, and any focus inside it moves somewhere sensible.
- **Reduced motion**: `prefers-reduced-motion` makes every change instant.
- **Disclosure triangles** turn in 80ms.

### Panel and section
- `panel` holds groups, each headed by an uppercase `{typography.group-title}` bar.
- `section-bar` is a raised 22px header. Its title is the disclosure button, with a quiet triangle beside it.
- `section-summary` sits at the right edge of the header and truncates first. It turns `section-summary-set` when anything inside the section is set.
- **States**:
  - Hover brightens the title to `{colors.heading-hover}`.
  - Focus shows an inset ring.
  - Open rotates the triangle.
- Folds are remembered, and a folded body stays mounted.

### Property row
- `property-row` holds a label, a control and an end slot, and fills with `{colors.row-hover}` on hover.
- **Set** (`property-row-set`): a filled `source-mark-set`, a tinted label, and a reset button.
- **Inherited** (`property-row-inherited`): a hollow `source-mark-inherited` and a tinted label.
- **Default**: plain.
- The property's description is the label's tooltip and the control's accessible description, never a line under the row.

### Text and number field
- `text-field` is a 20px recessed well.
- **States**:
  - Hover: `{colors.field-edge-hover}`.
  - Focus: `text-field-focus`, a Primary border.
  - Invalid: `text-field-invalid`, a Danger border, with the reason in words.
  - Disabled: `{colors.faint}` text.
- `number-field` adds tabular figures and a faint unit inside the well.
- A ranged number draws a `number-field-fill` bar inside itself, so the field doubles as its slider.
- The row's label is a horizontal drag handle for the value.

### Select and segmented control
- **Few closed options**: a `segmented-control`, one well split by 1px dividers, with the checked option in `segmented-option-checked` and arrow keys to move the choice.
- **Long closed lists**: a native select, styled as a text field.
- **Open vocabularies**: stay as text fields with suggestions, because a closed list cannot show a value it doesn't contain.

### Buttons
- **Primary** (`button-primary`): the one commit action on a surface.
- **Quiet** (`button-quiet`): the default. It brightens on hover, and a disabled one fades to `{colors.faint}`.
- **Icon** (`button-icon`): an 18px square, used for reset, that hovers to `{colors.hover}`. Its name says what the value returns to.
- **Destructive** (`button-destructive`): the same square in Danger, used only for delete. It hovers to `button-destructive-hover`. Pressing it unfolds an `inline-confirm` over the row, with focus on the confirm button and a way to back out.

### Chip and search
- `search-field` is an 18px pill that matches every word typed. Escape clears it.
- `chip` is an 18px toggle in a named group. A pressed chip becomes `chip-pressed`.
- Chips and search filter the same list. A search opens the sections that match it.

### Swatch and colour input
- A `swatch` sits before a mono text field. It paints its colour over the checkerboard, and becomes `swatch-open` while its picker `popover` is open.
- The text field accepts any common notation, including alpha.
- Text the field can't read is kept exactly as typed, and the swatch shows as empty.

### Popover
- `popover` is anchored to its control and flips or pins to stay on screen.
- It takes focus when it opens.
- Escape, or a press outside, closes it; Escape returns focus to the anchor.

### List row
- `list-row` shows a faint index, a quiet kind and a truncating summary. It hovers to `{colors.hover}`; selected is `list-row-selected`.
- **Reordering**: a 2px Primary line marks where the row will drop, and the same move works from the keyboard.

### Status indicator
- `status-dot` is Faint when idle, Inherited while working, Success when good and Danger when lost. It always sits beside words.
- `badge-warning` is a pill for a state that must not be missed.

### Tabs
- **The strip** is a recessed bar in `{colors.panel-recessed}` with a single baseline.
- **Each `tab`** is quiet text with no chrome.
- **The selected tab** (`tab-selected`) takes the panel colour and breaks the baseline, so the tab and its content read as one surface.
- **Keyboard**: arrow keys move between tabs.

## Do's and Don'ts

### Principles
1. **Dense rows, label left, control right.** Scanning a column of labels is faster than reading a form, and density keeps the whole object in view.
2. **Every value is typeable and directly manipulable.** Text is precise and pasteable, while dragging and nudging are fast. Numbers take arrow keys (Shift for ×10) and a drag on their label. Colours take both a picker and a code.
3. **Accept what people type.** A field holds exactly what was entered. The validator names the problem, and the field never silently empties or rewrites what is being typed.
4. **Provenance is always visible, and a reset is one click.** It shows as a mark, a tint and words, and the reset names the value it restores. "What do I get back?" is the question someone asks before pressing reset.
5. **Destructive actions confirm inline, not in modals.** The confirm appears where the action was, names what will go, and backs out with one key, so attention stays in place.
6. **Motion is short, vertical and optional.** It shows where content went, without slowing an expert down.
7. **Keyboard parity.** Every pointer action has a key. Focus is always visible and is never lost when something closes. Shortcuts are shown in the current platform's own notation.
8. **One control per concept.** One reset, one delete, one colour input and one popover behaviour, so each is learned once and means one thing.
9. **Never colour alone.** Every colour-coded state is also shown by shape, by text, or by the control's accessible name.

### Don't
- Don't use `type="number"`: it turns typos into blanks.
- Don't clamp typed values. Clamp only drags and nudges.
- Don't put a help line under every row.
- Don't put a shadow on anything that doesn't float.
- Don't let content widen the panel or scroll it sideways.

## Responsive Behavior

- **No breakpoints.** The only media query is `prefers-reduced-motion`.
- **Sidebar**: a fixed 420px column that never collapses. The work area takes the rest of the window.
- **Rows**: at that width the label column is about 150px and the value column about 215px. Labels truncate and controls shrink. Only notes and errors wrap.
- **Small windows**: the chrome does not adapt. The header toolbar doesn't wrap, and in a window narrower than 420px the sidebar is clipped. Popovers stay on screen at any size.
- **Touch**: designed for mouse and keyboard. Targets of 18-22px are below WCAG 2.2's 24px minimum.

## Iteration Guide

1. Change density in one place: row height, field height, label column, inset, gap and radius are variables.
2. Prefix the chrome's variables so they can't collide with the content being edited.
3. Describe properties as data, and draw every one through the same row and the same control for its kind.
4. Before adding a component, check whether a row, a field, a button family, a chip or a popover already covers it.
5. Add states as separate entries: `-hover`, `-focus`, `-set`, `-selected`, `-invalid`.
6. After changing a token, open `preview.html`, which is built only from these tokens.

## Known Gaps

- **Dark only.** There is no light theme.
- **No responsive layout.** Controls are sized for a pointer.
- **Native tooltips.** Tooltips use the browser's `title` attribute, so their delay and look are the platform's.
- **The picker itself.** The colour picker's gradient and strips are a third-party widget, so only its container is specified here.
- **Origin.** This was extracted from the perch layout editor's sidebar. Its tokens are in `apps/editor/src/controls/chrome.ts`.
