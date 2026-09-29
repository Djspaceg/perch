# Cloud backgrounds - spec

Thermalright's hosted videos, fetched at run time into a cache; never in the repo or an installer.

## Source and catalogue

Servers, tried in this order: `http://www.czhorde.cc/tr/bj{W}{H}/` (international), then
`http://www.czhorde.com/tr/bj{W}{H}/` (china). Per item: `{id}.mp4`, and sometimes `{id}.png`.
Ids are a category prefix and 3 digits, static (not served): `a` Gallery 82, `b` Tech 25, `c` HUD 72,
`d` Light 55, `e` Nature 54, `y` Aesthetic 10. `a042` is labelled "Gallery 42".

Hosted sizes (a HEAD for `a001.mp4`, 2026-09-29: all 28 trcc-linux panel sizes answered 200): 1280x480 1600x720 172x640 176x320 1920x440 1920x462 240x240 240x320 320x176
320x240 320x320 320x960 360x360 440x1920 462x1920 480x1280 480x480 480x640 480x800 480x854
540x960 640x172 640x480 720x1600 800x480 854x480 960x320 960x540.

## Resolution rule

For a target W x H a size qualifies when width >= W and height >= H (long axis on the same axis,
the other at least ours); the least area wins. If none, the least `|ln(w/W)| + |ln(h/H)|`, ties to
the smaller area. The video covers the element, cropped centred, unless it says `contain`.

| Target | Picks | Why |
|---|---|---|
| 1920x400 | 1920x440 | beats 1920x462 on area |
| 400x1920 | 440x1920 | the same, portrait |
| 480x480 | 480x480 | exact |
| 2560x720 | 1600x720 | none qualifies; 0.47 beats 1920x462's 0.73 |

## Reference

A media element's `src` is a relative path or `thermalright:<id>`, `<id>` = `[a-z][0-9]{3}`, not
`000`. layout-schema validates the grammar (`malformed-background-ref`); no version step, so every
existing layout is unchanged. Never a URL or a path; resolved at render time.

## Cache

`@perch/backgrounds` (Node half, no Electron): `<root>/thermalright/<w>x<h>/<id>.mp4`, plus
`<id>.png`, `<id>.nopng` (both servers 404'd the preview) and `<id>.head.mp4` (the first 384 KiB,
a thumbnail when there is no PNG). Desktop root: `<userData>/backgrounds`. A download streams to
`.<name>.<random>.part` beside its target, is checked (length, `ftyp`/PNG magic), then renamed
over it; a failure unlinks it; hour-old parts are swept at start. In-flight downloads are shared,
four run at once; caps 64 MiB (PNG 4 MiB), 30 s on the first server, 60 s on the second.

## API and IPC

`cache.ensure(ref, target)` -> `{ ok, url }` or `{ ok: false, code, reason }`;
`cache.preview(ref, target)` -> `{ ok, kind: 'image' | 'video', url }`. Main checks the ref against
the catalogue and the target as whole pixels first.

- Runner page: `perchDesktop.ensureBackground(ref, target)`.
- Editor page: `perchEditorHost.ensureBackground(ref, target)`, `.previewBackground(ref, target)`.

Each answers only its own page.

## Read path

`perch-cache://backgrounds/thermalright/<w>x<h>/<file>`: a privileged streaming scheme whose
handler serves only names matching that grammar inside the root, GET/HEAD, with byte ranges (206)
for video. CSP: `media-src` (both pages) and `img-src` (editor) gain that origin.

## When downloads happen

An editor pick; a thumbnail scrolled into view; each page ensuring its layout's references on load
(so the runner caches its open layout's background).

## Failure

Offline, timeout, 5xx or 404: the other server. Both fail: `unreachable` or `not-found`, with
the reason. Short, over the cap or bad magic: dropped, the other server tried. Only `.nopng` is a cached failure. The canvas
shows `background unavailable: thermalright:a042 (<reason>)` in the rect; loading, it stays empty.

## Renderer

ui-kit `VideoBackground`: `<video autoplay muted loop playsinline>`, no controls, in the media
element's box and its opacity token, paused while the page is hidden. `LayoutCanvas` takes
`resolveBackground(ref)` (ready / loading / failed) beside `resolveAsset`; images are unchanged.
`useBackgroundSources(layout, ensure)` holds the state; no network or Electron code in ui-kit.

## Thumbnails

The PNG if the server has one, else `<id>.head.mp4` in `<video preload="metadata" muted>`, its first
frame. No ffmpeg. Cached too.

## Browser dev mode

`npm run dev`: the runtime's and editor's Vite servers mount the same cache at
`/__perch/backgrounds/{ensure,preview,file/...}`, root `node_modules/.cache/perch/backgrounds`
(`PERCH_BACKGROUNDS_DIR` moves it). A static build has no cache: the failure box says so.

## Editor UX

Media element, Content: a `background` row, its button naming the current one ("Gallery 42" or
"none"), opens a popover: tabs Gallery / Tech / HUD / Light / Nature / Aesthetic, a grid whose
cells take the layout's `aspect-ratio` W / H with the thumbnail covering the cell, lazily loaded
as cells scroll in. Cells are options named "Gallery 42", the current one selected; arrows,
Home/End move, Enter picks. A pick spins on the cell, downloads, then sets
`src` as one undoable edit and closes; a failure stays open, saying why. The Add menu's
"Background" inserts a full-canvas media element first in paint order, through the same browser.
