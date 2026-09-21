# perch
A web server, service, and tooling to make and display web pages that show sensor data.

## Running it

```sh
npm install

npm run dev          # just the dashboard, mock data, no hardware needed
npm run relay        # just the relay: polls LHM, serves its own MQTT broker
npm run dev:stack    # both, one terminal, prefixed output
```

Point the relay at your LibreHardwareMonitor host, and the page at the relay:

```sh
PERCH_LHM_HOST=192.168.1.3 \
PERCH_BROKER_URL=ws://localhost:9001 \
npm run dev:stack
```

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

### Telling real data from mock

The dashboard currently builds a **mock** source — see the seam documented at
the top of `apps/runtime/src/main.tsx`. When it is reading live hardware,
throughput shows a figure like `6699008` rather than `6.4`, because the relay
reads LibreHardwareMonitor's raw field instead of its display field, which
rescales its unit with magnitude.

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
