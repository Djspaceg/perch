# `@perch/runtime` (app)

> Status: tentative.

## Purpose

Takes a layout definition and renders it. This is the thing that actually *is* a
dashboard at run time, and the thing that gets emitted as a standalone bundle.

## Two modes

**Windowed** — normal browser tab. Scales the fixed canvas to fit the viewport,
letterboxed. What you use day to day.

**Capture** — for anything that screenshots or screencasts the page:

- Viewport fixed to `layout.target`, exactly. No scrollbars, ever.
- No hover, focus, or interaction affordances rendered.
- An explicit **ready signal** once fonts are loaded, assets fetched, and the
  first sensor values have arrived — so frame one is never a half-painted page.
- No transition on first paint.

The ready signal is the part that is easy to skip and expensive to retrofit.
Whatever captures the page needs to know when to start.

## Standalone bundle

The deliverable artifact: a self-contained directory of HTML, JS, CSS, and copied
media assets that loads cold from `file://` or any static server, with no build
step at the far end.

```sh
npm run build -w @perch/runtime -- --layout ../../layouts/desk-1920x400.json
```

Broker URL is read from a config file **beside the bundle** at load time, not baked
in at build time, so one bundle runs against several machines.

Not built yet. `npm run build` today runs `tsc -b` and then `vite build` into
`dist/page`, with no `--layout` flag and no asset copying, and the result needs a
static server rather than `file://`.

## The page today (React + Vite)

`index.html` + `src/main.tsx` + `src/app.tsx` are the page, and it now **loads a
layout** rather than hard-coding tiles. `main.tsx` constructs the source and passes
the layout catalogue and the parsed query string; `app.tsx` runs the chosen document
through `loadLayout` and either paints it or shows why it refused. Both modes above
and the ready signal are implemented; the standalone bundle is not.

The repo settles on **Vite 8**. `apps/runtime` and `apps/editor` both declare
`vite@^8.3.0` with `@vitejs/plugin-react@^6.1.1`, and the root declares `vite` too
because Vitest 5 has a non-optional `vite` peer — so all three resolve to a single
installed copy rather than the two majors this repo used to carry.

Vite 8 bundles with **Rolldown** and transpiles with **Oxc** instead of Rollup and
esbuild. That is a real change in what produces `dist/page`, not a version bump: if
a built page ever misbehaves in a way the dev server does not, the bundler swap is
the first place to look.

```sh
npm run dev -w @perch/runtime       # vite, http://127.0.0.1:5173 (strictPort)
npm run build -w @perch/runtime     # tsc -b, then vite build → dist/page
npm run preview -w @perch/runtime   # serve the built page
npm test -w @perch/runtime          # vitest, jsdom
```

`vite.config.ts` aliases `@perch/*` to each package's `src/index.ts` — the same table
`vitest.aliases.js` gives the tests, imported rather than restated — so the page and its
tests resolve `ui-kit` identically, and editing a widget needs no `tsc -b`.

**HTTP is required, and the failure over `file://` is silent.** Opening `index.html`
from disk renders a blank page and reports *nothing*: no exception, no console error.
The module script is simply never executed. If the page looks empty, check the URL
scheme before looking anywhere else.

What the page demonstrates is now the *layout's* business, not the page's. Both shipped
layouts show live values in most tiles and deliberately leave one or two waiting on a
topic the mock never publishes, so the waiting and no-reading states are visible without
a tile being captioned into existence by the page. The second short-lived mock source
that used to drive the stale state is gone: a layout file cannot name a source, so a
second source had no tile it could reach. Staleness is covered by `ui-kit`'s tests
against a controlled clock, which is where a timing claim belongs anyway.

## Selecting a layout

Two query parameters, and nothing else. There is no picker UI: a panel has no keyboard,
and a URL is the one setting a kiosk browser can be told at launch.

```
http://localhost:5173/?layout=desk-1920x400
http://localhost:5173/?layout=tower-720x1280&mode=capture
http://localhost:5173/?layout=invalid/broken-desk
```

- **`?layout=`** — the path under `layouts/` without the `.json`, so `desk-1920x400` or
  `invalid/broken-desk`. Absent → the first layout in the catalogue, sorted, which keeps
  `npm run dev` a single command. A name that does not exist is refused on the page with
  the names that do, rather than silently falling back to the default — falling back
  would make a typo look like a layout that renders the wrong thing.
- **`?mode=`** — `windowed` (default) or `capture`. Windowed scales the fixed canvas to
  fit the viewport and letterboxes the remainder. Capture renders **1:1 or not at all**:
  if the viewport is not exactly `layout.target`, the page refuses with
  `describeTargetMismatch`'s sentence instead of handing a screenshot tool a scaled
  picture of the panel. Any other value is treated as `windowed`.

Everything under `layouts/invalid/` is reachable by name and never offered: the page
will not default to one and does not list one, because it is not a layout.

### The chrome strip, and why it cannot be turned off

A fixed strip along the bottom names the layout, the mode and fit, the source, the
source's status in words, and the timestamp of the last reading. It renders in **both**
modes and on every refusal, and a layout's theme cannot reach it.

That is deliberate and not negotiable from a layout file: while the sensor host is off,
every value on this page is generated by the mock, and a screenshot that did not say so
would be a picture of invented hardware readings. Both shipped layouts *also* carry
"mock source · generated values, not hardware" as canvas text, so a crop that loses the
strip still says where the numbers came from.

### Mock or MQTT, chosen at load

`src/main.tsx` is the only file in the repo that constructs a source, and it picks one:

```sh
npm run dev -w @perch/runtime                                    # mock
PERCH_BROKER_URL=ws://localhost:19001 npm run dev -w @perch/runtime   # real broker
```

Set → `createMqttSource`. Unset → `createMockSource`. Only an *explicitly set* value
selects MQTT: `main.tsx` feeds it to `resolveBrokerUrl` and requires `origin === 'env'`,
so the resolver's built-in `ws://localhost:9001` can never quietly point the page at
whatever else is on 9001. The sensor host is off most of the time; `npm run dev` has to
keep working with no hardware and no environment.

The variable reaches the browser through `envPrefix: ['VITE_', 'PERCH_']` in
`vite.config.ts` — Vite exposes only prefixed variables to `import.meta.env`, and reads
them from the shell as well as from `.env` files. `src/vite-env.d.ts` declares that one
variable rather than referencing `vite/client`, whose `ImportMetaEnv` carries an `any`
index signature the repo's TypeScript rules forbid.

Which source is live is printed in the page header, with the URL when there is one, and
the source's `status` sits beside it in words: `connecting` (nothing yet), `live`,
`stale` (transport up, publisher quiet) and `error` (link down). Mock data must never be
readable as hardware, and a colour alone is not a sentence on a wall panel.

The canvas is the **fixed, scaled, letterboxed** one described under *Windowed* above,
no longer the fluid grid the page used before it could read a layout. A browser tab and
a 1920×400 viewport now show the same arrangement at two sizes, which is the point: the
geometry a layout author writes is the geometry the panel gets.

The previous harness — `dev-harness.html`, `src/dev-harness.ts`, `tools/serve.mjs`,
`tools/capture.mjs` and the hand-maintained import map — is **gone**. It existed only
because `tsc -b` emits bare specifiers no browser can resolve; it served `dist/`, one
build behind the source. See DECISIONS.md, "The React ui-kit and the Vite runtime page".

## Depends on

`ui-kit`, `layout-schema`, `sensor-contract`, `sensor-sources`. Nothing depends on
this package — `caster` consumes its **built output**, not its source.

## Hard rules

1. **No panel or device code.** The runtime produces pixels in a page. It does not
   know a physical display exists.
2. **Rejects a layout it cannot honour**, naming the mismatch. A layout declaring
   1920×400 rendered into a target that cannot do it is an error, not a best-effort
   scale.
3. **No authoring.** Read-only with respect to layouts. It never writes one.

## Open questions

- **Bundle granularity.** One bundle per layout, or one bundle that takes a layout
  at load time? Per-layout is simpler to ship to a panel; runtime-loaded is nicer
  for iterating. Possibly both, with the layout embedded as a build option.
- **Font loading.** Web fonts and the ready signal interact badly. Local fonts
  only, or block the signal on font readiness.
