# `@perch/sensor-contract` — SPEC

> Status: tentative. `ASSUMPTION:` lines are unconfirmed decisions.

## Purpose

The one place a sensor reading is defined. Every input adapter publishes to this
shape; `ui-kit` reads it. If a topic name or field exists in two places, this
package has failed.

## Owns

- The topic grammar and the helpers that build and parse topics.
- The metric vocabulary and each metric's canonical unit.
- The reading shape and the sensor metadata shape.

## Derived from real hardware, not invented

The vocabulary is derived from LibreHardwareMonitor's own type system, because it
is the richest sensor source we know of and anything narrower will not survive
contact with real hardware. LHM declares **14 hardware types** and **21 sensor
types**, each sensor type with a fixed canonical unit.

Crucially, most of that taxonomy is **physics, not vendor concepts** — voltage,
current, power, clock, temperature, flow, humidity. It generalises to other
sources (lm-sensors, powermetrics, a Shelly relay) without carrying LHM's
assumptions along, which is why we adopt it rather than a vocabulary of our own.

## Topic grammar

```text
sensors/<device>/<deviceIndex>/<metric>/<sensorIndex>
```

`ASSUMPTION:` Both indices are optional in authored topics and default to `0`, so
the common case stays readable while the hard case stays expressible:

```text
sensors/cpu/temperature              → sensors/cpu/0/temperature/0
sensors/cpu/0/temperature/3          → CPU 0, core #3
sensors/gpu/1/fan/0                  → second GPU's first fan
sensors/storage/2/level/0            → third disk's used-space level
```

This mirrors LHM's own `Identifier` format (`/intelcpu/0/temperature/3`) —
hierarchical, indexed at both the hardware and sensor level. They solved this
already; copying the shape is cheaper than rediscovering why it needs two indices.

### The `<deviceIndex>` segment is a device *instance*

An ordinal where the source has one, or an **opaque token** where it does not:

```text
sensors/gpu/1/fan/0                                            ordinal — second GPU
sensors/network/684d7057-f1c7-4928-8500-6160b637cc46/data/2     token — one adapter
```

The token exists because LHM identifies a network adapter by GUID and gives it no
ordinal at all (`/nic/%7B684D7057-…%7D/data/2`, verified in
`fixtures/lhm-data.sample.json` — five adapters, no index on any of them). Reading
that GUID as a model name, which is what the contract does with a Super I/O chip's
`/lpc/nct6798d/0`, silently collapses all five onto `sensors/network/0/…`.

Its spelling is `[a-z0-9]+(-[a-z0-9]+)*`, at most 64 characters — `isSensorDeviceToken`.
Lower-case, no percent-encoding, no braces, so one device has one topic; and none of
`/`, `+` or `#`, which an MQTT topic level cannot contain. A digits-only token must be
the ordinal's canonical spelling, so `00` cannot become a second name for device `0`.

The token is **opaque**: it is not an ordinal, nothing may decode meaning back out of
it, and there is no registry mapping it to one. The only promise is that the same
device yields the same token every time. `<sensorIndex>` stays an ordinal — no source
seen so far names a sensor *within* a device by anything else. See DECISIONS.md,
"Opaque device-instance tokens".

### Devices

`ASSUMPTION:` LHM's hardware types, **normalised on vendor**:

```text
motherboard  superio  cpu  memory  gpu  storage  network
cooler       embedded-controller    psu  battery  power-monitor
```

`GpuNvidia | GpuAmd | GpuIntel` collapse to `gpu`, with vendor moved to metadata.
A dashboard bound to `sensors/gpu/0/temperature` must not break when the card is
replaced with another brand — that portability is worth more than preserving the
vendor distinction in the topic.

### Metrics and their units

The unit is a **property of the metric**, defined here once:

| Metric | Unit | | Metric | Unit |
|---|---|---|---|---|
| `voltage` | V | | `data` | GB (2³⁰ B) |
| `current` | A | | `small-data` | MB (2²⁰ B) |
| `power` | W | | `throughput` | B/s |
| `clock` | MHz | | `time-span` | s |
| `temperature` | °C | | `timing` | ns |
| `load` | % | | `energy` | mWh |
| `frequency` | Hz | | `noise` | dBA |
| `fan` | RPM | | `conductivity` | µS/cm |
| `flow` | L/h | | `humidity` | % |
| `control` | % | | `factor` | (dimensionless) |
| `level` | % | | | |

## Reading shape

```ts
type SensorReading = {
  value: number | null   // null = sensor present but reporting nothing
  at: number             // epoch ms — when the source READ it, not when it arrived
}
```

**`value` is nullable** because LHM's `ISensor.Value` is `float?`. A sensor can be
enumerated and still have no reading, and a dashboard must be able to show "no
data" distinctly from a stale number or a zero.

**`at` is not optional.** The runtime needs to tell "42 °C" from "42 °C, six
minutes stale because the publisher died". A dashboard silently showing frozen
numbers is worse than one showing an error.

**No `unit` field.** The unit is a pure function of the metric type and is defined
in the table above. Repeating it in every message at 1 Hz is redundant, and worse,
it creates a second source of truth that can disagree with the first.

`ASSUMPTION:` A reading is a single scalar. Multi-value sensors are separate
topics, never arrays.

## Metadata shape

Published once to a **retained** companion topic
(`sensors/<device>/<i>/<metric>/<j>/meta`):

```ts
type SensorMeta = {
  label: string      // LHM's Name — 'CPU Core #3', 'CPU Package'
  vendor?: string    // 'nvidia' | 'amd' | 'intel' — normalised out of the topic
  hidden?: boolean   // LHM's IsDefaultHidden: noisy by default, offer but don't show
}
```

Human-readable labels cannot be derived from a topic, so they live here.

### What is deliberately *not* here: gauge range

LHM exposes `Min`/`Max`, and it is tempting to treat them as a gauge range. They
are **observed running extremes**, resettable at any time via `ResetMin()` /
`ResetMax()` — not the sensor's design range. A gauge whose scale silently
rescales as the day's peak moves is unreadable.

`ASSUMPTION:` Gauge range is **authored in the layout**, not published by the
source. A CPU-temp gauge reading 0–100 is a design decision, not a measurement.
`layout-schema` owns it.

## Hard rules

1. **Zero runtime dependencies.** Nothing to install, nothing to version against.
2. **No imports out of this package.** It is a leaf. It must not know that
   `ui-kit`, `runtime`, or any adapter exists.
3. **No transport knowledge.** Broker hosts, ports and URLs belong in
   `sensor-sources`. This contract must be able to describe the same readings
   arriving over MQTT, HTTP polling, or from a host that already emits metrics.
4. **JSON-safe only.** Nothing that does not survive
   `JSON.parse(JSON.stringify(x))` unchanged. This contract crosses a network.
5. **Names live here or nowhere.** No consumer may declare its own topic string,
   metric name, or unit.

## Implementation status

`src/topics.ts` and `src/reading.ts` currently implement an earlier, much narrower
vocabulary — four devices, five metrics, no indices, and `unit` inside the reading.
Its template-literal `SensorTopic` type is worth keeping: it makes a topic typo a
compile error on both the publishing and consuming side, which is rule 5 enforced
by the compiler rather than by review. **Widening it to this spec is the next
change to this package**, and it will invalidate the tests written against the
narrow version.

## Open questions

- **Discovery.** How does the editor learn which topics exist, so its picker can
  offer them? Subscribe to `sensors/#` and observe, or read a published manifest.
  Observation is simpler but leaves the picker empty until data flows. LHM's
  `IsDefaultHidden` matters here — a naive picker would list hundreds of sensors.
- **Staleness threshold.** Fixed interval, per-sensor, or declared in metadata?
  The runtime has to render *something* when a value ages out, and `ui-kit` has
  the same question open.
- **`factor` and `timing`.** Dimensionless and nanosecond metrics have no obvious
  widget. Include for completeness, or omit until something needs them?
