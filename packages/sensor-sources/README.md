# `@perch/sensor-sources`

> Status: tentative.

## Purpose

The one seam where sensor data enters perch. A source subscribes to topics and
emits readings; nothing downstream knows or cares which implementation is running.

This is the package that makes "swap MQTT for something else" a one-line change
instead of a refactor.

## The interface

One shape, implemented by every source. **It lives in `@perch/sensor-contract`**, not here
— `ui-kit`'s provider takes a source as an argument, and `ARCHITECTURE.md` gives `ui-kit` an
edge to the contract and deliberately none to this package. An interface is a contract; the
implementations are the replaceable part, and they are what this package owns.

```ts
// from '@perch/sensor-contract'
type SensorSource = {
  subscribe(pattern: string, onReading: (topic: SensorTopic, r: SensorReading) => void): Unsubscribe
  meta(topic: SensorTopic): SensorMeta | undefined
  readonly status: 'connecting' | 'live' | 'stale' | 'error'
}
```

`status` is deliberately part of the contract. A dashboard needs to distinguish
"no data yet" from "connection died" from "connected but the publisher stopped",
and only the source can tell the difference.

`pattern` stays a plain string, because it spans one canonical topic and a wildcard such as
`SENSOR_TOPIC_WILDCARD`. The topic a source hands back is always canonical, so a consumer
can use it as an identity key; expanding an authored shorthand is the caller's step, via the
contract's `normalizeSensorTopic`. Matching a topic against a pattern is `topicMatchesPattern`
in this package, because `+` and `#` are MQTT's syntax and the contract holds no transport
knowledge.

## Implementations

| Source | Status | Notes |
|---|---|---|
| **mock** | **built** | Generates plausible values on an interval, deterministic when seeded. `createMockSource()` in `src/mock-source.ts`. The source the editor and tests run against. |
| **mqtt** | **built** | MQTT-over-WebSockets, browser and Node. The real one. `createMqttSource()` in `src/mqtt-source.ts`. Validates every payload at the boundary, reads retained `/meta` companions, reconnects with backoff. |
| **http-poll** | later | Polls a JSON endpoint directly, no broker. Useful for a single-machine setup. |
| **external-metrics** | later | Consumes a metrics tick from a host that already enumerates sensors, rather than polling hardware ourselves. |

`ASSUMPTION:` mock ships first and stays permanently. It is not scaffolding — the
editor needs live-looking data with no hardware, and tests need determinism.

## Hard rules

1. **One interface, no leaks.** No consumer may branch on which source it has, or
   import a source-specific type.
2. **Runs in the browser.** The mqtt source is used by `runtime` and `editor`
   directly, so no Node built-ins in the shared path.
3. **Depends only on `sensor-contract`.**

## Why the broker endpoint lives here, not in the contract

`src/relay-endpoint.ts` holds the MQTT-over-WebSockets host and port (9001) and the
URL builder. It belongs in this package, not in `sensor-contract`, because **the
contract must outlive the transport**. A contract that knows the transport is MQTT
on port 9001 cannot describe the same readings arriving over HTTP polling or from a
host that already emits metrics — and swapping transport would then be a contract
change, which is the one thing contracts exist to avoid.

## The mqtt source

```ts
import { createMqttSource, resolveBrokerUrlAsync } from '@perch/sensor-sources'

const { url, origin } = await resolveBrokerUrlAsync(fetch)
const source = createMqttSource({ url, origin })
```

Both narrow subscriptions are taken on every CONNECT: `sensors/+/+/+/+` for readings and
`sensors/+/+/+/+/meta` for metadata. The contract's `SENSOR_TOPIC_WILDCARD` (`sensors/#`)
matches the retained `/meta` companions too, so a source built on it receives metadata
interleaved with readings and has to route on the suffix — and a routing slip there hands a
`SensorMeta` body to a widget expecting a number. Two patterns make that structurally
impossible rather than merely guarded against.

A consumer's `subscribe(pattern, …)` is a local filter on that already-narrow stream, not a
new SUBSCRIBE, so no broker-side subscription table has to be reconciled on reconnect.

### Every payload is untrusted

`parse → isSensorReading` (or `isSensorMeta`) → deliver, and **drop** on any failure. Drops
are counted by reason on `source.stats.rejectionsByReason` (`undecodable`, `invalid-json`,
`unroutable-topic`, `uncanonical-topic`, `not-a-reading`, `not-a-meta`) and the first of each
reason is logged once, so a schema mismatch is visible instead of a dashboard that renders
nothing for no stated reason. A zero-length retained publish on a `/meta` topic is MQTT's
withdraw, so it clears the label and counts as `metaCleared` rather than a rejection.

### What `status` means here

| State | Condition |
|---|---|
| `connecting` | The first CONNECT is in flight, **or** the link is up and no reading has ever arrived. Nothing has arrived and nothing has failed. |
| `live` | Link up and a reading landed within `staleAfterMs` (default 3000 — three missed 1 Hz intervals). |
| `stale` | Link up and the window closed. Also the state right after a reconnect, before the first reading of the new session: the transport has proved itself, the data has not arrived. |
| `error` | The link is down after a failure, or the source was closed. The source is retrying. |

It is derived on read from the link state and the clock, never written by a timer — the
contract says "read it; never cache it", and a timer-driven status is a cached one. Through a
reconnect gap the status is `error` for the whole gap: never `live` off the pre-gap reading,
and never back to `connecting`, which would read as "nothing has failed yet". Retained
metadata is deliberately **not** cleared on a drop, because `status` already reports the link
and blanking every label would make a reboot look like a data-model failure.

## The default broker URL is a trap

`relay-endpoint.ts` defaults to `ws://localhost:9001`, and on a developer machine that port is
frequently **a different broker**: a Homebrew mosquitto bound to `0.0.0.0:9001` with anonymous
access. It accepts the connection, accepts the subscriptions, and delivers nothing — so the
dashboard looks connected and stays empty. Say which broker you mean:

```sh
PERCH_BROKER_URL=ws://127.0.0.1:1884 npm run dev   # 1. environment variable wins
```

```json
// 2. perch-relay.json, beside the bundle — for a deployed panel
{ "brokerUrl": "ws://sensors.lan:1884" }
```

3. Only then the built-in default, and `createMqttSource` logs a warning naming
   `PERCH_BROKER_URL` whenever `origin === 'default'` — that warning is the one signal
   distinguishing "wrong broker" from "broker with nothing to say".

A **present** override that is not a `ws:`/`wss:` URL throws with the variable's name in it
rather than falling through; silently using the default there reproduces the exact failure
this resolution order exists to prevent. An **absent** config file is not an error.

The tests never dial 9001: the in-process `aedes` broker takes an OS-assigned ephemeral port,
and the cases about a link that cannot be made use `ws://127.0.0.1:1`.

`apps/runtime/src/main.tsx` takes the trap one step further and uses `origin` as a *switch*
rather than only a warning: it builds an MQTT source when `origin === 'env'` and the generated
mock otherwise, so the built-in default never selects MQTT at all. In the browser
`readProcessEnv()` returns `{}` — there is no `process` — so the page passes the value it read
from `import.meta.env` in as `env`, which keeps trimming, validation and `origin` reporting in
this one function rather than reimplemented in the page.

## Resolved questions

- **Connection config.** Settled: environment variable → config file beside the bundle →
  default, with the deciding input reported as `origin` so the trap above is legible. See
  `src/broker-url.ts` and `DECISIONS.md`.
- **Reconnection and backfill.** Settled for the source: it reconnects with exponential
  backoff (1 s → 30 s), resubscribes explicitly on every CONNECT (`clean: true`,
  `resubscribe: false`), and **buffers nothing**. A gap in the data is a gap, reported through
  `status`. Whether a sparkline draws a gap or bridges it is the widget's decision, made from
  the `at` timestamps it already holds.
