# Perch — rationale

> **Architecture lives in [`ARCHITECTURE.md`](ARCHITECTURE.md).** This document
> keeps only the *why*: what was evaluated and rejected, the display target, and
> how perch relates to neighbouring projects. Its original architecture,
> effort-estimate, and open-questions sections described a single-page dashboard
> app and have been superseded.

A lightweight, browser-rendered sensor dashboard. Live hardware telemetry (CPU/GPU
temps, usage, clocks, etc.) is published over a pub/sub relay and consumed by
self-wiring React components — the resulting page is meant to be viewed in a normal
browser tab *and* rendered onto physical USB LCD panels.

## Why this exists

Off-the-shelf options were evaluated and rejected:

- **Thermalright's official TRCC** — works, but locked to their own themes/UI,
  cloud-dependent, not customizable
- **AIDA64** — no native driver for Thermalright's LCD protocol family (confirmed
  via an open, unanswered forum feature request); general-purpose LCD tools in this
  space are built around a different set of USB-LCD protocols (Turing/XuanFang-style
  serial), not Thermalright's HID/bulk protocol
- **thermalright-trcc-linux itself** — actively reverse-engineers and drives the
  physical panel correctly, but has no sensor-reading or dashboard layer, and is
  Linux-first (Windows support is intermittent since the maintainer primarily tests
  on Linux)

The common gap in all three is **authoring**. Reading sensors is a commodity and
driving the panel is solved; nothing lets you compose a 1920×400 sensor dashboard
and emit it as a portable artifact. That is what perch is for — see
`ARCHITECTURE.md`.

## Target display constraints

Primary target panel: Thermalright Trofeo Vision 11.3 LCD White, **1920×400**
resolution. Dashboard layouts should default to this aspect ratio (long horizontal
strip) — think AIDA64 SensorPanel-style layouts, not a typical square/portrait
dashboard grid. Should also degrade reasonably to a normal browser-tab aspect ratio
for day-to-day viewing/dev.

**Unresolved:** this exact panel is not listed in trcc-linux's device
documentation — not under confirmed devices, not under devices needing testers, not
even under models with no known USB ID. The two listed Trofeo entries are
`Trofeo Vision LCD` (`0416:5302`, HID Type 2, 1280×480) and `Trofeo Vision 9.16 LCD`
(`0416:5408`, LY Bulk). Whether the 11.3 can be driven at all is an open hardware
question, answered by `lsusb` with the panel connected. Nothing in perch's
architecture depends on the answer.

## Relationship to other projects

**thermalright-trcc-linux** (GPL-3.0, Python) drives Thermalright LCD panels over
six reverse-engineered USB transports. It is not a dependency of perch's core and
shares no code with it.

Its relevance is as an **output adapter**: its screencast command captures a
specified region — `screencast(key, x, y, w, h)` — to the panel. So perch can put a
dashboard on a surface at a known rectangle and hand off across a process boundary,
with no code from either project entering the other.

Feature request [#288](https://github.com/Lexonight1/thermalright-trcc-linux/issues/288)
proposed a `webcast` source that renders a URL directly via pywebview. It remains
open with no maintainer response. Perch does not depend on it landing — region
capture of an existing surface achieves the same result without the per-platform
offscreen-snapshot work that proposal requires.

Perch is licensed GPL-3.0, so porting protocol code from trcc-linux is legally
available as a deliberate choice rather than a necessity. `ARCHITECTURE.md` states
why `caster` nonetheless contains no panel protocol code.
