# `@perch/editor` (app) — SPEC

> Status: tentative. The least-defined piece in the project.

## Purpose

Drag-and-drop authoring of a dashboard. Its **only** output is a layout
definition file.

That constraint is what keeps it tractable: the editor has no runtime
responsibilities, no device knowledge, and no build pipeline. It is a GUI that
writes JSON.

## Capabilities

**v1**

- Canvas at the layout's `target` resolution, 1:1, with zoom-to-fit for screens
  smaller than 1920×400.
- Place, move, resize, and delete elements. Snap and align.
- Bind a widget to a sensor topic via a picker populated from live topics.
- Add text elements with font, size, colour.
- Set a background image or video.
- Edit theme tokens (CSS custom properties) and see them apply live.
- Load and save a layout file. Validate before writing.
- **Preview in capture mode** — see exactly what the panel will get.

**Explicitly not v1:** undo history beyond a simple stack, multi-layout projects,
asset library management, collaborative editing, templates.

## WYSIWYG is the whole point

The canvas renders `@perch/ui-kit` — the same components `runtime` renders, not a
stand-in. Any divergence between editor canvas and runtime output is a bug in this
app, not a cosmetic issue. This is the single reason `ui-kit` is its own package.

The editor runs against the **mock** sensor source by default, so authoring works
with no hardware, no broker, and no agent running.

## Shell

`ASSUMPTION:` Ships first as a plain web app, run locally. A native desktop
wrapper (Tauri or Electron) is additive — it changes the shell and the file-picker
path, and leaks into neither the layout format nor `ui-kit`. Deciding it now buys
nothing.

If it does become a native app, the standalone-executable packaging belongs here,
not in a separate package.

## Depends on

`ui-kit`, `layout-schema`, `sensor-contract`, `sensor-sources`. Nothing depends on
this package.

## Hard rules

1. **Writes layouts and nothing else.** No bundle building, no panel output, no
   device control.
2. **Validates before saving.** An editor that can produce a layout the runtime
   rejects is broken.
3. **Never its own widget implementations.** If the canvas needs a widget, it goes
   in `ui-kit`.

## Open questions

- **File access.** Browser file-system access is awkward; a local dev server with
  a tiny save endpoint may be the pragmatic v1, with native file dialogs arriving
  alongside the desktop wrapper.
- **Topic picker when nothing is publishing.** Free-text entry as a fallback, with
  validation against the contract's topic grammar.
- **Asset paths.** The editor picks a background from somewhere on disk; the layout
  stores a relative path. Where is "relative to" — the layout file, or a project
  root?
