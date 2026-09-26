# `@perch/editor` (app)

> Status: first slice. Narrower than `SPEC.md` on purpose — see [Scope](#scope).

Pick a layout, watch it render, change the fields it already has, and write it
back. The preview is the shared `@perch/ui-kit` canvas the runtime paints with,
so a layout this editor accepts is a layout the runtime can draw.

## Run it

```
npm run dev -w @perch/editor      # http://localhost:5402/
```

The header's connection control picks the sensor host: **localhost** (default, applies at once)
or **host** with a `host`/`host:port` field and **connect**. The dev stack starts the relay and
hands this page its WebSocket URL as `PERCH_RELAY_URL`; the page tells the relay which
LibreHardwareMonitor host to poll (`perch/relay/lhm/request`) and reads whether that works from
its retained status (`perch/relay/lhm/status`). "Connected" means the relay's poll succeeds *and*
readings arrive here; only then do the preview and the sensor picker read the relay. Otherwise the
preview reads `createMockSource()` under a **sample data** badge, because authoring must not
require hardware. The choice and typed host are remembered (see [Settings](#settings)). The header marks the
source with `data-perch-source-kind` (`mock` or `mqtt`) so no
capture can be misread as a live panel. Open a specific file with `?layout=`,
including one under `layouts/invalid/` that the picker does not offer.

## Settings

The editor's settings live in one zustand store (`src/store.ts`), persisted to `localStorage` under
`perch-editor`: the sensor host, which sidebar sections and Advanced folds are open, each token
pane's tab and chip, and the layout last picked (`?layout=` still wins). The open draft and the
selection are in the same store but never persisted, so a reload always opens the file on disk.
With the Redux DevTools extension installed, every change shows on its timeline by name
(`toggle/section`, `set/connectionHost`, `edit/draft`, ...).

## Undo

The header's **undo** and **redo**, or Cmd-Z / Ctrl-Z and Shift-Cmd-Z / Ctrl-Shift-Z / Ctrl-Y from
anywhere but a text field (a field keeps the browser's own undo of its typing). Every change to the
layout is a step: a move or resize, any property, an add or delete, a topic, a theme token. Selection,
folds, tabs and the connection are not. One drag, one scrub, or one field between focus and blur or
Enter is one step (`src/edit-gestures.ts`). The history is in memory only, 200 steps deep, and cleared
when a layout is opened, switched or reverted; a save keeps it, and undoing back to the saved document
reads clean (`src/history.ts`).

## Scope

This slice does the four things the ask named: **list** the layouts and switch
between them, **preview** the selected one live on the shared canvas at its own
target size scaled to fit, **edit** the fields that already exist (element rects,
text, theme tokens, media `src`/`fit`, widget/chart bindings and ranges), and
**write** a valid layout back out. Since then: drag and resize on the canvas,
and **adding and deleting** elements. "+ Add" in the Selected-entity bar makes a
live reading, a chart or a label, with a searchable sensor picker listing what
the connected source has published (the same picker backs the topic field); the
selection header's trash can deletes, asking once inline, and the Delete or
Backspace key asks the same way when the canvas has focus. **Undo and redo** cover
every change to the layout (see [Undo](#undo)).
Escape, or a click on empty canvas, deselects. The sidebar's sections, the
selected entity's controls, the element rows and the delete confirm slide open
and shut rather than jumping (instant under `prefers-reduced-motion`).

Deliberately **not** in this slice, and why it is safe to leave out: adding a
media element (it needs an asset path), asset management, multi-layout
projects, and templates. See `DECISIONS.md` for the full list —
nothing here was missed, it was scoped out.

## Saving

A save is a `PUT /__perch/layout/<name>` handled by a **Vite dev-server
middleware** (`vite.config.ts`). Three mechanisms were weighed — dev-server PUT,
the File System Access API, and download-and-replace — and the PUT won because it
writes the file in place with no picker, no second copy in `~/Downloads`, and no
API that only some browsers ship. The trade is that it **only works under
`npm run dev`**; a statically built `dist/` has no server to answer the PUT, and
its save button will fail. That is acceptable for a local authoring tool and is
the reason the limit is stated here rather than implied.

What the endpoint will and will not do:

- **Edits existing files only.** A `PUT` to a name with no file on disk is a
  `404` — the editor changes the layouts that are there and does not create them.
- **Cannot escape `layouts/`.** The name is checked by `resolveSaveTarget`
  (`src/save-target.ts`, tested per-refusal in `save-target.test.ts`): no
  separators in either spelling, no traversal, no absolute paths, no hidden
  files, alphanumeric-led, `.json` appended by the server. `layouts/invalid/...`
  is therefore openable but unsaveable.
- **Validation is the client's job.** The middleware checks method, name, that
  the file exists, body size, and that the body is JSON — nothing semantic. The
  layout is validated in the browser by `validateLayout` before any request is
  made (`saveDraft` refuses with no HTTP at all when there are issues), so the
  server's shallow checks are a backstop, not the gate. See `src/save.ts`.

### It reformats hand-collapsed JSON

`serializeLayout` writes `JSON.stringify(layout, null, 2)` with a trailing
newline. The shipped `layouts/*.json` collapse some objects onto one line
(`"rect": { "x": 0, ... }`); a save re-expands every such object, so the first
save of a shipped layout produces a large-looking diff that is whitespace plus
the `schemaVersion` bump. The bytes still load identically through the runtime's
loader (`save.test.ts` round-trips them), but the diff is real and expected.

### Opening a shipped layout upgrades its schema

Both shipped layouts are `schemaVersion` 1; the loader migrates them forward to 2
on open. The editor carries the migration report and shows it in a bar before the
save (`1 -> 2: ... — saving writes the migrated document`), because it is this
editor that moves the version number and an author should not first meet that in
a diff.

## What this consumes from the packages

- `@perch/ui-kit` — `LayoutCanvas` (the preview *is* this, not a lookalike),
  `WIDGET_REGISTRY`/`WIDGET_NAMES`, `SensorProvider`, and the widget stylesheets.
- `@perch/layout-schema` — `loadLayoutJson` for a file from disk, `validateLayout`
  for in-memory drafts, `formatLayoutIssues` for the problem panel,
  `fitLayoutTarget`/`formatScalePercent` for the preview fit. There is no
  `serializeLayout` in the schema; this app supplies its own.
- `@perch/sensor-sources` — `createMockSource` for the preview's readings.
- `@perch/sensor-contract` — `normalizeSensorTopic` as the topic rule, identical
  to the runtime's.

## Tests and evidence

`npm test -w @perch/editor` covers listing, switching, an edit producing a valid
document, an invalid edit refused before any save request, and — the load-bearing
one in `app.test.tsx` — the preview's markup being byte-identical to a directly
rendered `LayoutCanvas`, which is how "the preview renders what the runtime
renders" is proven rather than asserted.

Screenshots and a save diff live under `.evidence/` (untracked): a desk layout
previewed, a tower layout after a switch, an invalid edit refused with the problem
legible, and the file a live save wrote. All frames are mock data.
