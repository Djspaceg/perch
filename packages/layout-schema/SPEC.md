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
