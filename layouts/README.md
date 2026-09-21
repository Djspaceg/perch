# `layouts/`

Your actual dashboards. Content, not code — this directory is the reason the rest
of the repo exists.

One file per dashboard, validated against `@perch/layout-schema`. Name them for
their target, since a layout is tied to a resolution:

```text
layouts/
  desk-1920x400.json          # the Trofeo Vision panel: a dark strip of eight narrow tiles
  desk-1920x400.assets/       # rails.svg — the backdrop that layout references
  tower-720x1280.json         # a tall warm-paper column of six deep tiles
  tower-720x1280.assets/      # weave.svg — the backdrop that layout references
  invalid/                    # documents that are deliberately NOT layouts
    broken-desk.json
```

`ASSUMPTION:` Media is referenced by a path relative to the layout file, and lives
in a sibling `<name>.assets/` directory. Keeps a layout and its assets movable as
a unit, and keeps binaries out of the layout file so it stays diffable.

Both shipped assets are hand-authored SVG — a pattern plus a few rects, a few hundred
bytes each. No binary belongs here: a background that can only be diffed as bytes is a
background nobody will ever review.

A layout that will not validate is not a layout. The editor validates before
saving and the runtime validates before rendering, so a file here that fails
either is a bug in whichever wrote it.

## `invalid/`

The one exception, and it is why it has its own directory and not a naming convention:
these documents exist **to be refused**. `broken-desk.json` is valid JSON that fails
validation nine ways at once — one per issue code — so the runtime's refusal page can be
exercised against a real file rather than only a test fixture.

Nothing here is offered by the runtime or reachable as a default; you have to name one
(`?layout=invalid/broken-desk`). The rule above still holds: these are not layouts.

## What every layout here must do

Both shipped layouts read from the **mock** source while the sensor host is off, so both
are written to be honest about that and to show the whole range of readout states:

- at least one **indexed** topic, so the five-segment topic form is exercised;
- at least one topic the mock **never publishes**, so the waiting state is visible rather
  than theoretical — but only one or two, so the panel reads as a dashboard with a gap
  and not as a broken page;
- canvas text saying the values are generated and not hardware, so a crop of a screenshot
  cannot be mistaken for a reading off a real machine.

`apps/runtime/src/layouts.test.ts` asserts each of those against the real files.

## The bottom band belongs to the chrome strip

The runtime paints a fixed 29px provenance strip across the bottom of the *viewport*, over the canvas,
and a layout cannot turn it off (`apps/runtime/README.md`, "The chrome strip"). Windowed mode scales
the canvas, but not the strip — so the band of canvas it covers is **29 ÷ scale** canvas pixels, and it
grows as the window gets smaller relative to the target.

Keep the bottom of a canvas clear in proportion to how small it will ever be shown:

| Smallest scale you care about | Canvas pixels to leave clear |
| --- | --- |
| 1 (the panel, capture mode) | 29 |
| 0.625 (target in a 1280×800 tab) | 46 |
| 0.3125 (a tall layout on a 1920×400 panel) | 92 |

`tower-720x1280.json` puts its footer line at y 1196 of 1280 — 84px of headroom, which clears the
strip at 1:1 and in a tab, and is *covered* when the column is scaled onto the panel's own 1920×400.
That is a known limit and not a bug in the fit: see `.evidence/CAPTURES.md`, which measures it. Nothing
here enforces the rule, which is one more way a layout is a call site no compiler checks.
