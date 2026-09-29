# perch
A web server, service, and tooling to make and display web pages that show sensor data.

## Running it

```sh
npm install

npm run dev          # the editor, the dashboard and the relay, one terminal
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

  relay     Started. The editor dials it at the port it reports; pick the sensor host in
            the editor. PERCH_BROKER_URL is unset, so the runtime page reads generated
            mock data; set it to the relay URL to change that. --no-relay leaves the
            relay out. Editor: ws://localhost:9001. Polling
            http://localhost:8085/data.json, where nothing is listening. ...

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

### Picking the sensor host in the editor

The editor's header has the connection control: **localhost** (the default,
which takes effect as soon as it is picked) or **host** with a field for
`host` or `host:port` (port 8085 if omitted) and a **connect** button. The
relay keeps running on this machine and is told which LibreHardwareMonitor host
to poll; the label says `connecting`, `connected` or `disconnected`, with the
relay's reason (`EHOSTUNREACH`, `ECONNREFUSED`) when it has one. Connected means
the relay's poll of that host works *and* readings are arriving in the editor;
only then do the preview and the sensor picker use live data. Until then the
preview shows sample values under a **sample data** badge. The choice and the
typed host are remembered in the browser. In the desktop app the same control
is in its Settings window (Cmd+, or Ctrl+,, or the tray), and the runner
remembers the host.

The stack starts the relay first and hands the editor the WebSocket port the
relay actually bound. If 1883 or 9001 is already held (a Homebrew mosquitto) and
`PERCH_BROKER_URL` is unset, the relay takes free ports instead and the editor
is told which, so nothing needs stopping. `--no-relay` leaves the relay out; the
editor then says there is no relay and stays on sample data.

### The dashboard against real hardware

Point the relay at your LibreHardwareMonitor host and the page at the relay, and
the same one command brings all three up:

```sh
PERCH_LHM_HOST=192.168.1.3 \
PERCH_BROKER_URL=ws://localhost:9001 \
npm run dev
```

`PERCH_BROKER_URL` decides what the runtime page reads and nothing else does:
unset, the page reads its generated mock. The relay starts either way, for the
editor; `--no-relay` leaves it out.

With the sensor host switched off the relay still comes up — it serves its
broker, logs one `poll failed` line and then a summary on a widening interval,
and keeps retrying. Startup says so before the line appears, so it does not read
as a failed start.

If another MQTT broker already holds 1883 or 9001 while `PERCH_BROKER_URL` is
set — a Homebrew `mosquitto` is the usual culprit — the stack names it and
offers to stop it before building anything. It only offers for a process it can identify, only on a terminal, and
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
