# Perch — Architecture

> Status: tentative. This document is the agreed shape, not a finished design.
> Lines marked `ASSUMPTION:` are decisions made without confirmation — redline them.

## What perch is

**Perch is a dashboard authoring toolchain for hardware telemetry.**

You author a dashboard once, and perch renders it wherever you want it: a browser
tab, a standalone bundle on disk, or a physical LCD panel.

## What perch is not

These are the boundaries that keep the project from sprawling. Each is a thing
perch deliberately does *not* own:

- **Not a sensor reader.** Reading CPU/GPU temps is a solved commodity
  (LibreHardwareMonitor, and trcc's own per-OS `Platform` adapters). Perch
  consumes sensor values; it does not discover hardware.
- **Not a panel driver.** Perch does not speak USB, HID, or any vendor LCD
  protocol. It produces pixels; something else moves them to a device.
- **Not a message broker.** MQTT is transport. Perch speaks it; it does not
  implement it.
- **Not a theme store.** Layouts are files in your repo, not cloud assets.

Everything in that list is an **adapter**. None of it is the product.

## The shape

```text
        INPUT ADAPTERS                 CORE                  OUTPUT ADAPTERS
   ┌───────────────────┐    ┌──────────────────────┐    ┌───────────────────┐
   │ MQTT subscriber   │    │  editor  (authors)   │    │ browser tab       │
   │ mock generator    │───▶│      ↕ layout        │───▶│ standalone bundle │
   │ trcc metrics      │    │  runtime (renders)   │    │ captured frames   │
   │ HTTP poll         │    │      ↕ ui-kit        │    │   → LCD panel     │
   └───────────────────┘    └──────────────────────┘    └───────────────────┘
            ▲                          ▲
            │                          │
     sensor-contract            layout-schema
     (what a reading is)     (what a dashboard is)
```

The core is four packages. Everything else is an adapter on one side or the other.

## The two contracts

These are the only two things that must be right early. Adapters are cheap to
replace; contracts are not.

### `sensor-contract` — what a sensor reading is

Owns the topic convention (`sensors/<device>/<metric>`) and the value shape.
Consumed by every input adapter and by `ui-kit`. Zero runtime dependencies.

### `layout-schema` — what a dashboard is

The pivot of the whole project: **the editor writes it, the runtime reads it,
both validate it.** A layout declares its target resolution and frame rate, its
widgets, each widget's bound topic, its text and media elements, and its style
tokens.

Because it is the one artifact that outlives every other decision, it carries an
explicit version field and a migration path from day one.

### Three contract rules, learned the hard way

Taken from reviewing a sibling project's command contract, where each of these
had gone wrong:

1. **If a contract claims a type is serializable, it must actually be.** No
   `bytes` or filesystem-path fields in anything documented as JSON-safe.
   Encode at the boundary, and say so in the contract itself.
2. **Event and topic names live in exactly one place.** A producer and a consumer
   that each keep their own list will drift, and the failure mode is a silent
   subscription that never fires.
3. **A contract must be able to express what the other side doesn't know.**
   Resolution negotiation is the concrete case: a layout authored for 1920×400
   must be able to say so and be rejected cleanly by a target that can't do it.

## Folder structure

```text
perch/
  ARCHITECTURE.md                 this document
  packages/                       libraries — things that get imported
    sensor-contract/SPEC.md       what a sensor reading is
    layout-schema/SPEC.md         what a dashboard is
    ui-kit/README.md              the widgets, and the canvas that lays them out
    sensor-sources/README.md      where sensor data enters
  apps/                           deployables — nothing imports these
    runtime/README.md             renders a layout
    editor/SPEC.md                authors a layout
    agent/SPEC.md                 reads sensors, publishes MQTT
    caster/SPEC.md                puts a bundle on a capturable surface
    desktop/README.md             the desktop app: relay + runtime page in one Electron process
  layouts/README.md               your actual dashboards (content, not code)
```

**`packages/` vs `apps/` is load-bearing, not cosmetic.** If it lives in
`packages/`, something imports it, and it is potentially publishable. If it lives
in `apps/`, nothing in this repo may import it. That makes the "products are
leaves" rule structural instead of a convention someone has to remember.

### `packages/` — libraries

| Package | Kind | Owns | Depends on |
|---|---|---|---|
| `sensor-contract` | contract | topic names, sensor value shape, metadata shape, source interface | — |
| `layout-schema` | contract | layout format, validation, versioning, migration | — |
| `ui-kit` | core | widgets: readout, gauge, sparkline; the widget catalogue; `LayoutCanvas`, which paints a whole layout | `sensor-contract`, `layout-schema` |
| `sensor-sources` | adapter | implementations of that one interface: mock, mqtt, and later ones | `sensor-contract` |

### `apps/` — deployables

| App | Kind | Owns | Depends on |
|---|---|---|---|
| `runtime` | core | renders a layout; windowed + capture mode; emits a standalone bundle | `ui-kit`, `sensor-sources`, both contracts |
| `editor` | core | drag-and-drop authoring; writes a layout definition | `ui-kit`, `sensor-sources`, both contracts |
| `agent` | input adapter | reads a sensor source, publishes to MQTT | `sensor-contract` |
| `caster` | output adapter | runs a bundle at target resolution on a capturable surface | — (consumes runtime's built artifact) |
| `desktop` | host | the Electron app: the runner (relay in-process, runtime page rendering a layout document from disk, tray); the editor window is next | `agent` (as a library), runtime's built page (artifact) |

Dependency rules:

- Contracts depend on nothing. They are leaves, and nothing in them imports
  anything else in the repo. That includes `layout-schema`, which must not import
  `ui-kit` even though `ui-kit` now imports **it**: the widget vocabulary is
  *injected* into the validator as a `WidgetRegistry` at the call site, so the
  edge runs one way only and the two stay acyclic.
- `ui-kit` cannot live inside `runtime` or `editor`, because **both render it**.
  The editor's canvas must draw the same gauge the runtime draws, or WYSIWYG is
  a lie.
- `ui-kit` depends on `layout-schema`, and that edge is deliberate. It is what
  lets **the canvas itself** live in `packages/` rather than in one app: the
  thing that turns a validated `Layout` into positioned pixels needs the layout
  types, and both products need that thing to be the same code. The alternative
  — a third package holding just the canvas — buys nothing at this size and adds
  a hop between the canvas and the widgets it draws. See DECISIONS.md.
- `agent`, `runtime`, `editor`, and `caster` are products. Nothing depends on
  them, and they never import each other. The one exception is `desktop`, a host
  rather than a product of its own: it imports `agent` through its library
  export (`startRelayService`) to run the relay in its main process, and loads
  `runtime`'s **built page**, an artifact boundary like `caster`'s. Nothing
  imports `desktop`.
- `caster` depends on runtime's **built output**, not its source. Artifact
  boundary, not a code boundary — which is what keeps a browser engine out of a
  browser bundle.

## Why `ui-kit` has a frame budget

Under every output path, the page is **captured**, not interacted with. That is a
design constraint on the widgets themselves, not an afterthought:

- No hover, focus, or interaction affordances in capture mode.
- Animation and redraw must complete inside the capture interval.
- Nothing that tears or leans on sub-pixel antialiasing — it reads badly on a
  physical panel.
- Deterministic first paint, with an explicit "ready to capture" signal, so
  frame one is never a half-loaded page.

`runtime` therefore has two modes: a normal windowed mode, and a capture mode
with a fixed viewport, no scrollbars, and that ready signal.

## Why `agent` polls, and carries the broker

`agent` exists, and it polls. The question was whether the sensor host already
enumerates sensors and emits them on a tick — in which case perch would have
needed a bridge rather than a poller. It does not: `agent` reads
LibreHardwareMonitor's `/data.json` on its own interval and maps each reading onto
the topic grammar. Nothing upstream pushes, so something has to pull.

The broker runs inside that same process — `aedes`, fronted by native MQTT on TCP
and MQTT over WebSockets. That is an install-story decision, not a transport one:
an external Mosquitto is a user-facing prerequisite (install it, write a
`listener 9001` block, enable `protocol websockets`, run it as a service), and
perch does not add one — so the relay executable is the whole install beyond
LibreHardwareMonitor itself. Two listeners because a browser cannot open a TCP
socket and the dashboard is a browser; **one** `aedes` behind both, so a retained
message is visible on either. None of this breaches "not a message broker" above.
Perch still does not implement MQTT; it embeds an implementation, the same way it
consumes sensor readings without discovering hardware. See DECISIONS.md.

## V1 slice

The smallest thing that proves the pipeline end to end:

> A hand-written layout JSON renders at 1920×400 in a browser tab, fed by a mock
> sensor source.

No agent, no MQTT, no editor, no panel. Once that renders:

- the editor is "a GUI that writes this file",
- MQTT is "a different input adapter",
- the panel is "capture this window".

Each becomes additive work behind a contract that already exists.

## Development workflow

One `npm install` at the root. Each package keeps its own dependencies, build,
and release target; you never navigate between them to invoke anything.

```sh
npm run build                     # all packages
npm run build -w @perch/runtime   # one package
npm test                          # all packages
npm test  -w @perch/ui-kit        # one package
npm run dev -w @perch/editor
```

Test environments differ by package: `jsdom` for `ui-kit`, `runtime`, and
`editor`; `node` for the contracts, `agent`, and `caster`.

## Stated assumptions

`ASSUMPTION:` TypeScript throughout.

`ASSUMPTION:` `sensor-contract` and `layout-schema` stay separate packages rather
than one `@perch/contracts`. They version on different clocks, and `agent` has no
business importing layout code.

`ASSUMPTION:` The editor ships first as a plain web app. A native desktop
wrapper is additive and leaks into neither the layout format nor `ui-kit`.
(Held by `apps/desktop`'s runner: neither was touched. The page learns it is
hosted only through a preload bridge that `runtime/src/desktop-host.ts` reads.)

`ASSUMPTION:` Layouts *reference* background media by path; the bundle build
copies assets in. Media is never embedded in the layout file.

`ASSUMPTION:` The broker URL comes from a runtime config file beside the bundle,
not baked in at build time, so one bundle runs against several machines.

`ASSUMPTION:` Sensors and the panel may live on different machines, with MQTT
between them. This is the case that justifies MQTT over a plain WebSocket.

## Open questions

- **Is the target panel driveable at all?** Unresolved hardware question,
  upstream of every panel decision. Nothing else in this document depends on it.

## Reference

- `perch-project-spec.md` — original rationale and rejected alternatives. Its
  architecture sections predate this document and are superseded.
