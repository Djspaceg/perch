---
version: alpha
name: Dense-inspector-panel
description: |
  A dense, quiet inspector language for desktop authoring tools, dark by default with a light scheme that follows the system: one-line property rows (label left, control right) in folding sections of a resizable, foldable sidebar, on a cool near-black ladder (or its light counterpart) where fields are wells and section bars are faintly raised. System sans at 11.5px and 10.5px, 22px rows, 20px fields, 3px corners, 24px targets under touch. One blue accent means "this one"; two muted colours mean "set here" and "inherited"; a soft red is kept for deletion. Motion is short, height and opacity only, and off under reduced motion. Every value is both typeable and directly manipulable.

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
  header: "#0d1016"
  header-text: "#9aa4b2"
  scrim: "rgba(7, 8, 10, 0.7)"
  picker-ring: "rgba(0, 0, 0, 0.6)"

colors-light:
  primary: "#1f5fae"
  on-primary: "#0d2747"
  primary-fill: "#d3e2f6"
  primary-edge: "#2f6fc0"
  canvas: "#d5dae1"
  panel: "#f5f6f8"
  panel-recessed: "#e9ecf0"
  bar: "#fbfcfd"
  bar-edge: "#ffffff"
  bar-shadow: "#d6dae1"
  field: "#ffffff"
  field-edge: "#7a8391"
  field-edge-hover: "#5a6473"
  hover: "#e2e6ec"
  row-hover: "#eceff3"
  popover: "#ffffff"
  toolbar-edge: "#cdd2da"
  group-divider: "#d5d9e0"
  swatch-edge: "#7a8391"
  ink: "#141a23"
  ink-2: "#2e3846"
  heading: "#1b2330"
  heading-hover: "#000000"
  label: "#454f5e"
  quiet: "#505a68"
  faint: "#5a6473"
  fill-bar: "#dce7f5"
  own: "#2f6fc0"
  own-text: "#1d5aa6"
  inherited: "#9a6a1c"
  inherited-text: "#7f5512"
  danger: "#b3261e"
  danger-fill: "#fbe7e5"
  danger-strong: "#8c1d18"
  danger-surface: "#fdf1f0"
  danger-edge: "#c9605a"
  success: "#1b6e3f"
  success-fill: "#e1f3e8"
  success-edge: "#3f8a5f"
  warning: "#805200"
  warning-fill: "#fbf0d6"
  warning-edge: "#a5781f"
  checker-light: "#ffffff"
  checker-dark: "#d3d8df"
  scroll-thumb: "#b4bbc6"
  scroll-track: "#eceff3"
  focus-ring: "#1f5fae"
  popover-shadow: "rgba(20, 26, 35, 0.18)"
  header: "#e9ecf0"
  header-text: "#454f5e"
  scrim: "rgba(245, 246, 248, 0.7)"
  picker-ring: "rgba(0, 0, 0, 0.45)"

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
  label-column: clamp(96px, 38%, 180px)
  sidebar-width: 420px
  sidebar-min: 300px
  sidebar-max: 540px
  sidebar-handle: 14px
  splitter-hit: 8px
  work-area-min: 320px
  touch-target: 24px
  touch-field-height: 26px
  touch-row-height: 30px

components:
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    width: "{spacing.sidebar-width}"
    borderColor: "{colors.toolbar-edge}"
  sidebar-splitter:
    width: "{spacing.splitter-hit}"
    borderColor: "{colors.primary}"
  sidebar-handle:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.quiet}"
    width: "{spacing.sidebar-handle}"
    borderColor: "{colors.toolbar-edge}"
  sidebar-handle-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
  tooltip:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: 3px 7px 4px
    borderColor: "{colors.field-edge-hover}"
    shadow: "0 4px 12px {colors.popover-shadow}"
  header:
    backgroundColor: "{colors.header}"
    textColor: "{colors.header-text}"
    typography: "{typography.toolbar}"
    height: 44px
    padding: 0 10px
    borderColor: "{colors.toolbar-edge}"
  header-more:
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: 20px
    borderColor: "{colors.field-edge}"
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

A working surface, not a showcase: the inspector of a design tool, a game engine or a settings pane, for people who adjust many small values quickly and want to see them all at once. Cool, dense and calm, dark by default and light where the system is. The chrome stays out of the way of the content, and every element earns its place by holding a value or saying where that value comes from.

The mood comes from restraint. The only accent, `{colors.primary}`, always means "this one". Two muted provenance colours, `{colors.own}` and `{colors.inherited}`, answer the question every inspector raises: is this value mine, or am I seeing a default? Everything else is a ladder of blue-greys: near-black in the dark scheme, near-white in the light one.

**Key characteristics:**
- One property per 22px row: label left, control right, an end slot for undoing it.
- Fields are recessed wells and section bars are faintly raised. Only floating boxes cast a shadow.
- Two type sizes, 11.5px and 10.5px, in the platform's own sans.
- Every value is typeable and directly manipulable, and a set value is one click from reset.
- Motion is brief, vertical and optional.

## Colors

The values are in the front matter: `colors` is the dark scheme and `colors-light` the light one, with the same roles under the same names. This section gives each colour's role, which is the same in both.

- **Schemes**: the system's by default (`prefers-color-scheme`), or one the author picks: System, Light or Dark. The pick lives where the host keeps settings (a desktop app's Settings window, or a browser page's More menu) and applies to every window. A scheme changes the chrome only: the content being edited keeps its own colours.
- **The light ladder** is not an inversion of the dark one. The window is a mid grey so a light panel still reads as a panel, fields are white wells with a visible edge (a recess cannot be drawn darker than a light panel without looking like a hole), and raised bars are lighter than the panel with a darker edge below.
- **Contrast**: in the light scheme every text role is at least 4.5:1 on every surface it is drawn on, and every control edge, mark and the focus ring at least 3:1 (WCAG 2.2 AA, 1.4.3 and 1.4.11).

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
- **Header**: `{colors.header}` behind `{colors.header-text}`, the window's toolbar strip.
- **Scrim** (`{colors.scrim}`) veils a thumbnail while it loads. **Picker ring** (`{colors.picker-ring}`) is the dark hairline round a colour picker's white pointer, so it shows on white.
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
- **Row grid**: three columns. A label column of 38% of the row, held between 96px and 180px (`{spacing.label-column}`) and right-aligned so every label sits next to its control; a value column (`minmax(0, 1fr)`); and an 18px end slot. The columns are 6px apart, and every cell can shrink to zero, so a long value truncates in its own column.
- **Panel**: a sidebar of groups, each a stack of folding sections. It is `{spacing.sidebar-width}` by default and resizable from `{spacing.sidebar-min}` to `{spacing.sidebar-max}`, or folded to a `{spacing.sidebar-handle}` handle. A folded section is one bar with a summary, so folded sections still map the whole. Rarely used properties go behind a nested "Advanced" fold, which says how many hidden values are set.
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
- **Changing what is selected**: sections have stable names, so a section two selections share stays where it is, folded or open, and only its values change. Sections and rows that do not carry over shrink away while the new ones grow, in the same 180ms. Nothing scrolls.
- **Reduced motion**: `prefers-reduced-motion` makes every change instant.
- **Disclosure triangles** turn in 80ms.

### Panel and section
- `panel` holds groups, each headed by an uppercase `{typography.group-title}` bar.
- `section-bar` is a raised 22px header. Its title is the disclosure button, with a quiet triangle beside it.
- `section-summary` sits at the right edge of the header and truncates first. It turns `section-summary-set` when anything inside the section is set.
- The panel's groups, top to bottom: **Global** (each of its panels titled "Global ...": Global Target, Global Clock, Global Appearance and so on), **Elements**, then **Selected entity**, which opens with the selection header: its name line and its kind and path line 3px apart (`{spacing.xs}`), with 6px above (`{spacing.sm}`) and 10px below before the tabs (`{spacing.md}`), each line one line, ellipsised.
- **No category filter.** Every section is always listed; its disclosure triangle is what hides it. The Customize and Developer tabs switch what a token pane shows, and its search filters by text; neither is a category filter.
- **Drag handle.** Every top-level section of Global and of Selected entity has a six-dot grip just before its triangle, faint until hovered, and its whole header is a drag source, with a grab cursor (the title keeps its pointer). A press that moves less than 4px and lets go is a click, and folds the section; past 4px it drags, and does not fold. A control of the header's own stays a control. Dragging moves the section: a 0.3-opacity copy of its header follows the pointer, and a 2px Primary line marks the gap it will drop into. Escape lets go. With the grip focused, Alt+ArrowUp and Alt+ArrowDown move it one place. Sections move only within their group, and the order is remembered per group; the selected entity's order is one order for every element.
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
- **Stacked** (`property-row-stacked`): prose and templates, a text element's text, have no label column. The label is a line of its own above, and the field spans the row and grows with the sidebar. The `{}` insert button sits at the field's top-right; the field resizes vertically.

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
- **Long closed lists that can hold a value they leave out** (the layout clock's locale and time zone): a searchable dropdown. The field shows the choice's words; it opens a popover with a search and the list, the choice marked and in view, "System default" first. A stored value the list lacks is listed after System default and stays selected; a search that matches nothing but is itself a valid value is offered as "use ...".
- **Open vocabularies**: stay as text fields with suggestions, because a closed list cannot show a value it doesn't contain.

### Buttons
- **Primary** (`button-primary`): the one commit action on a surface.
- **Quiet** (`button-quiet`): the default. It brightens on hover, and a disabled one fades to `{colors.faint}`.
- **Icon** (`button-icon`): an 18px square, used for reset, that hovers to `{colors.hover}`. Its name says what the value returns to.
- **Destructive** (`button-destructive`): the same square in Danger, used only for delete. It hovers to `button-destructive-hover`. Pressing it unfolds an `inline-confirm` over the row, with focus on the confirm button and a way to back out.

### Chip and search
- `search-field` is an 18px pill that matches every word typed. Escape clears it.
- `chip` is an 18px toggle in a named group. A pressed chip becomes `chip-pressed`.
- A chip is as wide as its whole label and never truncates. The strip is one line that scrolls sideways when the chips do not fit: a trackpad swipe, a vertical mouse wheel, or focus. The edge with more chips past it fades out.
- Chips and search filter the same list. A search opens the sections that match it.

### Swatch and colour input
- A `swatch` sits before a mono text field. It paints its colour over the checkerboard, and becomes `swatch-open` while its picker `popover` is open.
- The text field accepts any common notation, including alpha.
- Text the field can't read is kept exactly as typed, and the swatch shows as empty.

### Popover
- `popover` is anchored to its control and flips or pins to stay on screen.
- It takes focus when it opens, once it is placed (it is hidden for the one frame it is measured in).
- Escape, or a press outside, closes it; Escape returns focus to the anchor.

### Template insert
- A text element's text field has a `{}` button that opens a `popover` with three tabs: **Sensor** (the sensor picker), **Clock** (each token beside how it reads now) and **Style**.
- **Style** wraps the selection in a style span (`{#label}`, `{#unit}`, `{#value}`, `{#note}`), adds a filter (`| fit`, `| hold`, `| note`, ...) to the sensor placeholder at the caret, or turns that placeholder into a readout's three rows.
- With the caret in no sensor placeholder, the filters and the readout button are disabled, and the group's heading says to put the caret in one.
- Whatever is inserted, the field's validator judges the result as it would typing, and the preview paints it live.

### List row
- `list-row` (the Elements list, after Photoshop's Layers palette): the eye in a fixed first column, a kind glyph or thumbnail two thirds of the row's height (T, a chart line, a gauge for a reading, an image's own picture or a picture glyph), the truncating name, and the element's index, faint, at the right. A row is 28px, from one variable (`--ed-element-row-h`, 14/11 of the base row): 38px under a coarse pointer, and never under the 24px touch target. A 1px `{colors.group-divider}` line runs under every element row, as in Photoshop's Layers palette, inside the row and over its selected or hover fill; the drop line draws over it, and the background row, always last, has none. It hovers to `{colors.hover}`; selected is `list-row-selected`, and ends in Duplicate and Delete.
- **The background row** is last: "Background" in italics, its source quiet after it, a lock at the right edge, and no delete (its source is cleared in its Content section).
- **Above the list**: a "Kind" label with Text, Media, Chart and Reading toggles, which list only the kinds pressed (the background stays) and title the panel "Elements (filtered)", with a clear while any is on; and beside them the selected element's opacity, the same scrubbing field as its Appearance row.
- **Panel options**: a three-line button in the Elements bar opens a menu: Show thumbnails, Clear kind filter, Reset panel order.
- **Reordering**: a 2px Primary line marks where the row will drop, and the same move works from the keyboard.
- Everything here says "element", never "layer".

### Placement
- The selected entity's box, as Affinity's Transform panel lays it out. Global Placement, the theme's, is a different panel.
- **Resize band**: a 3x3 resize anchor grid at the left, x/y and w/h as two rows of fields beside it with no label column. x and y are the anchor point's position; w and h resize about it, so it stays put. One anchor for every element, remembered, top left by default. Rects are still stored top-left; the canvas handles each hold the opposite edge as before. Below 200px of block width the grid goes on its own row above the fields.
- **Content band**: under it, labelled "Content alignment", the 4x4 (text) or 3x3 (readout) grid of where the content sits inside the box, never where the box sits, with its value in words, source mark and reset. Only kinds that have it show the band; it grows in and collapses away in height.

### Status indicator
- `status-dot` is Faint when idle, Inherited while working, Success when good and Danger when lost. It always sits beside words.
- `badge-warning` is a pill for a state that must not be missed.

### Tabs
- **The strip** is a recessed bar in `{colors.panel-recessed}` with a single baseline.
- **Each `tab`** is quiet text with no chrome.
- **The selected tab** (`tab-selected`) takes the panel colour and breaks the baseline, so the tab and its content read as one surface.
- **Keyboard**: arrow keys move between tabs.

### Resize handle
- `sidebar-splitter` straddles the sidebar's inner edge: an 8px grab zone (`{spacing.splitter-hit}`), invisible until hovered, focused or dragged, when a 2px Primary line shows.
- **Pointer**: drag to resize within `{spacing.sidebar-min}` to `{spacing.sidebar-max}`; a double-click returns to `{spacing.sidebar-width}`. Dragged well past the minimum, the sidebar shows at its narrowest, faded, and folds when let go.
- **Keyboard**: it is a focusable window splitter (`role="separator"` with its value, minimum and maximum). Arrow keys nudge 10px (Shift for 50), Home and End go to either end, Enter folds.
- The width is remembered, and gives way to the window so the work area keeps `{spacing.work-area-min}`.

### Collapsed handle
- `sidebar-handle` is what a folded sidebar leaves: a `{spacing.sidebar-handle}` strip on the window's right edge with an inward chevron. It hovers to `sidebar-handle-hover`.
- Pressing it, or the fold's shortcut, brings the sidebar back at the width it had. Focus that was in the sidebar moves to the handle when it folds, and back to the splitter when it opens.
- The fold is remembered. A window narrower than the minimum sidebar plus the minimum work area folds it on its own, without changing what is remembered.

### Tooltip
- `tooltip` is a small floating box, the popover's surface in either scheme, with no arrow.
- **When**: after 500ms of hover or keyboard focus alike; at once when moving from one tip to the next; never for touch.
- **Gone**: when the pointer leaves (the tooltip itself can be hovered), on blur, a press, scroll or Escape, which leaves focus where it was.
- **Where**: below its target, above when there is no room, pinned inside the window, by the popover's own placement.
- **Accessible**: while shown, and from the moment of keyboard focus, it is part of the target's description, after any it already had. A tip that only repeats a control's name is not added. A truncated label's tip shows only while it is truncated.

### Header and More
- `header` is one line that never wraps and never clips. Each item has a rank, and what does not fit moves into a `header-more` popover at the end of the line, least needed first, and comes back when there is room. The unsaved mark and the commit action never move.
- In a browser, More also holds the colour scheme.

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

- **Media queries**: `prefers-color-scheme` picks the scheme, `prefers-reduced-motion` turns motion off, and `pointer: coarse` grows the targets. There are no width breakpoints: the sidebar is sized by the author and the window, and the header by what fits.
- **Sidebar**: `{spacing.sidebar-width}` by default, resizable from `{spacing.sidebar-min}` to `{spacing.sidebar-max}`, foldable to `{spacing.sidebar-handle}`. It gives way so the work area keeps `{spacing.work-area-min}`, and in a window narrower than the two together it folds on its own.
- **Rows**: nothing wraps at any width in the range. The label column scales with the row between 96px and 180px, labels truncate with an ellipsis, read-outs shrink, chips scroll sideways rather than shrink, and controls take what is left. Only prose wraps: an empty state, a help line, an error, and a stacked text field.
- **Small windows**: the header keeps one line by moving items into More. The sidebar folds. Popovers and tooltips stay on screen at any size.
- **Touch**: under a coarse pointer only, rows grow to `{spacing.touch-row-height}`, fields to `{spacing.touch-field-height}` and every target to at least `{spacing.touch-target}` (WCAG 2.2, 2.5.8). A mouse keeps the density.

## Iteration Guide

1. Change density in one place: row height, field height, label column, inset, gap and radius are variables.
2. Prefix the chrome's variables so they can't collide with the content being edited.
3. Describe properties as data, and draw every one through the same row and the same control for its kind.
4. Before adding a component, check whether a row, a field, a button family, a chip or a popover already covers it.
5. Add states as separate entries: `-hover`, `-focus`, `-set`, `-selected`, `-invalid`.
6. A scheme is a second set of values for the same names. Never write a colour into a component: name the role.
7. After changing a token, run `node tools/design-preview.mjs` to regenerate `preview.html`'s tokens from this front matter, then open it in both schemes.

## Known Gaps

- **The dark scheme's own contrast.** The light scheme meets WCAG AA for text and 3:1 for edges; the dark scheme, as designed, does not everywhere: `{colors.quiet}` is about 4.2:1 on the panel, `{colors.faint}` about 2.6:1, and field edges about 1.3:1, with wells told apart by their fill.
- **The picker itself.** The colour picker's gradients and strips are a third-party widget. Its frame, edges, checkerboard, pointer ring and focus are themed, but its gradients and pointer geometry are its own.
- **Origin.** This was extracted from the perch layout editor's sidebar. Its tokens are in `apps/editor/src/controls/chrome.ts`.
