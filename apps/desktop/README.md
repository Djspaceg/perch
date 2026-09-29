# @perch/desktop

The desktop app, in Electron. One install, two runners: the **runner** reads layout documents
and renders the one it last had open; the **editor** is an IDE for those documents. Both are one
process, one relay, one tray.

```text
Electron main process (single instance per userData)
  relay (apps/agent, in process)  --ws://127.0.0.1:<port>-->  runner window, editor window
  layouts folder, watched         --runtime preload------->   app://runtime/index.html
  editor documents, dialogs       --editor preload-------->   app://editor/index.html
  the relay's URL and poll target --settings preload------>  app://editor/settings.html
  tray: layouts, folder, Open editor, Show/Hide preview, Settings..., start at login, quit
  menu: App (macOS), File, Edit, View, Window
```

## Try it

```bash
npm run runner    # the runner only
npm run editor    # the runner, with the editor window open
```

Each builds the pages it needs and this app, then launches it. Run `npm run editor` while a
runner is up and the new launch hands off to it (`second-instance`) and quits: the running one
opens or focuses the editor. Closing the editor leaves the runner running. The first launch creates
`~/Documents/perch/layouts`, seeds it from the repository's `layouts/` (a packaged app: the copy
inside it), and opens the first document. After that the runner reopens whatever it had open at quit. Closing the window hides it; quit from
the tray.

## What moves what

| Variable                                                                                       | Default                     | Effect                                                |
| ---------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------- |
| `PERCH_LAYOUTS_DIR`                                                                            | `~/Documents/perch/layouts` | the layouts folder                                    |
| `PERCH_USER_DATA_DIR`                                                                          | the OS's, for `perch`       | Electron's userData, which holds `perch-desktop.json` |
| `PERCH_RUNTIME_PAGE_DIR`                                                                       | `apps/runtime/dist/page`\*  | the built page the runner window loads                |
| `PERCH_EDITOR_PAGE_DIR`                                                                        | `apps/editor/dist/page`\*   | the built page the editor window loads                |
| `--user-data-dir=<dir>`                                                                        |                             | as `PERCH_USER_DATA_DIR`, and wins over it            |
| `PERCH_LHM_HOST`, `PERCH_LHM_PORT`, `PERCH_BIND_HOST`, `PERCH_MQTT_PORT`, `PERCH_WS_PORT`, ... | see `apps/agent`            | the relay, exactly as the CLI reads them              |

\* In a packaged app, the pages and the seed layouts are in its resources folder
(`process.resourcesPath`): `runtime-page/`, `editor-page/`, `layouts/`. It never reads the
repository.

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
- **Remembered:** the open document, the LHM host a client (the Settings window) last switched the
  relay to, and File > Open recent's list, in `perch-desktop.json`, written atomically.
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
- **Header.** No picker, connection control, undo, redo or save: those are in the menu bar and the
  Settings window. It keeps the fit, a connection indicator (a dot, the phase and the host, the
  relay's reason in its tooltip) that opens Settings, the sample-data badge, the unsaved mark and
  revert. `npm run dev` in a browser has no menu bar and keeps the whole toolbar.
- **Menu.** File: New, Open..., Open preset, Open recent, Save, Save As..., and Settings (Ctrl+,) on
  Windows and Linux. On macOS Settings... (Cmd+,) is in the app menu. Each item shows the
  accelerator of the editor's binding for it, overrides included, and runs the same registry command
  the key does. Undo, Redo, Save and Save As are enabled as the editor says: Undo with a step to
  undo (or a text field focused), Save with unsaved changes. Undo and Redo are not the platform
  roles: in a text field they are the field's native undo, elsewhere the editor's history, and in
  another window that window's native undo. There is no Reload, which would drop unsaved edits.
  Developer tools are in View for an unpackaged run.
- **Open preset** lists the layouts folder, the list the picker showed, with a checkmark on the
  document the editor has open, and follows the folder: add, rename or remove a file and it is
  rebuilt. "No presets" when the folder has none. Picking one opens it in the editor, opening the
  editor first if need be, behind the unsaved-changes bar as Open is.
- **Open recent** lists the last 10 documents opened or saved in the editor, newest first; one no
  longer on disk is left out (and comes back if the file does). "Clear recently opened" empties
  it. On macOS the Dock's recent list is kept to match.

## Settings

One small window, only ever one: opening it again brings it forward. From the app menu's
Settings... (macOS), File > Settings (Windows, Linux), the tray's Settings..., or in the editor its
Mod+Comma and the header's connection indicator. It holds the sensor host control the editor header
used to: localhost or a typed host[:port], Connect, and the status with the relay's reason. It
starts on the host the relay is polling, so opening it moves nothing; a Connect retargets the relay,
and the runner saves the host and resumes with it. The page is a second entry of the editor's build,
so `npm run runner` now builds the editor too.

## Layout

```text
src/main.ts              app-wide: app:// scheme, navigation lock, permissions, menu, lock, quit
src/runner.ts            the runner: settings, folder, relay, document, window, tray
src/runner-window.ts     the runner's BrowserWindow, and the log of what the page shows
src/runtime-preload.cts  the runner page's bridge; CommonJS because a sandboxed preload must be
src/editor.ts            the editor: its IPC, dialogs, close prompt and window lifecycle
src/editor-window.ts     the editor's BrowserWindow
src/editor-preload.cts   the editor page's bridge
src/settings-window.ts   the Settings window, one at a time (single-window.ts), and its IPC
src/settings-preload.cts the Settings page's bridge: one load
src/folder-watch.ts      the layouts folder's watch, which the tray and Open preset follow
src/*.ts                 the pure parts, each with its test: launch, app-menu, editor-documents,
                         editor-close, lhm-sync, app-protocol, settings, recent, ...
src/packaging.ts         the electron-builder config, and the launcher files it cannot make itself
src/app-icon.ts          the placeholder app icon, drawn at packaging time
electron-builder.config.mjs  calls packaging.ts; electron-builder reads it
```

## Packaging

One install, two launchers. From the repository root:

```bash
npm run package:mac      # release/mac-<arch>/perch.app, perch editor.app; release/perch-<v>-<arch>.dmg
npm run package:win      # release/perch Setup <v>.exe (NSIS, x64)
npm run package:linux    # release/perch-<v>.AppImage, release/perch_<v>_amd64.deb (x64)
```

Each runs `npm run build` first, then electron-builder into `apps/desktop/release/` (gitignored).
All three build on a Mac with nothing else installed: electron-builder downloads its own NSIS,
AppImage and fpm tools on first use. `npm run build` and `npm test` never package.

| Platform | The runner         | The editor launcher                                                  |
| -------- | ------------------ | -------------------------------------------------------------------- |
| macOS    | `perch.app`        | `perch editor.app`, beside it on the .dmg; drag both to Applications |
| Windows  | Start Menu "perch" | Start Menu "perch editor" (`perch.exe --editor`)                     |
| Linux    | `perch.desktop`    | its "Open editor" action; in the .deb also `perch-editor.desktop`    |

Every editor launcher runs the same app with `--editor`. With a perch already running, that launch
hands the editor to it through the single-instance lock and quits; with none, it starts the runner
and opens the editor over it. `perch editor.app` is a small script bundle: it runs
`open -n` on the `perch.app` in its own folder (else the one macOS knows by bundle id), passing
`--editor`, its own arguments, and any `PERCH_*` variables it was started with. `open -n` matters:
without it macOS only activates a running perch and the flag is lost.

Inside every package: the compiled main process and preloads, the relay (`@perch/agent` and its
dependencies, in `app.asar`), and in the resources folder both built pages and the seed layouts.

**Placeholders, yours to change:** the bundle id `dev.perch.app` (`APP_ID` in `src/packaging.ts`;
the editor launcher is `dev.perch.app.editor`), the icon (drawn by `src/app-icon.ts`; replace
`appIconPng` or point `icon` at a file), and the .deb maintainer `perch@example.invalid`.

Test a packaged build without touching your own perch: run the binary directly, so every flag
reaches it, with its own folder, userData and ports.

```bash
T=$(mktemp -d)
PERCH_LAYOUTS_DIR=$T/layouts PERCH_MQTT_PORT=0 PERCH_WS_PORT=0 \
  "release/mac-arm64/perch.app/Contents/MacOS/perch" --user-data-dir=$T/userData &
open -a "$PWD/release/mac-arm64/perch editor.app" --args --user-data-dir=$T/userData
```

### Signing and notarization (off)

Off by default on every platform, because each needs your certificates. electron-builder would
otherwise sign on its own with any Developer ID it finds in your keychain, so macOS signing is set
off explicitly. To switch it on:

- **macOS signing.** `PERCH_MAC_SIGN=1`, and `CSC_NAME="Developer ID Application: <Name> (<TEAM>)"`
  (or `CSC_LINK` + `CSC_KEY_PASSWORD` for a .p12). electron-builder signs `perch.app` with the
  hardened runtime; the `afterSign` hook signs `perch editor.app` with `CSC_NAME`.
- **macOS notarization.** Also `PERCH_MAC_NOTARIZE=1`, with `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` (or `APPLE_API_KEY`, `APPLE_API_KEY_ID`,
  `APPLE_API_ISSUER`). electron-builder notarizes and staples `perch.app`. Then notarize the .dmg,
  which covers `perch editor.app`:
  `xcrun notarytool submit release/perch-<v>-<arch>.dmg --apple-id ... --team-id ... --password ... --wait`
  and `xcrun stapler staple release/perch-<v>-<arch>.dmg`.
- **Windows.** `PERCH_WIN_SIGN=1`, with `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` (a .pfx).
- **Linux.** Nothing to sign.

Neither path has been run: there are no credentials here. An unsigned macOS download is refused by
Gatekeeper on another Mac until you right-click Open it or clear its quarantine, and Apple silicon
may call it damaged; a locally built one runs as is. Auto-update is not set up.
