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

`index.html` + `src/main.tsx` + `src/app.tsx` are **the page, not yet the runtime**.
They **hard-code their widgets** — a fixed list of tiles in `LIVE_TILES` — because
`layout-schema` does not exist yet. Reading a layout, the two modes above, and the
ready signal all land later; nothing here should be mistaken for them.

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

What the page deliberately demonstrates, rather than waiting for it to occur: every
readout state (live, a sensor reporting `null`, stale, and never-published). The stale
one is driven by a **second, injected mock source** that publishes briefly and then
stops, so the rendering ages a real reading against a real clock — and it stays a mock
even when the page is reading hardware, because a relay cannot be asked to die on cue.
Its tile is captioned `stale · mock publisher stopped` for that reason.

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

The canvas is **fluid**, not the letterboxed fixed canvas described under *Windowed*
above. That is temporary and load-bearing for now: it means a browser tab and a
1920×400 viewport produce genuinely different geometry, so capturing both is a real
check on the layout rather than the same picture at two scales.

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
