# @perch/agent

The relay. One process that polls LibreHardwareMonitor, maps each reading onto the perch topic
grammar, and publishes it over MQTT — **including the broker**, which runs inside this process.

That last part is the point. perch must not add a user-facing installation prerequisite, and an
external Mosquitto is one: install it, write a config with a `listener 9001` block, enable
`protocol websockets`, run it as a service — four steps before a single number appears on a
dashboard, on a machine whose owner wanted a temperature readout. `aedes` is a broker as a
library, so this executable is the whole install story beyond LibreHardwareMonitor itself.

```
LibreHardwareMonitor  --HTTP-->  relay  --MQTT/TCP------>  mosquitto_sub, another relay
   /data.json                       |
                                    '----MQTT/WebSockets->  the dashboard, in a browser
```

## Running it

```bash
npm run build -w @perch/agent
node apps/agent/dist/main.js --lhm-host 192.168.1.3 --ws-port 19001
```

### Always override `--ws-port` on this machine

The default WebSocket port is **9001**, because `packages/sensor-sources/src/relay-endpoint.ts`
already contracts it and the dashboard connects there. But a Homebrew Mosquitto on this
development machine holds 9001 on *all* interfaces. If you leave the default in place during a
dev run, one of two things happens, and the second is much worse than the first:

- the bind fails with `cannot listen on 0.0.0.0:9001`, or
- **your client silently connects to that Mosquitto instead**, sees no `sensors/#` traffic, and
  you spend the afternoon debugging a relay that was never in the conversation.

So: pass `--ws-port` (and `--mqtt-port`, for the same reason on 1883) on every dev run. The
tests all bind on port 0, which makes the OS pick a free port and makes this class of mistake
impossible for them.

## Configuration

Every setting can be given three ways. Precedence is **CLI switch, then environment variable,
then default** — the switch wins because it is the thing typed most recently and most
specifically, and a rejected switch is an error rather than a quiet fall-through to the layer
below.

| setting | flag | environment variable | default |
| --- | --- | --- | --- |
| LHM host | `--lhm-host` | `PERCH_LHM_HOST` | `localhost` |
| LHM port | `--lhm-port` | `PERCH_LHM_PORT` | `8085` |
| bind interface | `--bind-host` | `PERCH_BIND_HOST` | `0.0.0.0` |
| native MQTT port | `--mqtt-port` | `PERCH_MQTT_PORT` | `1883` |
| MQTT-over-WebSockets port | `--ws-port` | `PERCH_WS_PORT` | `9001` |
| poll interval | `--poll-interval-ms` | `PERCH_POLL_INTERVAL_MS` | `1000` |
| request timeout | `--request-timeout-ms` | `PERCH_REQUEST_TIMEOUT_MS` | `1500` |

`localhost:8085` is the right default because the relay's eventual home is the Windows host
running LibreHardwareMonitor, where the source is on the same machine. Pointing it at another
box — `--lhm-host 192.168.1.3` — is exactly what the override is for.

A listen port of `0` asks the OS for a free one; the port actually bound is what gets reported
at startup, not the `0` that was requested.

Startup prints every setting with the layer it came from, so a surprising value is one line of
log away from an explanation rather than a guess:

```
perch-agent configuration (value, origin, environment variable):
  lhm-host = 192.168.1.3 (cli, env PERCH_LHM_HOST)
  lhm-port = 8085 (default, env PERCH_LHM_PORT)
  ...
polling http://192.168.1.3:8085/data.json
broker listening: mqtt://0.0.0.0:11883, ws://0.0.0.0:19001
```

### No authentication

Deliberate, and recorded in `DECISIONS.md`: any client may connect, publish and subscribe. The
posture is LAN-only, and `--bind-host 127.0.0.1` is how it narrows to this machine alone.

## What it publishes

For each mapped sensor, on every poll:

- `sensors/<device>/<i>/<metric>/<j>` — `{"value": 41.5, "at": 1789961344029}`, **not retained**.
  A retained reading is a stale reading that arrives at a new subscriber looking fresh, and `at`
  is the only thing that would tell them otherwise.
- `sensors/<device>/<i>/<metric>/<j>/meta` — `{"label": "Core (Tctl/Tdie)", "vendor": "amd"}`,
  **retained**, published once per topic per process. It is exactly what a dashboard connecting
  later needs and cannot recompute; it does not change between polls.

`value` is `null` — never `0` — when LHM sends something unparseable or non-finite, which in the
captured payload is one unpopulated fan header. `0 °C` is a plausible reading; `null` is not.
`at` is when the reading was *read*, not when it was published.

A failed poll publishes **nothing at all**. It does not publish `null` for every sensor, because
`null` already means "this sensor is present and reporting nothing" and overloading it with "the
relay cannot reach LHM" would destroy the distinction. Staleness is `at`'s job, and the failure
goes to the log every time it happens.

### `RawValue`, not `Value`

LHM sends both. `Value` rescales its unit with the magnitude (`"6.4 MB/s"`) while `RawValue`
holds it steady (`"6699008.0 B/s"`), and the contract fixes one unit per metric. A relay reading
`Value` would publish a throughput 2²⁰ times too small, intermittently, in a way nothing
downstream could detect. `src/lhm-tree.rawvalue.test.ts` exists to keep that from regressing.

## Tests

```bash
npm test -w @perch/agent
```

No network and no external broker. The whole path is covered against the captured payload in
`fixtures/lhm-data.sample.json`, and the broker is verified by connecting real `mqtt` clients to
it over both transports — including `src/round-trip.test.ts`, which runs the real poll loop and
the real broker together and asserts on what a WebSocket subscriber actually receives.

To watch it by hand, against a real or stand-in LHM:

```bash
node apps/agent/dist/main.js --lhm-host 192.168.1.3 --mqtt-port 11883 --ws-port 19001
mosquitto_sub -h 127.0.0.1 -p 11883 -t 'sensors/#' -v
```

## Layout

| file | what it is |
| --- | --- |
| `src/config.ts` | the three precedence layers, pure: no `process`, no I/O |
| `src/lhm-client.ts` | one `GET /data.json` with a timeout, errors unwrapped into readable reasons |
| `src/lhm-tree.ts` | the tree walk, the topic mapping, and the duplicate-identifier decision |
| `src/broker.ts` | `aedes` plus the TCP and WebSocket listeners |
| `src/relay.ts` | the poll loop: what to publish, what to log, and when not to |
| `src/cli.ts` | argv and streams in, a running relay or an exit code out |
| `src/main.ts` | the only file that touches `process`: argv, env, signals, exit |
