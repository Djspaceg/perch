# `@perch/ui-kit`

> Status: tentative.

## Purpose

The widgets. Each one is a thin wrapper that reads a single sensor topic and
paints it.

## Why this is its own package

**Both the runtime and the editor render it.** The editor's canvas has to draw the
same gauge the runtime draws, or WYSIWYG is a lie. It cannot live inside either
one.

## v1 widget set

- **readout** — numeric value plus unit and label.
- **gauge** — dial or arc, needs `range` from the layout or sensor metadata.
- **sparkline** — short rolling history, fixed window.

Text and media background are layout element kinds rather than widgets — they
bind to no topic. Bar charts and multi-metric combo widgets are explicit
fast-follow, not v1.

## The frame budget

Under every output path the page is **captured**, not interacted with. This is a
constraint on the widgets themselves:

- No hover, focus, or interaction affordances. Nothing that only appears on
  pointer input, because there is no pointer.
- Animation and redraw complete inside the capture interval. A sparkline that
  animates over 400 ms on a 10 fps capture is torn in four different frames.
- Nothing that leans on sub-pixel antialiasing or fine 1 px detail — it reads
  badly on a physical panel.
- Deterministic paint. Given the same props, the same pixels.

## Hard rules

1. **No transport.** Widgets never connect to MQTT, WebSockets, or HTTP. They
   receive values as props or via the sensor hook. Swapping the source must not
   touch this package.
2. **No layout parsing.** Widgets take a rect and props; they do not read layout
   files.
3. **Browser only.** No Node built-ins, no filesystem, nothing that a bundler
   would have to polyfill.
4. **Depends only on `sensor-contract`.** For topic and value types.

## Open questions

- **Stale rendering.** What does a widget look like when its sensor has aged out?
  Greyed, last-known with a marker, or explicit error state. Needs deciding once,
  here, rather than per widget.
- **Theming reach.** Which properties are token-driven vs per-element style
  overrides in the layout.
