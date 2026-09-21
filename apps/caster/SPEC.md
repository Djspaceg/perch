# `@perch/caster` (app) — SPEC

> Status: tentative.

## Purpose

Gets a rendered dashboard onto a physical display. It runs a built `runtime`
bundle at the target resolution on a surface something else can capture, and
coordinates the handoff.

## What it deliberately does not contain

**No panel protocol code. No USB, no HID, no SCSI, no vendor wire format.**

That boundary is the most important thing in this spec. Panel protocols are
reverse-engineered, per-device, and maintained by projects that own that problem.
Reimplementing them here would mean inheriting a hardware-support treadmill and,
depending on the source, a license entanglement. Perch produces pixels; something
else moves them.

## What it does

- Launch a runtime bundle in capture mode at exactly `layout.target`, on a
  capturable surface: a real display, a dedicated virtual display, or offscreen.
- Wait for the runtime's **ready signal** before anything captures a frame.
- Report the surface's geometry, so an external capture tool can be pointed at the
  right rectangle.
- Optionally export a video file, for panel tooling that accepts a file rather
  than a live source.

## Handoff to panel tooling

The panel-control software on the target machine already does the hard part:
region capture to the device, over the transports it has reverse-engineered. Its
capture command takes an explicit rectangle, so the integration is:

1. `caster` puts the dashboard on a surface at a known rect.
2. External tool captures that rect to the panel.

That is a **process boundary** — a CLI call or an HTTP request — which is why no
code from that project needs to enter this one.

`ASSUMPTION:` A dedicated window or virtual display at exactly the panel
resolution, rather than a region of the primary desktop. Keeps the rect stable and
stops other windows from occluding the dashboard.

## Depends on

Nothing in this repo, at the code level. It consumes `runtime`'s **built
artifact** — an artifact boundary, not a code boundary, which is what keeps a
browser engine out of the browser bundle.

## Open questions

- **Which surface.** Real display, virtual display, or offscreen browser context.
  Each has different capture and cost characteristics on each OS.
- **Is the target panel driveable at all?** Unresolved hardware question, upstream
  of everything here. Nothing else in perch depends on the answer.
- **Frame throughput.** If frames cross a process boundary encoded per frame, that
  cost needs measuring before it is designed around. A live 1920×400 feed is the
  one place this project can be too slow.
