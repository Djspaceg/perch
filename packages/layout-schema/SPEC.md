# `@perch/layout-schema` — SPEC

> Status: tentative. `ASSUMPTION:` lines are unconfirmed decisions.

## Purpose

The pivot of the whole project. **The editor writes it, the runtime reads it, both
validate it.** It is the one artifact that will outlive every other decision here,
so it is versioned and migratable from the first commit.

## Owns

- The layout definition format.
- Validation, with errors a human can act on.
- The `schemaVersion` field and the migration path between versions.

## Shape

```ts
type Layout = {
  schemaVersion: number
  target: {
    width: number       // 1920
    height: number      // 400
    frameRate: number   // capture ceiling, not a promise
  }
  theme: Record<string, string>   // CSS custom property tokens
  elements: Element[]             // paint order = array order
}

type Element =
  | { kind: 'widget'; widget: string; topic: string; rect: Rect; style?: Style; range?: [number, number] }
  | { kind: 'text';   text: string;   rect: Rect; style?: Style }
  | { kind: 'media';  src: string;    rect: Rect; fit?: 'cover' | 'contain' }
  | { kind: 'chart';  widget: string; topic: string; rect: Rect; style?: Style; range?: [number, number];
      windowMs: number; gap?: 'break' | 'span' }

type Rect = { x: number; y: number; w: number; h: number }
```

## Gauge range is authored here, not measured

`range` on a widget element is **required for any widget that draws a scale**, and
it is a design decision, not a measurement.

A sensor source can report observed minimum and maximum — LibreHardwareMonitor
does, and they are resettable at runtime — but those are the extremes *seen so
far*, not the sensor's design range. A gauge whose scale silently rescales as the
day's peak moves is unreadable. A CPU-temperature gauge reading 0–100 is a choice
the author makes once.

See `packages/sensor-contract/SPEC.md`, which deliberately excludes range from
sensor metadata for this reason.

## The chart element (added in schema version 2)

A chart is a widget binding plus **a time axis**. It is its own `kind` rather than a
widget element with extra fields, because `windowMs` is *required* for a chart and
meaningless on a gauge, and deciding which fields are required from the value of
`kind` is exactly what the discriminated union is for. An optional `windowMs` on
`kind: 'widget'` would accept a chart with no window and silently ignore a window on
a readout.

What it adds beyond a widget element:

- **`windowMs`** (required) — how much time the x-axis spans, in milliseconds,
  ending at now. Authored, for the same reason `range` is authored: the alternatives
  are an axis that depends on how long the process has been up, or one that depends
  on `rect.w`, and both are the `range` mistake moved into the time axis. The unit is
  in the name because a factor of 1000 in a time axis is invisible in the output, and
  because it matches `at` on a sensor reading, so a renderer needs no conversion.
  Accepted band: `CHART_MIN_WINDOW_MS` (1 s) to `CHART_MAX_WINDOW_MS` (24 h). The
  floor exists because a sub-second window holds too few samples to be a trend at any
  frame rate this format allows, and because a value that small is almost always
  seconds written into a field that wants milliseconds. The ceiling exists because
  nothing in this project buffers history.
- **`gap`** (optional, `'break' | 'span'`, default `'break'`) — what to do with the
  hole a reconnect leaves in the data. The source buffers nothing, so a gap is real
  and visible through `at` timestamps. Whether to *draw* it is a rendering decision,
  but which of the two is correct is a truth decision only the author can make:
  spanning draws a line through time where no measurement existed, which is the same
  class of untruth as two units on one y-axis. So it is a field, the default is the
  honest one, and `DEFAULT_CHART_GAP` is exported so the runtime and the editor cannot
  drift on what an absent `gap` means.

What it deliberately does *not* add:

- **`range` is not a chart rule.** A chart requires an authored range under exactly
  the same condition a widget does — the injected registry says the widget
  `drawsScale` — and both kinds call the same check. Charts got no second copy of the
  rule.
- **No multi-series.** A chart element binds **one** `topic`, like every other bound
  element. Two series that share a unit and a scale need nothing new: paint order is
  array order, so two chart elements with the same `rect` and `range` already stack.
  Two series that do *not* share a unit should not share a y-axis anyway. Multi-series
  with per-series style, labels and independent axes is a real feature with a real
  design; inventing its shape before a renderer exists would be guessing at the field
  names it needs.

## Coordinate system

`ASSUMPTION:` Absolute pixels on a fixed canvas the size of `target`, with the
whole canvas scaled to fit whatever viewport it lands in (letterboxed).

The alternative — responsive/relative layout — sounds more flexible and is wrong
here. The primary target is a fixed 1920×400 panel, the authoring model is
AIDA64-SensorPanel-style absolute placement, and scaling the entire canvas is the
only approach where the editor's canvas and the panel's output are guaranteed
identical. Degrading to a browser tab is then a scale factor, not a reflow.

## Versioning

`schemaVersion` is mandatory and checked on load. A layout one version behind is
migrated forward and the result reported; a layout from the future is rejected
with its version named. There is no "best effort" path — silently ignoring an
unknown field is how authored work gets destroyed.

**Current version: 2.** The chart element is the only change from 1, and it is purely
additive — no version 1 field changed meaning, and every valid version 1 document is a
valid version 2 document with its version number stepped. So the `1 -> 2` migration
rewrites nothing; what the version step buys is the two halves of the boundary being
legible:

- **A new reader handed an old file** migrates it forward and says so.
  `loadLayout` reports the steps it ran, and `formatMigrationReport` names them.
- **An old reader handed a chart layout** refuses the *document* at its
  `schemaVersion`, once, naming the version it can read and the version it was given —
  rather than walking into the elements and blaming the author for four unknown fields
  on an element kind it has never heard of. Refusing at the version is the only refusal
  that tells the human the true problem, which is that their build is too old.

A version step is therefore worth taking even when the migration function is the
identity. The step also has to exist for its own sake: a version 2 with no step from 1
would make `earliestMigratableVersion` 2 and strand every version 1 file as
`unsupported-past-version`.

## Hard rules

1. **JSON-safe only.** Same rule as `sensor-contract`, same reason.
2. **Media is referenced, never embedded.** `src` is a path relative to the layout
   file. The bundle build copies assets in. Base64 in a layout file makes it
   undiffable and unreviewable.
3. **A layout must declare what it needs.** `target` exists so a mismatched output
   can be rejected cleanly and loudly, rather than rendering wrong and being
   discovered on the panel.
4. **Zero runtime dependencies**, beyond a validator. It is a leaf.
5. **No imports out of this package.** It must not know `ui-kit` exists — it names
   widgets by string, and the runtime resolves them.

## Open questions

- **Widget identity.** `widget: string` keeps the schema decoupled from `ui-kit`,
  at the cost of typo-safety. Worth a registry the validator can check against?
- **Grouping.** No groups or nesting in v1. Adding them later is a schema version;
  adding them now is speculative.
- **Per-element visibility rules.** e.g. hide a widget when its sensor is stale.
  Probably belongs here rather than in `ui-kit`, but not in v1.
- **Multi-series charts.** Deferred, not rejected — see the chart section. Two stacked
  chart elements cover the case that shares a scale; anything past that wants per-series
  style and labels, which is a design to do once a chart renderer exists.
