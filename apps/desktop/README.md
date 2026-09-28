# @perch/desktop

The desktop app, in Electron. One install, two runners: the **runner** (this, today) and the
**editor** (next). The runner reads layout documents; the editor will write them.

```text
Electron main process
  relay (apps/agent, in process)  --ws://127.0.0.1:<port>-->  runner window
  layouts folder, watched         --preload bridge-------->   app://runtime/index.html
  tray: layouts, folder, window, start at login, quit
```

## Try it

```bash
npm run runner
```

Builds the runtime page and this app, then launches it. First launch creates
`~/Documents/perch/layouts`, seeds it from the repository's `layouts/`, and opens the first
document. After that it reopens whatever was open at quit. Closing the window hides it; quit from
the tray.

## What moves what

| Variable | Default | Effect |
|---|---|---|
| `PERCH_LAYOUTS_DIR` | `~/Documents/perch/layouts` | the layouts folder |
| `PERCH_USER_DATA_DIR` | the OS's, for `perch` | Electron's userData, which holds `perch-desktop.json` |
| `PERCH_RUNTIME_PAGE_DIR` | `apps/runtime/dist/page` | the built page the window loads |
| `PERCH_LHM_HOST`, `PERCH_LHM_PORT`, `PERCH_BIND_HOST`, `PERCH_MQTT_PORT`, `PERCH_WS_PORT`, ... | see `apps/agent` | the relay, exactly as the CLI reads them |

A test launch that leaves the real folder and settings alone:

```bash
PERCH_LAYOUTS_DIR=/tmp/p/layouts PERCH_USER_DATA_DIR=/tmp/p/userData npm run runner
```

## Behaviour worth knowing

- **Relay ports.** 1883 and 9001 when free. When anything answers there already (a Homebrew
  Mosquitto, the dev stack's relay) the listener takes a free port, logs the move, and the page is
  handed that port. It never dials a broker it did not start.
- **Bind.** Loopback only, unlike the CLI. `PERCH_BIND_HOST=0.0.0.0` to serve another machine.
- **The document is watched.** A save re-renders in place; a malformed save shows the runtime's
  own refusal and the watch continues; a fixed save renders again. Switching documents in the tray
  reloads the page.
- **Remembered:** the open document and the LHM host a client (the editor's connection control)
  last switched the relay to, in `perch-desktop.json`, written atomically.
- **Security.** Sandboxed renderer, context isolation, no Node in the page, a preload with two
  functions, a content security policy, navigation locked to `app://runtime/index.html`.

## Layout

```text
src/main.ts              app-wide: app:// scheme, navigation lock, permissions, quit
src/runner.ts            the runner: settings, folder, relay, document, window, tray
src/runner-window.ts     the BrowserWindow, and the log of what the page shows
src/runtime-preload.cts  the bridge; CommonJS because a sandboxed preload must be
src/*.ts                 the pure parts, each with its test
```

The editor window will be a sibling of `runner.ts`, with its own preload and an `app://editor/`
host in `app-protocol.ts`. Packaging (installers, signing) is not here yet.
