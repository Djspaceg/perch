# `@perch/agent` (app) — SPEC

> Status: tentative, and **its existence is an open question** — read the last
> section before building anything here.

## Purpose

Runs on the machine being monitored. Reads a sensor source, publishes each reading
to its topic over MQTT.

Unlike everything else in this repo, this is a **long-lived background service on
someone else's machine**, which makes packaging and configuration the hard part
rather than the logic.

## Scope

- Poll a sensor source on an interval.
- Publish each value to `sensors/<device>/<metric>` using
  `@perch/sensor-contract` builders — never hand-written topic strings.
- Publish sensor metadata once to the retained companion topics.
- Reconnect to the broker with backoff, and keep running when it is unreachable.

## Deployment is the real work

- A config file: broker host and port, credentials, poll interval, which sensors
  to publish, topic prefix.
- A single-file executable, or a runtime install plus a service wrapper.
- Autostart as a background service, with logs somewhere a human will find them.
- A first-run check that reports what it found rather than failing silently.

`ASSUMPTION:` Node/TypeScript, matching the rest of the repo, so it can import
`sensor-contract` directly rather than restating topic names in another language.

## Hard rules

1. **Depends only on `sensor-contract`.** It has no idea layouts, widgets, or
   panels exist.
2. **Topic names come from the contract package.** A topic string literal in this
   app is a bug.
3. **Publishes `at` from read time**, not publish time, so staleness detection
   downstream is honest.
4. **Never fails silently.** A dead sensor source must be visible, because the
   dashboard downstream will otherwise show frozen numbers.

## Does this need to exist?

**Decide before writing code.** Sensor enumeration is a commodity and at least two
existing programs already do it on the target machine — LibreHardwareMonitor
exposes readings as JSON over HTTP, and the panel-control software on the Linux
side enumerates sensors per-OS and emits them on a tick.

If a host already produces readings, perch needs a **bridge** (read existing
output → publish to MQTT), which is far less than an agent, and possibly just a
config option on an existing tool rather than a deployable of ours.

Three outcomes:

- **Bridge only** — thin adapter in `packages/sensor-sources`, no app at all.
- **Agent needed** — no suitable host on the target machine; build this as specced.
- **Both** — agent for machines with nothing, bridge for machines already covered.

Resolving this is upstream of every packaging decision here, and packaging is most
of the cost.
