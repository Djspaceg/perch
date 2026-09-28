# @perch/desktop

The desktop app, in Electron. One install, two runners: the **runner** reads layout documents
and renders the one it last had open; the **editor** is an IDE for those documents. Both are one
process, one relay, one tray.

```text
Electron main process (single instance per userData)
  relay (apps/agent, in process)  --ws://127.0.0.1:<port>-->  runner window, editor window
  layouts folder, watched         --runtime preload------->   app://runtime/index.html
  editor documents, dialogs       --editor preload-------->   app://editor/index.html
  tray: layouts, folder, Open editor, window, start at login, quit
  menu: App (macOS), File, Edit, View, Window
```

## Try it

```bash
npm run runner    # the runner only
npm run editor    # the runner, with the editor window open
```

Each builds the pages it needs and this app, then launches it. Run `npm run editor` while a
runner is up and the new launch hands off to it (`second-instance`) and quits: the running one
opens or focuses the editor. Closing the editor leaves the runner running. The first launch First launch creates
`~/Documents/perch/layouts`, seeds it from the repository's `layouts/`, and opens the first
document. After that the runner reopens whatever it had open at quit. Closing the window hides it; quit from
the tray.

## What moves what

| Variable                                                                                       | Default                     | Effect                                                |
| ---------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------- |
| `PERCH_LAYOUTS_DIR`                                                                            | `~/Documents/perch/layouts` | the layouts folder                                    |
| `PERCH_USER_DATA_DIR`                                                                          | the OS's, for `perch`       | Electron's userData, which holds `perch-desktop.json` |
| `PERCH_RUNTIME_PAGE_DIR`                                                                       | `apps/runtime/dist/page`    | the built page the runner window loads                |
| `PERCH_EDITOR_PAGE_DIR`                                                                        | `apps/editor/dist/page`     | the built page the editor window loads                |
| `--user-data-dir=<dir>`                                                                        |                             | as `PERCH_USER_DATA_DIR`, and wins over it            |
| `PERCH_LHM_HOST`, `PERCH_LHM_PORT`, `PERCH_BIND_HOST`, `PERCH_MQTT_PORT`, `PERCH_WS_PORT`, ... | see `apps/agent`            | the relay, exactly as the CLI reads them              |

A test launch that leaves the real folder and settings alone:

```bash
PERCH_LAYOUTS_DIR=/tmp/p/layouts PERCH_USER_DATA_DIR=/tmp/p/userData npm run editor
```

Check the first `[runner] userData:` line names the temporary folder. The single-instance lock is
per userData, so a launch with its own never hands off to a perch you already have open.

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
- **Security.** Sandboxed renderers, context isolation, no Node in either page, a preload each, a
  content security policy each, navigation locked to the two pages. The editor page never names a
  file: every document has a key (`desk`, `desk-2`), and only the main process maps a key to a
  path — the folder's documents, and ones chosen in a native Open or Save As dialog.

## The editor

- **Documents.** The picker lists the layouts folder, and follows it. File > New (Mod+N) opens a
  blank canvas the size and theme of the open one, untitled until its first save, which is a Save
  As. Open (Mod+O) is a native dialog starting in the layouts folder. Save (Mod+S) validates in the
  page, then the main process checks the body is JSON and writes it atomically. Save As
  (Mod+Shift+S) is a native dialog. The editor opens the runner's document first.
- **Dirty.** The window shows the edited mark (macOS) or a `*` in its title; closing it, or
  quitting, with unsaved changes asks Save / Don't Save / Cancel. Cancel calls a quit off.
- **The runner sees saves.** Saving the document the runner shows re-renders it, through the
  runner's own watch.
- **The sensor host.** The editor's connection control starts on the host the relay is polling,
  so opening the editor never moves it; switching it retargets the relay, and the runner saves it
  and resumes with it.
- **Menu.** Each item shows the accelerator of the editor's binding for it, overrides included.
  Undo and Redo are not the platform roles: in a text field they are the field's native undo, and
  elsewhere the editor's history, through its keybinding registry. There is no Reload, which would
  drop unsaved edits. Developer tools are in View for an unpackaged run.

## Layout

```text
src/main.ts              app-wide: app:// scheme, navigation lock, permissions, menu, lock, quit
src/runner.ts            the runner: settings, folder, relay, document, window, tray
src/runner-window.ts     the runner's BrowserWindow, and the log of what the page shows
src/runtime-preload.cts  the runner page's bridge; CommonJS because a sandboxed preload must be
src/editor.ts            the editor: its IPC, dialogs, close prompt and window lifecycle
src/editor-window.ts     the editor's BrowserWindow
src/editor-preload.cts   the editor page's bridge
src/*.ts                 the pure parts, each with its test: launch, app-menu, editor-documents,
                         editor-close, lhm-sync, app-protocol, settings, ...
```

Packaging (installers, signing, a separate editor launcher) is not here yet.
