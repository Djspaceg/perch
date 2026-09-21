# `layouts/`

Your actual dashboards. Content, not code — this directory is the reason the rest
of the repo exists.

One file per dashboard, validated against `@perch/layout-schema`. Name them for
their target, since a layout is tied to a resolution:

```text
layouts/
  desk-1920x400.json        # the Trofeo Vision panel
  desk-1920x400.assets/     # backgrounds and video referenced by that layout
  browser-tab.json          # a wider-aspect variant for day-to-day viewing
```

`ASSUMPTION:` Media is referenced by a path relative to the layout file, and lives
in a sibling `<name>.assets/` directory. Keeps a layout and its assets movable as
a unit, and keeps binaries out of the layout file so it stays diffable.

A layout that will not validate is not a layout. The editor validates before
saving and the runtime validates before rendering, so a file here that fails
either is a bug in whichever wrote it.
