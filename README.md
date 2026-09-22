# perch
A web server, service, and tooling to make and display web pages that show sensor data.

## Running it

```sh
npm install

npm run dev          # the editor and the dashboard, one terminal, mock data
```

That is the whole loop: author a layout in the editor, save, and the dashboard
tab reloads, because the save writes the real `layouts/<name>.json` and the
dashboard's dev server watches it. It prints both URLs once both servers have
answered:

```
perch dev stack

  editor    http://localhost:5402/
  runtime   http://localhost:5173/
            Author in the editor and save; the runtime tab reloads, because the save
            writes the real layouts/<name>.json and the runtime watches it.

  layouts   desk-1920x400, tower-720x1280, trend-1920x400
            Add ?layout=<name> to either URL for a specific one; without it each page
            opens desk-1920x400.

  relay     Not started: PERCH_BROKER_URL is unset, so the page reads generated mock
            data and nothing would read the relay. Add --relay to start it anyway, or
            set PERCH_BROKER_URL=ws://localhost:9001 to point the page at it.

  Ctrl-C stops everything this started.
```

`npm run dev:stack` is the same command under its older name. `npm run dev --
--help` lists the options; the ones worth knowing are `--editor-port` and
`--runtime-port`, which move this stack off a port another checkout is holding.
Both servers use a fixed port on purpose — a capture has to navigate to a known
URL — so a held port stops startup and names the process holding it rather than
drifting to the next free one.

```sh
npm run relay                          # just the relay, no pages
npm run dev:runtime                    # just the dashboard
npm run dev:editor                     # just the editor (saves work here too)
npm run dev -- --runtime-port 5502     # when something else holds 5173
```

### Against real hardware

Point the relay at your LibreHardwareMonitor host and the page at the relay, and
the same one command brings all three up:

```sh
PERCH_LHM_HOST=192.168.1.3 \
PERCH_BROKER_URL=ws://localhost:9001 \
npm run dev
```

The relay is started **only** when `PERCH_BROKER_URL` or `PERCH_LHM_HOST` is
set, because `PERCH_BROKER_URL` decides what the page reads and nothing else
does: with it unset the page reads its generated mock, so a relay would be
serving a broker this stack's own page will not dial. `--relay` starts it
anyway; `--no-relay` never does.

With the sensor host switched off the relay still comes up — it serves its
broker, logs one `poll failed` line and then a summary on a widening interval,
and keeps retrying. Startup says so before the line appears, so it does not read
as a failed start.

If another MQTT broker already holds 1883 or 9001 — a Homebrew `mosquitto` is
the usual culprit — the stack names it and offers to stop it before building
anything. It only offers for a process it can identify, only on a terminal, and
never when you have set your own ports. Otherwise the relay fails with the flag,
the variable and a suggested port in the error itself — and, for the WebSocket
listener, the `PERCH_BROKER_URL` the page has to move with it.

**Always set `PERCH_BROKER_URL` explicitly.** Its built-in default is
`ws://localhost:9001`, and on a developer machine that port is often a
*different* broker — one that accepts the connection, accepts the
subscriptions, and delivers nothing. The page then looks connected and stays
empty, which is the most expensive way to be wrong.

Startup order does not matter. The browser's MQTT source reconnects with
backoff and re-subscribes on every connect, and sensor metadata is retained, so
labels arrive whenever the relay appears.

### Relay configuration

Every setting resolves **CLI flag → environment variable → default**. A
malformed CLI value is an error rather than a fall-through, so `--lhm-port
banana` never silently polls the default port.

| Flag | Environment variable | Default |
|---|---|---|
| `--lhm-host` | `PERCH_LHM_HOST` | `localhost` |
| `--lhm-port` | `PERCH_LHM_PORT` | `8085` |
| `--bind-host` | `PERCH_BIND_HOST` | `0.0.0.0` |
| `--mqtt-port` | `PERCH_MQTT_PORT` | `1883` |
| `--ws-port` | `PERCH_WS_PORT` | `9001` |
| `--poll-interval-ms` | `PERCH_POLL_INTERVAL_MS` | `1000` |
| `--request-timeout-ms` | `PERCH_REQUEST_TIMEOUT_MS` | `1500` |

`npm run relay -- --help` prints the same list with resolved values and where
each one came from.

### Which source the page reads

`PERCH_BROKER_URL` decides, and nothing else does:

| `PERCH_BROKER_URL` | The page reads | Header says |
|---|---|---|
| set, e.g. `ws://localhost:9001` | that broker, over MQTT | `mqtt · ws://localhost:9001` |
| unset | the generated mock | `mock data · generated here, not hardware` |

Only an explicitly set variable selects MQTT. The resolver's built-in default
(`ws://localhost:9001`) deliberately does **not**, because silently dialling a
port that on this machine is often someone else's broker is the failure
described above. `npm run dev` with no hardware and no environment keeps
working.

Vite hides environment variables from client code unless they carry a known
prefix, so `apps/runtime/vite.config.ts` sets `envPrefix: ['VITE_', 'PERCH_']`
and `src/vite-env.d.ts` declares the one variable that reaches
`import.meta.env`. Vite reads it from the shell as well as from `.env` files,
which is what makes `PERCH_BROKER_URL=... npm run dev` work.

### Telling real data from mock

Four tells, in order of how quickly they settle it:

1. The header names the source and, over MQTT, the URL it dialled.
2. The badge beside it reads `live`, `connecting`, `stale` (transport up,
   publisher quiet) or `error` (link down) in words, not colour alone.
3. The `hardware only · raw bytes/s` tile carries a value only over MQTT. The
   mock never publishes `gpu/throughput`.
4. That value is a raw figure like `6699008`, not `6.4`, because the relay reads
   LibreHardwareMonitor's raw field rather than its display field, which
   rescales its unit with magnitude.

One tile is captioned `stale · mock publisher stopped`, and it is mock data in
both modes: a real relay cannot be asked to die on cue to demonstrate the stale
rendering. It is the only invented number on screen when the page is reading
hardware, and it says so where it is read.

### Checks

```sh
npm run build      npm test      npm run typecheck
npm run lint       npm run format:check
```

## License

perch — a sensor dashboard toolchain for hardware telemetry
Copyright (C) 2026 Blake Stephens

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
