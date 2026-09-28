# Workspace wiring — decisions

Scope of this change: npm workspaces, TypeScript, and Vitest for the shape
`ARCHITECTURE.md` already agreed. No product code, no redesign. Every `ASSUMPTION:`
line in the docs was left exactly as written.

Evidence for the claims below: `build.log`, `test.log`, `typecheck.log` (green), and
`red-1-no-wiring.log` / `red-2-no-entry-points.log` (the same tests failing before the
wiring existed).

## 1. npm workspaces at the root, no build orchestrator

`packages/*` and `apps/*` are the workspace globs, matching the folder structure
`ARCHITECTURE.md` calls load-bearing. One `npm install` at the root, as the stated dev
workflow requires. No Turborepo, Nx, or task runner: `ARCHITECTURE.md` rejects extra
build orchestration at this size, and `tsc -b` already does topological ordering.

## 2. TypeScript: project references for packages, path mapping only for tests

Two mechanisms, each doing one job:

- **Project references** (`composite: true` everywhere, `references` per package) wire
  the eight projects. Each package's `build` is a bare `tsc -b`, which builds its own
  referenced projects first, so the root fan-out does not need to order anything. The
  references are also a *second* place the dependency edges are stated, and `tsc` fails
  if a package imports something it has not referenced — the dependency rules become
  mechanical rather than remembered.
- **Path mapping** appears in exactly one file, `tsconfig.tests.json`, a root `noEmit`
  project that typechecks all 15 test files. Tests must see each other's *source*,
  whereas the package projects deliberately see only built `.d.ts` — the same boundary a
  consumer outside the repo would get.

Rejected: path mapping everywhere instead of references. It typechecks a package against
sources that a published consumer would never receive, so a missing export in
`index.ts` would not be caught until publish time.

Test files are excluded from the package projects (`"exclude": ["src/**/*.test.ts"]`), so
no test code or test `.d.ts` reaches `dist/` — verified: `dist/` contains 44 files and
none matches `*test*`.

`tsconfig.base.json` holds the shared strictness. Two deliberate omissions:

- **`noUncheckedIndexedAccess` is OFF.** With it on, `topics.ts`'s
  `const [, device, metric] = parts` types both as `string | undefined` and the file no
  longer compiles. Turning it on would mean editing `topics.ts`, which this task forbids.
  Worth revisiting with the human when the closed-union question is settled.
- **`types: []` by default**, so a hoisted `@types/node` cannot leak Node globals into a
  browser package. `agent` and `caster` opt back in with `types: ["node"]`. This is how
  "no Node built-ins in the shared path" (`sensor-sources` rule 2) and "browser only"
  (`ui-kit` rule 3) are enforced rather than just documented: `ui-kit`, `sensor-sources`,
  `runtime`, and `editor` get `lib: ["ES2022", "DOM"]` and no Node types at all.

## 3. Vitest: one config per package, environment stated locally

Each of the eight packages has its own `vitest.config.ts` naming its environment, per
`ARCHITECTURE.md`: `jsdom` for `ui-kit`, `runtime`, `editor`; `node` for
`sensor-contract`, `layout-schema`, `sensor-sources`, `agent`, `caster`. A per-package
config is what makes `npm test -w @perch/<name>` work with no extra flags, and it keeps
the environment next to the package whose constraint it is.

Rejected: a single root config with `projects`. It centralises eight one-line facts into
a file none of the eight packages own, and per-package invocation then needs the root
config passed in.

The environment is not taken on trust. Every package has an `environment.test.ts` that
asserts what it got — the jsdom packages additionally build a real element
(`document.createElement('canvas').tagName === 'CANVAS'`), because the global names
existing is weaker than a DOM actually being present.

## 4. Cross-package resolution in tests goes to source, via one shared alias table

`vitest.aliases.js` at the root maps `@perch/<name>` to that package's
`src/index.ts`; every package's config spreads it into `resolve.alias`. Consequences:
`npm test` needs no prior `npm run build`, a test always exercises the working tree, and
the alias table is one file instead of four lines repeated eight times.

It is plain `.js` on purpose. Vite loads config files through esbuild, and a `.js`
specifier resolves the same way regardless of the importing config's language — no
`.js`-means-`.ts` ambiguity in a file every test run depends on.

## 5. Root scripts fan out with `--workspaces --if-present`

```sh
npm run build   # npm run build --workspaces --if-present
npm test        # npm test  --workspaces --if-present
npm run clean   # npm run clean --workspaces --if-present
npm run typecheck   # tsc -b && tsc -p tsconfig.tests.json
```

`--if-present` keeps a future workspace without one of these scripts from breaking the
root command. Each fan-out prints a per-lane header and its own summary, so a lane is
judged by its own output: `build.log` shows 8 `> @perch/… build` lanes, `test.log` shows
8 lanes, 15 files, 77 tests, 0 failures.

`typecheck` is the one root script that does not fan out, because `tsc -b` at the root
solution file already walks all eight projects in order, and the tests project is
repo-wide by nature.

## 6. Dependency edges are exactly the two tables in ARCHITECTURE.md

| Workspace | `dependencies` |
|---|---|
| `@perch/sensor-contract` | none |
| `@perch/layout-schema` | none |
| `@perch/ui-kit` | `sensor-contract` |
| `@perch/sensor-sources` | `sensor-contract` |
| `@perch/runtime` | `ui-kit`, `sensor-sources`, `sensor-contract`, `layout-schema` |
| `@perch/editor` | `ui-kit`, `sensor-sources`, `sensor-contract`, `layout-schema` |
| `@perch/agent` | `sensor-contract` |
| `@perch/caster` | none |

No edge was added that the docs do not list. `caster` has no `dependencies` and no
`references` — it consumes `runtime`'s built artifact, an artifact boundary, and the
absence is commented in its `tsconfig.json` so it does not read as an oversight. Every
declared edge has a test that imports it and calls through it, so an edge that is
declared but unresolvable fails the suite (see `red-2-no-entry-points.log`, where
exactly those tests fail).

Internal edges are pinned as `"0.0.0"`, matching each member's version, which npm
resolves to the workspace symlink. All eight are `private: true` for now; publishing is
a reserved decision and nothing here is ready for it.

## 7. Tests for the salvaged sources test behaviour, including rejection

- `topics.test.ts` (21 tests): the builder over all 4x5 device/metric pairs, round-trip
  through the parser, the type guard's narrowing, and 15 rejection tests — foreign root,
  missing and extra segments, unknown device, unknown metric, wrong case, empty segment,
  leading and trailing slash, the subscription wildcard, and the retained `/meta`
  companion topic from the SPEC.
- `reading.test.ts` (30 tests): valid readings, extra fields (the guard is structural),
  and rejection of `null`, arrays, primitives, each missing field, a numeric string, a
  `Date` as `at`, and `NaN`/`±Infinity` for both numeric fields. One test asserts the
  contract's own JSON-safe rule by round-tripping through `JSON.stringify`.
- `relay-endpoint.test.ts`: the URL builder's default, host override, host+port
  override, and that the result parses as a `ws:` URL.

`topics.test.ts` includes a case asserting `parseSensorTopic('sensors/cpu/core3/temp')`
is `null`. That **documents** the known design problem — the closed unions have no topic
for CPU core 3 — it does not endorse or resolve it. The grammar is untouched, because it
is an open question with the human.

## 8. Red-then-green

- `red-1-no-wiring.log` — all 15 suites fail; no tsconfig, no package manifests, no
  Vitest configs exist yet.
- `red-2-no-entry-points.log` — manifests, tsconfigs, and Vitest configs in place,
  entry points not yet written. The suites depending on a missing `index.ts` fail by
  name (`Failed to resolve import "@perch/sensor-sources"`), while
  `sensor-contract`'s 52 tests already pass.
- `test.log` — 77 tests, 0 failures.

Stated plainly: `sensor-contract`'s tests are green in `red-2` because `topics.ts` and
`reading.ts` were salvaged with the repo and already existed. Their honest red is
`red-1`, where the wiring those tests need is absent. Nothing was reconstructed.

## Deferred, and why

These are named rather than quietly filled in. Each is either out of the stated scope or
a dependency decision that is not mine to make.

1. **React is not installed.** `ui-kit`, `runtime`, and `editor` are React-shaped in the
   docs, but the task approves only the workspaces/TypeScript/Vitest/jsdom minimum, and
   an empty entry point needs no React. The jsdom environments are verified without it.
   The first widget brings React, `@types/react`, and whichever component-test library
   it wants.
2. **`npm run dev -w @perch/editor` does not exist.** `ARCHITECTURE.md` lists it in the
   dev workflow, but a dev server means a bundler (Vite), which is outside the approved
   dependency set. Surfaced rather than added.
3. **`runtime`'s bundle build is a bare `tsc -b`.** Its README documents
   `npm run build -w @perch/runtime -- --layout …` emitting a standalone bundle. That is
   a bundler plus product code; the script name and workspace exist, the bundle does not.
4. **`layout-schema` has no validator dependency.** Its SPEC allows "zero runtime
   dependencies, beyond a validator", but choosing the validator is a design call
   attached to writing the schema, which is out of scope.
5. **`SensorMeta` is specified but not implemented.** `sensor-contract`'s SPEC defines
   the metadata shape and its retained companion topic; `src/` has no `meta.ts` and
   `index.ts` does not export one. Writing it is contract work, not wiring. The `/meta`
   topic is covered by a rejection test today, since the three-segment grammar excludes
   it.
6. **No linter or formatter.** Not in scope and not in the approved dependency set.
7. **The topic grammar itself.** Wired and tested exactly as `topics.ts` stands. While
   this change was being made, `packages/sensor-contract/SPEC.md` was rewritten in the
   working tree (not by this change, and left uncommitted) to specify a much wider
   grammar — `sensors/<device>/<deviceIndex>/<metric>/<sensorIndex>`, an LHM-derived
   vocabulary, a nullable `value`, and no `unit` in the reading. That rewrite says so
   itself: widening `topics.ts` is the next change to the package and will invalidate the
   tests written against the narrow version. Those tests are still the right tests for
   the code that exists today, and `CALL_SITES.md` lists what the widening will touch.
8. **`vitest.config.ts` files are not typechecked.** `tsconfig.tests.json` covers test
   files only; including the configs would mean `allowJs` for the alias table's sake.
   They are eight lines each and every test run executes them.

---

# Widening `@perch/sensor-contract` to its full vocabulary — decisions

Scope of this change: `packages/sensor-contract` only, implementing its SPEC as written —
the topic grammar with both indices, the 12-device and 21-metric vocabularies, the
metric/unit table, `value: number | null` with no `unit`, and `SensorMeta`. Plus the five
consumer call sites the old vocabulary broke. No redesign: where the SPEC states a
decision, the SPEC won.

Evidence: `.evidence/green-build.log`, `.evidence/green-test.log`,
`.evidence/green-test-per-lane.log`, `.evidence/green-typecheck.log` (all exit 0), and
`.evidence/red-1-new-tests-vs-narrow-impl.log` / `.evidence/red-2-typecheck-vs-narrow-impl.log`
(the new tests failing against the old narrow implementation).

## 1. The LHM `SensorId` mapping lives in `sensor-contract`, in its own module

`lhmSensorIdToTopic()` and `lhmVendor()` are in `packages/sensor-contract/src/lhm.ts`,
not in `sensor-sources`.

The deciding argument is the dependency graph, not taste. Per `ARCHITECTURE.md`
`apps/agent` — the app whose whole job is reading sensors and publishing them — depends on
`sensor-contract` **alone**. Putting the mapping in `sensor-sources` leaves two options:
give `agent` a new edge it does not otherwise need, or let `agent` keep its own copy of the
table. A second copy of a name mapping is exactly the failure SPEC rule 5 ("names live
here or nowhere") exists to prevent, and the first option widens the dependency graph to
pay for a pure string function.

The supporting arguments: the mapping is a *name* mapping (`intelcpu` to `cpu`,
`smalldata` to `small-data`), which is the category rule 5 reserves for this package; it is
not transport, so rule 3 does not push it out; it has zero runtime dependencies, so rule 1
holds; and the SPEC already states this package's vocabulary is derived from LHM, so LHM's
taxonomy is declared provenance here rather than foreign knowledge smuggled in.

It is a separate module rather than part of `topics.ts` so that `topics.ts` stays about the
grammar and exactly one file knows a foreign vocabulary. If this judgement is later
reversed, moving it is a file move.

## 2. The LHM hardware table fails closed, and is honestly incomplete

Only `/intelcpu/0/temperature/0` is verified from source. The remaining keys follow LHM's
and OpenHardwareMonitor's identifier conventions, with both spellings included where the
two projects differ (`gpu-nvidia` and `nvidiagpu`, `gpu-amd` and `atigpu`).

An unrecognised hardware type returns `null`. The alternative — bucketing an unknown type
into a plausible-looking device — would publish real readings under a wrong topic, and
nothing downstream could detect it. A `null` is a visible gap that an adapter can log.
**Deferred:** widening the table against a live `/data.json`. See "Deferred" below.

## 3. The identifier is parsed from the end, because the hardware portion is variable-length

A rigid four-segment split would have failed on real identifiers. LHM omits the hardware
index entirely for singletons (`/ram/data/0`) and uses more than one segment to name a
Super I/O chip (`/lpc/nct6687d/temperature/2`) or a NIC (`/nic/{guid}/throughput/1`). So
`splitLhmSensorId` takes `sensorIndex` and `sensorType` from the end, treats the remainder
as the hardware portion, pops a trailing numeric segment as `deviceIndex` if there is one,
and resolves the hardware name by exact match then by leading segment. Covered by tests
for all four shapes.

## 4. The template-literal type stays closed on names and open on indices

`SensorTopic` is:

```ts
`sensors/${SensorDevice}/${number}/${SensorMetric}/${number}`
```

The device and metric holes stay closed unions, so `'sensors/cpu/0/celsius/0'` is a
compile error — that property is the whole reason the narrow version was worth keeping, and
`topics.test.ts` pins it with `@ts-expect-error` assertions that fail the typecheck if the
type ever goes loose.

The index holes are `${number}`, a *pattern* rather than an enumerated union. Enumerating
indices would multiply the union by an arbitrary index bound (12 x 21 x N x N) for no gain;
as written the type has 252 members. The cost is that the type also admits index spellings
the runtime rejects (`1.5`, `-1`, `1e3`). That is the right trade: rule 5 is about *names*,
and an index is not a name. Two things cover the gap — `sensorTopic()` throws `RangeError`
rather than returning a topic its own parser would reject, and `parseSensorTopic()` rejects
non-canonical index segments.

## 5. An index segment has exactly one canonical spelling

`parseSensorTopic` rejects `00`, `+1`, `1e3`, `1.5`, `-1` and whitespace, via
`/^(?:0|[1-9][0-9]*)$/`. A topic is an identity key: if `sensors/cpu/00/temperature/0` and
`sensors/cpu/0/temperature/0` both parsed, one sensor would have two topic strings, which
means two subscriptions and two widgets disagreeing about which is live.

## 6. `isSensorTopic` rejects the shorthand; `normalizeSensorTopic` is the authoring seam

`isSensorTopic` narrows to `SensorTopic`, which is the five-segment type. A guard that
returned `true` for the three-segment shorthand would be lying to every caller that then
treats the value as canonical, so it returns `false` and the SPEC's shorthand is handled by
`parseSensorTopic` (which accepts both forms) and `normalizeSensorTopic` (which validates
and expands, returning `null` on anything invalid).

`normalizeSensorTopic` rather than a third boolean guard: free-text entry needs the
canonical spelling to store and subscribe to, not just a yes/no, and `!== null` gives the
boolean for free.

## 7. `SENSOR_METRIC_UNITS` is frozen, and `factor` has the empty string

One `Object.freeze`d `Record<SensorMetric, string>`, asserted against the SPEC table
key-for-key. Frozen because rule 5 forbids a consumer declaring its own unit, and freezing
makes the attempt fail rather than mutate the shared table.

`factor` is dimensionless and its unit is `''`, not a placeholder like `'x'` or `'-'`: a
renderer concatenating value and unit then produces the right output with no special case.

## 8. `sensorTopic(device, metric, { deviceIndex, sensorIndex })`

Named indices in a trailing options object, both defaulting to `0`. Positional
`(device, metric, 0, 3)` would put two bare numbers at every call site with nothing to
distinguish "second GPU" from "core #3" — and the topic order interleaves them
(`device/deviceIndex/metric/sensorIndex`), so no positional order reads correctly. The
common case stays `sensorTopic('cpu', 'temperature')`, as the SPEC asks.

## 9. `isSensorReading` ignores a leftover `unit` field rather than rejecting it

`unit` is gone from the shape. A stale publisher still sending it produces a reading that
is structurally valid and carries a field with no authority — the check is structural for
extra fields everywhere else, and rejecting this one field would turn a harmless
version skew into a dashboard showing no data. Pinned by a test, so the leniency is a
decision rather than an oversight.

## 10. `NaN` is rejected at the boundary, not coerced

`isSensorReading` rejects `NaN` and `±Infinity` for both fields. LHM's `RawValue` is
`float?` and can be `NaN` (its own Prometheus exporter skips `float.IsNaN`), so the source
must publish `null`. Coercing here would hide a producer bug; and `NaN` cannot be the wire
representation anyway, since `JSON.stringify` emits `null` for it — a test asserts exactly
that, so the reason is recorded next to the rule.

## 11. `SENSOR_META_SUFFIX` is exported, and a meta topic is not a reading topic

The retained companion suffix is named here, not spelled `'meta'` in `agent`. Because
`SENSOR_TOPIC_WILDCARD` (`sensors/#`) also matches meta topics, a subscriber on it receives
metadata interleaved with readings; `isSensorTopic` and `parseSensorTopic` both reject a
six-segment meta topic, so routing cannot silently hand a `SensorMeta` body to a reading
consumer. Noted in the code where the wildcard is defined.

## 12. Call sites, all of them

A shared-package change is a class of change. Every row of `CALL_SITES.md`'s "existing call
sites" table was visited; the five that used the old vocabulary were updated in the same
change:

| Call site | Change |
|---|---|
| `packages/sensor-contract/src/index.ts` | re-exports the new surface: units table, `SensorMeta`, the LHM helpers |
| `packages/sensor-contract/src/topics.test.ts` | rewritten for the new grammar |
| `packages/sensor-contract/src/reading.test.ts` | rewritten for `value: number \| null`, no `unit` |
| `packages/sensor-contract/src/meta.test.ts` | new |
| `packages/sensor-contract/src/lhm.test.ts` | new |
| `packages/ui-kit/src/dependency-edges.test.ts` | `('cpu','temp')` to `('cpu','temperature')`; dropped `unit` from the reading |
| `packages/sensor-sources/src/dependency-edges.test.ts` | `('gpu','temp')` to `('gpu','temperature')` |
| `apps/runtime/src/dependency-edges.test.ts` | same rename; dropped `unit` |
| `apps/editor/src/dependency-edges.test.ts` | `('ram','usage')` to `('memory','load')` — both old names are gone |
| `apps/agent/src/environment.test.ts` | topic literal now five-segment |

`packages/sensor-sources/src/relay-endpoint.ts` does not import the contract, so it is
untouched. No config-level reference moved: no package was renamed. The "not written yet"
rows are still unwritten, which is the point of doing this before they exist.

## What the SPEC left underspecified, and what was chosen

Recorded rather than quietly decided. None of these needed a redesign.

1. **`at` has no lower bound.** The SPEC says "epoch ms" and nothing more, so any finite
   number is accepted — a negative `at` renders as an absurdly stale reading, which is
   self-diagnosing, where inventing a bound would reject a legitimate clock skew.
2. **`label` may be empty.** The SPEC does not forbid it, so `isSensorMeta` accepts `''`.
   A non-empty rule is a reasonable later tightening; it is not in the SPEC today.
3. **`vendor` is `string`, not a union.** The SPEC's prose lists
   `'nvidia' | 'amd' | 'intel'` but its type block says `vendor?: string`. The type block
   won. `lhm.ts` produces those three lowercase values.
4. **Index bounds are unstated.** Non-negative integer, unbounded above.
5. **The `factor`/`timing` open question is left open.** The SPEC's metric table includes
   both, so both are implemented; its open question about whether they deserve widgets is a
   `ui-kit` question and is untouched.
6. **Discovery and the staleness threshold** are the SPEC's own open questions and stay
   open. Nothing here forecloses either.

## Deferred, and why

1. **The LHM hardware table needs widening against a live `/data.json`.** Only
   `/intelcpu/0/temperature/0` is verified from source; the rest follow LHM/OHM convention.
   It fails closed, so the gap is visible rather than silent, but a real LHM host is the
   only thing that settles it — and it was not available in this environment.
2. **`SENSOR_TOPIC_WILDCARD` still matches meta topics.** Whether the mqtt source should
   subscribe to two narrower patterns instead is a `sensor-sources` decision, out of scope
   here. The suffix and the guards' behaviour are exported so that decision has something
   to build on.
3. **No LHM node-to-`SensorMeta` builder.** `lhmVendor` recovers the vendor and
   `LHM_RAW_VALUE_FIELDS` names the fields to read, but assembling a `SensorMeta` from a
   `/data.json` node means knowing that JSON's shape, which is adapter work in `agent` or
   `sensor-sources`.
4. **`SensorMetaTopic` has no parser.** `sensorMetaTopic()` builds one and the reading
   parser rejects one; nothing yet needs to parse a meta topic back into parts. When the
   runtime routes retained metadata, that is the moment to add it.

## Two gate failures, expected and not fixed

- **Clean working tree fails.** The human has an active commit hold: all work stays staged
  and uncommitted on `main` at `ade7408`. Nothing was committed, branched, checked out,
  amended, stashed or reset. Any instruction in the gate contract to commit, or to verify
  at a committed HEAD, is stale against that hold.
- **`adversarialReviewPresent` fails.** A standing rule forbids adversarial hardening
  reviews at this stage, so no `/code-review` was run and no `code-review.md` exists. The
  call-sites enumeration the contract also asks for is section 12 above, and
  `CALL_SITES.md` is updated.

---

# The first rendered sensor value — decisions

> Scope: the `SensorSource` interface, the mock source, the `ui-kit` provider and
> `useSensor(topic)`, and one widget — the numeric readout. No MQTT, no layout parsing, no
> app wiring.

## 1. `SensorSource` lives in `sensor-contract`, not in `sensor-sources`

`ARCHITECTURE.md` lists `ui-kit -> sensor-contract` and deliberately no
`ui-kit -> sensor-sources` edge. The provider takes a source as an argument, so it needs the
interface; putting the interface where the implementations live would have forced either a
new edge or a duplicated type. An interface is a contract, so it went to the contract:
`packages/sensor-contract/src/source.ts`. `sensor-sources` keeps implementations only and
imports it.

Both documents were corrected rather than left sketching the old arrangement: the
`sensor-contract` and `sensor-sources` rows of the `packages/` table in `ARCHITECTURE.md`,
and the "The interface" section of `packages/sensor-sources/README.md`. No `ASSUMPTION:`
line was touched and no prose was rewritten.

## 2. `status` is on the interface; per-topic freshness is not

`status` answers "what is the connection doing" — `connecting`, `live`, `stale`, `error` —
and only a source can. `SENSOR_SOURCE_STATUSES` is a frozen array with the type derived from
it, matching how `topics.ts` declares its vocabularies, so a status chip can enumerate the
four without a second list.

Per-topic freshness is a *different* question and is not on the source: a source can be
`live` while one sensor of forty has aged out. The provider computes it from each reading's
`at`. Keeping them separate is what lets a dashboard say "connected, and this one sensor is
old" instead of collapsing both into one indicator.

## 3. `subscribe` takes a `string` pattern; the topic it hands back is a `SensorTopic`

The pattern spans two shapes — one canonical topic and a wildcard such as
`SENSOR_TOPIC_WILDCARD` — so a narrow type would have to encode MQTT's `+`/`#` grammar into
the contract's template literals. That is transport syntax, which SPEC rule 3 keeps out, and
the encoding gets ugly fast. Pattern stays `string`; **the delivered topic is typed**, which
is where it matters, because a consumer uses it as an identity key.

`meta(topic: SensorTopic)` is typed for the same reason. A source therefore never sees the
authored three-segment shorthand: expanding it is the caller's step, via the contract's
`normalizeSensorTopic`, and `ui-kit`'s provider does it once for everyone. A typed pattern
grammar is deferred; nothing in v1 needs one.

## 4. Pattern matching lives in `sensor-sources`, not in the contract

`+` and `#` are MQTT's. A broker does this matching for the mqtt source; the mock has no
broker, so `topicMatchesPattern` in `packages/sensor-sources/src/topic-pattern.ts` does it —
including MQTT's rule that a `#` is only legal as the last level, which is rejected rather
than guessed at so a typo'd pattern fails visibly instead of quietly subscribing to the
wrong set.

## 5. The mock is seeded-deterministic and unseeded-lively, on mulberry32

Seeded: the same seed replays the same values in the same order. With an injected `now`, `at`
is deterministic too, which is what lets a test assert on a whole stream rather than on a
range. Unseeded: a random 32-bit seed, so the editor's canvas moves.

mulberry32 rather than `Math.random`, because a seeded assertion must not change when V8
changes its generator. Starting values are the midpoint of each range, not a random draw, so
even the first frame of a seeded run is predictable.

`tick()` is public: a test needs no timers, and a capture loop that already has a frame tick
can drive the source from it. The interval starts on the first subscriber and is cleared when
the last one leaves, so nothing keeps a timer alive behind a closed dashboard.

## 6. The mock's sensor set covers the two cases a renderer gets wrong

Nine topics a real desktop would publish, every one built with `sensorTopic()` — there is not
a hand-written topic string in the file. Two are there on purpose rather than for flavour:

- `sensors/cpu/0/factor/0`, whose unit is the **empty string**. Anything that assumes a unit
  is non-empty breaks on it.
- `sensors/cooler/0/fan/0`, with `reportsNothing: true`, so every reading is `value: null`.
  That is exactly how LHM presents a pump header with nothing attached, and without it
  nothing in the repo exercises the null path `SensorReading` exists to express.

## 7. `stop()` reports `stale`, never `error`

The mock has no transport, so it can model a publisher going quiet but cannot honestly model
a connection failing. `error` stays unreachable here; it is the mqtt source's to exercise.

## 8. The staleness threshold is 5 s, overridable per provider

`DEFAULT_STALE_AFTER_MS = 5_000`, derived from the publish rate the `sensor-contract` SPEC
describes (1 Hz): four consecutive missed ticks plus scheduling jitter before a widget starts
calling a value old.

- Shorter (1-2 s) flaps on a GC pause or a slow hardware poll, and a readout flickering
  between live and stale is worse than either state.
- Longer (30 s) leaves a dead publisher's frozen number on a wall panel for half a minute,
  which is the exact failure `at` exists to prevent.

A reading is stale when `age > threshold`, so exactly-at-threshold is still live. The
provider re-checks on its own interval, default `min(1000, threshold / 2)`, because a value
ageing out is **not an event** — no reading arrives to announce that the publisher died.
`recheckIntervalMs: 0` disables the timer and leaves `refresh()` as the only trigger, which
is what a test and a frame-driven capture loop both want.

This answers the open question in `packages/ui-kit/README.md` ("Stale rendering") and the one
in `packages/sensor-contract/SPEC.md` ("Staleness threshold": a fixed, overridable interval —
not per-sensor and not published in metadata). Neither document was edited: the authorised doc
edits for this change were the two named in decision 1.

## 9. The source is injected into the provider, and the provider is the only seam

`createSensorProvider({ source })` never constructs a source, and `ui-kit` has no dependency
that could. Swapping the mock for MQTT is a change at the app root. `meta` and `sourceStatus`
are passed through the provider so a widget never holds the source itself — `ui-kit` rule 1,
no transport, held all the way down.

One subscription at the root regardless of widget count: a dashboard with forty readouts must
not open forty subscriptions. Out-of-order readings are dropped (`previous.at > reading.at`),
because a retained message can arrive after a fresher live one.

## 10. `useSensor` throws on a topic outside the grammar

Returning `waiting` for a typo'd topic would make a mistyped binding indistinguishable from a
dead publisher, and the person who has to tell them apart is looking at a panel on a wall.
Authored-topic validation belongs to `layout-schema`, upstream of here, so reaching this
throw means a bug rather than bad input.

## 11. No React: the provider is framework-agnostic

`useSensor` reads like a React hook, but nothing in this repo has a React dependency and
adding one is a reserved decision for the human, not a side effect of building a widget. So:
`createSensorProvider()` owns the subscription, `provider.watch(topic, listener)` is the
reactive seam, and `installSensorProvider()` plus the free `useSensor(topic)` play the part a
context would — a component reads by topic with no provider in hand.

The shape is deliberately React-compatible: `watch` is exactly
`useSyncExternalStore`'s `subscribe`, and `useSensor` is its `getSnapshot`. If a framework is
adopted, the adapter is a few lines in a new file and this package's contents do not change.

## 12. The readout paints four renderings out of three provider states

The provider reports three: `waiting`, `live`, `stale`. The widget splits `live` on whether
the value is `null`, because "the sensor is reporting nothing" and "we have heard nothing" are
different facts:

| State | Primary | Unit | Note |
|---|---|---|---|
| `waiting` | `--` | hidden | `waiting` |
| `no-reading` (`value: null`) | `n/a` | hidden | `no reading` |
| `value` | `61.3` | `°C` | none |
| `stale` | last value, dimmed | `°C` | `stale 9s` |

Two different glyphs for two different absences: `0` would be a lie and a blank would read as
a broken widget. A real zero renders as `0.0`, never as `n/a`. Stale wins over `no-reading`
when both are true, because the age is the more actionable fact — a null that is also six
minutes old is a dead publisher.

The unit comes from `SENSOR_METRIC_UNITS`, keyed by the metric parsed out of the topic, and
never from the reading; `SensorReading` has no `unit` field and a widget that invented one
would be the second source of truth the contract exists to prevent. Value and unit are joined
with one space **only when the unit is non-empty**, so `factor` renders `43.5` and not
`43.5 `.

A missing `SensorMeta` falls back to showing the canonical topic. Ugly on purpose: nothing can
derive 'CPU Package' from a topic, so an invented label would hide a real gap where the topic
makes it diagnosable.

## 13. `readoutView()` is pure; `createReadout()` only rewrites text

Every rendering decision is in `readoutView(snapshot, metric, ...)`, which takes no DOM — that
is what makes "given the same props, the same pixels" a test rather than an aspiration. The
DOM binding builds a fixed four-span shape once and thereafter only writes `textContent` and
one `data-state` attribute, so a repaint cannot reflow the dashboard mid-capture.

Frame budget, held: no hover, focus or active rule anywhere in `READOUT_STYLES`; no transition
and no animation; nothing that appears only on pointer input; `tabindex` never set. Tests
assert each of those against the stylesheet and the rendered element rather than trusting the
review.

Decimals are per-metric presentation, not contract: one place by default, zero for `clock`,
`fan`, `frequency`, `throughput`, `timing` and `energy`, because `1487.6 RPM` spends a
character on noise at two metres. Overridable per widget.

## 14. Styles ship as a string

`READOUT_STYLES` is an exported stylesheet string rather than a `.css` file, because `ui-kit`
has no bundler contract yet and a caller may be inlining everything into a single-file capture
bundle. When the bundle story is settled, this becomes a file.

## Deliberately deferred

1. **The gauge.** It needs a range, and a range is authored in the layout — `layout-schema`
   owns it, says so explicitly in `sensor-contract/SPEC.md`, and is not built. Building a
   gauge now would mean inventing range semantics in `ui-kit` and then deleting them, or
   reaching for LHM's `Min`/`Max`, which the SPEC rejects by name as observed running extremes
   that make a gauge's scale drift with the day's peak.
2. **The sparkline.** It needs history buffering, which forces the reconnect-and-backfill
   question still open in `sensor-sources/README.md`: on reconnect, does the line show a gap
   or stitch over it? That answer decides whether the *source* buffers, so it is a source
   decision, not a widget one, and guessing it here would put the buffer in the wrong package.
3. **A typed subscription-pattern grammar.** See decision 3.
4. **Metadata that changes while a dashboard runs.** `SensorMeta` is read once at mount, which
   is correct for a retained topic. A source that gains metadata later needs a remount; the
   mqtt source is where that becomes real.
5. **A React (or any framework) adapter.** See decision 11.

## What these specs left underspecified, and what was chosen

1. **Is the source interface's `subscribe` pattern typed?** The README sketched
   `pattern: string` and `onReading(topic: string, ...)`. Chosen: pattern `string`, delivered
   topic and `meta` argument typed as `SensorTopic`. Decision 3.
2. **Where does wildcard matching live?** Unstated anywhere. Chosen: `sensor-sources`,
   decision 4.
3. **What is the staleness threshold?** An open question in two documents. Chosen: 5 s,
   overridable, `age > threshold`. Decision 8.
4. **What does a stale widget look like?** An open question in `ui-kit/README.md`. Chosen:
   last-known value, dimmed, with an explicit age note. Decision 12.
5. **Does `null` mean the same as "no data yet"?** The SPEC says `null` is "present but
   reporting nothing" and separately that a dashboard must show "no data" distinctly from a
   stale number or a zero, but never says whether those two absences are one state or two.
   Chosen: two, with two glyphs. Decision 12.
6. **How many decimals does a readout show?** Nothing says. Chosen: a small per-metric table
   in `ui-kit`, since it is presentation rather than contract. Decision 13.
7. **How does a widget get its metadata?** The SPEC defines the retained topic but nothing
   said whether a widget reads it once or watches it. Chosen: once at mount. Deferred item 4.
8. **Is `ui-kit` a React package?** Never stated in any document. Chosen: framework-agnostic,
   decision 11 — and adding a framework dependency is the human's call, not a side effect.

## Call sites

`packages/sensor-contract` and `packages/sensor-sources` are both shared surfaces, and this
change adds to each. `CALL_SITES.md` is updated with the new exports and every consumer of
them; the short version:

| New surface | Package | Call sites today |
|---|---|---|
| `SensorSource`, `SensorSourceStatus`, `SENSOR_SOURCE_STATUSES`, `SensorReadingHandler`, `Unsubscribe` | `sensor-contract` | `sensor-sources/src/mock-source.ts`, `ui-kit/src/sensor-provider.ts`, `sensor-contract/src/source.test.ts`, `ui-kit/src/*.test.ts` |
| `createMockSource`, `MOCK_SENSOR_SPECS`, `topicMatchesPattern` | `sensor-sources` | `sensor-sources/src/mock-source.test.ts`, `topic-pattern.test.ts`. No product consumer yet — `apps/runtime` and `apps/editor` are the declared ones. |
| `createSensorProvider`, `useSensor`, `installSensorProvider`, `createReadout`, `readoutView`, `READOUT_STYLES` | `ui-kit` | `ui-kit/src/*.test.ts`. `apps/runtime` and `apps/editor` are the declared consumers, both still empty entry points. |

No existing call site changed behaviour: every addition is new surface, and the one
already-exported thing this change touched is `sensor-contract/src/index.ts`, which gained
five exports and lost none.

## Evidence

- `.evidence/red-first-tests.log` — the new tests failing before implementation:
  `sensor-contract` 3 failed, `sensor-sources` 25 failed across two new files, `ui-kit` 2
  files failed. Kept because red-first is a claim that has to be checkable after the fact.
- `.evidence/build-test-typecheck.log` — `npm run build`, `npm test`, `npm run typecheck` at
  the root, each with its own captured exit code (all `0`) and each of the eight workspaces'
  own `Test Files ... passed` line. Judged per lane, not on the wrapper's status: `npm
  --workspaces` continues past a failing workspace, so the last lane's result is not the run's
  result.
- `.evidence/readout-states-1920x400.png` — the readout rendered in Chrome at 1920x400, the
  V1 slice's target resolution, showing all four renderings at once: values with units
  (`57.2 °C`, `68.1 %`, `1060 RPM`), the dimensionless `17.6` with no unit, `n/a` / NO READING,
  `--` / WAITING with the topic-as-label fallback, and a dimmed `44.4 °C` / STALE 9S. Fed by
  the seeded mock; no hardware involved.

The screenshot harness is `.evidence/demo/` — an esbuild bundle and a static page, kept out of
`packages/` and `apps/` because app wiring is a separate task, and never staged.

## Two gate failures, expected and not fixed

- **Clean working tree fails.** The human's commit hold is still in force: all work stays
  staged and uncommitted on `main` at `ade7408`. Nothing was committed, branched, checked out,
  amended, stashed or reset. Any gate instruction to commit, or to verify at a committed HEAD,
  is stale against that hold.
- **`adversarialReviewPresent` fails.** A standing rule forbids adversarial review at this
  stage, so no `/code-review` was run and no `code-review.md` exists. The call-sites
  enumeration the contract also asks for is the "Call sites" section above, and `CALL_SITES.md`
  is updated.

---

# The first pixels on screen — decisions

> Scope: one page in `apps/runtime` that renders live readouts from the mock source, at
> 1920x400. No layout parsing, no MQTT, no capture mode, no ready signal, no gauge, no
> sparkline. **Zero new npm entries** — that constraint is what most of this section is
> about.

## 1. An import map is what makes `tsc -b` output run in a browser

The question this task existed to answer: does the emitted output load with no bundler?
**Yes, with one addition — an import map.**

`tsc` emits ES modules and does not rewrite import specifiers, so
`apps/runtime/dist/dev-harness.js` asks the browser for `@perch/ui-kit` verbatim. A browser
cannot resolve a bare specifier; nothing in the ESM spec tells it that `@perch/ui-kit` is a
directory on disk. That is the one and only thing a bundler would have been needed for here.

`apps/runtime/dev-harness.html` therefore carries a three-line `<script type="importmap">`
mapping each workspace package to its own emitted entry point:

```json
{ "imports": {
  "@perch/sensor-contract": "../../packages/sensor-contract/dist/index.js",
  "@perch/sensor-sources":  "../../packages/sensor-sources/dist/index.js",
  "@perch/ui-kit":          "../../packages/ui-kit/dist/index.js"
} }
```

Three entries and not more, because packages' *internal* imports are already relative
(`./readout.js`, `./topic-pattern.js`) and resolve without help. Only the cross-package
bare specifiers need mapping, which is one line per package the page imports — and the
packages' own `package.json` `exports` already point at exactly these files, so the map is
not a second source of truth so much as a restatement of one the browser cannot read.

Import maps are baseline in Chrome, Safari and Firefox, so this needs no flag and no
polyfill. The files the browser executes are byte-for-byte the files `tsc` emitted: no
transform step, no source-map indirection, and a stack trace points at real line numbers in
`dist`.

## 2. The map's paths are relative, not absolute from a server root

`../../packages/...` rather than `/packages/...`. Import-map values resolve against the
document's base URL, so relative paths keep the page working regardless of which directory
the static server was rooted at, and keep the door open for the standalone bundle later,
where "server root" is not a meaningful concept.

## 3. HTTP is still required; `file://` does not work

Module scripts are blocked by CORS over `file://`, so double-clicking the HTML fails no
matter how the specifiers resolve. Checked rather than assumed: loading the same page as a
`file://` URL in the same headless Chrome renders nothing — the harness never mounts, and
`Runtime` reports no exception, so the failure is silent to anything watching for one. This
is a property of ES modules, not of the import map,
and it is a real constraint on the runtime's "loads cold from `file://`" goal in
`apps/runtime/README.md` — **that goal is incompatible with unbundled ES modules** and will
need either a bundle step or a revised claim. Flagged, not solved here.

## 4. The static server is forty lines of `node:http`, not a dependency

`serve`, `http-server` and `express` would each be a new npm entry, and dependency additions
are the human's call. `apps/runtime/tools/serve.mjs` does the whole job with stdlib: a
content-type table, a traversal containment check, `no-store`, and a root pinned to the repo
root — which the harness needs, because the page lives in `apps/runtime/` and imports out of
each package's `dist`, so a server rooted at the package directory could not reach them.

Exposed as `npm run harness -w @perch/runtime`.

## 5. Screenshots are taken over CDP with Node's built-in `WebSocket`, not Puppeteer

Chrome's own `--screenshot` flag captures once, at a moment it picks, which cannot show a
value changing or a reading ageing into `stale` — the two things this task's evidence has to
show. Puppeteer or Playwright would be a new dependency for it.

Node 22 ships a global `WebSocket`, and CDP is JSON over one socket, so
`apps/runtime/tools/capture.mjs` is a complete client in about 150 lines: launch headless
Chrome with `--remote-debugging-port`, find the page target over `/json/list`,
`Emulation.setDeviceMetricsOverride` for exact pixels, then `Page.captureScreenshot` at each
requested millisecond from a single page load. It also echoes the page's own footer text and
any console output or thrown exception into the log, so a screenshot and the log that
accompanies it describe the same moment.

Evidence tooling, not a runtime path. `caster` owns real capture.

## 6. No React, no Vite, no bundler, and nothing restructured toward one

`readout.ts` and `sensor-provider.ts` were used exactly as they are: plain DOM, plain
functions, `READOUT_STYLES` injected as a `<style>` element. Nothing in `packages/` was
edited for this task at all. Vite is present in `node_modules` only as a transitive
dependency of `vitest` and is neither declared nor invoked.

**Net new npm entries: zero.** The only `package.json` change is one `scripts` line.

## 7. Two providers, because the stale state has to be *driven*

Four renderings had to be on screen at once, and a single running source cannot be both live
and dead. So the harness builds two mock sources:

- the live one (`createMockSource()`, unseeded, so values move), and
- a frozen one (`createMockSource({ seed: 1, autoStart: false })`) that is ticked exactly
  once and then never again.

The frozen source's topics age past `DEFAULT_STALE_AFTER_MS` and the provider's recheck
timer flips them to `stale`, counting up — a real dead publisher rather than a faked clock.
This is the injection seam working as designed: the frozen provider is passed to one
readout as `provider`, while the live one is installed with `installSensorProvider()` and
found implicitly by the rest. Both paths exercised.

The `waiting` rendering needed no machinery at all: `sensors/psu/0/voltage/0` is simply a
topic nothing publishes, and it also demonstrates the topic-as-label fallback, since no
`SensorMeta` exists for it.

## 8. The source is created in the harness, one line from the MQTT swap

`const liveSource = createMockSource()` is the only line that names a source. `ui-kit` never
constructs one, so replacing that call with the MQTT source is the entire swap and nothing
below it changes — the property decision 9 of the previous section was designed for, now
demonstrated rather than asserted.

## 9. Every topic comes from `sensorTopic()`; there is no topic string in the harness

Including the indexed case: `sensorTopic('storage', 'temperature', { deviceIndex: 1 })` is
on screen as `Drive 2 Temperature`, so the builder's index handling is visible and not just
unit-tested. The only topic text a reader sees is the *label fallback* on the waiting tile,
which is a topic the provider printed, not one the harness typed.

## 10. Windowed mode is a four-line scale-to-fit, and deliberately not more

A fixed 1920x400 canvas, `transform: scale(min(vw/1920, vh/400))`, centred and letterboxed.
That is `README.md`'s windowed mode in its cheapest honest form: a normal browser tab shows
the panel's real aspect ratio instead of a scrollbar. The runtime will own this properly —
it has to *reject* a target it cannot honour, per its hard rule 2 — and this is not that.

## 11. This is a harness, and it says so in three places

`apps/runtime/src/dev-harness.ts` opens with "A HARNESS, NOT THE RUNTIME", the HTML repeats
it, and it is here. The runtime's eventual shape is a layout from `layout-schema`
instantiating widgets; this file hard-codes seven tiles. It is written to be deleted when the
React-or-not decision lands, which is why it is one file, one HTML page, and two small tools
with no shared abstractions between them.

It is not wired into `apps/runtime/src/index.ts`, so the package's public surface is
unchanged and nothing imports it.

## Call sites

No file in `packages/` was touched, so there is no shared-component change to enumerate.
For completeness, the harness is the repo's **first** consumer of these exports, and the
first evidence that any of them work outside a test:

| Export | Package | Used for |
|---|---|---|
| `createMockSource` | `sensor-sources` | both sources — live (unseeded) and frozen (`seed: 1, autoStart: false`) |
| `MockSensorSource.tick` | `sensor-sources` | one manual publish on the frozen source |
| `createSensorProvider` | `ui-kit` | one provider per source, source injected |
| `installSensorProvider` | `ui-kit` | the live provider as the root provider |
| `SensorProvider.watch` | `ui-kit` | the footer's reading counter |
| `SensorProvider.sourceStatus` | `ui-kit` | the footer's status text |
| `createReadout` | `ui-kit` | all seven tiles, with and without an explicit `provider` |
| `READOUT_STYLES` | `ui-kit` | injected as a `<style>` element |
| `sensorTopic` | `sensor-contract` | every topic, including the indexed one |

`CALL_SITES.md` was left alone: another worker is active in `packages/sensor-contract` and
that file is theirs to move this round.

## Evidence

- `.evidence/harness-1920x400-t2.5s.png` and `.evidence/harness-1920x400-t9.5s.png` — the
  page at the V1 target resolution, 7 s apart from one page load. Live values differ between
  them (`61.2 -> 56.9 °C`, `1202 -> 1265 RPM`, `29.0 -> 30.7`), the footer's reading count
  goes 2 -> 9, and the frozen tile changes from a plain `59.3 °C` to a dimmed `59.3 °C` /
  `STALE 6S`. All four renderings are in both frames: values with units, the dimensionless
  value with none, `n/a` / `NO READING`, `--` / `WAITING`.
- `.evidence/harness-1440x900-tab.png` — the same page in a normal browser-tab viewport,
  scaled and letterboxed, showing the strip keeps its aspect ratio.
- `.evidence/harness-capture-1920x400.log`, `.evidence/harness-capture-1440x900.log` — the
  capture runs with exit codes, each shot's timestamp and the page's own footer text at that
  moment, and `page messages: none (no console output, no exceptions)` — the page loaded its
  modules with nothing logged and nothing thrown, which is the import map's own proof.
- `.evidence/harness-build-test-typecheck.log` — root `npm run build`, `npm test`,
  `npm run typecheck`, each with its own captured exit code (`BUILD_EXIT=0`, `TEST_EXIT=0`,
  `TYPECHECK_EXIT=0`) and all eight workspaces' own `Test Files ... passed` lines. Judged per
  lane, not on the wrapper's status.

## Is this sustainable, or is a bundler genuinely needed?

Honest answer: **sustainable for the runtime as it stands, and it will not survive the first
third-party dependency.**

What works and will keep working: an import map costs one line per workspace package, the
packages already declare the same paths in their `exports`, and the debugging experience is
better than a bundler's because the browser runs the emitted file. For a self-contained repo
of four first-party packages this is less machinery than Vite, not more.

Where it breaks, in the order it will happen:

1. **A third-party runtime dependency.** The moment `mqtt`, or anything with a CommonJS
   entry, or anything that imports its own bare specifiers internally, is needed in the
   browser, the import map stops being three hand-written lines: transitive bare specifiers
   inside `node_modules` are not resolvable by the map on the page, and CJS does not load in
   a browser at all. That is a bundler's actual job. MQTT-in-the-browser is on the roadmap,
   so this is a matter of when.
2. **The standalone bundle.** `README.md` promises a self-contained directory that loads cold
   from `file://`. Unbundled ES modules cannot do `file://` (decision 3), and "self-contained"
   and "imports out of a sibling `node_modules`" are not compatible. The bundle deliverable
   is a bundler by another name.
3. **CSS and media assets.** Fine today — one styles string — and not fine once layouts
   reference background media that the bundle build has to copy and rewrite paths for.

So: do not add a bundler for this page, and do not plan on shipping the standalone bundle
without one. The cheap next step, if the framework decision lands on "no framework", is to
keep this loading path for development and add a bundler only at the bundle boundary, where
`caster` consumes a built artifact anyway.

## Two gate failures, expected and not fixed

- **Clean working tree fails.** The human's commit hold is in force: all work stays staged
  and uncommitted on `main` at `ade7408`. Nothing was committed, branched, checked out,
  amended, stashed or reset. Any gate or prompt instruction to commit, or to verify at a
  committed HEAD, is stale against that hold and was ignored.
- **`adversarialReviewPresent` fails.** A standing rule forbids adversarial review at this
  stage, so no `/code-review` was run and no `code-review.md` exists. The call-sites
  enumeration the contract also asks for is the "Call sites" section above.

---

# The LHM mapping against real captured data — decisions

> Scope: `packages/sensor-contract` only, corrected against `fixtures/lhm-data.sample.json` —
> a live `GET /data.json` capture, 214 sensors, 13 of LHM's 21 sensor types, six hardware
> prefixes. Three defects were briefed; the fixture revealed several more, and the human
> answered one parked grammar question mid-task ("Opaque token"), which is decision 4.

## 1. `/data.json` sends every value as a *string*, `RawValue` included — so parse it

LHM's C# API types `ISensor.Value` as `float?`, and `lhm.ts` documented `RawValue` the same
way. That is the in-process type, not the transport type. Over HTTP, all six value fields are
formatted strings, the unit included:

```text
"Value":"2.848 V"    "RawValue":"2.848 V"        number + unit
"Value":"448 RPM"    "RawValue":"448 RPM"        integer + unit
"Value":"44.0 °C"    "RawValue":"44.0 °C"        non-ASCII unit
"Value":"48.500"     "RawValue":"48.500"         Factor: no unit at all
"Value":"-"          "RawValue":" °C"            enumerated, reporting nothing
"Value":"6.4 MB/s"   "RawValue":"6699008.0 B/s"  the one type where the two differ
```

`parseLhmValue` takes the leading numeric portion and treats whatever follows as a unit that
may be **absent**. That is not tolerance for its own sake: the fixture's 14 `Factor` sensors
are bare, so a parser requiring a unit would have dropped all 14 silently.

Deliberate choices inside it:

- **`null`, never `0`.** `' °C'` and `'-'` are how LHM spells a sensor that is enumerated but
  reporting nothing. `SensorReading.value` already distinguishes that from a real zero, and
  `isSensorReading` rejects `NaN`/`±Infinity`, so the parser must not hand one on.
- **Nothing locale-aware.** The digits and `.` are spelled out in the pattern rather than
  handed to anything culture-sensitive. LHM formats with the invariant culture, so `.` is the
  decimal separator on every machine; a locale-sensitive parse would read `48.500` as 48500 on
  a host whose locale groups with `.`. `'48,500'` is therefore `null`, not 48.5 and not 48500 —
  it is a string this source does not emit, and guessing which it meant is how you publish a
  number wrong by 1000×.
- **No exponent form.** LHM's `F`-format never emits one, and `1e3` is indistinguishable from
  a number followed by a unit starting with `e`.
- **Fails closed on a digit after the number.** `'1e3 V'`, `'1.5.2 V'`, `'10 20 V'` → `null`.
  A unit has no digits in it, so a digit in the remainder means the string is not a reading
  this understands. Publishing a plausible wrong number is worse than publishing nothing:
  nothing downstream can detect it.

`RawValue` is still preferred over `Value`, and the reason in the comment is now the precise
one. The two differ for exactly two types in this capture — `Throughput`, where `Value`'s unit
*changes with magnitude* (`6.4 MB/s` vs `6699008.0 B/s`, a factor of 2²⁰), and `Temperature`,
where they differ only in decimal places. Throughput is the one that matters: this contract
fixes one unit per metric, so a source reading `Value` would publish MB/s into a topic
declared B/s and be wrong *only sometimes*.

## 2. `/lpc` is two devices, and the second segment is what tells them apart

The alias table keyed on the identifier's first segment, so everything under `/lpc` became
`superio`. The capture has both shapes:

```text
/lpc/nct6798d/0/voltage/0   22 sensors   a Super I/O chip, second segment is a model
/lpc/ec/temperature/0        7 sensors   the embedded controller, and no instance segment
```

Seven sensors were landing on `sensors/superio/0/…` when LHM's own `EmbeddedController` is a
distinct hardware type and this contract has a distinct name for it. The fix is one table key:
`lpc/ec` is matched **exactly**, against the whole hardware portion, before the leading-segment
fallback runs. No new machinery — `resolveHardware` already tried exact-then-leading — and the
fallback still puts every other chip under `/lpc` on `superio`, which is LHM's convention:
what it hangs off `lpc` is either the EC or a Super I/O chip named by model.

Note the second shape difference: `/lpc/ec` has no instance segment at all, so `deviceIndex`
defaults to `0`. The existing read-from-the-end split already handled that; it is the reason
the split reads from the end rather than the start.

## 3. The whole fixture is the test, not a sample of it

`src/lhm-fixture.test.ts` asserts over all 214 sensors that each maps to a canonical topic,
that every topic re-parses to the expected device, metric and sensor index, and that the device
distribution is the one `fixtures/README.md` documents:

```text
cpu 102   gpu 39   network 25   superio 22   storage 19   embedded-controller 7   = 214
```

Its expected hardware→device table is written out **independently** of `lhm.ts` rather than
imported from it. A test that asked the implementation what the answer should be would have
passed against the `/lpc/ec` bug.

The fixture is read through `src/lhm-fixture.test-support.ts`, which is excluded from the
package `tsconfig` alongside the tests: it uses `node:fs`, and SPEC rule 1's zero-runtime-
dependency claim is about what reaches `dist`.

## 4. Opaque device-instance tokens

The human's answer to the parked grammar question was "Opaque token". That settles the
semantics; the spelling was left to this task, and this is it.

**The problem.** LHM identifies a network adapter by GUID and gives it no ordinal:
`/nic/%7B684D7057-F1C7-4928-8500-6160B637CC46%7D/throughput/7`. Five adapters in this capture,
all with the same 5 sensor types, none with an index.

**What was actually happening before this change** — and this corrects the brief, which said
these 25 sensors returned `null`: they did not. The GUID segment was read as a *model* name,
exactly like `/lpc/nct6798d/0`'s, and normalised away. All five adapters collapsed onto
`sensors/network/0/…`, five sensors deep, each topic colliding five ways — 214 sensors produced
188 distinct topics. That is a silent mis-mapping, not a visible gap: a publisher's second
write overwrites the first and the dashboard shows one adapter's numbers under another's name.
Because that is the worse failure, the fail-closed behaviour (`null`) was implemented and
pinned by test first, and the widening came after.

**The token.** `%7B684D7057-F1C7-4928-8500-6160B637CC46%7D` becomes
`684d7057-f1c7-4928-8500-6160b637cc46`:

- **Percent-decoded**, because the braces are LHM's HTTP layer encoding `{`/`}`, not part of
  the identity. Decoding is also the step that can produce `/`, `+` or `#`, which is why the
  result is re-validated rather than trusted.
- **Braces stripped.** They carry no information, and `{` in a topic is noise in every URL,
  log line and config file the topic will appear in.
- **Lower-cased**, with `toLowerCase` and not `toLocaleLowerCase`: a GUID's case is not
  significant, a topic's is, and a Turkish locale maps `I` to `ı` — the token must not depend
  on the host's locale.
- **Validated** against `[a-z0-9]+(-[a-z0-9]+)*`, at most 64 characters (a decoded GUID is 36).

Why that shape and not "any non-empty string":

1. **An MQTT topic level cannot contain `/`, `+` or `#`.** `/` would add a segment and change
   the topic's arity; `+` and `#` would turn one device's topic into a wildcard matching other
   devices — a subscriber on `sensors/network/+/throughput/7` would be fed by a publisher.
   `%2Fetc%2Fpasswd`, `%2B` and `%23` all decode into exactly those characters, so the
   post-decode check is load-bearing, not a formality. Tests pin all three as `null`.
2. **One spelling per device.** No upper case, no percent-encoding, no braces, no leading,
   trailing or doubled hyphen. A topic is an identity key: two spellings of it are two
   subscriptions, and a reader watching the wrong one silently sees nothing. A digits-only
   token must be the ordinal's canonical spelling, so `00` is rejected and cannot become a
   second name for device `0`; `'1'` and `1` build the identical topic.
3. **Bounded**, so a malformed identifier cannot produce an unbounded topic level.

Kept genuinely opaque, as instructed: nothing parses meaning back out of it, no ordinal is
assigned, and there is **no registry** — nothing that would have to survive a reboot, and no
ordering between two tokens. The only promise is stability: the same adapter yields the same
token every time, which is all a subscription needs.

Which families get this treatment is stated explicitly, in `LHM_INSTANCE_IDENTITY_FAMILIES`
(currently `nic` alone). `/nic/{GUID}` and `/lpc/nct6798d/0` are **structurally
indistinguishable** — both are a family plus an extra segment — so no heuristic can tell an
identity from a model name. Guessing would mean either collapsing adapters or turning chip
models into device instances. A one-entry set that a human extends when a source proves it
needs extending is the honest version.

Type-level: `SensorTopic`'s device-instance hole widens from `${number}` to `${string}`, and
`SensorTopicParts.deviceIndex` becomes `number | string` — a number when the segment is an
ordinal, a string when it is a token, so the common case stays arithmetic and a consumer that
assumed arithmetic everywhere is told by the compiler. Rule 5 loses nothing: an instance is not
a name, and device and metric remain closed unions.

**The cost, recorded rather than hidden.** The grammar can no longer tell an opaque token from
a misspelled segment, so `sensors/cpu/first/temperature/0` now parses. `isSensorTopic` is that
much weaker as a typo check for free-text entry. Two `topics.test.ts` rejection cases were
therefore inverted into an explicit acceptance test that says so. The `<sensorIndex>` position
is untouched and still strictly an ordinal, and an editor picker should be offering discovered
topics rather than leaning on the grammar to catch typing — which is the discovery question the
contract SPEC already has open.

## 5. What the fixture revealed that no spec covers

- **LHM emits a duplicate `SensorId`.** `/gpu-nvidia/0/load/3` is the identifier of *both*
  "GPU Memory" and "GPU Bus". Two sensors share one identity at the source, so no mapping can
  separate them and a publisher's second write overwrites the first. The fixture test pins this
  exactly — 214 sensors, 213 distinct topics, `['/gpu-nvidia/0/load/3']` the one duplicate — so
  that if a future capture stops duplicating, the test fails and the pin gets removed, and if a
  *different* id starts duplicating, the test fails and names it. Worth a human decision before
  the agent publishes: `SensorName` is what actually distinguishes them.
- **A sixth value shape the brief did not list.** `/lpc/ec/temperature/1` ("T Sensor", an
  unpopulated header) sends `Value: "-"` and `RawValue: " °C"` — a unit with no number. This is
  the real `value: null` case, and the reason the parser's null path is tested against the
  fixture rather than only against invented strings.
- **Non-integer hardware instances are not exotic.** 25 of 214 sensors have one. Any adapter
  written against LHM will meet this on its first run on a machine with more than one NIC.
- **The hardware prefix varies in depth**: one segment (`/nvme/0`), two with an index
  (`/lpc/nct6798d/0`), two without (`/lpc/ec`), and two where the second is an identity
  (`/nic/{GUID}`). All four shapes are in one 214-sensor capture from one machine.
- **Privacy.** `fixtures/README.md` records the capturing machine's hostname, motherboard model
  and five real adapter GUIDs. Scrub before this repository is published. Every GUID in a
  *test* file is synthetic for this reason; the real ones stay in the fixture.

## Evidence

- `.evidence/red-1-fixture-vs-current-mapping.log` — the fixture test against the pre-fix
  alias table. `EXIT=1`, 6 failed: `/lpc/ec/voltage/0: expected 'superio' to be
  'embedded-controller'`, `superio: 29` against an expected 22, no `embedded-controller` bucket
  at all, one network instance instead of five, and 188 distinct topics for 214 sensors.
- `.evidence/red-2-nic-fails-closed-before-widening.log` — after the fail-closed step and
  before the widening. `EXIT=1`, 8 failed, all 25 NIC identifiers listed as unmappable; the
  `/lpc/ec` fix and all 35 parser tests green. This is the red half of the widening.
- `.evidence/green-build.log`, `green-test.log`, `green-typecheck.log` — root `npm run build`,
  `npm test`, `npm run typecheck`, all `EXIT=0`, 356 tests across 8 packages, 260 of them in
  `sensor-contract`. `typecheck` covers `tsconfig.tests.json`, which is what confirms the
  `@ts-expect-error` assertions in `topics.test.ts` still error under the widened
  device-instance hole, and that no consumer package broke.

No screenshots: nothing here has a visible surface.

## Two gate failures, expected and not fixed

- **Clean working tree fails.** The commit hold is in force: everything stays staged and
  uncommitted on `main` at `ade7408`. Nothing was committed, branched, checked out, amended,
  stashed or reset. `reviewSnapshotMatchesBranchHead` fails for the same reason and is waived
  by the same instruction — satisfying it would mean committing.
- **`adversarialReviewPresent` fails.** A standing rule forbids adversarial review at this
  stage, so no `/code-review` was run and no `code-review.md` exists. The call-sites
  enumeration is the appended section of `CALL_SITES.md`.

---

# The layout format, its validation and its migration machinery — decisions

> Worker: `packages/layout-schema/`. Scope was this package plus this appended section and the
> appended section of `CALL_SITES.md`. Nothing outside `packages/layout-schema/` was edited.

The three decisions the brief handed down — absolute pixels on a fixed canvas, widget identity as a
string validated against an injected registry, `range` authored here — were implemented, not
reopened. What follows is everything the SPEC left to the implementation.

## 1. One validation pass that collects, three entry points that differ only in shape

`validateLayout` returns `{ ok: true, layout }` or `{ ok: false, issues }` and **never stops at the
first problem**. A `LayoutIssue` is `{ code, path, message, elementIndex? }`, where `path` is a
JavaScript-ish accessor a human can paste — `elements[3].rect.w`, `theme["--perch-fg"]` — and
`code` is one of the frozen `LAYOUT_ISSUE_CODES`.

"Fails loudly naming an index and a field" is a per-issue property, so it is tested as an
invariant rather than case by case: every issue carrying an `elementIndex` has a path beginning
`elements[<that index>]`, and every issue without one does not (`layout.test.ts`).

`assertLayout` (throws `LayoutValidationError`, `.issues` attached, `formatLayoutIssues` as the
message), `isLayout` (a guard) and `parseLayoutJson`/`loadLayoutJson` (a syntax error becomes an
`invalid-json` issue, not a thrown `SyntaxError`) are all thin over that one pass. One error
channel, because a consumer that has to catch *and* branch will do one of the two.

**Cascade suppression.** When `target` fails, `context.canvas` is `null` and the off-canvas check is
skipped entirely, so one bad `target.width` produces one issue rather than one per element. Pinned
by a test asserting the code list is exactly `['wrong-type']` with two off-canvas elements present.

## 2. The validator returns a rebuilt object, not the input

Every `validate*` function constructs the value it returns field by field. The unknown-field rule
makes this almost free, and it buys two things: the returned `Layout` cannot carry a property the
type does not declare (so `Object.keys(layout)` is exactly the four schema fields, tested), and
inherited properties are structurally invisible — every read goes through `readField`, which
consults `Object.prototype.hasOwnProperty`. A document built on a prototype carrying `theme` is
reported as *missing* `theme`, which is the honest answer.

## 3. `Style` is element-scoped CSS custom properties, the same grammar as `theme`

Two alternatives were rejected. A free-form `Record<string, string>` of arbitrary CSS declarations
puts a stylesheet language inside a data format and hands the runtime an injection surface. A closed
set of named style properties (`fg`, `fontSize`, …) makes every new visual knob a schema version.
Custom properties are already how `ui-kit` themes, they are a flat string map, and the widget
decides what it honours.

That makes theme-token *values* a security boundary, so they are constrained: at most 256
characters, and no `;`, `{`, `}`, `<`, `>`, backslash or control character — each of which is a way
out of a `style="…"` attribute or a `<style>` element. Keys are `--` followed by letters, digits,
`-` or `_`, at most 64 characters.

`url(` in a token value gets its own `embedded-media` code rather than the generic malformed one: it
is hard rule 2 being smuggled through the theme, and the fix is "use a media element", which is a
different sentence from "that character is not allowed". Where both rules apply — `url('data:…;…')`
contains a `;` — the character rule wins, and a test pins that deliberately rather than leaving it
to rule order.

## 4. `LayoutElement`, not `Element`

`Element` is a DOM global. A package that will be imported into browser code and into Node tooling
should not shadow it; the mistake surfaces as a confusing assignability error in somebody else's
file, months later.

## 5. Rects are integers, may bleed off the canvas, may not be entirely off it

A device pixel is not divisible, so `x`/`y`/`w`/`h` must be integers (`not-an-integer`). `w` and `h`
must be at least 1 — a zero-width element is another spelling of invisible, and the author who
wrote it meant something else.

Negative `x`/`y` and overhanging `w`/`h` are **accepted**: bleeding a backdrop off the edge is a
real authoring technique on a fixed canvas, and the canvas clips it. A rect that intersects the
canvas nowhere is **rejected** (`off-canvas`, naming `1920x400`), because it can never paint and is
therefore always an error the author wants to know about. `rectIntersectsCanvas` is exported so the
editor can ask the same question while dragging.

## 6. `target` has ceilings, and they are about catching unit mistakes

`LAYOUT_MAX_DIMENSION = 16384` (the texture limit of the hardware generation this targets) and
`LAYOUT_MAX_FRAME_RATE = 240`. `frameRate` may be fractional, because 29.97 is a real capture rate;
a value over 240 says so in terms of the actual mistake — "a larger value is usually a frame
interval in milliseconds written into a field that wants hertz".

## 7. Media paths: relative, no traversal, one canonical spelling

Hard rule 2 gets a dedicated `embedded-media` code for a `data:` URL (case-insensitively), with the
SPEC's own reason in the message. Everything else that is not a relative sibling path is
`malformed-media-path`: any URL scheme (named in the message), a POSIX absolute path, a Windows
drive path, `..` anywhere, `./`, a doubled or trailing separator, a backslash, a leading or trailing
space, `*?"<>|`, a control character, or over 512 characters. A drive letter is reported as an
absolute path rather than as a one-letter URL scheme, because that is what the author meant.

Spaces *inside* a filename are accepted. Real assets have them, and rejecting them would be this
package inventing a filesystem rule.

## 8. Text may not be empty; a bad `style` fails the element rather than being dropped

An empty `text` renders as nothing, which is indistinguishable from a bug. Dropping a malformed
`style` and accepting the element would render the author's work subtly wrong on a panel they are
not looking at — the failure hard rule 3 exists to prevent, one level down.

## 9. `range` is `[min, max]` with `min < max`, and a malformed range is not a missing one

Equal bounds are rejected: a scale with no span cannot be read. Both entries must be finite numbers,
reported at `range[0]` / `range[1]`.

**The rule the red run found.** The `missing-range` check reads presence off the raw record
(`readField(record, 'range') !== undefined`), not off the validated value. Reading it off the
validated value meant a scale widget with `range: [100, 0]` got *both* `invalid-range` and
`missing-range` — telling an author that they wrote no range while it is on the screen in front of
them. Six tests failed on it; the fix is two lines and there is now a regression test asserting the
code list is exactly `['invalid-range']`.

Relatedly, the range requirement is only enforced for a widget the registry **resolved**. An
unknown widget has already been reported; adding "and it might also need a range" on top would be a
guess about a widget this package has never heard of.

## 10. The registry is required, has no default, and is the only injection point

```ts
createWidgetRegistry({ gauge: { drawsScale: true }, readout: { drawsScale: false } })
```

returns a frozen `WidgetRegistry` with `has`, `get` and a **sorted** `names` — sorted so two
identical tables produce byte-identical error messages. `ValidateLayoutOptions.widgets` is
**required with no default**: an optional registry means a caller who forgot it gets a layout that
validates and then renders nothing, which is exactly the failure the registry exists to prevent,
now reachable by omission. A caller with genuinely no widget table passes `EMPTY_WIDGET_REGISTRY`
and says so at the call site.

A malformed registry **throws** (`TypeError` for shape, `RangeError` for numbering, matching how
`sensor-contract` splits the two) rather than producing issues. A bad registry is programmer input:
it is the same on every run, no layout file is at fault, and reporting it as a validation failure
would blame the author of a file that is fine.

`isTopic` is the second injected piece, and optional where `widgets` is required: there *is* a
meaningful vocabulary-free check for a topic and there is none for a widget name. The default
`isTopicShaped` declares no device or metric names — which is what keeps this inside
`sensor-contract`'s rule 5 — and only rejects strings that could not be a single unambiguous key:
empty segments, MQTT wildcards `+`/`#`, whitespace, control characters. It is deliberately weaker
than the real check, and every consumer that has `sensor-contract` on its dependency list should
inject `isSensorTopic` instead. A test proves the injection point actually replaces the default in
both directions.

Upper-case is accepted by `isTopicShaped` and rejected by `isWidgetName`, on purpose: case in a
topic is a vocabulary question and vocabulary is not this package's, while a widget name is this
package's own identifier grammar.

## 11. The migration machinery is a table of data plus a runner, and `targetVersion` is the seam

`LayoutMigration` is `{ from, to: from + 1, description, migrate }`. Single-step, so version N+2
costs one new function rather than one per predecessor. `LAYOUT_MIGRATIONS` is frozen and `[]`; the
runner is not empty.

`migrateLayoutDocument(document, { migrations?, targetVersion? })` runs **before** validation and
has to: an older document does not satisfy the current field checks — that is what a version *is* —
so validating first would reject every migratable file. It therefore checks only what it needs to
route (object, plausible integer `schemaVersion`), then:

- at the target → a copy, `steps: []`;
- above the target → `unsupported-future-version` naming both versions;
- below `earliestMigratableVersion` → `unsupported-past-version` naming the oldest reachable version
  and telling the human to use a build that still knows theirs;
- otherwise → a JSON deep copy (which doubles as the hard-rule-1 check, reported as `invalid-json`),
  then `migrations.slice(fromVersion - earliest)` applied in order.

Two runner responsibilities that exist because of how migrations actually go wrong: **the runner
stamps `schemaVersion`, never the step** — a step that had to remember it would eventually forget,
and the symptom is a document that migrates forever — and **the step gets a private copy**, so a
step that mutates its input cannot corrupt the caller's object.

`assertLayoutMigrationTable` throws on a table that is not contiguous in both directions: a
multi-version step, a gap, a table that stops short of the target, one that overshoots, version 0,
a fractional version. Contiguity is what lets the runner slice by arithmetic and what guarantees
every version from the earliest onwards can reach the target. The runner calls it on every run, so
a bad table cannot be shipped quietly.

`ValidateLayoutOptions.targetVersion` is what makes all of this testable with one version in
existence: every interesting case needs a target above 1. It changes only which version number is
demanded of the document, not which fields are checked — a test asserts exactly that. Production
code leaves it alone; `validateLayout` with a `targetVersion` above the document's produces
`unsupported-past-version` pointing at `loadLayout`.

`loadLayout` = migrate then validate, returning the validated `Layout`, the `fromVersion` the file
declared, and the `migrations` that ran. `formatMigrationReport` prints them, because "the result
reported" is a requirement and a consumer that has the steps but no way to print them tends not to.

**What these 51 migration tests cannot prove**, said plainly here and in the test file's header:
that a *real* future migration is correct. What they do prove is that the machinery carrying it
works — chaining in order, joining a chain mid-way without replaying earlier steps, the no-op at the
target, an unreachable past version, a future refusal, a step that throws (`migration-failed`
naming `1 -> 2`, the description and the thrown message), a step that returns a non-object, a step
that mutates its input, a step that forgets or lies about the version stamp, a chain that stops at
the failure, and the composed `loadLayout`/`loadLayoutJson` paths including validation catching a
field the migration invented.

## 12. Leaf-ness is asserted, not just intended

`environment.test.ts` reads every non-test `.ts` in `src/` and asserts none of them matches
`from '@perch/` or `from 'node:`. ARCHITECTURE.md's dependency rule and the SPEC's hard rules 4 and
5 are otherwise the kind of constraint that holds until the first convenient afternoon.

## What the SPEC left underspecified, and what was chosen

- **"Zero runtime dependencies, beyond a validator"** (hard rule 4) reads as permission to add one,
  while hard rule 4's own heading says zero and the brief forbids installing anything. Read as
  literal zero: validation is hand-written. No `npm install` was run.
- **The "Widget identity" open question** is answered by the brief's decision 2 (a registry,
  injected), so it is closed. The SPEC's own text still presents it as open — worth editing.
- **`theme: Record<string, string>` is not constrained** by the SPEC at all. Constrained as in §3.
- **`range?: [number, number]`** is optional in the type sketch but "required for any widget that
  draws a scale" in prose. Resolved by `drawsScale` living in the injected registry: the type stays
  optional because this package cannot know, and the requirement is enforced per widget.
- **No ordering, uniqueness or identity for elements.** Paint order is array order, as stated; there
  is no element `id`. Nothing in v1 needs one, and adding one now would be an identity scheme with
  no consumer. It is the obvious first thing a v2 needs (per-element visibility rules in the SPEC's
  open questions would want it).
- **"A mismatched output can be rejected cleanly"** names no mechanism. Added `fitLayoutTarget` /
  `describeTargetMismatch`: they compute the relationship (`exact` / `scaled` / `letterboxed`, a
  scale factor from the tighter dimension, an exactly-compared aspect ratio, and whether the frame
  rate is honoured) and **name every shortfall**. The *policy* — refuse, warn, or letterbox and
  carry on — is the runtime's, so nothing here is fatal.
- **Empty `theme` / empty `elements`** are valid and required to be present. `{}` and `[]` are
  meaningful statements; absence is a missing field, and the message says to write them.
- **No minimum element count.** An empty layout is a legitimate starting state for the editor.

## Evidence

All exit codes are the tool's own, read from `echo $?` immediately after the command, not from a
pipeline's status. Logs in `.evidence/layout-schema/`.

- `test-red-1.log` — `TEST_EXIT=1`, 6 failed / 326 passed of 334. Five of the six are the
  `missing-range` defect in §9: a scale widget with `range: [100, 0]` reported both `invalid-range`
  and `missing-range`. The sixth was a wrong expectation about `url('data:…;base64,…')`, which the
  character rule catches before the `url(` rule — now pinned as its own test.
- `test-green-2.log` — `TEST_EXIT=0`, `Test Files 11 passed (11)`, `Tests 334 passed (334)`.
- `build-1.log` — `BUILD_EXIT=0` (`tsc -b`, the package project).
- `lint-1.log` — `LINT_EXIT=1`, two errors in `layout-fixture.test-support.ts`
  (`no-unnecessary-type-parameters` on `hostile`, `consistent-type-definitions` on `Failure`).
  `lint-2.log` — `LINT_EXIT=0` after making `Failure` an interface and adding the one disable
  comment in the package, with its reason on the same line: a return-position-only type parameter
  is the entire point of `hostile`, since it puts the lie at the call site.
- `prettier-check.log` — `PRETTIER_EXIT=0`, "All matched files use Prettier code style".
- `typecheck-tests-1.log` — root `tsc -p tsconfig.tests.json`, `EXIT=2`, **13 errors, all 13 in
  `packages/ui-kit/`** (`createReadout`, `createSensorProvider` and `ReadoutProps` not yet exported,
  plus implicit `any`s in its tests). Zero mention `layout-schema`. That is another worker mid-edit;
  per the brief it is reported, not fixed.
- Three earlier ESLint failures (`no-control-regex` in `media.ts`, `options.ts`, `theme.ts`) were
  fixed structurally rather than disabled, by extracting `hasControlCharacter` in `checks.ts` as a
  code-point scan. The rule exists because a literal control character is invisible in source, which
  is the same reason the function is clearer than the character class was.

No screenshots: this package has no visible surface.

### The root run, which is red in packages this worker did not touch

Run once at the end, as the brief asks. All three lanes fail, and **every failure is in another
worker's live package**. Nothing in `packages/layout-schema/` was changed in response, and nothing in
their code was edited.

- `root-build.log` — `ROOT_BUILD_EXIT=1`. `@perch/layout-schema` builds first and cleanly. The
  failures are `@perch/ui-kit` (`src/index.ts:53` re-exports `ReadoutProps`, which `readout.js` does
  not export yet, and needs `export type` under `verbatimModuleSyntax`) and then `@perch/editor` and
  `@perch/runtime` failing on that same reference, plus `apps/runtime/src/dev-harness.ts` importing
  `createReadout`, `createSensorProvider` and `installSensorProvider`, none of which `ui-kit` exports
  yet. A mid-rename in `ui-kit`.
- `root-test.log` — `ROOT_TEST_EXIT=1`. Per workspace: `layout-schema` **11 files / 334 tests
  passed**, `sensor-contract` 8 / 260 passed, `sensor-sources` 7 passed, `caster` 1 passed, `editor`
  2 passed, `runtime` 2 passed. Red: `@perch/ui-kit` 4 of 8 files (`readout.test.ts`,
  `readout.test.tsx`, `lhm-tree.test.ts`, `sensor-provider`-adjacent) and `@perch/agent` 4 of 8
  (`broker.test.ts`, `cli.test.ts`).
- `root-typecheck.log` / `typecheck-tests-1.log` — `ROOT_TYPECHECK_EXIT=2`, 13 errors, all 13 in
  `packages/ui-kit/`.
- `root-lint.log` — `ROOT_LINT_EXIT=1`, 236 errors across `packages/ui-kit/` (`readout.tsx`,
  `sensor-context.tsx` and their tests), `apps/agent/src/broker.ts`, `apps/agent/src/relay.test.ts`
  and `apps/runtime/src/dev-harness.ts`. **Zero of the 236 are in `packages/layout-schema/`** —
  `grep -c layout-schema` on the log returns 0.

## Two gate failures, expected and not fixed

- **Clean working tree fails.** The commit hold is in force: everything stays staged and uncommitted
  on `main` at `ade7408`. Nothing was committed, branched, checked out, amended, stashed or reset.
  `reviewSnapshotMatchesBranchHead` fails for the same reason — satisfying it would mean committing.
- **`adversarialReviewPresent` fails.** A standing rule forbids adversarial review, so no
  `/code-review` was run and no `code-review.md` exists. The call-sites enumeration is the appended
  section of `CALL_SITES.md`.

`task_complete` returned, verbatim:

```
verdict: "fail"
failedChecks: [
  "evidenceDirNonEmpty", "decisionsFilePresent", "adversarialReviewPresent",
  "buildLogPresent", "reviewSnapshotMatchesBranchHead"
]
```

Three of those five were the gate reading its own evidence directory rather than `.evidence/`, and
were satisfied afterwards by registering `DECISIONS.md`, `CALL_SITES.md` and eight logs through
`evidence_capture`: `evidenceDirNonEmpty`, `decisionsFilePresent`, `buildLogPresent`. The remaining
two are the waived pair above — `reviewSnapshotMatchesBranchHead` (commit hold) and
`adversarialReviewPresent` (standing rule). A failure limited to those two is this project's pass,
so the gate was not re-run and nothing was invented to turn it green.

# The browser's MQTT source — decisions

The `mqtt` implementation of `SensorSource`: `packages/sensor-sources/src/mqtt-source.ts` plus
`broker-url.ts`. Everything below is shaped by two facts — every byte on the wire is untrusted,
and the machine publishing them reboots.

## 1. Two narrow subscriptions, not `sensors/#` and a filter

Pre-decided in the brief; implemented as `SENSOR_READING_SUBSCRIPTION = 'sensors/+/+/+/+'` and
`SENSOR_META_SUBSCRIPTION = 'sensors/+/+/+/+/meta'`, both built from `SENSOR_TOPIC_ROOT` and
`SENSOR_META_SUFFIX` rather than hand-written.

The fact it turns on is asserted as a test: `topicMatchesPattern(CPU_TEMP_META,
SENSOR_TOPIC_WILDCARD)` is `true`. The contract's own wildcard matches the retained metadata
companions, so a source built on it receives `SensorMeta` bodies interleaved with readings and
must route on a suffix — and one routing slip hands a widget an object where it expects a
number. The guards would catch it; the point is that with two patterns a meta payload is never
a *candidate* for the reading path. Red-first evidence: with one `sensors/#` subscription and
no validation, `never hands a meta payload to a reading subscriber` fails with
`readingsAccepted` = 2 rather than 1 — the metadata body was accepted as a reading and
delivered.

## 2. Broker URL: environment variable → config file beside the bundle → default

Pre-decided; implemented in `broker-url.ts`, which returns `{ url, origin }`. The `origin` is
the load-bearing half and the reason this is not a three-line `??` chain.

`relay-endpoint.ts` defaults to `ws://localhost:9001`, and on this machine a Homebrew mosquitto
already listens on 9001 bound to all interfaces with anonymous access. Used as-is it accepts
the CONNECT, accepts both SUBSCRIBEs and delivers nothing: a dashboard that looks connected and
stays empty, with no error anywhere to read. So `createMqttSource` logs
`DEFAULT_BROKER_URL_WARNING` — naming `PERCH_BROKER_URL` and the port — whenever
`origin === 'default'`. That warning is the only signal separating "wrong broker" from "broker
with nothing to say".

## 3. A present-but-malformed override throws; an absent config file does not

Falling back on a bad `PERCH_BROKER_URL` would reproduce exactly the failure decision 2 exists
to prevent: the operator believes they aimed the dashboard at one broker and it quietly went to
another. An override is a statement of intent, so a malformed one is a `TypeError` naming the
variable. Absence is different — an unconfigured bundle is the normal state, so a 404 or a
`fetch` that rejects (as it does over `file://`) yields `undefined` and resolution continues.
A config file that *is* there and is wrong throws, for the same reason as the env var.

## 4. `status` is derived on read, not written by a timer

The contract says "read it; never cache it", and a timer-written status *is* a cached one:
correct only as often as the timer fires, and a leak if the source is dropped without being
closed. `currentStatus()` reads a three-valued link state (`opening` / `up` / `down`), the
last-accepted-reading timestamp and the clock. The `live` → `stale` transition then happens at
the exact moment the window closes, and there is no timer to own or cancel.

Injecting `now` makes the boundary exact rather than timed: the test asserts `live` at
`staleAfterMs` (inclusive) and `stale` at one millisecond past.

## 5. The three absences are kept apart by `everReceived` and the link state

- `connecting` — link opening, **or** link up and no reading has *ever* arrived. Nothing has
  arrived and nothing has failed, which is exactly the contract's wording.
- `live` — link up, reading inside the window.
- `stale` — link up, window closed. Also the state immediately after a reconnect, before the
  first reading of the new session: the transport has just proved itself and the data has not
  come, which is neither `connecting` (nothing has failed) nor `error` (the link is fine).
- `error` — link down after a failure. Retrying is the source's job, not the consumer's.

`connecting` versus `stale` with the link up is the distinction that needs a second bit, and
`everReceived` is it: "nothing has spoken yet" is not "something went quiet". Red-first
evidence: collapsing the states (`lastReadingAt === undefined → 'stale'`, everything else
`'live'`) fails five tests, including both `error` cases and the reconnect walk.

## 6. Through a reconnect gap the status is `error` for the whole gap

`lastReadingAt` is cleared on every drop *and* on every CONNECT. Without the first, a source
would report `live` off a reading from before the gap for a whole staleness window; without the
second, it would do the same on the new link. And the gap is never `connecting` again, which
would read as "nothing has failed yet" about a connection that demonstrably failed. The test
advances the injected clock 60 s inside the gap and asserts `error` throughout.

## 7. Retained metadata survives a link drop; readings do not

`metas` is deliberately not cleared in `noteFailure()`. The label is still the right label, the
retained companions will be redelivered on resubscribe, and `status` already says the link is
down — blanking every widget's label for the duration of a reboot would make a transport gap
look like a data-model failure. Readings are the opposite case: a stale number presented as
current is a lie, and clearing `lastReadingAt` is what stops it.

## 8. A zero-length retained meta publish clears the label and is not a rejection

MQTT withdraws a retained message with an empty payload. It is an instruction, not a malformed
body — the sensor's label is *gone*, not corrupt. Counted as `metaCleared`, not `rejected`, so
the rejection counters stay a signal about the schema rather than about normal traffic.

## 9. Rejections are enumerated and counted, and each reason is logged exactly once

`SENSOR_MESSAGE_REJECTIONS` is a frozen six-member tuple, and `stats.rejectionsByReason` is a
fixed-shape record a test or a dashboard can assert on. A validating boundary that validates
*quietly* creates its own failure mode: "connected and nothing renders" becomes
indistinguishable from "connected and every payload is being dropped". Counting makes the scale
visible; logging the first of each reason (with the topic) makes the cause visible; not logging
the rest keeps 200 topics at 1 Hz from flooding out the one line worth reading.

`unroutable-topic` is counted even though only a broker bug can produce it — that is the point
of counting rather than assuming.

## 10. Arrival time is *our* clock, not the reading's `at`

`lastReadingAt = now()`, never `reading.at`. `at` is the publisher's clock and the two machines
need not agree; a sensor host with a skewed clock would otherwise be permanently `stale` or
permanently `live`. `status` is a statement about this process's link, so it uses this
process's clock.

## 11. A consumer's `subscribe` pattern is a local filter, not a new SUBSCRIBE

The broker-side subscription set is fixed at the two patterns. A consumer's pattern is matched
in process with `topicMatchesPattern`. A desktop publishes on the order of 200 topics at 1 Hz,
so the matching is negligible, and the alternative is a broker subscription table that has to
be reconciled on every reconnect — more state, and a path where a per-consumer pattern could
widen the stream back to something that includes `/meta`.

## 12. `clean: true` and `resubscribe: false`: the resubscription is ours, explicitly

Relying on the library to replay subscriptions would make the most important behaviour in a
reboot an implicit library default. The `connect` handler subscribes every time, so reconnect
and first connect are the same code path — which is why the reconnect test can assert
`connects === 2` and then see readings flow without a special case.

Readings take QoS 0 and metadata QoS 1: at 1 Hz the next reading is worth more than a
redelivery of the last, while metadata is published once and a lost one means a widget with no
label until the publisher restarts.

## 13. `close()` reports `error`, because the contract has no fourth state for it

The interface's four states do not include "closed by the consumer". `connecting` would be a
lie (nothing is in flight), `stale` would be worse (it implies a live transport). `error` is
the honest one of the four: there is no link and there will not be one. Recorded here because
it is an interface gap, not a preference — see "What the interface left underspecified".

## 14. `mqtt` is default-imported, and is not declared in this package's `package.json`

`mqtt@5.16.0`'s browser ESM bundle (`dist/mqtt.esm.js`, chosen by the `browser` export
condition) ends in `export default`. `import { connect } from 'mqtt'` typechecks against the
CJS-shaped `.d.ts` and then fails in the bundle, so the import is `import mqtt from 'mqtt'`
with type-only named imports beside it.

**A knowingly-paid cost:** `mqtt` is *not* added to `packages/sensor-sources/package.json`. It
resolves from the root `node_modules` through workspace hoisting, so build, test and lint all
pass, but the package's manifest does not declare a dependency it has. The brief forbids
touching dependencies or the lockfile while two other workers are live, and a manifest edit is
the kind of change that drifts `package-lock.json`. **Follow-up, one line:** add
`"mqtt": "^5.16.0"` to that package's `dependencies` once the other workers have landed.

## 15. The test broker is real, and never on port 9001

`mqtt-broker.test-support.ts` stands up `aedes` over `ws` in process and the tests dial it with
the same `mqtt` client the browser runs: real CONNECT, real SUBSCRIBE, real retained delivery,
real socket destruction. A stub would prove the source calls a library; what needed proving is
that readings, metadata and `status` come out right at the far end of a wire.

It always listens on an OS-assigned ephemeral port (`listen(0)`), which *cannot* collide with
the system mosquitto on 9001 — a test on the default port would pass or fail for reasons
unrelated to the code, and on a machine where mosquitto happened to be running it would look
green while proving nothing. The cases about a link that cannot be made use `ws://127.0.0.1:1`.
The one use of an explicit port is restarting a broker on the port a previous one had, which is
how a rebooting sensor host is reproduced.

The file carries the `.test-support.ts` suffix and the package tsconfig now excludes that
suffix from the build, so none of this Node-only scaffolding can reach `dist` or the browser
path. Same arrangement as `sensor-contract`'s `lhm-fixture.test-support.ts`.

## What the interface left underspecified

- **No state for "closed".** `SensorSource` has four states and none of them is "this source
  was shut down by its consumer". Decision 13 resolves it as `error`; a fifth state, or a
  documented note that `close()` is outside the contract's vocabulary, would be better.
- **`subscribe` does not say whether the pattern reaches the transport.** Nothing in the
  contract says whether a source should SUBSCRIBE per consumer pattern or filter an existing
  stream, and the two differ observably — on a broker's subscription table, on reconnect cost,
  and on what a wildcard can pull in. Decision 11 chose filtering.
- **No re-entrancy or ordering guarantee for handlers.** The contract does not say whether a
  handler may `subscribe`/unsubscribe during delivery. This source iterates a live `Map`, so a
  handler that unsubscribes itself is safe and one that subscribes during delivery may or may
  not see the current message. Worth pinning down before a widget relies on it.
- **`status` has no stated granularity.** "Connected but the publisher stopped" needs a
  staleness window, and the contract names no default. 3000 ms is chosen here from the SPEC's
  1 Hz publish rate (three missed intervals), and it is an option.

## Call sites

A `packages/*` change, so the enumeration is required. It lives here rather than in
`CALL_SITES.md` because the brief scoped writes to `packages/sensor-sources/` plus this file.

- **Nothing imports `createMqttSource` yet.** `grep -rn "createMqttSource\|resolveBrokerUrl"`
  outside `packages/sensor-sources/` returns nothing. This is additive: no existing call site
  changes behaviour.
- `packages/sensor-sources/src/index.ts` — the only file modified for export purposes; gains
  `./broker-url.js` (14 names) and `./mqtt-source.js` (10 names) alongside the existing mock
  exports. Existing exports are untouched, so `apps/runtime`'s and `apps/editor`'s imports of
  `createMockSource` and `topicMatchesPattern` are unaffected.
- `packages/sensor-sources/tsconfig.json` — adds `src/**/*.test-support.ts` to `exclude`. The
  only effect on anything else is that the emitted `dist` is now strictly smaller.
- **The future call site** is `apps/runtime`'s bundle entry, one line from the mock source it
  currently creates (`DECISIONS.md`, "The source is created in the harness, one line from the
  MQTT swap"). It is mid-edit by another worker and was deliberately not touched.
- `packages/sensor-contract` — read only. No contract file was modified; the interface is
  implemented as written.

## Evidence

Lanes, `@perch/sensor-sources`: `npm run build -w` `EXIT=0`; `npm test -w` `EXIT=0`, **75
tests, 7 files**; `npx eslint packages/sensor-sources --max-warnings 0` `EXIT=0`;
`npx prettier --check` `EXIT=0`. Typecheck of the test lane is scoped (see below) `EXIT=0`.

- `.evidence/mqtt-broker-roundtrip.log` — the in-process broker round trip, verbose: 22 named
  tests against real `aedes`-over-`ws`, including the retained-metadata-before-connect case,
  the eight malformed publishes and the broker restart. `EXIT=0`.
- `.evidence/mqtt-red-1-wildcard-and-no-validation.log` — red-first. One `sensors/#`
  subscription with no meta/reading split, no `isSensorReading`, no topic canonicalisation:
  **9 failed**, including `never hands a meta payload to a reading subscriber`
  (`readingsAccepted` 2, expected 1 — the meta body was delivered as a reading), both retained
  metadata tests, all four boundary tests and the reconnect walk.
- `.evidence/mqtt-red-2-collapsed-status.log` — red-first for `status`. Collapsing the four
  states into "connecting / stale / live": **5 failed** — `connecting` with the link up and no
  data, the exact `live`→`stale` boundary, `error` when the connection dies, `error` when the
  broker was never there, and the reconnect walk.
- `.evidence/mqtt-green-test.log`, `mqtt-green-build.log`, `mqtt-green-lint.log`,
  `mqtt-green-typecheck-scoped.log` — the green lanes.

The typecheck is scoped because the root `tsconfig.tests.json` currently fails in
`packages/ui-kit/` (34 errors, another worker mid-edit). `grep "error TS" | grep -v
"^packages/ui-kit/"` on that run returns nothing. To prove this package's test files typecheck
under the strict flags, the same project was re-run narrowed:

```json
{
  "extends": "/Users/stepblk/Source/perch/tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"],
    "typeRoots": ["/Users/stepblk/Source/perch/node_modules/@types"],
    "paths": {
      "@perch/sensor-contract": ["packages/sensor-contract/src/index.ts"],
      "@perch/sensor-sources": ["packages/sensor-sources/src/index.ts"]
    }
  },
  "include": ["packages/sensor-sources/src/**/*.ts"]
}
```

`EXIT=0`. No `any`, no non-null assertions, and one deliberately widened callback parameter
annotation in the test broker (aedes types its publish callback `(error?: Error)` and actually
calls it with `null` on success — checking only `undefined` rejects every successful publish,
which it did until it was caught).

**Root lanes fail in packages this work did not touch.** `npm run build` `EXIT=1` and
`npm test` `EXIT=1`:

- `@perch/ui-kit` — 22 tests failed (`readout.test.ts(x)`, `sensor-context.test.tsx`) and
  `src/index.ts(53)` fails to compile, which then fails `apps/runtime`'s `dev-harness.ts` on
  `createReadout` / `createSensorProvider` / `installSensorProvider`.
- `@perch/agent` — 5 tests failed (`broker.test.ts`, `cli.test.ts`, `lhm-tree.test.ts`,
  `round-trip.test.ts`).

Those are the two workers the brief said are live in this checkout, in exactly the directories
it named. Their code was not modified. `@perch/sensor-sources` passes 75/75 inside the same
root run, and `@perch/sensor-contract` (260), `layout-schema`, `caster` and `editor` all pass.
Logs: `.evidence/mqtt-root-build.log`, `.evidence/mqtt-root-test.log`.

No screenshots: this source has no visible surface of its own.

## Two gate failures, expected and not fixed

- **Clean working tree fails.** The commit hold is in force: everything stays staged and
  uncommitted on `main` at `ade7408`. Nothing was committed, branched, checked out, amended,
  stashed or reset. `reviewSnapshotMatchesBranchHead` fails for the same reason — satisfying it
  would mean committing.
- **`adversarialReviewPresent` fails.** A standing rule forbids it, so no `/code-review` was
  run and no `code-review.md` exists. The brief's trailing "deliverable contract" block, which
  demands commits, a `code-review.md`, AutoSDE runs and a CR, contradicts the two hard
  constraints stated above it and is treated as stale on the brief's own instruction.

# React, Vite, strict TypeScript, ESLint and Prettier — decisions

The framework decision was made in one sentence: *"everything should obviously be react + vite
+ strict typescript + eslint + prettier. no raw bullshit anywhere."* That sentence is both the
architecture and the dependency approval, and this section is only the toolchain half of it.
Nothing here ports a module to React, wires Vite into an app, or retires the dev harness —
those are owned by later work and, at the time of writing, by workers running concurrently in
this same checkout.

"Strict" is read as a claim about what the compiler catches, not as `strict: true` and a shrug.

## 1. Dependencies are declared where they are used, not at the root

Eight workspaces, and the dependency each one gets is the one it actually resolves:

| Workspace | Added |
| --- | --- |
| `packages/ui-kit` | `react` as a **peer**; `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@testing-library/react`, `@testing-library/jest-dom` as dev |
| `apps/runtime` | `react`, `react-dom` as **runtime deps**; `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`, `@testing-library/react`, `@testing-library/jest-dom` as dev |
| `apps/editor` | the same set as `apps/runtime` |
| `packages/sensor-contract`, `packages/layout-schema`, `packages/sensor-sources`, `apps/agent`, `apps/caster` | **nothing** |

`ui-kit` takes React as a peer because it is a library: `runtime` and `editor` render it, and a
library that hard-depends on React is how a second copy of React ends up in a bundle and hooks
start throwing. The dev copy is there so `ui-kit` still typechecks and tests on its own.

The three workspaces with no UI and no bundler got nothing. `sensor-contract` in particular
stays dependency-free, which is the property that lets `apps/agent` depend on it without
dragging a renderer into a Node process.

The lint and format toolchain *is* at the root: `eslint`, `typescript-eslint`, `@eslint/js`,
`globals`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-config-prettier`,
`prettier`. One config governs the repo, so one place declares its tools.

`@eslint/js` and `globals` are not incidental picks — they are the two companions
`typescript-eslint`'s own install instructions name for a flat config, supplying the base
`recommended` rule set and the environment global tables that `env: node` used to.

## 2. Vite is declared, and the version numbers are not the ones you would guess

Before this change Vite existed only as a transitive dependency of Vitest, which is exactly the
"raw" state the decision was made against: the bundler was present, unversioned by us, and
upgradeable out from under the repo by a Vitest bump.

It is now declared. What actually resolves, from `package.json` and the lockfile rather than
from memory:

```
root:                  vite ^6.4.3   @vitejs/plugin-react ^4.7.0
apps/runtime, editor:  vite ^7.3.6   @vitejs/plugin-react ^5.2.0
```

The root pairing is the one that co-exists with the test runner: **Vitest 3 brings its own
Vite**, and `@vitejs/plugin-react` 6 requires Vite 8, which collides with it. So Vite 6 with
plugin-react 4 is the pairing that resolves cleanly against Vitest 3 — *not* "Vite 7 forced by
Vitest", which is wrong and was corrected before this was written.

**Open item, not resolved here.** Those two rows are different majors, and `npm ls` confirms
both are installed rather than deduped: `vite@6.4.3` at the root (the copy Vitest uses) and
`vite@7.3.6` under `runtime` and `editor`. Two Vite majors in one lockfile is a real defect and
should be one pairing. It is left alone deliberately: `package.json` and `package-lock.json` are
contended files with other workers live in this checkout, removing a declared dependency is not
an additive edit, and re-resolving would rewrite the lockfile over work that is only staged.
Whoever wires Vite into `apps/runtime` should collapse this to a single pair and should own the
choice, because that worker is the one who finds out which major the app actually needs.

## 3. `eslint` is pinned to 9, and that is a ceiling someone else set

`eslint-plugin-react@7.37.5` declares a peer range that stops at ESLint `^9.7`. ESLint 10 is
therefore not usable while the React rules are, so `eslint` and `@eslint/js` are both `^9.39.5`.

npm prints `npm warn deprecated eslint@9.39.5: This version is no longer supported` on install.
That warning is accurate and is accepted knowingly: the alternative is dropping the React rules
from a repo whose stated direction is React. It is recorded here so the next person to see the
warning does not "fix" it by bumping ESLint and silently losing `eslint-plugin-react`.

## 4. Strict TypeScript: what was turned on, and what each one is for

`strict: true` was already set. Everything in this list is a check `strict` does **not** enable,
added in `tsconfig.base.json` so it applies to all eight workspaces at once:

| Flag | Why it is on here specifically |
| --- | --- |
| `noUncheckedIndexedAccess` | Every table in `lhm.ts` is a `Record`, and every topic parse is a `split`. Both were typed as though a lookup always hits. |
| `exactOptionalPropertyTypes` | `{ deviceIndex: undefined }` is not `{}`. Passing an explicit `undefined` into an options bag is how a default silently stops applying. |
| `noImplicitReturns` | A function that returns a value on some paths must return one on all of them. |
| `noPropertyAccessFromIndexSignature` | An index-signature read is a lookup and must be written as one. A typo'd `dataset` key was previously a silently-ignored `data-*` attribute. |
| `allowUnreachableCode: false`, `allowUnusedLabels: false` | Unreachable code is an error, not editor greyout. |
| `noUncheckedSideEffectImports` | An `import './thing.css'` that resolves to nothing becomes an error rather than a no-op — this matters the moment a component imports a stylesheet. |
| `erasableSyntaxOnly` | No enums, no parameter properties, no namespaces: only syntax that erases. Keeps every file loadable by a type-stripping runtime or by esbuild. |

`noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`,
`isolatedModules`, `verbatimModuleSyntax` and `forceConsistentCasingInFileNames` were already
set by the scaffold and are left as they are.

### Left off deliberately

- **`noImplicitAny` and friends** — already implied by `strict`. Listing them again would
  suggest they were separate choices.
- **`useUnknownInCatchVariables`** — also part of `strict`; same reason.
- **`noUnusedLocals` duplicated in ESLint** — see decision 6; the compiler keeps this one and
  the lint rule is turned off rather than both owning it.
- **`verbatimModuleSyntax` churn was accepted, not avoided.** It rewrote imports across the
  workspaces to the inline `type` specifier. That is mechanical and was expected.

Nothing else was left off. The judgement calls above are the whole list, which is the point of
recording them.

## 5. The stricter settings found a real bug, not just style

Eighteen `tsc -b` errors and five more from `tsconfig.tests.json`, all fixed. Most were the
honest-widening kind: `?? ''` on a segment split, `| undefined` on an optional options member,
bracket access on `dataset`. One was not.

`packages/sensor-sources/src/mock-source.ts` held its sensor set as **two parallel arrays**,
`specs` and `topics`, indexed in lockstep by the publish loop. `specs[i]` and `topics[i]` were
the same sensor only because of an invariant nothing enforced — no type said so, and no test
would have caught a divergence, because a reordering would still have produced plausible
numbers on plausible topics. It would have published the CPU's value on the GPU's topic and
looked fine on a panel.

`noUncheckedIndexedAccess` made it visible by forcing both reads to be `| undefined`, and the
fix is structural rather than a cast: one array of `{ spec, topic }` pairs, iterated with
destructuring. The invariant is now the data shape.

Also removed: a pre-existing `as string` cast in `lhm.ts`'s `resolveHardware`, which was
suppressing exactly the "a lookup can miss" question this flag set exists to ask.

## 6. ESLint is a flat config in three tiers, and a warning is a failure

`eslint.config.js`, one file, because lint rules are a property of the repo rather than of any
one workspace — the same argument `tsconfig.base.json` makes about strictness.

1. **Sources** (`packages/*/src`, `apps/*/src`, plus the `vitest.setup.ts` files) get
   **type-aware** linting: `strictTypeChecked` and `stylisticTypeChecked`. This is where a type
   checker pays for itself — a floating promise, an `await` on a non-thenable, a `??` whose left
   side can never be nullish.
2. **React sources** — `ui-kit`, `runtime`, `editor`, the three workspaces `ARCHITECTURE.md`
   lists as rendering — additionally get `eslint-plugin-react` and `eslint-plugin-react-hooks`.
   Scoped rather than global so a hooks rule cannot fire in `agent`, which has no UI.
3. **Config and tooling files** get syntax-and-idiom linting with no type information, because
   they are in no `tsconfig` project.

`--max-warnings 0` is on both `lint` and `lint:fix`. `react-hooks`'s recommended set ships
several rules at `warn`, and a warning nobody fails on is a warning nobody reads.

Rule overrides, each for a reason:

- `@typescript-eslint/no-unused-vars` **off** — the compiler already errors via `noUnusedLocals`,
  and it does it with the project's own knowledge of type-only imports. Two implementations of
  one check only produce disagreements.
- `consistent-type-imports` with `fixStyle: 'inline-type-imports'` — `verbatimModuleSyntax` makes
  this the required spelling, not a preference.
- `strict-boolean-expressions` with `allowString: false, allowNumber: false` — coercing a value
  that might be `''` or `0` is how a real zero reading and the dimensionless empty unit both turn
  into "no data". Both are values this repo's contracts call meaningful. It found **zero**
  violations, which is a genuine signal about the existing code.
- `restrict-template-expressions` relaxed to allow numbers and booleans — a `RangeError` message
  has to print whatever it was handed.

## 7. Prettier owns formatting outright, and ESLint never argues with it

`eslint-config-prettier` is last in every chain — the config, not `eslint-plugin-prettier`. The
plugin approach runs Prettier *as* a lint rule, which produces a second, slower, differently-
reported copy of the same output. Disabling the conflicting rules instead means the two tools
never both have an opinion about the same character.

`printWidth: 100` was measured, not chosen by taste. The existing code is hand-wrapped, so the
setting that reformats least is the one that matches the author: width 96 rewrote 183 lines,
width 90 rewrote 90, and width 100 rewrote 77. Prettier should adopt the repo's existing style,
not impose a new one on its first run.

### What Prettier does not format

- **`*.md`** — authored prose, hand-wrapped, with tables laid out on purpose. Prettier rewrites
  every one: `CALL_SITES.md` 160 lines, `DECISIONS.md` 142, `sensor-contract/SPEC.md` 48,
  `layout-schema/SPEC.md` 35, `ARCHITECTURE.md` 28, `infra/mosquitto/README.md` 12. Two of those
  are files this change was explicitly told not to touch. A documentation reformat should be its
  own deliberate change with its churn visible on its own.
- **`fixtures/lhm-data.sample.json`** — a byte-exact capture from a real LHM host. Its value is
  that it is what the wire produced.
- **`.claude/`** — tool-managed local state; Claude Code rewrites `settings.local.json` itself,
  so a format gate over it would fail on a file no human edited.
- `.evidence/`, `dist/`, `node_modules/`, `package-lock.json`, `*.tsbuildinfo`.

`dev-harness.html` **is** formatted — it needed zero changes, so HTML stays in scope.

## 8. jest-dom matchers are wired now, so the next task needs no approval round

`@testing-library/react` and `@testing-library/jest-dom` are installed and registered, so the
worker who writes the first React component can test it immediately.

Each jsdom workspace gets a `vitest.setup.ts` at its **package root, not in `src/`**. Everything
under `src/` is compiled into `dist/` by that package's own `tsconfig`, and a file whose only job
is to extend a test assertion vocabulary has no business being published. It is referenced from
`vitest.config.ts` via `setupFiles`, and typechecked by `tsconfig.tests.json` — which is also
what makes the matcher types visible to the tests, since the augmentation has to be in the same
program as the `expect` calls that rely on it.

It imports `@testing-library/jest-dom/vitest`, not the bare package: that entry point is the one
that augments Vitest's `Assertion` interface, so `expect(el).toBeVisible()` is typed as well as
available. Verified with a throwaway probe test that asserted `toBeVisible()` and
`toHaveTextContent()` — it passed and typechecked, and was then deleted.

## 9. React config is set one step ahead of the first component

`jsx: "react-jsx"` on the `ui-kit`, `runtime` and `editor` projects; `.tsx` added to their
`include` and to their Vitest `include`; `.test.tsx` added to `tsconfig.tests.json`.

The automatic runtime means a component needs no `import React`. Setting it now means the first
`.tsx` file added is the whole change, rather than a file plus three config edits — and it is why
`react.configs.flat['jsx-runtime']` is in the ESLint chain, without which every component would
trip `react/react-in-jsx-scope`.

## 10. `tsconfig.tests.json` stays, and ESLint resolves through it rather than around it

The scaffold flagged this file as a second module-resolution mechanism, and the stricter settings
did sharpen the tension, exactly as anticipated.

Test files are excluded from every package project, so with `projectService` they are "out of
project" and type-aware rules cannot run on them. The options were a third mechanism, or using
the file that already exists. ESLint therefore uses the legacy `parserOptions.project` array,
listing `tsconfig.tests.json` alongside the eight package projects.

It did not block, so it was not restructured. The observation stands for whoever does take it on:
the cost is that a test file's types come from a different program than its source's, and that
program is the only place path mapping exists.

## 11. The eight lint violations were fixed in the code, not muted

`--max-warnings 0` means the count has to reach zero. It did, and no `eslint-disable` comment was
added anywhere in this change.

Five were `no-non-null-assertion`, and they were **created by ESLint's own autofix**:
`non-nullable-type-assertion-style` rewrote `as number` and `as SensorTopic` into `!`, which
`no-non-null-assertion` then rejected. Both rules ship in `strictTypeChecked`, so the fix of one
is the violation of the other — a genuine rule-vs-rule contradiction.

Turning one rule off was rejected in favour of removing the assertion. Vitest's `assert` is typed
`asserts expression`, so it narrows:

```ts
assert(raw !== null && formatted !== null, sensor.SensorId);
expect(raw, sensor.SensorId).toBeGreaterThanOrEqual(formatted);
```

This is strictly better than what it replaced. The old code paired
`expect(reading.value).not.toBeNull()` with `reading.value!` — an expectation that checked a fact
and an assertion that re-stated it to the compiler, with nothing tying the two together. One
`assert` both fails the test and narrows the type, and it names the offending sensor when it
fires. Three sites in `mock-source.test.ts`, two in `lhm-value.test.ts`.

The other three were `no-empty-function` on deliberate no-op listeners, replaced with a named
`const noop = (): void => undefined;`. `() => {}` at a call site reads as an unfinished handler;
`noop` reads as the point of the test, which is that *subscribing* is what is being asserted.

**One of those three did not survive, and not because of anything here.** The file it lived in,
`packages/ui-kit/src/sensor-provider.test.ts`, was deleted from the worktree by the concurrent
React rewrite (session `54954f5a`) while this work was in progress. The violations it fixed are
gone because the file is gone. Nothing was reverted and nothing was lost — that file is its
owner's to replace.

## 12. What was deliberately not done

- `packages/ui-kit/src/readout.ts` and `sensor-provider.ts` were made to compile clean under the
  new flags and **not** restructured or ported to React. (Both have since been replaced by
  session `54954f5a`, which owns them.)
- The dev harness — `dev-harness.html`, `src/dev-harness.ts`, `tools/serve.mjs`,
  `tools/capture.mjs` — was not deleted and Vite was not wired into `apps/runtime`.
- `infra/mosquitto/`, `fixtures/` and every `SPEC.md` were not touched.
- No dependency outside the approved set was added.

## Call sites

Recorded in `CALL_SITES.md`. The behaviour-bearing edits are confined to three shared surfaces —
`sensor-contract`'s topic and LHM parsing, `sensor-sources`'s mock, and `ui-kit`'s readout and
provider — and in each case the change is a widening or a de-casting, not a signature change a
caller has to react to.

## Evidence

Root lanes, captured in `.evidence/toolchain/` with exit codes in
`.evidence/toolchain/EXIT-CODES.txt`:

| Lane | Exit | Attribution |
| --- | --- | --- |
| `npm test` | **0** | 881 passed. Includes `sensor-contract` 260 and `sensor-sources` 118, the two suites this change edited. |
| `npm run lint` | 1 | 16 errors, **none in this change's files**: 14 in `apps/runtime/src/dev-harness.ts` (session `54954f5a`, mid-rewrite, retiring that file), 2 in `apps/agent/src/{broker.ts,relay.test.ts}` (session `7c6966ad`). |
| `npm run typecheck` | 2 | 5 errors, all `apps/runtime/src/dev-harness.ts`, on `createReadout` / `createSensorProvider` / `installSensorProvider` — exports `54954f5a` has replaced with React components. |
| `npm run build` | 1 | Same five errors, same file, same owner. |
| `npm run format:check` | 1 | 6 files, all `apps/agent/src/*` (session `7c6966ad`), written after this change's `format` run. |

Scoped to this change's own files, every lane is clean:

```
eslint <this change's 13 files> --max-warnings 0     EXIT=0
prettier --check <this change's files>               EXIT=0
```

The red lanes are the three concurrent workers' in-flight state in the directories they own.
Their files were not reverted, re-formatted or repaired.

An earlier measurement, taken at the point this change was complete and before the concurrent
rewrites landed, had all five lanes green with **356 tests passing** — the same count as before
the change, which is the proof that a config-only change altered no behaviour. Those logs are
superseded by the table above but the count is the meaningful number: 356 → 356.

`npm audit` reports 2 moderate advisories (`@vitest/mocker`, GHSA-82fw-gwwq-j7x9). Both are
pre-existing and the only remedy is a Vitest major bump, which would change what `npm test`
means and is out of scope.

**No screenshots, because this change has no visible surface** — it is compiler flags, lint
rules and dependency declarations. This is a statement about *this* change and must not be read
as a relaxation: the panel-ratio capture at 1920×400 plus a normal tab size remains **required**
for any work that alters what the user sees, and that includes the React port now in flight.

## Two gate failures, expected and not fixed

- **Clean working tree fails.** The commit hold is in force: everything stays staged and
  uncommitted on `main` at `ade7408`. Nothing was committed, branched, checked out, amended,
  stashed or reset. `reviewSnapshotMatchesBranchHead` fails for the same reason — satisfying it
  would mean committing.
- **`adversarialReviewPresent` fails.** A standing rule forbids it, so no `/code-review` was run
  and no `code-review.md` exists.

# The relay: polling LHM and embedding the broker — decisions

`apps/agent`. One process that polls LibreHardwareMonitor's `/data.json`, maps every reading onto
the topic grammar, and publishes it over an MQTT broker running **inside the same process**.

## The broker is embedded, not installed

`aedes` in-process, serving native MQTT on TCP (`node:net`) and MQTT-over-WebSockets (`node:http`
plus `ws`), both fronting one broker instance.

The standing rule is that perch adds no user-facing installation prerequisite, and an external
Mosquitto is one: install it, write a config with a `listener 9001` block, enable
`protocol websockets`, run it as a service. That is four steps before a number appears on a
dashboard. A broker-as-a-library makes the relay executable the entire install story beyond LHM
itself.

Two listeners rather than one because a browser cannot open a TCP socket, and the dashboard is a
browser. The TCP listener is what makes the thing inspectable from a shell — it is how the round
trip below was verified at all. **One** `aedes` instance behind both, so a message published once
is visible on either and the retained store is shared; two brokers would have been two sources of
truth.

ARCHITECTURE.md's "perch is not a message broker" is not in tension with this. perch still does
not implement MQTT; it embeds an implementation.

## The duplicated identifier: first in document order wins, and says so

The capture holds 214 sensors but only 213 distinct topics. LHM emits `/gpu-nvidia/0/load/3`
twice, once as "GPU Memory" and once as "GPU Bus". The relay publishes the **first in document
order** and logs one warning naming the identifier, both labels, and the topic:

```
[warn] LHM reports two sensors under one identifier /gpu-nvidia/0/load/3: publishing
"GPU Memory" and dropping "GPU Bus" on sensors/gpu/0/load/3. Two sensors share one identity at
the source, so no topic can carry both.
```

The alternatives and why not:

- **Publish both.** Two unrelated readings would alternate on one topic at 1 Hz with nothing on
  the wire to explain it. A dashboard panel would flicker between GPU memory load and PCIe bus
  load, and no consumer could detect the problem, let alone fix it. This is the worst option and
  it is also the one that happens by accident.
- **Publish neither.** Discards a real reading to avoid an ambiguity that only affects one of the
  two, and leaves a hole a user cannot explain.
- **Disambiguate from LHM's per-node `id` (168 and 169 here).** That field is a per-response
  ordinal, not a sensor identity — it moves when the tree changes — so a topic built on it would
  not be stable across restarts. The topic grammar also has nowhere to put a label.

First-wins is deterministic because the walk preserves document order, so the topic has one
stable meaning across polls and restarts. The warning is what makes it a decision rather than a
silent loss; it is emitted once per distinct topic per process, not per tick, because at 1 Hz
per-tick would be 86 400 identical lines a day and a log nobody reads.

Reported in every `PollReport` regardless, so a caller can surface it without reading the log.

## A failed poll publishes nothing at all

Not `{"value": null}` for every sensor. `null` already means "this sensor is present and
reporting nothing" — the unpopulated fan header in the capture — and overloading it with "the
relay cannot reach LHM" would destroy a distinction the contract exists to make. A dashboard
would render the same thing for a probe that is absent and a source that is down.

Staleness is `at`'s job: readings stop arriving, `at` stops advancing, and a consumer decides how
much stale is too much. The failure is logged every time it happens, and a recovery is logged
too, so a silent log is not the only sign the source came back.

The poll never rejects; it resolves with a `failure` string. A long-lived loop that can be ended
by one unhandled rejection is not a service. Likewise a rejecting publish is logged and the loop
continues.

## QoS 0, readings unretained, metadata retained once

- **QoS 0.** A reading is superseded by the next poll a second later. At-least-once delivery of a
  value that is about to be replaced buys nothing and costs an ack round trip per sensor per
  tick — 213 of them here.
- **Readings unretained.** A retained reading is a stale reading that arrives at a new subscriber
  looking fresh; `at` is the only thing that would tell them otherwise.
- **Metadata retained, published once per topic per process.** It is exactly what a dashboard
  connecting an hour later needs and cannot recompute, and it does not change between polls. 213
  retained writes a second would make the retained store the busiest thing in the process.

`aedes.publish` is used rather than a loopback client: the packet goes through the same retained
store and subscription matching a connected client's publish would, so the relay's own messages
are not a second code path.

## `hidden` is omitted, not set to `false`

`SensorMeta` has the field and LHM's `ISensor` has `IsDefaultHidden`, but `/data.json` does not
carry it. `hidden: false` would be a claim, and a sensor picker would trust it. Absent means
unknown.

## The WebSocket default is 9001, restated rather than imported

`packages/sensor-sources/src/relay-endpoint.ts` already contracts `RELAY_WEBSOCKET_PORT = 9001`
and the dashboard connects there, so the relay must default to it. The number is nonetheless
written out again in `apps/agent/src/config.ts`, with a comment pointing at both that file and
this section, because neither way of sharing it is available:

- ARCHITECTURE.md gives `apps/agent` exactly one dependency edge, to `sensor-contract`. Importing
  from `sensor-sources` would add a second.
- Moving the constant into `sensor-contract` would break that package's SPEC rule 3: the contract
  carries no transport knowledge. A port number is transport.

A test asserts the value, so the duplication is checked rather than merely hoped about.

## No authentication, `0.0.0.0` by default

`aedes`'s defaults: any client connects, every publish and subscribe is authorised. The human's
answer was "unrestricted for now". Binding all interfaces is what lets the dashboard run on a
different machine from the relay, which is the normal case here — the relay's home is the Windows
host and the browser is elsewhere. `--bind-host 127.0.0.1` narrows it to one machine without a
code change, and that flag exists precisely so the posture is a flag away rather than a rewrite.

Recorded here and in the README rather than left to be discovered.

## Port 0 means "ask the OS", and the bound port is what gets reported

`--mqtt-port 0` binds a free port instead of failing. The startup line reports the port actually
bound, from `server.address()`, never the `0` that was requested — printing the request would be
worse than printing nothing, because a browser needs the real number. Every test binds on 0,
which is not only convenience: a Homebrew Mosquitto on the development machine holds 9001 on all
interfaces, so a test that asked for the default port would either fail to bind or, far worse,
pass by talking to *that* broker and prove nothing about this code. The README says the same
thing for dev runs.

## Startup fails loudly rather than half-starting

If either listener cannot bind, `startEmbeddedBroker` closes whatever it already opened and
rejects with the host and port in the message; the CLI exits 1. A relay listening on MQTT but not
WebSockets would serve `mosquitto_sub` perfectly while the dashboard — the actual product — could
not connect, and every log line would look healthy.

## Ticks never overlap

The loop chains `setTimeout` after each poll finishes rather than using `setInterval`. With an
interval, a poll slower than the period overlaps the next one and two snapshots race to publish
with `at` out of order, which a staleness check downstream cannot recover from. The first poll
runs immediately, so a human starting the relay learns within a second whether it can reach LHM.

## Configuration precedence: CLI, then environment, then default

Three layers, and the resolver is pure — it reads neither `process.argv` nor `process.env`, both
of which arrive as arguments, which is why the precedence itself is unit-tested rather than
inferred. `main.ts` is the only file that touches `process` at all.

A *rejected* CLI value is an error, not a fall-through to the environment or the default. If
someone typed `--lhm-port banana`, silently polling 8085 is worse than refusing to start: the
relay would appear to work while ignoring what it was told. Exit 2 for a bad command line, the
conventional usage code, and one message per distinct problem — a command line with one thing
wrong must not produce two rejections, which is why the "ports must differ" check only runs when
nothing else has already failed.

Numeric parsing is strict: `0x1f91`, `1e3`, `8085.0`, `80abc`, `+8085` and whitespace are all
rejected rather than coerced. `Number()` would accept most of them and `parseInt` would accept
`80abc` as 80, which is a listener on the wrong port with no error anywhere.

`localhost:8085` is the default because the relay's eventual home is the Windows host running
LHM, where the source is local. The live instance during development is `192.168.1.3:8085`, which
is what `--lhm-host` is for.

## Evidence

Built, tested and linted; test counts and the round trip below are measured, not asserted.

### Round trip through the embedded broker, captured with `mosquitto_sub`

Relay on overridden ports (`--mqtt-port 11883 --ws-port 19001`), polling a real HTTP endpoint
serving `fixtures/lhm-data.sample.json`, with `/opt/homebrew/bin/mosquitto_sub -t 'sensors/#' -v`
subscribing for three seconds:

```
lines received:  853      # 213 retained meta + 3 ticks x 213 readings, + mosquitto_sub's own
distinct topics: 426      # "Timed out" line at the end of the window
meta topics:     213

sensors/cpu/0/temperature/2 {"value":68.1,"at":1789961344029}
sensors/cpu/0/temperature/2 {"value":68.1,"at":1789961345052}
sensors/cpu/0/temperature/2 {"value":68.1,"at":1789961346079}
sensors/cpu/0/temperature/2/meta {"label":"Core (Tctl/Tdie)","vendor":"amd"}
sensors/embedded-controller/0/temperature/1 {"value":null,"at":1789961344029}
sensors/embedded-controller/0/temperature/1/meta {"label":"T Sensor"}
sensors/gpu/0/load/3 {"value":11.9,"at":1789961344029}
sensors/gpu/0/load/3/meta {"label":"GPU Memory","vendor":"nvidia"}
sensors/gpu/0/throughput/0 {"value":6699008,"at":1789961344029}
sensors/gpu/0/throughput/0/meta {"label":"GPU PCIe Rx","vendor":"nvidia"}
```

Every decision above is visible in those ten lines: 213 topics for 214 sensors, the meta
companion once against three readings, `null` for the unpopulated header, `GPU Memory` holding
the contested topic, and `6699008` rather than `6.4` for throughput.

### Live hardware: reached earlier in the session, down when the relay was ready

`http://192.168.1.3:8085/data.json` answered `200` with 59 769 bytes when it was checked at the
start of this work. By the time the relay could be pointed at it the host was off: the relay
logged

```
[error] poll failed: GET http://192.168.1.3:8085/data.json failed: no response within 1500 ms
[error] poll failed: GET http://192.168.1.3:8085/data.json failed: fetch failed
        (connect EHOSTDOWN 192.168.1.3:8085 ...)
```

and `ping` reported 100 % loss, `curl` failed to connect. **So a live poll through the relay was
not captured, and the round trip above is against a local HTTP server serving the captured
payload — real sockets and a real broker, but not live hardware.** Worth noting that this is the
failure path doing exactly what it is supposed to: the broker stayed up, nothing was published,
and the reason was named on every attempt.

### Two bugs the tests caught before any of this ran

Both were real and both would have been hard to find later:

1. **`ws` re-emits the HTTP server's `error` on the `WebSocketServer`.** A failed `listen`
   therefore arrived twice — once where `listen()` was waiting for it, once on an emitter with no
   handler, which in Node is an uncaught exception. The caller hung instead of being told the
   port was taken. Fixed with handlers on both emitters.
2. **`net.Server.close()` never calls back while a client holds a socket.** It stops accepting
   and then waits for existing connections to end on their own, and an MQTT client holds its
   socket open by design. `http.Server` has `closeAllConnections()` for this; `net.Server` has no
   equivalent, so live sockets are tracked and destroyed on shutdown. Without it the relay would
   not exit on Ctrl-C for as long as one dashboard tab was open.

No screenshots: the relay has no visible surface. Its output is MQTT messages, and they are
captured above.

## The lockfile is deliberately left unreconciled

`apps/agent/package.json` now declares `aedes`, `ws`, `mqtt` and `@types/ws` at the ranges
already present in the root manifest, per the convention every other workspace follows.
`package-lock.json` was **not** regenerated, because `npm install` is forbidden for the duration:
another worker is live in this checkout and a second install would corrupt the shared lockfile.
Nothing was added, upgraded or installed — every one of those four packages was already present
in `node_modules` and in the root manifest. Someone should run a single `npm install` once the
concurrent work has landed.

## Measured lanes

Whole repo, after this change, with the concurrent workers' files untouched:

```
npm run build -w @perch/agent                        EXIT=0
npm test -w @perch/agent                             EXIT=0   118 tests passing
eslint apps/agent --max-warnings 0                   EXIT=0
prettier --check apps/agent/**                       EXIT=0

npm run build                                        EXIT=0
npm run typecheck   (tsc -b && tsc -p tests)         EXIT=0
npm run lint                                         EXIT=0
npm test                                             EXIT=0   892 tests passing
```

892 across the eight workspaces: layout-schema 334, sensor-contract 260, agent 118, ui-kit 84,
sensor-sources 75, runtime 16, editor 3, caster 2.

One lint suppression, in `relay.test.ts`: `prefer-promise-reject-errors`, because rejecting with a
non-`Error` is the case under test — `fetch` and its dependencies can throw anything, and the
relay has to report it rather than log `[object Object]`. Reason on the same line, as the rule for
suppressions requires.

---

# The React ui-kit and the Vite runtime page — decisions

Two steps, one pass: `packages/ui-kit` rewritten as real React, and `apps/runtime` moved onto Vite
with the temporary harness retired. The brief for it was blunt about the bar — *"there's no
'porting' because no work exists yet. things just need to be written correctly, properly, using all
the tools"* — so nothing below adapts the imperative `createReadout` / `installSensorProvider`
surface. It is deleted. What survives is the one thing that deserved to: `readoutView()`, which was
already a pure function of a snapshot.

## 1. Three files, not one: store, context, view

The old provider did four jobs in one module — held state, owned the subscription, computed
staleness, and was itself a global. The replacement splits along what each part is allowed to know:

| File | Knows about | Deliberately does not know about |
|---|---|---|
| `sensor-store.ts` | topics, readings, clocks, staleness | React |
| `sensor-context.tsx` | React, one store, its lifecycle | what a readout is |
| `readout-view.ts` | a snapshot and a metric → strings | React, the DOM, the clock |
| `readout.tsx` | React and the view model | transport, the store's internals |

The payoff is that the two hardest things to test are testable without the other: staleness is 30
tests over a fake clock with no renderer, and every string a readout can print is a pure-function
test with no clock. Dataflow runs one way through all four — source → store → context → hook →
component — and no component can reach back, because nothing below `sensor-context.tsx` exports
anything that takes a source.

## 2. The singleton is gone, and that is the substantive change

`installSensorProvider()` / `currentSensorProvider()` were module-level mutable state. Concretely
what that cost: two sources in one page were unrepresentable, test isolation depended on
re-installing the global between cases, and the "provider" a widget read was whichever one had
installed itself last — a data race written as an import.

`<SensorProvider source={…}>` has none of those properties, and `apps/runtime/src/app.tsx` proves
it by **nesting a second provider with a different source and a different staleness threshold**
around exactly one tile. That page cannot be written at all against the old surface. There is now
zero module-level mutable state in `packages/ui-kit`.

## 3. `useSyncExternalStore`, and why snapshots are published rather than computed

`useSensor(topic)` is `useSyncExternalStore(subscribe, getSnapshot, getSnapshot)`. That hook
requires `getSnapshot` to return a **referentially stable** value between changes — computing
`{ state: 'live', reading, ageMs }` on each call returns a fresh object every time and React spins.

So the store keeps a `published` map: `computed()` derives a snapshot, `publish()` compares it to
the published one with `materiallySame()` and only replaces it if it materially changed.
"Materially" is doing real work there — a `live` reading's age changes every millisecond and no
reader cares, so `live` compares by reading identity alone, while `stale` compares by whole seconds
because the widget prints `stale 3s`. Without that, a 1 Hz sensor would re-render every widget
bound to it on every clock recheck.

`getServerSnapshot` is the same function. There is no server, and `waiting` is the honest answer to
"what did the server render".

## 4. `open()` / `close()` in an effect, idempotent on purpose

The provider subscribes in `useEffect` and unsubscribes on teardown. `open()` is
`unsubscribeSource ??= source.subscribe(...)` and `close()` clears it — both idempotent, both
reversible. StrictMode double-invokes effects in development precisely to catch a subscription that
cannot survive mount → unmount → mount, and `apps/runtime/src/main.tsx` renders under
`<StrictMode>` so that check is actually running.

**Exactly one subscription per provider, owned by the provider.** A widget never subscribes to the
source; it subscribes to the store, per topic. Eight readouts on the page produce one source
subscription and eight store listeners.

## 5. `useMemo` for the store, not `useRef` — forced, and worth recording

The first draft held the store in a `useRef` with a hand-rolled options comparison.
`eslint-plugin-react-hooks` 7 ships `react-hooks/refs`, which forbids reading `ref.current` during
render; the store is needed *during* render, so that draft produced seven lint errors and the
comparison function came out with it.

`useMemo` keyed on the option list is not a semantic guarantee — React may discard a memo. The
honest consequence: if it ever does, a new store is built, the effect re-syncs it, and the page
shows `waiting` for at most one publish interval. That is a flicker, and the alternative was
paying for it with a lint rule that exists to catch real tearing bugs.

## 6. The readout's states are a four-member discriminated union

```ts
type ReadoutState =
  | { readonly kind: 'waiting' }                                        // nothing has arrived
  | { readonly kind: 'no-reading' }                                     // present, reporting null
  | { readonly kind: 'value'; readonly value: number }
  | { readonly kind: 'stale'; readonly value: number | null; readonly ageMs: number };
```

Two distinctions the union makes that a string enum could not. A `value` carries a `number`, so
"live but I have no number" is unrepresentable rather than a runtime check. And `waiting` and
`no-reading` are different states with different meanings — "not reporting yet" and "reporting
nothing" — which the page shows side by side deliberately, because conflating them is how a
disconnected sensor looks identical to a dead broker.

**Adding a fifth member is three compile errors, and this was verified rather than asserted.** With
a fifth member added temporarily, `tsc` exits 2 with exactly:

- `readout-view.ts(62,7)` TS2741 — `READOUT_STATE_KIND_PRESENCE`, typed
  `Readonly<Record<ReadoutStateKind, true>>`, is missing the new key. This exists so
  `READOUT_STATE_KINDS` is provably the whole enumeration rather than a hand-kept list.
- `readout-view.ts(237,26)` TS2345 — `describe()`'s `assertNever(state, 'readout state')`.
- `readout.tsx(130,26)` TS2345 — `toneOf()`'s `assertNever(state, 'readout state kind')`.

And a fourth `SensorSnapshot` state fails at `readout-view.ts(169,26)` — `readoutState()`'s
`assertNever` — plus four narrowing errors in `materiallySame`. Both probes reverted; `tsc -b
--force` clean after. Log: `.evidence/exhaustiveness-probe.log`. The accurate claim is *three
enforcement points for `ReadoutState` and one for `SensorSnapshot`*, not "one per state".

## 7. `data-tone` exists because CSS has no exhaustiveness check

The protected property of the old DOM readout was that an update rewrote text and one attribute —
no structural change, no geometry change, so an update cannot reflow. That property is kept:
`data-state` and `data-tone` are both colour-only, and `readout.test.tsx` asserts the styles contain
no `:hover`, `:focus`, `transition` or `animation`.

`data-tone` is a second attribute on purpose. Severity is decided in TypeScript by `toneOf()`, an
exhaustive switch, rather than by four more `[data-state=…]` selectors — because a new state with no
CSS rule renders **unstyled**, and a stylesheet cannot be made to fail a build. Deciding it in the
switch turns that into error 3 in decision 6.

## 8. The label-width defect, fixed in both halves

The reported defect: with no metadata the readout falls back to the raw topic
(`sensors/psu/0/voltage/0`, the longest string on the page), and in the old
`grid-template-columns: max-content max-content` layout that label spanned both tracks — so it
contributed its max-content width to **track sizing**, setting the width of the whole widget.
`overflow: hidden` cannot help with that; a spanning item's max-content width sizes the tracks
whatever you do to its overflow. So the grid went:

- **Widget half:** flex column, `min-width: 0`, label and note both `white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis` with a **fixed height** and matching `line-height`, so
  the note appearing or disappearing cannot change the widget's height either.
- **Page half:** `.perch-tile { min-width: … }` — a flex item defaults to `min-width: auto`, which
  is max-content, so the container would have refused to be narrower no matter what the widget did.

Confirmed at panel aspect, which is what the 1920×400 capture is actually for: all eight tiles
report `tileWidth: 216` with the raw-topic tile among them, and `labelClipped: true` appears on a
*different* tile (`Pump Header (not connected)`). The long label ellipsises instead of widening its
tile. `.evidence/capture-report.json`, first entry.

## 9. Two defects the captures found that the tests could not

Both were invisible to 100 passing tests, because jsdom has no layout engine and reports every
geometry question as fine. Recording them because they are the argument for the capture rule.

**At 1440×900, values painted over the next tile.** Eight tiles across 1440px are ~160px each, and a
3.5rem `1448` plus `RPM` is wider than that — it overflowed into the neighbouring tile, so two
readings were unreadable at once. Two changes: `.perch-readout__primary` is now `overflow: hidden`
with the value ellipsising (a *containment guarantee* — a starved widget must look starved, not
spill), and `#perch-strip` wraps at a `13rem` tile floor instead of shrinking without limit.
Ellipsis rather than a bare clip, because a clipped numeral silently reads as a smaller number:
`55.97` → `55.9` is wrong where `55.9…` is visibly incomplete.

**Then the panel row wrapped, from `box-sizing`.** The `13rem` floor was content-box, so 34px of
padding and border landed on top of it and eight tiles no longer fitted 1920 — the clean single row
became 7 + 1. `box-sizing: border-box` on the tile restored it.

**And the value size is now measured, not chosen.** With the containment fix in place the 1920
capture showed `10…` where `1094` belonged: at 3.5rem a four-digit value with a unit needs ~189px
and eight tiles across 1920px give 182px. The default is `3rem`, which fits with margin at both
sizes; final captures report no clipped or spilling value at either viewport. A layout-driven type
scale is the real answer, and it arrives with `layout-schema`.

## 10. A fluid canvas, not the letterboxed one the README describes

`apps/runtime/README.md` specifies a fixed canvas scaled to fit, letterboxed. The page does not do
that yet, deliberately: a letterboxed canvas renders *the same layout at two scales*, which would
make the two-viewport capture matrix a formality. Fluid, a browser tab and a 1920×400 viewport
produce genuinely different geometry — which is how decision 9 was caught at one size and its
regression at the other. Half-implementing windowed and capture mode before layouts exist would
also have to be undone.

## 11. Retiring the harness

Deleted: `dev-harness.html`, `src/dev-harness.ts`, `tools/serve.mjs`, `tools/capture.mjs`, the
now-empty `tools/`, and the hand-maintained import map. Also the stale `dist/` and
`tsconfig.tsbuildinfo` left behind by it.

The harness existed for one reason: `tsc -b` emits import specifiers untouched, so a browser is
asked for `@perch/ui-kit` and cannot resolve it. The map answered that by pointing each package at
its emitted `dist/index.js`, which meant the browser ran one build behind the source and adding a
package meant editing HTML. Vite resolves workspace packages from source through `perchAliases` —
**the same table Vitest uses, imported from `vitest.aliases.js` rather than restated**, so the page
and the tests cannot disagree about what `@perch/ui-kit` means.

What the harness proved was kept and is now in the page itself: live rendering from an injected mock
source, every state driven rather than waited for, and real captures. The capture tooling moved
*out* of the package to `.evidence/capture-runtime.mjs` (untracked) — it is evidence machinery, and
`apps/runtime` should not ship a dependency on Chrome's debugging protocol.

Three configuration choices worth their line: `build.outDir` is `dist/page`, because `tsc -b` owns
`dist/` and Vite empties its `outDir` — pointed at `dist` it deletes the TypeScript build output
and the failure surfaces as a broken project reference somewhere else. `server.strictPort` is true,
because a dev server that helpfully moves to 5174 turns a capture into a screenshot of whatever else
is on 5173. And `sourcemap` is on, because the only way this page is ever looked at is a real
browser.

## 12. Vite 7 everywhere

Settled by the human: **the repo is on Vite 7.** `apps/runtime` and `apps/editor` declare
`vite@^7.3.6` with `@vitejs/plugin-react@^5.2.0`, already installed, and that is the sanctioned
major rather than a provisional choice. The root `package.json` still declares `^6.4.3` for Vitest;
aligning it is authorized bookkeeping that rides with the next `npm install` and was explicitly not
mine to do — a second `npm install` in this checkout would corrupt a lockfile another live worker is
sharing. `@vitejs/plugin-react` 6 requires Vite 8 and collides with Vitest 3's Vite, so 5 with 7 is
the pairing, not the newest of each. This supersedes the "two Vite majors" hedge in the earlier
section and in `CALL_SITES.md`.

## 13. An HTML comment cost the dev server, and the fix is a comment about comments

Serving the page for the first time exposed something no test would have: Vite injects its dev
client and the react-refresh preamble after the **first literal `<head>` in the file**, and
`index.html`'s explanatory comment contained that tag name as prose. The injected scripts landed
*inside the comment*. The app still mounted, so the page looked fine — but the preamble never ran,
and the React plugin then threw. `index.html` now spells it out and says not to write that tag name
in the comment. (Its sibling hazard is the same class of thing: a CSS comment inside a template
literal cannot contain a backtick, which broke `app.tsx` mid-session.)

## 14. The false `file://` claim, corrected

The old README said module scripts "do not load over `file://`". True, but it understated the
failure in the way that matters: the page renders **nothing and reports nothing** — a blank page,
no exception, no console error. Someone debugging that looks at their code for a long time. Both
`README.md` and `index.html` now say the failure is silent and to check the URL scheme first.

## 15. Manual Testing Library cleanup

Vitest `globals` are off in this repo, so `@testing-library/react`'s automatic `afterEach(cleanup)`
is never registered — it hooks a global `afterEach` that does not exist. The symptom is 11 tests
failing with "Found multiple elements", because each test inherits the previous test's DOM. Both
jsdom setups now call `cleanup()` in an explicit `afterEach`, with a comment saying why it is manual.
A new jsdom workspace must do the same.

## Underspecified in the specs, found while building

1. **`apps/runtime/README.md` describes a runtime this page is not.** Windowed/capture modes, the
   ready signal and the standalone bundle are all specified; none exist. The README now separates
   "the page today" from that, but the ready signal in particular is the thing the spec calls
   expensive to retrofit and it is still unbuilt. The page emits a `data-perch-ready` attribute on
   the footer as a placeholder — one reading arrived, nothing about fonts or assets.
2. **Nothing specifies what a readout does with a `null` value.** `SENSOR_METRIC_UNITS` and the
   nullable reading are both specified, but not the rendering. This change decides: a live `null` is
   `no-reading` printing `n/a`; a **stale** `null` stays `stale`, because how old the nothing is
   remains information. That belongs in a `packages/ui-kit/SPEC.md` — which does not exist. `ui-kit`
   has a README and no SPEC, where `layout-schema`, `sensor-contract`, `agent`, `caster` and `editor`
   all have one. (`sensor-sources` has none either.)
3. **Staleness recheck cadence is unspecified.** `DEFAULT_STALE_AFTER_MS` is specified as
   overridable; the interval on which a store *notices* is not. It is `min(1s, staleAfterMs / 2)`,
   which means a reading is reported stale at the first check after it ages out, not at the instant
   it does — up to a second late, and a test written against the instant will fail. Worth stating
   because the panel's frame budget makes a faster poll a real cost.
4. **No spec says which metrics get how many decimals.** `READOUT_DECIMALS` is a table in `ui-kit`
   with a default of 1, and it is a display decision that arguably belongs to the layout, not the
   widget. It will collide with `layout-schema` once elements carry style.
5. **The widget/page boundary for width has no owner in writing.** The defect in decision 8 needed a
   change in *both* packages, and nothing said which one owed the fix. The rule this change adopts:
   a widget never demands width and must contain its own text; a page must grant a legible minimum.
   That sentence is missing from `apps/runtime/README.md`, and `ui-kit` has no SPEC to put it in.

# Closing the pipeline: the dashboard reads the relay — decisions

Scope of this change: the page reads real readings over MQTT from the broker the relay
embeds, *when it is told to*, and the relay's port collision prints the way out. No new
dependency, no version change, and no source change in any `packages/*` — the diff is
three files in `apps/agent`, four in `apps/runtime`, and docs.

Evidence for the claims below, all in `.evidence/mqtt/` and untracked:
`mqtt-capture-report.json` with `mqtt-1920x400-t1.png`, `-t2.png`, `mqtt-1440x900-t2.png`
and the two `t3-relay-killed` frames; `mock-capture-report.json` with the two `mock-*`
frames; `eaddrinuse-before.log` against `eaddrinuse-after.log` and
`eaddrinuse-after-wsport.log`; `broker-tests-red.log` before `broker-tests-green.log`.
The relay, the embedded broker, the MQTT transport and the browser are real in all of it.
The **sensor host is replayed**: the live LibreHardwareMonitor machine at
`192.168.1.3:8085` is powered off, so `lhm-replay-server.mjs` serves
`fixtures/lhm-data.sample.json` — a verbatim capture of that machine's `/data.json` — and
the relay polls that. No capture here shows live hardware.

## 1. The seam is conditional on an explicitly set variable, not on a truthy default

`PERCH_BROKER_URL` set selects `createMqttSource`; unset keeps `createMockSource`. The
gate is not `if (url)` but `resolveBrokerUrl(...).origin === 'env'`:

```ts
const resolved = resolveBrokerUrl({
  env: { [RELAY_BROKER_URL_ENV_VAR]: import.meta.env.PERCH_BROKER_URL },
});
if (resolved.origin !== 'env') return { source: createMockSource(), identity: { kind: 'mock' } };
```

Two reasons for going through the resolver rather than reading the string directly.
First, `resolveBrokerUrl` already owns trimming, `ws:`/`wss:` validation and the
`TypeError` naming the variable on a malformed *present* override; a second
implementation in the page would be a second set of bugs. Second, `origin` makes the
distinction the page actually needs: the resolver's built-in `ws://localhost:9001` is a
documented trap on this machine — a Homebrew mosquitto answers there, accepts the
subscription and delivers nothing — so "default" must never select MQTT. `npm run dev`
with no hardware and no environment stays a mock page, which is the state the sensor host
is in most days.

## 2. `envPrefix` plus a narrow `ImportMetaEnv`, which are two halves of one mechanism

Vite exposes only prefixed variables to client code, so `apps/runtime/vite.config.ts`
sets `envPrefix: ['VITE_', 'PERCH_']`. `PERCH_` because the relay's entire configuration
surface is already `PERCH_*` and `dev:stack` sets those once for both processes; a
`VITE_PERCH_BROKER_URL` alias would mean the same value under two names. `VITE_` is kept
so the convention still works.

Vite reads matching variables from the shell as well as from `.env` files, which is what
makes `PERCH_BROKER_URL=... npm run dev` work with no file on disk — verified in the
browser, not merely in Node: the captured frames were taken from a Chrome session that
printed `mqtt · ws://localhost:19001` in the page.

The typing is `apps/runtime/src/vite-env.d.ts`, declaring exactly one optional readonly
string, rather than the usual `/// <reference types="vite/client" />`. That reference
brings in an `ImportMetaEnv` with an `any` index signature, which would silently make
every `import.meta.env.X` an `any` under rules that forbid one.

## 3. The page states which source it is reading, in the page

A header line — `mqtt · ws://localhost:19001` or `mock data · generated here, not
hardware` — plus `data-perch-source-kind` for a capture script. Not a console line: the
mock and the relay look identical at a glance, both plausible, moving and correctly
labelled, and mistaking one for the other means trusting a temperature invented by a
seeded PRNG.

The URL is shown, not just the word `mqtt`, because on a developer machine the expensive
failure is connecting to the *wrong* broker on the right-looking port, and the port is
the only thing that distinguishes them.

`Dashboard` takes this as a prop (`LiveSourceIdentity`) rather than sniffing the source.
`SensorSource` deliberately exposes no transport, and a page that guessed by looking for
an MQTT-shaped field would be wrong the first time a third implementation appeared.
`main.tsx` knows because `main.tsx` chose. Construction stays in `main.tsx` alone; the
tests keep injecting their own seeded sources and pass an identity explicitly.

## 4. All four statuses get their own sentence, and colour is never the only signal

`SOURCE_STATUS_WORDING` maps each `SensorSourceStatus` to a distinct phrase, because each
one calls for a different action: `connecting` = give it a second, nothing has failed;
`live` = believe the numbers; `stale` = the transport is fine and the *publisher* stopped
(relay up but not polling, or LHM gone behind it); `error` = the link itself is down
(wrong port, relay not running, machine asleep). A single "no data" for the last three
would be worse than printing the raw status code. A test asserts the four stay distinct.

The badge is words plus colour, never colour alone — this page is read from across a room
by whoever walks past, and a red dot is not a sentence.

The page does not poll for this. `SensorProvider`'s store republishes status on its
recheck interval, so a relay killed with the page open reaches `error` in about a second
with nothing in `app.tsx` watching a clock.

## 5. The heartbeat moved to `cpu/load`, and the tiles were retuned to the real topic sets

Found empirically over real MQTT, and this is the finding of the change: the page's topics
were mock-shaped. `sensors/cpu/0/temperature/0` **does not exist** in the captured
hardware payload — that machine's first CPU temperature is sensor index 2, "Core
(Tctl/Tdie)" — and neither do `gpu/0/fan/0`, `cooler/*`, `psu/voltage`, `storage/1/*` or
any `memory` device. LibreHardwareMonitor indexes what it finds, and what it finds is not
the mock's tidy set. Left alone, the footer read `last published never` and
`data-perch-ready` stayed `false` on a page that was in fact receiving 213 readings a
second. A heartbeat that can be silent while the link is healthy is worse than none.

So `HEARTBEAT_TOPIC` is `cpu/load`, and the captions say which source can fill each tile:
three `live ·` tiles are the mock/hardware intersection (`cpu/load`, `cpu/power`,
`cpu/factor`), two are `mock only ·`, and one is `hardware only ·`. A caption reading
`live` on a tile only one source publishes would be a lie in half the runs.

## 6. One `hardware only` tile, because the mode needs a tell that cannot be faked

`gpu/throughput` is on the page for a reason beyond decoration: the relay reads LHM's
`RawValue`, so throughput arrives as bytes per second — the capture shows `6699008 B/s`,
labelled "GPU PCIe Rx" — where LHM's own display field says `6.4 MB/s` and loses the unit
on the way. The mock does not publish `throughput` at all, so a value there is proof the
MQTT path is the one running, and the mock deliberately stays empty rather than filling
the one reliable tell with a plausible number.

## 7. The frozen tile stays a mock in both modes, and says so where it is read

A real relay cannot be asked to die on cue to demonstrate the stale rendering, so the
second source is `createMockSource` whether or not the first is MQTT. That makes it the
only invented number on screen when the page is reading hardware, so its caption is
`stale · mock publisher stopped` rather than `stale`. The alternative — dropping the tile
in MQTT mode — would mean the stale rendering has no capture at all.

## 8. The port collision prints flag, variable, a port to type, and nothing it cannot know

`portInUseGuidance(setting, port)` is a pure function built from the same `RELAY_CLI_FLAGS`
and `RELAY_ENV_VARS` tables the parser uses, so the advice cannot drift from the parser.
It names the flag, the variable, `port + 10000` as a concrete suggestion, and `--flag 0`
as the always-available answer. `suggestedListenPort` degrades to `0` above 65535 instead
of printing a port number that cannot exist.

Three deliberate limits:

- **Only on `EADDRINUSE`**, tested via `'code' in error && error.code === 'EADDRINUSE'`
  (the `in` operator narrows; no cast, and the standing rules forbid `any`). A bad
  `--bind-host` fails with `EADDRNOTAVAIL`, where advice about ports would be confidently
  wrong, and wrong advice costs more than none. A test asserts the non-collision message
  contains no flag.
- **The WebSocket case also names `PERCH_BROKER_URL`**; the MQTT case must not. Moving the
  WS listener and not the page silently breaks the browser, which dials the port it was
  told to — trading one afternoon of confusion for another. `--mqtt-port` has nothing to
  do with the page, and a message that said otherwise would send someone editing the
  wrong thing.
- **The defaults do not move.** 1883 is the registered MQTT port and 9001 is what
  `packages/sensor-sources/src/relay-endpoint.ts` contracts, so the message says *why*
  it is not offering to change them.

`DASHBOARD_BROKER_URL_ENV_VAR = 'PERCH_BROKER_URL'` is restated in `apps/agent/src/config.ts`
rather than imported, for the same reason 9001 already is: ARCHITECTURE.md gives
`apps/agent` exactly one edge, `sensor-contract`, and `RELAY_BROKER_URL_ENV_VAR` lives in
`sensor-sources`, the browser's package. A string two packages agree on is a cheaper
coupling than a dependency edge existing only to carry it.

## Found while building, and left alone

1. **A seven-digit value is clipped in a tile at both viewports.** `6699008 B/s` renders
   as `669…` on screen; the full figure is in the DOM and in the probe reports. That is
   `Readout`'s documented clipping backstop working as designed — the tile never overflows
   and never widens its neighbours — but it means the mode tell is legible to a script and
   not to a reader. Fixing it properly is widget work (fit-to-width, or a display-unit
   scale in `ui-kit`), and it would touch `packages/ui-kit`, which this change deliberately
   does not. Recorded rather than half-fixed.
2. **The mock's topic set is not a subset of any real machine's.** Decision 5 worked around
   it on this page, but the general problem stands: `createMockSource` invents device
   indices LHM does not produce, so any layout authored against the mock can be silently
   empty against hardware. That belongs to `layout-schema` validation or to a mock built
   from a captured payload; neither exists.
3. **Nothing specifies what the page shows for `status`.** The four sentences in
   `SOURCE_STATUS_WORDING` are a product decision made here because the page needed one.
   `sensor-contract` specifies the four states and `ui-kit` has no SPEC, so there is no
   file that owns the wording a user reads.

# Taking the toolchain to the latest versions the ecosystem allows — decisions

The instruction was "the latest possible versions of everything, all dependencies." Five
majors moved at once, so this was treated as a migration and researched before anything was
installed. Every number below was measured, not read off a changelog.

Measured against `1e4ec6c`: **909 tests before, 909 after**, and `build`, `typecheck`,
`test`, `lint` and `format:check` each exit `0` both before and after. **No source file
changed** — the entire diff is three manifests plus a regenerated lockfile. An earlier
baseline of 892 in the brief was taken at `32218d6`; the difference is the runtime and agent
work committed between those two commits, not this change.

## 1. What moved, and what it resolved to

```
typescript            5.9.3  -> 6.0.3
vitest                3.2.7  -> 5.0.1
vite                  7.3.6  -> 8.3.0      root, runtime, editor: one installed copy
@vitejs/plugin-react  5.2.0  -> 6.1.1
jsdom                26.1.0  -> 30.1.0
@types/node         22.20.4  -> 26.6.2
```

Everything else the sweep covered was **already at latest** and was verified rather than
assumed: `react` and `react-dom` 19.3.0, `prettier` 3.9.8, `typescript-eslint` 8.70.0,
`eslint-plugin-react` 7.37.5, `eslint-plugin-react-hooks` 7.1.1, `eslint-config-prettier`
10.1.8, `globals` 17.12.0, `mqtt` 5.16.0, `aedes` 1.2.0, `ws` 8.21.3, `@testing-library/react`
16.3.3, `@testing-library/jest-dom` 7.0.1, and the `@types/*` for react, react-dom and ws.

## 2. TypeScript stops at 6.0.3, because TypeScript 7 ships no compiler API

`typescript@7.0.2` is the native port, and it does not carry the JavaScript API that tooling
builds programs with. Installed and inspected rather than inferred: the `typescript`
entrypoint resolves to `lib/version.cjs`, the package exports exactly `version` and
`versionMajorMinor`, `createProgram` is `undefined`, and `lib/typescript.js` does not exist.
Everything else is behind explicitly-named `unstable/*` entrypoints.

So `typescript-eslint` cannot run on it. That is not a conservative peer range — there is no
API to call. Every `typescript-eslint` release caps `typescript` at `<6.1.0`, including the
`canary` (`8.70.1-alpha.28`), and its TS 7 support is tracking issue #10940, still open, with
no linked implementation and async-parser support in ESLint core named as a blocker.

`6.0.3` is a stable release, it sits inside `>=4.8.4 <6.1.0`, and it keeps the full API
(2248 exports, `createProgram` present). So the ceiling is 6.0.3, not 5.9.3 — a real gain
rather than a stalemate.

Worth recording for whoever revisits this: **`tsc` 7 itself is fine.** A probe config with all
of this repo's strict flags — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitReturns`, `noPropertyAccessFromIndexSignature`, `noUncheckedSideEffectImports`,
`erasableSyntaxOnly`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
`verbatimModuleSyntax` and the rest — compiles clean under 7.0.2. The blocker is the API that
type-aware linting needs, nothing about the flags. When typescript-eslint can consume tsgo,
this stops being a choice.

## 3. Nothing was relaxed to buy the green, and that was checked rather than asserted

No strict flag was touched, no `eslint-disable` added, no test skipped or deleted, and
`--max-warnings 0` is untouched. Because "the checks still pass" is worth nothing if the
checks quietly stopped checking, each tier was probed with code that must fail:

- `noUncheckedIndexedAccess` still reports a `Record` read as `string | undefined` (TS2322).
- `exactOptionalPropertyTypes` still rejects an explicit `undefined` (TS2375).
- `types: []` still withholds the DOM lib from a package project (TS2584).
- Type-aware ESLint still fires: `@typescript-eslint/no-floating-promises` and
  `strict-boolean-expressions` both reported. These need a built program, so they prove the
  type information survived the TypeScript bump.
- The React tier still fires: `react-hooks/rules-of-hooks` and `react/jsx-key` both reported.

The probe files were removed; they exist in the captured logs, not in the tree.

## 4. Vite 8 is the one change here with behavioural risk

The other bumps are version numbers. Vite 8 replaces Rollup with **Rolldown** and esbuild with
**Oxc**, so what actually produces `dist/page` is different code. `esbuild` leaves the
dependency tree entirely. The runtime page builds (34 modules) and its tests pass, and Vite 8
emits one advisory about `build.rolldownOptions.output.codeSplitting` which is informational
and was not acted on.

Nothing in `apps/runtime/vite.config.ts` needed changing: `resolve.alias` as a plain string map,
`envPrefix`, `build.outDir`, `build.sourcemap` and `server.strictPort` all carry over. Only
`resolve.alias[].customResolver` was deprecated, which this repo does not use.

## 5. The Vite constraint is gone, and the two-majors defect with it

Earlier notes recorded an open item: `vite@6.4.3` at the root for Vitest and `vite@7.3.6` under
`runtime` and `editor`, because Vitest 3 pinned its own Vite and `@vitejs/plugin-react` 6
required Vite 8. **That constraint no longer exists.** Vitest 5 peers `vite: ^6.4.0 || ^7.0.0
|| ^8.0.0` and plugin-react 6 wants `^8.0.0`, so they agree on 8.

`vite` is now declared at the root as well — Vitest 5's `vite` peer is non-optional — and that
declaration is what dedupes the tree. `npm ls vite` shows a single `vite@8.3.0` for root,
`runtime`, `editor` and `@vitest/mocker`. The open item is closed.

## 6. ESLint stays at 9, and that is a decision for the human rather than a limit

> **Superseded.** The question below was put to the human and answered: take ESLint 10 with the
> override. The measurements here still stand, but the outcome is now the opposite of the one this
> entry records. See "Taking ESLint to 10 by overriding a peer range" below.

`eslint@10.11.0` is blocked by `eslint-plugin-react@7.37.5`, which is the latest release — the
only higher `dist-tag` is `next`, an ancient `7.8.0-rc.0` peering ESLint `^3 || ^4`. Its peer
range stops at `^9.7`, so a plain install fails `ERESOLVE`. `typescript-eslint` and
`eslint-plugin-react-hooks` both already accept `^10`; the React plugin alone is the blocker.

It is reachable, and the cost was measured rather than guessed. Three routes were tried:

1. **`--legacy-peer-deps`** installs, but degrades peer resolution tree-wide and produces 60
   "type cannot be resolved" errors. A control run — ESLint **9** with the same flag — produced
   the same 60, so that damage is the flag, not ESLint 10.
2. **A surgical `overrides` entry** (`{"eslint-plugin-react": {"eslint": "$eslint"}}`) installs
   cleanly with full peer resolution intact and no `ERESOLVE`. With the config left as-is the
   lint lane then **crashes**, exit 2:
   `TypeError: ... 'react/display-name': contextOrFilename.getFilename is not a function`.
   ESLint 10 removed `context.getFilename()`, and `settings: { react: { version: 'detect' } }`
   walks straight into the plugin's version detection.
3. **That override plus `react: { version: '19.3.0' }`** lints **clean**, and the full lane set
   is green: 909 tests, all five lanes exit 0.

So route 3 works. It is not taken here because it buys latest with a declaratively unsupported
tree, and a plugin that already calls one removed ESLint 10 API on a path this repo hits may
call others on code not yet written — the failure mode is a crash mid-lane, not a lint error.
Pinning the React version is not itself a weakened check: every React rule still runs. Left as
the human's call, with the cost stated, rather than defaulted either way.

## 7. Call sites: what a root manifest change reaches

The root `package.json` is shared by every workspace, so the upgrade's blast radius is all of
them. Each was built, typechecked, tested and linted individually rather than through the
aggregate wrapper, and each lane's own exit code recorded:

| Workspace | Tests | Consumes from this change |
| --- | --- | --- |
| `packages/sensor-contract` | 260 | typescript, vitest |
| `packages/layout-schema` | 334 | typescript, vitest |
| `packages/ui-kit` | 84 | typescript, vitest, **jsdom**, testing-library |
| `packages/sensor-sources` | 75 | typescript, vitest |
| `apps/runtime` | 25 | typescript, vitest, **jsdom**, **vite 8**, **plugin-react 6** |
| `apps/editor` | 3 | typescript, vitest, **jsdom**, **vite 8**, **plugin-react 6** |
| `apps/agent` | 126 | typescript, vitest, `@types/node` |
| `apps/caster` | 2 | typescript, vitest |

`jsdom` crossing four majors (26 to 30) was the risk to `ui-kit`, `runtime` and `editor`, since
their tests lean on it through `@testing-library`. All three pass unchanged, including the
`jest-dom` matchers registered in each `vitest.setup.ts`.

## 8. Held back, with the constraint named

| Package | Latest | Landed | Constraint |
| --- | --- | --- | --- |
| `typescript` | 7.0.2 | **6.0.3** | TS 7 ships no classic compiler API, so `typescript-eslint` cannot build a program. Every release including canary caps `typescript` at `<6.1.0`. Reaching 7 costs type-aware linting outright. |
| `eslint` | 10.11.0 | **9.39.5** | `eslint-plugin-react@7.37.5` (latest) peers at `^9.7`. Reachable via an `overrides` entry plus pinning `settings.react.version`; unsupported tree, so left as a decision. |
| `@eslint/js` | 10.0.1 | **9.39.5** | Peers `eslint@^10`; must move with `eslint` or not at all. |

## 9. Noted and not acted on: `engines` is now looser than the tree

The root declares `node >=22`, but `jsdom@30` requires `^22.22.2 || ^24.15.0 || >=26.0.0`. A
developer on 22.0 satisfies the repo's own declaration and then fails on a transitive engine
check. Tightening `engines` to match would be strictly more strict, not less — but it is a
change to what the repo accepts rather than part of taking dependencies to latest, so it is
recorded here rather than folded in silently.

# The clipped value: printing a seven-digit reading in full — decisions

`6699008 B/s` — the GPU PCIe Rx figure the README names as the tell that the page is reading
hardware over MQTT rather than mock data — painted as `669…` in its 216px tile, at the 1920×400
panel viewport and in a browser tab alike. That is the worst shape a display bug can take: an
unreadable value announces itself, where `669` is a plausible throughput four orders of magnitude
out and nothing on the panel says so.

## 1. The rule that was clipping it, found by reading rather than guessing

`.perch-readout__value` carried `min-width: 0; overflow: hidden; text-overflow: ellipsis` at a
fixed `font-size: 3rem`, inside a `.perch-readout__primary` that is `display: flex` with its own
`min-width: 0; overflow: hidden`. `min-width: 0` is what lets a flex item shrink below its
min-content width, and the value was the *only* item in that row carrying it — `.perch-readout__unit`
has no `min-width: 0` and so cannot shrink at all. Every pixel of shortfall in the row therefore
landed on the value, and the ellipsis that absorbed it was the same mechanism decision 8 installed
to stop a raw-topic fallback label from setting the widget's width.

So the containment was not wrong and was not removed. What was wrong is that it applied to the one
run of text in the widget whose characters are not decoration: eight digits of a reading are eight
significant figures, where eight characters of a label are a name the reader already knows.

## 2. The value is exempted by geometry, not by turning containment off

Two changes co-operate, and neither makes the tile's size depend on the reading.

- **A field sized in characters.** The value element carries `width: 8ch` with
  `font-variant-numeric: tabular-nums`, where one `ch` is one digit advance. `0`, `-40.0` and
  `37699580` all occupy the same box; the unit beside it sits at the same offset in every state.
- **A type scale taken from the widget's own inline size.** `.perch-readout` is now
  `container-type: inline-size` and the value's size is `clamp(1.5rem, 14cqw, 3rem)` — the largest
  size at which that eight-character field plus a unit still fits the width the page granted.

`overflow: hidden` with the ellipsis stays, as a backstop for a ninth character. A widget given too
little room must still look starved rather than spill into its neighbour — the 1440px defect
recorded as decision 9 — and the answer to a genuinely wider reading is decision 5 below, not a
wider tile.

## 3. How the geometry stays stable across every reading

The frame budget binds here: every output path captures the page, so a value crossing a digit
boundary must not resize anything.

- The field is a constant. `READOUT_VALUE_FIELD_CHARS` is a module constant, rendered as the same
  `style` attribute in every state and for every reading, so React writes it once at mount and
  never patches it. Nothing about the field's width is a function of `view.value`.
- The type scale's only input is the container's inline size, which is the page's layout and is
  already constant across a capture. It is not a function of the text either — `cqw`, not `em` of
  content, and no `fit-content`, no `max-content`, no `ch` derived from the string's length.

Measured in Chrome 153 against the running stack, both viewports, two frames four seconds apart:
every tile reported an identical `8ch` field box and an identical unit offset in frame 2 as in
frame 1, while `cpu/load` and `cpu/power` changed value between the frames. At 1920×400 each of
the eight tiles is 216px, the field 132.64px, the value 25.48px; at 1440×900 the row of six is
213.33px with a 130.75px field, and the two tiles on the wrapped second row are 672px, where the
`3rem` cap engages and the field is 248.66px. `valueClipped` was false for all sixteen tile
readings and `spillsPastTile` was −16px throughout.

## 4. Eight characters, measured against this machine's own sensors

Eight is not a round number picked for comfort. `fixtures/lhm-data.sample.json` reports GPU PCIe Rx
as `6699008 B/s` — seven digits, the reported defect — and GPU PCIe Tx, the same card in the same
payload, as `37699580 B/s`. Eight is the widest reading the hardware this reads actually produces.
It also covers `-40.0`, a signed six-digit figure, and both placeholders.

The number lives in `readout.tsx` rather than in `READOUT_STYLES`, and the split is deliberate: how
many characters a reading may need is a claim about *data*, where the type scale beside it is a
claim about pixels. A claim about data belongs where the reading that motivates it can be cited in
a comment and a test can read it back off the rendered element. That also made the fix survive the
toolchain upgrade that landed underneath it: jsdom 30 normalises a computed `8ch` to `64px` on an
assumed 8px advance, so a field declared in the stylesheet was unassertable through
`getComputedStyle` — on the element, `style.width` is `8ch` whatever the DOM implementation thinks
a character is. At weight 650 in the system sans a digit advances 0.6475em, confirmed by measuring
the rendered box: 248.66px for eight characters at 48px.

## 5. Display-unit scaling is deliberately not here

Rendering `6699008 B/s` as `6.4 MB/s` would make the tile narrower and read better, and it is still
out of scope, for two reasons that are not about effort:

- The README documents the **raw** figure as the tell that the page is reading hardware over MQTT
  rather than mock data, and `apps/runtime` captions that tile `hardware only · raw bytes/s`.
  Scaling the number would remove the signal the tile exists to carry.
- Which metrics scale, at what precision, and whether the layout controls it, is a schema question.
  It belongs with `layout-schema`, where a `scale` or `unit` field can be authored and validated
  once for every widget, rather than being decided inside one widget by the person fixing a clip.

## 6. The label's protection was re-checked, not assumed, and is now stronger

Decision 8's fix is untouched: the label and note keep `min-width: 0; white-space: nowrap;
overflow: hidden; text-overflow: ellipsis` and their fixed heights, and there is still no
`grid-template-columns` anywhere in the sheet. A test asserts the unlabelled `psu/voltage` topic
renders its raw canonical topic `sensors/psu/0/voltage/0` as its label with those three properties
resolved on the rendered element, and the capture confirms that tile is exactly as wide as its
seven siblings — 216px — at the panel viewport.

Making the widget a query container hardens that fix rather than competing with it: an inline-size
container's width cannot depend on its contents at all, so the fallback label is now *structurally*
unable to size the widget, not merely ellipsised out of trying. That is asserted too.

## 7. Proving it where the pixels are not: characters, not geometry

jsdom has no layout engine — every box it reports is 0 — so "is this number clipped?" cannot be
asked of it directly. The field is declared in characters, so the test asks the same question in
characters: a field of N characters renders a reading of N characters or fewer in full. Nine tests
read the rendered value's text and its field capacity off the element for `6699008`, `37699580`,
`0`, `-40.0`, `48.500`, `n/a` and `--`, assert one field width across four readings of different
lengths, and re-check the label. All nine fail against the pre-fix file (capacity 0 — the value got
whatever width was left over, and left-over is what the ellipsis ate) and pass after. The pixel
question is answered where pixels exist: in Chrome, by the capture in decision 3.

## 8. Call sites: what a `ui-kit` widget change reaches

`<Readout>` has exactly one renderer today: `apps/runtime/src/app.tsx`, which injects
`READOUT_STYLES` verbatim once per page and renders eight tiles — including the throughput tile that
carried this defect and the unlabelled `psu/voltage` tile that guards decision 8. It sets no width on
the value and is not edited here; it picks up both the field and the type scale unchanged.
`apps/editor` depends on `@perch/ui-kit` and imports the namespace in `dependency-edges.test.ts`, but
does not render the widget yet, so the change reaches it only as a resolvable export. `apps/caster`
captures the runtime page rather than importing the widget, so it sees the fix through the page.
Neither dependency-edge test asserts the shape of the export list, so adding
`READOUT_VALUE_FIELD_CHARS` broke nothing; it has no consumer outside `ui-kit`'s own tests, and is
exported so a future display-unit decision has a number to reason about rather than a magic `8ch`
buried in a stylesheet.

# Taking ESLint to 10 by overriding a peer range — decisions

The previous section left ESLint at 9 and put the question to the human, because buying `latest`
with a declaratively unsupported tree is not a worker's call. The answer was **"Take ESLint 10
(override)."** So `eslint@10.11.0` and `@eslint/js@10.0.1` are the committed state, and what follows
is the cost that came with them, recorded as cost rather than as a footnote.

All five lanes are green in the committed tree: `build`, `typecheck`, `lint`, `format:check` and
`test` each exit `0`, with **918 tests passed** — the same 918 as before this change, since nothing
here touches what runs.

## 1. What holds ESLint 10 up, and why it is load-bearing

`eslint-plugin-react@7.37.5` is the plugin's latest release and peers at
`^3 || ^4 || ... || ^9.7`. It does not admit ESLint 10, so a plain install fails `ERESOLVE`. The
root manifest now carries:

```json
"overrides": {
  "eslint-plugin-react": { "eslint": "$eslint" }
}
```

`$eslint` resolves the plugin's peer against the root's own `eslint` declaration, so the tree keeps
**one** installed ESLint (`node_modules/eslint` at 10.11.0, and no nested copy) with peer resolution
otherwise fully intact. This is deliberately not `--legacy-peer-deps`: that flag was measured too,
and it degrades peer resolution tree-wide, producing 60 spurious "type cannot be resolved" lint
errors. A control run pinned that damage on the flag rather than on ESLint 10 — ESLint **9** with
the same flag produced the identical 60.

The override is therefore not decoration. Removing it without simultaneously moving `eslint` back to
9 breaks `npm install` itself, before any lane runs.

## 2. Accepted cost: the tree is declaratively unsupported

An override is an assertion that the author of `eslint-plugin-react` has not made. Nothing verifies
it; it is a claim this repo makes on the plugin's behalf, and the plugin's maintainers owe it
nothing. Concretely accepted:

- `npm install` no longer tells the truth about compatibility here. A future `ERESOLVE` involving
  this plugin is suppressed by construction, so the signal that would normally warn a maintainer is
  gone.
- If the plugin publishes a release that peers `^10`, the override becomes redundant and should be
  deleted. Nothing will prompt that; it has to be noticed.

## 3. Accepted cost: the React version is now hand-maintained and will drift

`settings.react.version` was `'detect'`. Detection calls `context.getFilename()`, which ESLint 10
removed, so the lint lane does not merely warn under detection — it dies:

```
TypeError: Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function
    at resolveBasedir (node_modules/eslint-plugin-react/lib/util/version.js:31)
    at detectReactVersion (node_modules/eslint-plugin-react/lib/util/version.js:85)
```

So the version is pinned to `19.3.0` in `eslint.config.js`, with a comment at that line saying why,
because the obvious "cleanup" for a future reader is to restore `'detect'` and that restores a
crash.

The cost is real and it is a slow one: **when `react` moves, this number does not.** Several
`eslint-plugin-react` rules are version-gated, so a stale pin means those rules judge the code
against a React that is no longer installed — and nothing fails. There is no lane that catches it.
Bumping `react` is now a two-file change: the manifest, and this line.

The pin is not a weakened check. Every React rule still runs, and that was verified rather than
assumed: a probe component with a conditionally-called hook and a keyed-list violation was linted
under ESLint 10 with the pin in place, and `react-hooks/rules-of-hooks` and `react/jsx-key` both
reported. The probe was removed.

## 4. Accepted cost: the residual risk, and the symptom to recognise it by

The plugin already calls one API ESLint 10 removed, on a path this repo's code reaches. That is
evidence about the plugin's general state, not a single fixed bug: the same class of call can sit on
paths that only execute for code nobody has written here yet — a `propTypes` shape, a class
component, a rule this config does not currently trigger.

**What that would look like, so it is not misdiagnosed:** the lint lane exits **2**, not 1, and
prints a `TypeError` naming a rule — `Error while loading rule 'react/<something>'` — with a stack
inside `node_modules/eslint-plugin-react/`. There is no file-and-line finding against the source,
because the rule never got far enough to produce one. Crucially, this will surface *while someone is
writing unrelated React code*, so the natural reading is "my new component broke the linter." It did
not. The override came due.

The response is to fix the ESLint version story, not the code that exposed it: upgrade the plugin if
a supporting release exists, or move ESLint back to 9 and remove the override. Silencing it with
`eslint-disable` is not available, because a crashed rule loader reports no rule to disable.

## 5. What was not reopened

TypeScript stays at **6.0.3**; nothing in this answer bears on TypeScript 7, which is blocked for an
unrelated and structural reason (no classic compiler API). The root `engines: node >=22` versus
`jsdom@30`'s `^22.22.2 || ^24.15.0 || >=26.0.0` mismatch stays recorded and untouched — still the
human's call.

The lockfile was **deleted and regenerated** from the manifests rather than edited, so the resolution
committed here is one npm produced from scratch.

# The 1 Hz failure line: reporting an outage without repeating it — decisions

The relay polls once a second. While LibreHardwareMonitor is unreachable it wrote one line per
poll, so a host switched off for 100 hours produced on the order of **360 000 identical lines**.
The volume is the obvious complaint; the damage is that it buries the two lines that carry
information — the **first** failure, whose reason is the diagnostic, and a **change** of reason,
where `ECONNREFUSED` becoming a timeout is the difference between "host up, nothing listening"
and "host gone".

The bar this was built to: someone tailing the log can answer *is it still broken, since when, and
why* without scrolling past repeats.

## 1. Collapse the run; do not lower the severity, drop the line, or add a quiet flag

Three cheaper fixes were available and all three are the wrong trade. Demoting the line to `warn`
or `debug` keeps 360 000 lines and makes them harder to find. Dropping repeats with no summary
leaves a reader unable to distinguish "still broken" from "the process died". A `--quiet` flag
that defaults to hiding failures makes the default configuration the one that lies.

So failures stay on `error`, nothing is suppressed that says something new, and there is no flag.
What changed is that a *run* of failures is reported as a run: `apps/agent/src/failure-log.ts`
emits the first failure in full, a changed reason immediately and in full, a periodic summary on
an escalating interval, and a recovery carrying the outage's duration and failed-attempt count.
Everything in between is silent.

## 2. The summary interval escalates: 10 s doubling to a 1 hour cap

A fixed interval has to choose between being useless early and noisy late. Ten seconds is right in
the first minute, when a human is watching and wants to know the relay is still trying — and it is
36 000 lines across a four-day outage. One hour is right overnight, and leaves the first minute
silent, which reads exactly like the process having died.

So the gap starts at 10 s and doubles after each summary, capped at one hour:

| summary at | 10 s | 30 s | 1 m 10 s | 2 m 30 s | 5 m 10 s | 10 m 30 s | 21 m 10 s | 42 m 30 s | then hourly |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

The properties that made this the choice rather than a round number picked by feel:

- **Bounded and easy to state.** Logarithmic while it ramps, one line an hour after. The 100-hour
  outage this was written for costs **108 lines instead of 360 000**, and the arithmetic is one
  sentence rather than a table a reader has to trust.
- **Never more than an hour stale.** The cap is what makes "is it still broken" answerable from
  the last line visible on screen, however long the outage has run. An unbounded ladder would
  eventually be indistinguishable from silence.
- **Reassuring while a human is present.** Four lines in the first three minutes is the window
  where someone is actually watching a relay they just started.

Each summary is self-contained — reason, elapsed duration, consecutive-failure count, and the
outage's absolute ISO start — because a reader who starts tailing mid-outage sees only summaries,
and the relay's lines carry no timestamp of their own.

## 3. A changed reason restarts the ladder but not the outage clock

A new reason is the moment a human starts watching again, so the escalation goes back to its base
and the change is followed by an early confirmation. The outage's `startedAt` and its cumulative
attempt count deliberately do **not** reset: the source has been down since it went down, and
reporting a five-day outage as five seconds old would be a worse lie than the repeats were. So a
reason change reads `poll failure reason changed after 16s and 16 failed attempts: <new> (was:
<old>)` — the duration is the whole outage, and the previous reason is named, because "what it
changed from" is the information.

Recovery, by contrast, resets in full, so a second outage is reported like a first one: its own
full line, its own clock, the ladder back at its base. A continuation-shaped report ("still
failing after 6 hours") for an outage that started a minute ago would misdirect whoever reads it.

## 4. The clock is a parameter, so the timing is tested without waiting

Every decision in this module is about elapsed time. Every entry point therefore takes `at` as an
argument rather than reading a clock, and `startRelay` passes `deps.now()`. `failure-log.test.ts`
runs **a hundred hours of outage in a loop** and asserts the line count is about 108 rather than
360 000; `relay.test.ts` runs five minutes of 1 Hz failure under vitest's fake timers and asserts
exactly five lines. Nothing in the suite sleeps.

The failure path reads the clock again at the point the request gave up rather than reusing the
pre-request reading, because for a timeout those are 1500 ms apart and the difference accumulates
into the duration the recovery line reports.

## 5. The tick-defect path got the same treatment, because it has the same cadence

Auditing the relay for anything else logging per poll or per publish turned up exactly one other
line: `tick aborted unexpectedly`, in `startRelay`'s rejection handler. It fires when a *publish*
rejects — a broker that has gone away — and a broker that is gone stays gone, so at 1 Hz it is the
same defect with a different cause. It now runs through the same collapser, with its own
independent run state: a source that answers nothing and a broker that rejects everything are two
different outages, and collapsing them together would hide whichever started second.

Two other emitters were examined and deliberately left alone. `reportAnomalies` (unmapped sensors,
duplicate identifiers) was already once-per-distinct-cause. The `[broker] ...` lines in `broker.ts`
are per client-error events, not per poll; a reconnect storm could make them noisy, but that is a
different cadence with a different fix, and inventing one here would be scope the report does not
ask for.

## 6. Ordering: the recovery line goes above the anomaly warnings

`noteSuccess` runs after the publishes — "recovered" has to mean the readings reached the broker,
not that the HTTP call answered — but *before* `reportAnomalies`. The first successful poll after
an outage re-warns nothing, but a source that came back with a new sensor can warn, and the line
that ends an outage should not be printed underneath a note about a duplicate sensor identifier.
This was found by reading the captured terminal output, not by reasoning about the diff.

## 7. `RelayState.failing` is gone, and that is a visible interface change

The boolean that tracked "the previous tick failed" is replaced by two `FailureRun` records.
`RelayState` is exported through the app's barrel, so this is a breaking change to a published
type — acceptable because `apps/agent` is a leaf that nothing in the repo imports
(ARCHITECTURE.md), and the barrel exists for tests and a future single-file build. The recovery
line's wording changed with it, from `recovered: 213 readings published` to `poll recovered after
40s, 25 failed attempts, last failure: <reason>; 213 readings published`, which is the duration
and the count the report asked for.

## 8. What the terminal actually looks like

Asserting on a mock logger proves the logic and shows nothing about the complaint, which was about
a terminal. Two real runs were captured, both with `PERCH_MQTT_PORT`/`PERCH_WS_PORT` moved off
this machine's occupied defaults:

- **`.evidence/relay-outage-terminal.log`** — `PERCH_LHM_HOST=127.0.0.1 PERCH_LHM_PORT=1`, run
  past the 5 m 10 s rung: **311 consecutive failed polls, five error lines.** Worth knowing for
  anyone reproducing it: port 1 is on the WHATWG bad-port list, so `fetch` reports `bad port`
  without ever connecting — a reliable refusal, but not an `ECONNREFUSED`.
- **`.evidence/relay-reason-change-terminal.log`** — one relay against a staged source on port
  18085 that refuses, then accepts without answering, then serves the captured payload. One
  process, every line the collapser can emit: the first `ECONNREFUSED` in full, a summary, the
  change to `no response within 1500 ms` naming what it changed from, another summary, the
  recovery with duration and failed-attempt count, and then a fresh full line when the source went
  away again.

# Wiring the layout format into the page — decisions

The format existed and nothing consumed it: `@perch/layout-schema` was built and tested, while
`apps/runtime` painted a hard-coded tile list. These are the decisions taken closing that gap — the
page now reads a document through `loadLayout` and paints whatever comes back.

## 1. The widget vocabulary is declared once, so the two halves cannot drift

Two consumers have to agree about what a widget is: `layout-schema` needs a `WidgetRegistry` (which
names exist, which of them draw a scale and so require an authored `range`), and the page needs a
name → React component map. The format's own hard rule keeps `layout-schema` from importing
`ui-kit`, so the vocabulary is injected — which is exactly the arrangement that invites two
hand-written lists to disagree.

The drift has one specific shape and it is the worst available outcome: a name in the registry with
no component behind it. A layout using it **validates and then renders nothing**. The format's
typo-safety says the document is fine while the panel shows an empty rectangle, so the author looks
everywhere except at the widget name.

`apps/runtime/src/widget-catalogue.tsx` therefore declares neither list. `WIDGET_CATALOGUE` is the
only declaration, and both are derived from it at module load: the registry by projecting each
entry's `drawsScale`, the component map by `Object.entries` of the same object. An entry's type
requires both halves, so a half-entry does not compile. Drift is not tested for — it is
unrepresentable. `widget-catalogue.test.tsx` asserts the weaker, still worthwhile thing: that the
derivation is still a derivation, in both directions.

`drawsScale` lives with the registry builder rather than in `ui-kit`, per the format's own note:
whether a widget needs a `range` is a statement about what a layout author must write, not about a
component's props.

**One entry today**, `readout`, and that is the honest state of the project. A catalogue entry for a
gauge nobody has written would be precisely the failure above, with the validator telling authors to
use a widget the page cannot draw.

## 2. A layout arrives as *text*, not as a parsed module

`layout-catalogue.ts` reads `layouts/` with `import.meta.glob(..., { query: '?raw' })` and hands the
bytes to `loadLayoutJson`. Importing the JSON as a module instead would put Vite's parser in front of
the format's: a layout with a trailing comma would fail at build time with a bundler error rather
than on the page with `formatLayoutIssues`. The promise is that a bad layout is refused *legibly*,
and that requires the runtime to see the document exactly as it is on disk.

The globs are eager, which the standalone bundle requires working backwards: the deliverable loads
cold from a static directory, so a layout fetched as a dynamic chunk would need a network the panel
host may not have. The whole catalogue is a few kilobytes.

The page takes the catalogue as a **prop**, exactly as it takes its sensor source. That is what lets
a test drive the refusal path with a document that is not on disk, and it keeps the knowledge of
where `layouts/` lives in one file.

## 3. Absolute pixels on a fixed canvas, scaled as one unit — never a reflow

The canvas is a box exactly `target.width × target.height` CSS pixels; every element is absolutely
positioned at its authored integer rect; the whole canvas is scaled with a single `transform` and
centred, so the spare space on one axis becomes the letterbox. Nothing reflows at any viewport.

`transform: scale()` rather than recomputing sizes: a transform is applied after layout, so children
keep their authored geometry and no amount of scaling can change which element is where. Scaling
proportionally by arithmetic instead would put every rounding decision back in play at every
viewport, and the editor's canvas and the panel's output would stop being pixel-identical — which is
the whole reason the format's geometry is integers.

Paint order is array order, implemented as source order with **no `z-index` anywhere**. A bleeding
rect keeps the geometry its author wrote and is clipped by the canvas, rather than being clamped: the
format allows the bleed deliberately, and clamping would move a background by 20px with nothing to
explain why.

## 4. Capture mode is where a target is refused; `frameRate` is not checked in a browser

"Rejects a layout it cannot honour" and "windowed scales to fit" are both requirements, and they
contradict each other unless the refusal has a home. It is capture mode: windowed legitimately scales
and letterboxes, capture renders **1:1 or not at all**, and a viewport that is not exactly the
declared target is refused with `describeTargetMismatch`'s sentence. Handing a screenshot tool a
scaled picture of the panel is the one failure a capture mode exists to prevent.

`OutputCapabilities.frameRate` is deliberately **omitted** rather than guessed. A browser cannot
report a compositor rate honestly, and the format documents omission as "unknown, do not check" —
so a 24fps layout is not refused by a claim the page is in no position to make. A test asserts the
mismatch text never mentions Hz, which is the observable form of that decision.

## 5. Problems on the page, in the format's own words

`layout-problem.tsx` renders three refusals — `unknown-layout`, `invalid-layout`, `target-mismatch` —
each with its own `data-perch-problem` value so a harness can tell them apart. The issue list is
`formatLayoutIssues`' output verbatim: one line per issue, `path: message [code]`, including the
field path and element index an author needs to find the line in their file.

It is a `<pre>` because that indent and one-issue-per-line shape carry meaning, and it **wraps**
rather than scrolling horizontally. Two of the format's messages — the theme-token grammar and the
media-path rule — are longer than a 1280px window, and a message clipped at the right edge is
unreadable in a screenshot and on a panel with no scrollbar.

The refusal page is deliberately **not themed**. One of the things a layout can be invalid about is
its theme, so a refusal must render identically whatever the document says.

## 6. Layout selection is a query parameter, and an unknown name is refused rather than defaulted

`?layout=<path under layouts/ without .json>` and `?mode=windowed|capture`. No picker UI: a panel has
no keyboard, and a URL is the one setting a kiosk browser can be given at launch. Absent `?layout=`
means the first catalogued name, sorted, so `npm run dev` stays one command.

A name that does not exist is refused **with the list of names that do**, not quietly replaced by the
default. Falling back would make a typo look like a layout rendering the wrong content, which is the
same class of failure as a registry with no component behind a name.

## 7. `layouts/invalid/` — catalogued, reachable, never offered

The refusal path deserves to be exercised against a real file on a real page, not only against a test
fixture. `layouts/invalid/broken-desk.json` is valid JSON that fails validation nine ways at once, one
per issue code the page has to render.

`layouts/README.md` says a layout that will not validate is not a layout, and that rule is kept
rather than bent: these documents live in their own directory under their own name, and the catalogue
marks them `offered: false`. The page will not default to one and does not list one; you have to ask
for it by name.

## 8. The second mock source is gone, and staleness moves to where it can be proven

The page used to construct a second, short-lived mock source purely to drive the stale rendering on
one tile. A layout file cannot name a source — and should not be able to — so that source had no
tile it could reach once the tile list came from a document. It is removed, and `main.tsx` records
why.

Staleness is not left unproven: `ui-kit` tests it against a controlled clock, which is where a claim
about elapsed time belongs. What was lost is a demonstration on a live page; what was avoided is a
page whose rendering depends on a source no layout can request.

## 9. The chrome strip is fixed, unstylable, and rendered on every path

A strip along the bottom names the layout, the mode and fit, the source, the source's status in
words, and the time of the last reading. It renders in windowed mode, in capture mode, and on every
refusal, and a layout's theme cannot reach it.

That is a provenance decision, not a design one. The sensor host is off; every value on this page is
generated by the mock. A screenshot that did not say so would be a picture of invented hardware
readings. Both shipped layouts *also* carry "mock source · generated values, not hardware" as canvas
text, so a crop that loses the strip still says where the numbers came from.

The ready signal is `data-perch-ready` on the page root, driven by whether a reading has actually
arrived — not by a wall clock, which advances happily in a screenshot of a dead page.

## 10. Two layouts that differ in character, from one widget

Only `readout` exists, so the difference had to come from everything else: `desk-1920x400` is a dark
monospace strip of eight narrow tiles over a rail backdrop at 30fps; `tower-720x1280` is a tall warm
serif column of six deep tiles on paper at 24fps, with a hero tile at a larger type scale. Target
size and aspect, tile density, theme tokens, text elements and a media background carry it.

Each reads an indexed topic (storage device 1) and leaves one tile deliberately waiting on a topic
the mock never publishes; the tower also shows the `no-reading` state, which the mock publishes as a
`null` for the pump header. Most tiles read live values on purpose — a screen of waiting tiles looks
like a failure rather than a layout, and a layout with no gap never shows the waiting state at all.

The mock's nine-topic vocabulary was **sufficient** for two convincingly different pages. It is,
however, the ceiling on what any layout can display, and it is narrow enough that a third layout
would start repeating topics.

## 11. Assets are hand-authored SVG, and no binary is committed

Both backdrops are a `<pattern>` plus a few rects, a few hundred bytes each, authored at the canvas
size so `fit: cover` is a 1:1 paint at target. A background that can only be diffed as bytes is a
background nobody will ever review — and `layouts/` is content the human is expected to read.

Media is referenced, never embedded: `?url` hands back the bundler's copied path, so "media is a
path relative to the layout file" holds all the way into the built page. A layout referencing a file
that is not there **validates** — the format checks the shape of a path, having no filesystem — and
renders a box naming the path it could not find, in the rect the image should have occupied.

## 12. `import.meta.glob`'s type lives next to its call site

Declared in `layout-catalogue.ts` inside `declare global`, not in `vite-env.d.ts`, because the tests
program (`tsconfig.tests.json`) includes test files plus what they import — not the package projects'
ambient `.d.ts` files. A declaration beside its only call site is in every program that can reach the
call, and `npm run typecheck` covers both programs. `vite/client` is still not referenced, for the
reason `vite-env.d.ts` already records: it carries an `any`-indexed `ImportMetaEnv`.

## 13. Awkward in `layout-schema`'s surface, reported rather than patched

Two things, neither a defect, both noticed while consuming it:

`describeTargetMismatch` interpolates the raw scale, so a 1280×800 window refusing a 1920×400 layout
prints `scaled by 0.6666666666666666`. It is correct and it reads like a bug on a wall. Rounding it
is a one-line change in a package this work was told not to touch.

`fitLayoutTarget`'s `OutputCapabilities.frameRate` being optional is the right shape, but "omitted
means do not check" is carried only in prose. A caller that forgets it gets a silent pass on the
frame-rate question rather than a type error — which is the correct behaviour for this page and a
trap for one that genuinely knows its refresh rate.

# A chart element in the layout contract, and the first real migration — decisions

`@perch/layout-schema` described three element kinds and had a migration runner with an empty table.
These are the decisions taken adding a fourth kind — a chart, with a time axis — and taking the
format from version 1 to version 2 so that both sides of that boundary behave. Contract only: there
is no chart renderer yet, and every choice below was made to be the thing a renderer is built
against rather than a guess at what one will want.

## 1. A chart is its own `kind`, not a widget element with extra fields

`windowMs` is required for a chart and meaningless on a gauge. Deciding *which fields are required*
from the value of `kind` is the entire job of the discriminated union, so the requirement belongs to
a kind.

The alternative was an optional `windowMs` on `kind: 'widget'`. It fails twice over: it accepts a
chart with no window, and it silently ignores a window on a readout. Getting the requirement back
would mean a second registry capability flag (`needsWindow` beside `drawsScale`) — which is to say,
inventing a new mechanism to recover a property the union already gives away for free.

The cost is that `chart` repeats `widget`, `topic`, `rect`, `style` and `range` in its field list.
That repetition is in the *field list*, not in the *rules*: see decision 3.

## 2. `windowMs` is required, is authored, and carries its unit in its name

Required, because there is no chart without a time axis, and a chart that picks its own span is a
chart whose meaning changes without the file changing.

Authored, for precisely the reason `range` is authored, and the SPEC's existing argument transfers
without modification. The two ways to avoid authoring it are to span "however long this process has
been up" or to derive it from `rect.w` at some samples-per-pixel. The first makes the axis mean
something different on every restart; the second makes a layout edit silently rescale time. Both are
the `range` mistake relocated into the time axis, and the format already refused it once.

The unit is in the name because a factor of 1000 in a time axis is invisible in the output — a
window that is wrong by 1000x still draws a plausible-looking line — and because `windowMs` matches
`at` on a sensor reading, so a renderer subtracts and compares without a conversion. `window` was
also rejected on its own merits: it is a DOM global, and this package already renamed `Element` to
`LayoutElement` for exactly that trap.

The accepted band is 1 s to 24 h, and both ends are arguments rather than round numbers. The floor
is there because a sub-second window holds too few samples to be a trend at any frame rate this
format allows, and because a `windowMs` that small is almost always seconds typed into a
milliseconds field — so the issue message names that mistake. The ceiling is there because nothing
in this project buffers history: a 48-hour window can only ever be drawn for the part of it this
process has been running, so the file is asking for something no source can supply.

## 3. `range` on a chart is the registry's rule, reused, not a chart rule that agrees with it

The brief's constraint, and the one worth being explicit about: "this widget needs a range" is
already modelled, in the registry, as `drawsScale`. A chart that requires a range must fall out of
that and not out of a new check.

So the rule was *extracted*. `requireRangeIfScaled` is now one function, called by
`validateWidgetElement` and `validateChartElement` alike; the registry is unchanged and still knows
nothing about element kinds. The observable consequence is pinned in `chart.test.ts`: a chart naming
`readout` (registered `drawsScale: false`) needs no range, because the registry's answer is the only
answer there is. Two copies of the rule would agree today and drift the first time one of them
gained a condition.

## 4. `gap` is a field, and the default is the honest one

The source buffers nothing, so a reconnect leaves a real hole, visible through `at` timestamps. The
brief asked whether the layout should be able to say what happens to it.

It should, and the reason is that this is not a style question. Spanning a gap draws a line through
time where no measurement existed — an assertion about the world that is false. That is the same
class of untruth as putting two units on one y-axis, and it is not the renderer's call to make
silently, because whether the lie is acceptable depends on what the chart is for. A smooth
watched-all-day CPU trace can span a two-second reconnect without misleading anyone; a chart being
used to find out *whether the source dropped out* must not.

Hence: `gap?: 'break' | 'span'`, defaulting to `'break'`. Absence means the honest rendering, so a
file that never thought about it does not ship the lie. The default is exported as
`DEFAULT_CHART_GAP` rather than written into the renderer, so `runtime` and `editor` cannot disagree
about what an absent `gap` means. And the validator leaves an absent `gap` absent rather than
materialising the default into the document — same treatment `fit` gets, same reason: a saved file
that differs from the one the author wrote is a file whose diffs stop being reviewable.

Whether the chart *draws* the break as a visible discontinuity, a dotted segment or simply nothing
is still entirely the renderer's business. The field says which of two meanings is wanted, not how
to paint it.

## 5. One topic per chart in version 1 — agreeing with the recommendation, with a concrete answer

Kept, and not merely deferred: the case that actually motivates multi-series has an answer today.
Paint order is array order, so two chart elements with the same `rect` and the same `range` already
stack into two series on one set of axes. That is pinned by a test rather than asserted here.

Two series that do not share a `range` should not share a y-axis in the first place — the thing
multi-series is usually reached for is the thing that makes a chart lie. And real multi-series (per
series style, labels, a legend, possibly independent axes) is a design with field names in it. Every
one of those names would be a guess made before a renderer exists to have an opinion, and each guess
is permanent in a versioned format: wrong fields are more expensive to remove than missing fields
are to add.

## 6. The version step, and what the migration does

`LAYOUT_SCHEMA_VERSION` goes 1 to 2, with one table entry `{ from: 1, to: 2 }` whose `migrate` is
`(document) => ({ ...document })`.

The no-op is the point, not a placeholder. Version 2 is purely additive: no version 1 field changed
meaning, so every valid version 1 document is a valid version 2 document with its number stepped,
and there is nothing to rewrite. What the step buys is the two halves of the boundary:

- **New reader, old file.** `loadLayout` migrates it forward and *says so* — `fromVersion: 1`, steps
  `['1->2']`, and `formatMigrationReport` naming the change. A version 1 document that is wrong on
  its own merits is still refused on its merits after migrating, not instead of migrating.
- **Old reader, chart file.** It refuses the *document* at `schemaVersion`, once, naming the version
  it can read and the version it was handed. Without the step it would walk into the elements and
  produce `unknown-element-kind` plus a pile of `unknown-field` issues — technically a refusal, but
  one that blames the author for fields they wrote correctly, when the true problem is that the
  build is old. Refusing at the version is the only refusal that names the real fault.

The step is also load-bearing for its own sake: a version 2 with no step from 1 would make
`earliestMigratableVersion` return 2 and strand every existing version 1 file as
`unsupported-past-version`. That is asserted directly, because it is the failure mode that would
otherwise be discovered by a user with a file they wrote last week.

## 7. Zero new issue codes were needed, and that is a result

Every failure the brief asked for maps onto a code that already existed: `missing-field`,
`out-of-range`, `wrong-type`, `missing-range`, `invalid-range`, `unknown-field`, `malformed-topic`,
`unknown-element-kind`. Adding a whole element kind with a new required numeric field, a new enum and
a conditional requirement did not need one new member of `LayoutIssueCode`.

That is evidence the issue union was cut along the right joint — codes describe *what kind of wrong*
a value is, not *which field* is wrong, and the field is carried by `path`. Worth recording while the
format is young, because the pressure to add a `bad-window` code was there and taking it would have
started a vocabulary that grows with every field.

## 8. Found while doing it: `targetVersion` alone no longer describes an older reader

The one thing in the existing machinery that genuinely fought back, and it is a real finding rather
than a test bug.

Writing "an old build refuses a chart layout" as `loadLayout(chartDocument(), { targetVersion: 1 })`
throws `RangeError` from `assertLayoutMigrationTable`, because the table it defaults to ends at 2 and
a table that overshoots its target is malformed. The error is *correct* — a bad table is programmer
input, not a bad file, and throwing beats collecting an issue for it. But it means that now the real
table is non-empty, simulating an older reader takes both halves: `targetVersion: 1` **and**
`migrations: []`, the empty table that build actually shipped with.

Left as it is, deliberately. Both parts are true of an old build, and a helper that filled the table
in from the target version would be inventing history. The `RangeError` is pinned by a test so the
next person meets it as a message rather than as a puzzle, and the test-local `v1Reader` constant
carries the explanation at the point where someone will need it.

Two smaller notes from the same pass. `validateLayout` consults no table at all, so `targetVersion`
on its own *is* a version 1 reader there — the asymmetry is correct but it is the kind of thing that
reads as an inconsistency until you know why. And migration running before validation means a
hand-stamped `schemaVersion: 2` document containing a chart is accepted by a reader that would have
refused the same document at version 1; that ordering is deliberate and documented in `migrate.ts`,
so the leniency is pinned by a test rather than left to be rediscovered as a surprise.

## 9. Call sites: what a fourth element kind reaches

Required because this change is in `packages/*`. Everything outside `packages/layout-schema/` is
another worker's territory in this session and was **not** touched; it is enumerated here so the
consequences are known rather than found.

Inside `packages/layout-schema/` (all updated):

- `src/element.ts` — the union, `ELEMENT_KINDS`, `CHART_FIELDS`, the `ELEMENT_VALIDATORS` table, and
  `requireRangeIfScaled` extracted out of `validateWidgetElement`.
- `src/chart.ts` (new) — the window band and the gap vocabulary.
- `src/layout.ts` — `LAYOUT_SCHEMA_VERSION = 2`.
- `src/migrate.ts` — the `1 -> 2` entry, and `LAYOUT_MIGRATIONS` no longer empty.
- `src/index.ts` — `ChartElement`, `ChartGap`, `CHART_GAPS`, `CHART_MIN_WINDOW_MS`,
  `CHART_MAX_WINDOW_MS`, `DEFAULT_CHART_GAP`.
- `src/layout-fixture.test-support.ts` — the shared fixture is at version 2 and has a chart, so every
  document-level test carries one; `v1LayoutDocument()` added as the other side of the boundary.
- `src/chart.test.ts` (new), `src/element.test.ts`, `src/layout.test.ts`, `src/migrate.test.ts`.

Outside it, reached and left alone:

- `apps/runtime/src/layout-canvas.tsx:133` — **fails to compile**, by design.
  `renderElement`'s `switch` is closed by `assertNever`, and its own comment says "a fourth member of
  `ELEMENT_KINDS` fails to compile here until it has a branch". It does:
  `error TS2345: Argument of type 'ChartElement' is not assignable to parameter of type 'never'`.
  This is the mechanism working. The fix is a `case 'chart':` and a renderer, which is the chart
  widget task.
- `apps/runtime/src/layouts.test.ts:107` — **fails**, twice (`desk-1920x400.json`,
  `tower-720x1280.json`): `expect(layout.schemaVersion).toBe(1)`. The shipped layouts are version 1
  files, `loadShipped` migrates them, and the migrated result is now 2. The assertion is a correct
  statement about a format that has moved; it becomes `LAYOUT_SCHEMA_VERSION`, or 2.
- `apps/runtime/src/app.tsx:319` — will now start rendering its "migrated from schemaVersion 1"
  chrome for every shipped layout, because every shipped layout now migrates. Visible, correct, and
  possibly asserted against in `app.test.tsx` — that lane passes today but the chrome text is a
  user-visible change somebody should see on purpose.
- `layouts/*.json` and `layouts/invalid/broken-desk.json` — all `"schemaVersion": 1`. They keep
  working through `loadLayout` (that is what the migration is for) and only need stepping if the
  intent is for the shipped files to stop being migrated on every load.
- `apps/runtime/src/layout-canvas.tsx:201` (`styleOf`) — reached and *not* broken: `chart` carries
  `style`, so the `kind === 'media'` test still narrows correctly. Noted because it is the other
  place that enumerates kinds and it needed nothing.
- `packages/ui-kit/` — nothing. The registry's `drawsScale` already carries everything the chart's
  `range` rule needs, and no widget code learned about element kinds.
- `apps/editor/`, `apps/caster/`, `apps/agent/`, `packages/sensor-contract/`,
  `packages/sensor-sources/` — nothing; they do not read the element union.

# Numbers in a refusal a person reads — decisions

Scope: `packages/layout-schema/src/target.ts` and its test. `fitLayoutTarget`'s `reasons` are
sentences the page prints for a human (`LayoutProblem`, `data-perch-problem="target-mismatch"`),
and two of the three interpolated a number raw. `TargetFit.scale` itself is untouched.

Evidence: `red-1-raw-numbers-in-prose.log` (the nine assertions failing against HEAD, with the
old strings quoted in full), `test.log`, `build.log`, `typecheck.log`, `lint.log`,
`format-check.log`, and two captures of the rendered refusal —
`target-mismatch-1366x768.png`, `target-mismatch-1920x400.png`.

## 1. The string rounds; the number does not

`scale` stays `Math.min(...)`, exact and unrounded, because the canvas transform is derived from
it — rounding it would move rendered geometry to save a printed digit. Only the *rendering*
rounds, in `formatScalePercent`. `TargetFit.scale`'s doc comment now says this, so the next
person who wants a shorter number has somewhere to put it other than the field.

## 2. A percentage, not a decimal

`0.7114583333333333` became `71.1%`, not `0.711`. The question a reader has is "how much of the
canvas am I getting", and a percentage answers it without a conversion step. It also carries
direction at a glance: `150%` is obviously bigger, where `1.5` has to be compared against 1
first. The sentence names the direction as well — `scaled down to 71.1%` / `scaled up to 150%` —
so the reader does not have to do even that comparison.

## 3. One decimal place, extended only to protect the reading of "100%"

One decimal is enough to decide whether a mismatch matters, and more digits are the noise this
change exists to remove. The exception is a scale near but not equal to 1: `0.999` rendering as
a flat `100%` would claim the pixel-identical fit that `exact` means, so `formatScalePercent`
extends precision (to at most six places) until the value stops rounding to 100 — `99.9%`,
`99.999%`. `100%` is therefore only printed for a scale of exactly 1.

The cost, accepted: a value that is exact at two decimals is still shown at one, so
`0.3125` prints as `31.3%` rather than `31.25%`. Visible in
`target-mismatch-1920x400.png`. A percentage is understood to be rounded; a reader deciding
whether a letterbox matters is not served by the extra digit.

## 4. A scale of exactly 1 is not "scaled by 1"

`scale` can be 1 without the fit being `exact` — a 1920x400 layout in a 3840x400 output is
full-size with bars. "so the canvas is scaled by 1" described that as scaling. It now reads
"so the canvas is shown at its declared size", and the letterbox reason that follows says where
the bars are from.

## 5. Aspect ratios are reduced, not divided out

`aspect ratio differs (1920:400 against 1920:1080)` printed the dimensions a second time and
left the reader dividing. It now reduces: `24:5 against 16:9`.

Rejected: decimals (`4.8:1 against 1.78:1`). More comparable, but not exact — 1920:1080 and
1366:768 both round to `1.78:1`, so the sentence would read "aspect ratio differs (1.78:1
against 1.78:1)" and contradict the cross-product that had just established they differ. That
pair is a 1080p layout in an ordinary laptop tab, i.e. common. GCD reduction is exact, cannot
self-contradict, and gives the recognisable form for the pairs this is mostly read for; the
price is that the awkward pair reads `16:9 against 683:384`. Non-integer dimensions cannot be
reduced and are printed as they are — nothing here produces one, a CSS-pixel viewport could.

## 6. The frame-rate reason had the same defect, and it was real

`frameRate` is the one `target` field the format allows to be fractional, so it is the one that
arrives measured: an output reporting `29.97002997002997` printed all seventeen digits. It is
now `29.97 Hz`. Found by reading the other reasons rather than by a report.

## 7. `?? 0` removed, because it could only ever have lied

The frame-rate reason read `output.frameRate ?? 0`. It was unreachable — an unknown rate is
honoured, not a shortfall — but had it been reached it would have reported an output that
"reaches 0 Hz". The condition is now spelled out (`outputFrameRate !== undefined && ... <
target.frameRate`) so the narrowing is real and the sentence has no rate it has to invent.
`frameRateHonoured` is unchanged in meaning.

## 8. `formatScalePercent` is exported, because the scale is printed in two places

`apps/runtime/src/app.tsx:390` (`formatScale`) already rounds `fit.fit.scale` for the chrome
badge, with its own convention — `0.711x`, and a hand-rolled `scale === 1 ? '1'` guard for
exactly the near-1 problem decision 3 solves. That is the same bug's second instance and the
reason the formatter is public API rather than a private helper in `target.ts`.

**It is not fixed in this change**, and this is the one thing left undone: a second worker is
live in `apps/runtime/` and `packages/ui-kit/` moving the layout canvas, and writing to
`app.tsx` underneath them would collide. The adopting edit is one line —
`` return formatScalePercent(scale) `` in place of the `toFixed(3)` expression — and belongs to
whoever next has that file. Left deliberately, named here so it is not lost.

## 9. Call sites: what `layout-schema`'s target surface reaches

`fitLayoutTarget`, `describeTargetMismatch`, `TargetFit` and the new `formatScalePercent`, every
consumer in the repo today:

| Call site | Uses | Affected by this change |
|---|---|---|
| `packages/layout-schema/src/index.ts` | re-exports all four | yes — `formatScalePercent` added to the barrel |
| `packages/layout-schema/src/target.test.ts` | all four | yes — 10 new tests, 8 of them on rendered strings |
| `apps/runtime/src/viewport.ts:71,75` | `describeTargetMismatch` for the capture refusal, `fitLayoutTarget` for the scale, `TargetFit` in `CanvasFit` | prose only — passes the sentence through unchanged, and reads `scale` as the exact number it still is |
| `apps/runtime/src/layout-problem.tsx:97` | the mismatch sentence, via `targetMismatchProblem` | prose only — renders it in a `<pre>`, no parsing |
| `apps/runtime/src/app.tsx:252,255,268` | `fit.fit.scale` → the canvas transform, `data-perch-scale`, and the chrome badge | `scale` is unchanged, so the transform and the attribute are unchanged. The badge is decision 8's open instance |
| `apps/runtime/src/viewport.test.ts:22,31,42,64` | asserts `fit.fit.scale` is `1`, `0.5`, `0.75`, `1` | unaffected, and the proof `scale` did not move: green, unedited |
| `packages/ui-kit/`, `apps/editor/`, `apps/caster/`, `apps/agent/`, `packages/sensor-*` | nothing | no |

No consumer parses a reason string or compares it to a literal, which is what made the wording
safe to change: the refusal path is identified by `data-perch-problem`, not by its prose.

# One canvas, in `ui-kit`, rendered by both products — decisions

The runtime's `LayoutCanvas` moved into `packages/ui-kit`. Nothing it draws changed; what changed
is which package owns it, and therefore whether the editor can render the same pixels or has to
write a second canvas. `ARCHITECTURE.md` says the quiet part already: "`ui-kit` cannot live inside
`runtime` or `editor`, because **both render it**. The editor's canvas must draw the same gauge the
runtime draws, or WYSIWYG is a lie." The canvas was on the wrong side of that sentence.

## 1. The tree did not build when this started, and closing that was step one

`main` was red before any of this: `apps/runtime/src/layout-canvas.tsx` failed to compile
(`ChartElement` not assignable to `never` — the `assertNever` tripwire firing exactly as designed
on the new fourth element kind) and `apps/runtime/src/layouts.test.ts` asserted
`layout.schemaVersion === 1` against layouts that migration now reports as 2. Both are call-site
consequences of the chart/schema-v2 work, and that work's own decisions document names both and
assigns them elsewhere.

Nothing in the repo built until they closed, so a move could not be verified across them. They are
a separate first commit, deliberately minimal:

- `case 'chart':` renders the **existing** `.perch-element__failure` box — `no chart renderer yet:
  <widget>`. Not a chart. `ui-kit` ships no chart component, and inventing one under a refactor
  would put an undesigned graph on a wall panel. The visible-failure idiom is already the answer to
  "an element this page cannot paint": say so, rather than leave a blank rectangle.
- `LAYOUT_SCHEMA_VERSION` replaces the literal `1`, so the assertion tracks the contract instead of
  being re-edited at every version step.

Neither shipped layout contains a chart, so no pixel on either panel reaches the new branch. That
is what lets the equivalence claim below stand despite this commit existing.

## 2. `widget-catalogue.tsx` moved too, because a catalogue in one app is the same divergence

The brief names the canvas. The canvas calls `widgetFor`, and leaving the catalogue in
`apps/runtime` would mean the editor building its own — which is the identical failure one level
down: the runtime paints a gauge the editor cannot offer, or the editor offers one the runtime
refuses. Both products now inject *this* registry into `loadLayout`, so "which widgets exist" has
one answer in the repo rather than one per app.

`drawsScale` stayed out of the components, which was the original file's point and is unchanged: it
is the registry builder's knowledge, not a prop, so a widget stays usable by a caller holding no
layout at all.

## 3. `ui-kit` -> `layout-schema`, and not a third package

Taken as recommended. The edge is acyclic and both ends are leaves: `layout-schema` still imports
nothing, and still learns the widget vocabulary only by injection (`WidgetRegistry` handed to
`loadLayout` at the call site), which is its SPEC's hard rule 5 and is untouched by this direction
of edge.

A third package holding only the canvas was considered and rejected. It would buy one thing —
`ui-kit` keeping a single dependency — at the cost of a package boundary between the canvas and the
widgets it draws through, for a repo with one widget in it. That is ceremony, not architecture. If
`layout-schema` ever needs to *not* be reachable from a widget, the split can happen then, with a
reason.

Declaring the edge needed no `npm install`: the root `node_modules/@perch/layout-schema` symlink
already exists and `packages/ui-kit/node_modules` does not, so resolution walks up. No dependency
version was changed and `package-lock.json` is untouched.

## 4. What stayed in `apps/runtime`, and why `index.ts` lost exports rather than gaining wrappers

Staying: the page chrome and its provenance strip, the mock/MQTT source choice, the `layouts/`
catalogue and the `?layout=` plumbing, the viewport fit, and the refusal page. None of that is the
pixels of a layout.

`apps/runtime/src/index.ts` **dropped** its `LayoutCanvas` and `WIDGET_REGISTRY` re-exports rather
than forwarding them. Its old header justified exporting `WIDGET_REGISTRY` as the answer to "what
widgets does this runtime have — a question the editor will have to ask". That question now has a
better address, and a pass-through here would preserve the idea that the runtime owns the canvas,
which is the idea being removed.

## 5. The moved tests lost `createMockSource`, and that is the only assertion-level change

`ui-kit` may not import `sensor-sources`, so the two moved test files could not keep using
`createMockSource`. They now use the local `fakeSource()` double this package already uses in
`readout.test.tsx` and `sensor-context.test.tsx`, with the same metadata — `CPU_TEMP` labelled
`CPU Package`. Every assertion is unchanged, including the one that matters: the readout is labelled
from the metadata for *that exact topic*, which is how a widget proves it is bound to the topic the
layout named rather than to whichever topic arrived first. `source.tick()` became an explicit
`source.emit(CPU_TEMP, ...)`, which is the same publish with the value written down instead of
generated.

`widget-catalogue.test.tsx` needs no readings at all — it asserts that a registered name renders —
so it uses a source that never publishes, examining every widget in its no-reading state. That is
the state in which a missing component shows up.

## 6. Test count: 229 -> 230, and where each test went

| Workspace | Before | After | Files |
|---|---|---|---|
| `@perch/ui-kit` | 128 | 151 | 9 -> 11 |
| `@perch/runtime` | 101 | 79 | 8 -> 6 |
| total | 229 | 230 | 17 -> 17 |

`layout-canvas.test.tsx` (15) and `widget-catalogue.test.tsx` (7) moved intact, 22 tests, none
dropped, none rewritten beyond decision 5's double. The +1 is a new `ui-kit`
`dependency-edges.test.ts` case asserting the `layout-schema` edge resolves — the edge this change
introduces should be the kind of thing a test notices disappearing.

## 7. Evidence that both shipped layouts render identically

A temporary harness rendered `Dashboard` with the real `LAYOUT_CATALOGUE` at a frozen clock and a
seeded mock source, and dumped the `.perch-stage` subtree one tag per line. Stage only, deliberately:
the chrome carries a wall clock, so including it would guarantee a diff that means nothing. It goes
through `Dashboard`, whose public surface this change does not alter, which is what let the harness
file itself stay byte-identical across the two runs. Two runs before the move produced identical
output, so the harness is deterministic and any difference after it would have been real signal.

`diff -r before after`: **identical**, five trees — `desk-1920x400` live and waiting,
`tower-720x1280` live and waiting, and `invalid/broken-desk`. The refusal still refuses with the
same nine problems in the same order.

Five real-Chrome screenshots at each end as well: both layouts in capture mode at their exact
targets (1920x400, 720x1280), both at a normal browser-tab size (1440x900, letterboxed at 0.750x),
and the refusal page. Identical geometry, tile positions, typography and letterbox; the only
differences are the mock values and the wall clock, both of which vary by design, which is precisely
why the deterministic DOM snapshot carries the claim and the screenshots only confirm it to a human.

The honest caveat about "before": `main` did not compile (decision 1), so the before-capture is
taken **after the unblock commit and before the move**. That is the correct baseline for the move
itself, and no capture of broken `main` exists or could.

Everything here is mock-driven. The sensor host is offline for roughly 100 hours, so every number in
every capture was generated locally, and the pages say so themselves — "mock source - generated
values, not hardware" is rendered chrome, not a caption added afterwards.

## 8. Frame-budget discipline is unchanged, because the file is unchanged

The element skeleton is still fixed, still index-keyed over a fixed array, with no insert, move or
remove on update; still one `transform: scale()` on the whole canvas with no transition on it; still
absolute integer rects and `overflow: hidden`. The move did not touch the render path. The chart
branch added in decision 1 is a `<span>` in a branch no shipped layout reaches.

## 9. Doc rationales that had to be rewritten, because they justified the old location

Three comments were true only while this code lived in `apps/runtime`, and would have become
confidently wrong in place:

- `MEDIA_FITS_TO_FRAME` said the two fit unions stay separate "because `ui-kit` may not import
  `layout-schema`". That is now false, and it was never the real reason: `MediaFrame` must stay
  usable by a caller holding no layout at all. Replaced with that.
- `CANVAS_TOKEN_DEFAULTS` claimed "`ui-kit` has never heard of either". It has now.
- "A fourth member of `ELEMENT_KINDS`" became "A new member" — there are four, and `chart` is the
  one that proved the tripwire works.

A stale rationale is worse than no rationale, because the next reader takes it as a constraint.

## 10. Deliberately not done: adopting `formatScalePercent` in the chrome badge

The preceding change's decision 8 leaves `apps/runtime/src/app.tsx`'s `formatScale` to "whoever next
has that file", which is this change. It is declined here on purpose. It alters a string a person
reads in the chrome strip, and this change's entire claim is that nothing a person sees moved. Doing
both at once would make the equivalence evidence unable to tell a refactor from a formatting change.
It remains a one-line adoption for a change that is allowed to alter visible output.

## 11. Call sites: everything that reached the moved surface

`LayoutCanvas`, `LAYOUT_CANVAS_STYLES`, `canvasToken`, `CANVAS_TOKEN_DEFAULTS`, `WIDGET_REGISTRY`,
`WIDGET_NAMES`, `widgetFor`, and the types beside them:

| Call site | Uses | What happened |
|---|---|---|
| `packages/ui-kit/src/index.ts` | all of it | now the origin: two new export blocks, and `WidgetCatalogueEntry` had to become `export` for the declaration emit |
| `packages/ui-kit/src/layout-canvas.tsx` | `widgetFor` | relative import, unchanged in meaning |
| `apps/runtime/src/app.tsx:49` | `LAYOUT_CANVAS_STYLES`, `LayoutCanvas`, `WIDGET_REGISTRY` | two relative imports folded into the existing `@perch/ui-kit` import |
| `apps/runtime/src/index.ts` | re-exported both surfaces | re-exports removed, not forwarded (decision 4) |
| `apps/runtime/src/layouts.test.ts:35` | `WIDGET_REGISTRY` in `LOAD_OPTIONS` | retargeted to `@perch/ui-kit`; still the same registry the page loads with, which is what makes that file's claim hold |
| `packages/ui-kit/src/widget-catalogue.test.tsx` | `WIDGET_REGISTRY`, `WIDGET_NAMES`, `widgetFor` | moved with the file; source double swapped (decision 5) |
| `packages/ui-kit/src/layout-canvas.test.tsx` | `LayoutCanvas`, `WIDGET_REGISTRY` | moved with the file; source double swapped (decision 5) |
| `packages/ui-kit/src/dependency-edges.test.ts` | the new `layout-schema` edge | one case added |
| `apps/editor/`, `apps/caster/`, `apps/agent/`, `packages/sensor-*`, `packages/layout-schema/` | nothing | no change. The editor is the point of the move and has not been written yet |

Nothing outside `apps/runtime` imported either file, which is the whole reason this move is small:
the canvas was already only reachable from the one app, and that was the problem.

# The chrome scale badge adopts `formatScalePercent` — decisions

Scope of this change: one expression in `apps/runtime/src/app.tsx`, the test that pins what it
prints, and this section. Nothing outside `apps/runtime/` was edited. `TargetFit.scale` is untouched.

Evidence: `red-before.log` (the three new assertions failing against the old convention, with the
old strings in the diff), `root-lanes.log` (all five root lanes with their own exit codes),
`badge-text.txt` and the three `chrome-scale-*.png` captures of the badge in a real browser.

## 1. The local convention is deleted, not harmonised

`formatScale` in `app.tsx` is gone and the call site now calls `formatScalePercent` from
`@perch/layout-schema`. The alternative — a local percent format that agrees with the shared one
today — was rejected for the same reason a second copy of a topic string is: the two copies have no
mechanism holding them together, so the next precision change to either is a silent divergence.
The previous change's decision 8 exported the formatter for this call site and its own comment says
so; adopting it is what closes that loop rather than re-deciding it.

## 2. What a person actually saw before this

The same canvas, at the same viewport, printed two different numbers on the same page:

| Surface | Before | After |
|---|---|---|
| chrome badge, 1366x768 against a 1920x400 canvas | `0.711x` | `71.1%` |
| `target-mismatch` refusal, same canvas and viewport | `71.1%` | `71.1%` (unchanged) |

Two renderings of one measurement is not a cosmetic difference — a reader comparing the badge
against a refusal has no way to know they are the same number.

## 3. `TargetFit.scale` was not rounded, and the captures prove it

Only the printed string changed. `data-perch-scale` still carries
`0.7114583333333333` and the canvas transform is still `scale(0.711458)` —
both visible in `badge-text.txt`. Rounding the number to shorten the string would have moved
rendered geometry to save a printed digit, which is exactly what `TargetFit.scale`'s doc comment
forbids.

## 4. The test asserts the rendered string, at three fits

Because the string is what was wrong, `app.test.tsx` asserts the badge's text content and not
`data-perch-scale` — an assertion on the raw number passed throughout the defect. Three cases, one
per shape of scale, plus a fourth tying the two surfaces together:

| Case | Viewport / canvas | Badge text | Old text |
|---|---|---|---|
| untidy ratio | 1366x768 / 1920x400 | `windowed · letterboxed · 71.1%` | `windowed · letterboxed · 0.711x` |
| exactly 1 | 1024x768 / 1024x768 | `windowed · exact · 100%` | `windowed · exact · 1x` |
| above 1 | 1024x768 / 512x384 | `windowed · scaled · 200%` | `windowed · scaled · 2.000x` |
| both surfaces agree | 1366x768 / 1920x400, `mode=capture` | refusal contains `71.1%` | already passed |

The fourth case passed before the fix, which is the point of keeping it: the refusal was already
right, so it is the badge that had to move to meet it.

A `data-testid="perch-fit"` was added to the span. It is the only markup change, and it exists
because the item previously had no handle and `screen.getByText` on a string this change is
rewriting would be a test that asserts its own subject.

## 5. A 512x384 fixture layout was added to the test catalogue

`UNDERSIZE`, a canvas smaller than the 1024x768 jsdom viewport, because no existing fixture can
produce a scale above 1 and the direction above 1 is the reading `200%` makes legible where `2x`
does not. The catalogue's default layout is unaffected: sorted, `oversize` still comes first.

## 6. Swept `apps/runtime` for other local conventions, and found exactly one

The brief asked whether anything else in `apps/runtime` formats a scale, ratio, percentage or unit
locally while a shared formatter exists. Searched for `toFixed`, `Math.round`, `Math.floor`,
`toPrecision`, `toLocaleString`, `padStart` and literal `%` across all of `apps/runtime/src`: the
only hit was the line this change deletes.

Three near-misses, all correct as they stand and deliberately left alone:

- `layout-problem.tsx` already calls `formatLayoutIssues` — and calls it centrally, so a caller
  cannot format issues its own way. That is this decision, already made, in the same app.
- `publishedAt` uses `toLocaleTimeString`. A wall clock, not a scale; no shared formatter exists for
  it and inventing one to have a rule would be the opposite of the rule.
- `viewport.ts` formats nothing at all. It returns numbers and a sentence `layout-schema` built.

## 7. Found while doing it, and not fixed here: the strip truncates at 1366px

`chrome-scale-1366x768-letterboxed.png` shows the badge as
`windowed · letterboxed · 71.…` — the percentage is clipped by
`.perch-chrome__item`'s `text-overflow: ellipsis` because at 1366px the strip's contents,
including a long migration report, exceed the viewport width. It is pre-existing, unrelated to which
formatter produces the string, and shortening the string is not the fix. Recorded here rather than
silently widened into this change; `badge-text.txt` carries the untruncated text for the same frame.

## 8. Call sites: everything that reaches `formatScalePercent`

The diff touches no `packages/*` file, so nothing shared changed shape. The adopted symbol's call
sites, for completeness:

| Call site | Uses | What happened |
|---|---|---|
| `packages/layout-schema/src/target.ts:128` | the definition | unchanged |
| `packages/layout-schema/src/target.ts:142` | `describeScaling`, for a refusal sentence | unchanged |
| `packages/layout-schema/src/index.ts:101` | the barrel re-export | unchanged; already exported |
| `packages/layout-schema/src/target.test.ts:179` | pins the format itself | unchanged; still the one place the rounding rule is tested |
| `apps/runtime/src/app.tsx:376` | the chrome badge | **the change** — replaces a local `toFixed(3)` convention |
| `apps/runtime/src/app.test.tsx` | asserts the rendered badge text | new tests |
| `apps/editor/`, `apps/caster/`, `apps/agent/`, `packages/ui-kit/`, `packages/sensor-*` | nothing | no call sites; nothing to update |

After this change there is one implementation of the scale convention and two call sites printing
it, which is the state decision 8 of the previous change was aiming at.

# The layout editor, first slice — decisions

Scope of this change: `apps/editor`, previously a placeholder (`index.ts` plus two config tests),
becomes an editor that lists layouts, previews the selected one on the shared `ui-kit` canvas, edits
the fields that already exist, and writes a valid layout back out. Narrower than `apps/editor/SPEC.md`
on purpose — see decision 9 for what was left out and why nobody should think it was missed.

Evidence: `apps/editor` tests (70) pass; `.evidence/editor-preview-desk.png`,
`.evidence/editor-preview-tower.png`, `.evidence/editor-refuses-invalid.png`,
`.evidence/editor-saved.png` with `.evidence/editor-capture-report.json` (all mock data);
`.evidence/editor-save-diff.log` (what a live PUT wrote, then reverted). Root gates in the
build/test/typecheck log staged with this change.

## 1. Two properties are structural, not remembered

`SPEC.md` hard rule 1 (WYSIWYG) and hard rule 2 (validate before saving) are the whole point of the
app, so neither is left to discipline:

- **The preview renders what the runtime renders.** `LayoutPreview` contains `LayoutCanvas` from
  `@perch/ui-kit` and nothing else — there is no element rendering anywhere in `apps/editor`. The
  widget vocabulary is `WIDGET_REGISTRY` from the same package. `app.test.tsx` proves this the only
  way it can be proven: it renders `LayoutCanvas` directly with the same layout and scale and asserts
  the editor's canvas subtree is byte-identical HTML. A local reimplementation that looked right, or a
  wrapper that added a selection outline or a resize handle, would fail that test.
- **Nothing reaches disk unvalidated.** Every edit goes through `editDraft` -> `validateLayout`; the
  save button is gated on `canSave`; and `saveDraft` refuses independently of the button, making no
  HTTP request at all when there are issues. `save.test.ts`'s central assertion is that negative:
  an invalid draft produces no request.

## 2. Saving is a Vite dev-server PUT, and the containment rule is pure and tested

Three mechanisms were weighed: a dev-server middleware accepting a `PUT`, the File System Access API,
and download-and-replace. The PUT won — it writes the file in place with no picker, no second copy in
`~/Downloads`, and no browser-gated API. The cost, stated in `README.md` rather than implied, is that
it works only under `npm run dev`; a built `dist/` has no server to answer it.

The security-relevant half — turning a name from a URL into a path under `layouts/` — is not in the
middleware. It is `resolveSaveTarget` in `src/save-target.ts`, a pure function with a test per refusal
(`save-target.test.ts`): traversal, absolute paths, both separator spellings, hidden files, a NUL, a
newline, an over-long name, and the empty name a bare `PUT /__perch/layout/` produces. The middleware
imports nothing from `@perch/*`; it checks method, name (via that function), file existence (a 404 —
it edits existing files, it does not create them), body size, and that the body is JSON. Everything
semantic is the client's, done by `validateLayout` before any request.

This was exercised live: `curl` against a running server returned 405/400/404/400 for wrong method,
traversal, a nonexistent name, and non-JSON, each with its sentence as the body; a real edit wrote the
file (`editor-save-diff.log`), which was then reverted so `layouts/` is clean.

## 3. The draft is a typed `Layout`, so ordinary edits exercise the refusal path

`DraftState` carries the typed document the author is editing (`draft`), the last document that
validated (`rendered`, which the canvas paints), and the current issues. Because `draft` is a real
`Layout` and the edit functions in `layout-edits.ts` are the operations ordinary controls perform, an
invalid state is reached the way an author reaches it — a zero width, a cleared number, an emptied
string, a topic that is not one — not by constructing a shape only a test could build. When an edit
fails to validate, `rendered` holds the last good document, so the preview freezes on the last thing
the runtime would have accepted while the control still shows the author their own typed value.

## 4. The preview paints `rendered`, sized in JS from shared constants

The canvas is always the layout's authored `target` size; only a `transform: scale()` changes, capped
at 1 so the preview never judges an upscaled resample. The scale comes from `fitLayoutTarget` against a
viewport computed in JavaScript (`preview-viewport.ts`, following the runtime's `useSyncExternalStore`
pattern) rather than from a `ResizeObserver`, which jsdom does not implement. The three layout numbers
(header height, inspector width, pane padding) live in one module and are interpolated into the CSS, so
the box the arithmetic scales for is the box the element is actually in.

`.perch-stage` from `ui-kit` could not be reused for the pane — it is `width: 100vw; height: 100vh`,
which is correct for a full-screen runtime and useless for an editor pane. See finding A.

## 5. Offered-only listing; `invalid/` openable but unsaveable

`layout-library.ts` is glob-backed. `names` lists only the shipped, valid layouts, sorted. The
`layouts/invalid/` fixtures are catalogued but not offered, reachable via `?layout=invalid/broken-desk`
so the editor's own refusal screen can be exercised against a real document — and unsaveable, which
falls out of `resolveSaveTarget` refusing separators rather than from a special case.

## 6. Range and enum fields edit only what is authored

`RangeFields` appears only when an element already has a `range`; there is no "add a range", and no way
back from a set `fit`/`gap` to unset. Editing existing fields is this slice; adding and removing
optional structure is element authoring, which is not (decision 9). Topic suggestions come from
`createMockSource().topics` via a `<datalist>` — `SPEC.md`'s "picker populated from live topics",
reduced to what is available with the sensor host off.

## 7. The source is the mock, unconditionally, and the page says so

Unlike the runtime, `apps/editor` has no mock/MQTT seam: `main.tsx` builds `createMockSource()` and
nothing else. Authoring must not require hardware — the sensor host is off for days — and an editor
that needed a relay to draw a readout could not be used to lay one out. The header shows
`mock data - generated here, not hardware` with `data-perch-source-kind="mock"`, the same wording and
attribute as the runtime's chrome, so no screenshot can be misread as a live panel.

## 8. Opening plus saving a shipped layout upgrades schemaVersion 1 -> 2

Both shipped layouts are version 1; the loader migrates them to 2 on open. The editor carries the
migration report (`formatMigrationReport`) and prints it in a bar before the save, because it is this
editor that moves the number and an author should not first meet it in a diff. A save also re-expands
the hand-collapsed one-line objects in `layouts/*.json`, so the first save of a shipped layout shows a
large whitespace diff plus the version bump; the bytes still round-trip through the runtime loader
(`save.test.ts`). Both facts are in `README.md`.

## 9. Left out of this slice, on purpose

Not missed - scoped out, to match the ask ("switch and preview layouts and start customizing them")
rather than the whole SPEC:

- **Direct manipulation** (drag, resize, snap, align on the canvas). Form editing only this slice.
- **Creating or deleting elements**, and adding/removing optional fields (`range`, `fit`, `gap`).
- **Asset management** (a media library, uploads). The editor resolves the assets the bundler found
  and marks a missing one; it does not add them.
- **Multi-layout projects and templates.**
- **An undo stack.** There is none, which is why switching the picker with unsaved edits parks the
  switch behind an explicit discard rather than silently throwing work away.

## 10. Findings: what was awkward to consume from an editor's side

Recorded rather than fixed, because `ui-kit` and `layout-schema` have other writers this slice and the
brief said to treat a needed change to them as a finding, not an edit:

- **A. `ui-kit` has no pane-sized stage.** `.perch-stage` is `100vw/100vh`. Both the runtime and the
  editor want "centre a scaled canvas in the box I give you"; a stage sized from its parent would serve
  both. The editor copies only the centring and the letterbox token (`canvasToken`) into `PREVIEW_STYLES`.
- **B. `ui-kit` exports no aggregated stylesheet.** Every consumer must learn each sheet name
  (`READOUT_STYLES`, `TEXT_BLOCK_STYLES`, `MEDIA_FRAME_STYLES`, `LAYOUT_CANVAS_STYLES`, and whatever the
  chart widget adds). A single `UI_KIT_STYLES` barrel would mean a new widget's styles arrive without
  every app editing its `<style>` list. The editor mounts the sheets it knows about.
- **C. `layout-schema` has no `serializeLayout`.** The loader is the source of truth for reading and
  the validator for shape, but writing the canonical on-disk form is left to callers, so the editor
  supplies its own (`save.ts`) and pins the format in `save.test.ts`. If a second writer ever appears,
  this belongs in the schema.
- **D. `LOAD_OPTIONS` is duplicated between runtime and editor.** `apps/` may not import `apps/`, so
  the two apps cannot share the constant; they share its ingredients instead (`WIDGET_REGISTRY` and
  `normalizeSensorTopic`, both from packages). Both sides name the same two exported values, so this is
  agreement, not divergence — but it is duplication a shared non-app module would remove.

## 11. Call sites: this change touches no `packages/*` file

Nothing shared changed shape, so there is nothing whose call sites need updating. `apps/editor` is a
leaf — `SPEC.md` says nothing depends on it, and nothing does. The files this worker owns and wrote,
all under `apps/editor/` plus this `DECISIONS.md` section:

`src/app.tsx`, `src/main.tsx`, `src/draft.ts`, `src/layout-edits.ts`, `src/layout-library.ts`,
`src/inspector.tsx`, `src/problems.tsx`, `src/preview.tsx`, `src/preview-viewport.ts`, `src/save.ts`,
`src/save-target.ts`, `src/index.ts` (rewritten from the placeholder); tests `src/app.test.tsx`,
`src/draft.test.ts`, `src/layout-library.test.ts`, `src/save.test.ts`, `src/save-target.test.ts`;
`index.html`, `vite.config.ts`, `package.json`, `vitest.setup.ts`. The other workers' `packages/ui-kit`
and `apps/runtime` edits, the new `packages/ui-kit` chart/line-chart files, `layouts/trend-1920x400.json`,
and `.claude/settings.json` were left unstaged.

# perch's first chart: the history store and the line renderer — decisions

These are the decisions taken building the `kind: 'chart'` renderer whose contract the layout-schema
worker had already settled (its section above, "A chart element in the layout contract"). That section
ends "there is no chart renderer yet, and every choice below was made to be the thing a renderer is
built against." This is that renderer. Nothing in `packages/layout-schema` was touched; where the
contract was awkward to implement against, it is reported in 8 and 9 rather than patched.

Two commits: the history store (`ab18d9c`) and the widget. They read as two because history is a
store concern that a chart happens to be the first consumer of, and the widget is a pure view over it.

## 1. History is a bounded ring in the ui-kit store, sized by the longest window any chart asks for

No history existed: the MQTT source buffers nothing on purpose and the relay publishes only the latest
reading. The approved design puts history in the store, not the source and not the relay. A `TopicRing`
per topic holds readings; its capacity is derived from a `WindowDemand` ledger — a multiset of the
`windowMs` values of every mounted chart on that topic — as `historyCapacity(max(windows))`. One ring
per topic, shared by every chart on it, so two charts on one topic cost one buffer sized to the longer.

Rejected and not drifted toward: relay-side retention (the relay stays latest-only) and a time-series
store (this is a fixed-size ring in memory, nothing queryable). Accepted on the record: history does
not survive a page reload — the canvas text on the demo layout says so.

## 2. Demand shrinks, it is not monotonic-forever

The doubt the brief named: "the buffer's size is derived from demand, so that derivation needs to be
honest rather than monotonic-forever." `WindowDemand` is a counted multiset. `retain(windowMs)` adds a
count and `release()` removes exactly one; `recompute()` rescans the live counts so the ring's capacity
*falls* when the widest chart unmounts. A chart unmount releases its window; when the last chart on a
topic releases, the ring is dropped and the memory freed (`forgetHistoryIfIdle`). Retention lives in
`useSensorHistory`'s `subscribe`, not in an effect, so it is in place before the first `getSnapshot`
and is StrictMode-safe. `sensor-history.test.ts` covers shrink-on-release, the two-charts-one-ring
case, idempotent release, and that nothing grows without limit (a 10,000-reading run stays capped).

## 3. The x-axis advances with no new reading, and the geometry stays a pure function of a snapshot

A chart is a line over time, so it must move left even while a publisher is quiet. The store carries
`endsAt` inside the published `SensorHistorySnapshot` and republishes once per recheck tick; materiality
is quantised to whole seconds so an idle topic does not churn. `chartView` is then a pure function of
the snapshot — clock included, because the clock arrives as `endsAt`. "Same snapshot, same pixels" is
asserted directly (`chartView(x)` deep-equals `chartView(x)`), which is what the capture story rests on.

## 4. The frame budget: one path per series, holes as `M` moves, a fixed skeleton

Every output path *captures* the page, so redraw must finish inside the capture interval and the element
skeleton must not reflow on update. Three things hold the node count constant across every state:
one `<path>` for the whole series (holes are `M` subpath moves inside one `d`, not extra elements),
a fixed `CHART_GRIDLINE_COUNT`, and every text run plus the marker always rendered (the placeholder is
an empty string, the marker toggles on `data-shown`, not on mount). An update writes text and attributes
only. The plot is sized by arithmetic from the authored rect, never measured — a `ResizeObserver` fires
after layout, so a measured chart would draw frame one at the wrong size and move it on frame two, a
reflow inside the capture interval. Redraw cost is bounded by the rect, not the publish rate: per-pixel-
column thinning keeps the min and max of each column, capping points at `(plot.w + 1) * 2`. At a 386px
plot that is 774; a 40 Hz publisher's 2,401 readings over a minute still render <= 774 (proved in
`chart-view.test.ts`, and `red-2` shows the assertion bites when thinning is removed). Coordinates are
whole pixels, so two frames of identical data produce byte-identical `d` strings and nothing re-rasterises.

## 5. Panel strokes: 3px line, hairline grid solved by placement, 10px ringed marker

The output is a 1920x400 LCD read across a room, where thin lines flicker and sub-pixel antialiasing
reads badly. So, adjusted once for the target and only once: a **3px** round-capped series line where a
screen chart uses 2px (odd-times-one, so a stroke on an integer pixel covers whole pixels; the round cap
also makes a single reading paint as a dot). Gridlines stay **1px hairline** — the panel problem is
solved by *placing* the line on a half-integer with `shape-rendering: crispEdges`, so it lands on one
row of pixels instead of smearing over two, rather than by thickening it into a table of boxes. The
newest reading carries a **10px** marker with a 2px surface ring so it stays legible where it crosses
the line. The series keeps default rendering, because a diagonal stroke needs antialiasing to read as a
line. Captures at both sizes were inspected (`.evidence/chart-widget/CAPTURES.md`); the line reads
cleanly at 1:1 and the grid recedes.

## 6. Empty and all-stale both render legibly, and are different states

A chart with nothing in its window paints the frame, grid and scale, prints `--`, and carries
`waiting for readings` — a reader sees what it will plot and against what scale before the first reading.
A chart whose newest reading is older than the store's staleness threshold draws the line in
`--perch-stale`, rings the marker the same, prints the held-but-old number, and notes its age; the shape
is worth seeing, what must not happen is showing it as current. A third placeholder, `no values in
window`, covers a present sensor reporting only nulls: there is a series and no line, which an empty plot
under an `n/a` header would not explain. All three are in the demo capture at once (cpu live, cooler
`no values in window`, psu `waiting for readings`).

## 7. `gap` is honoured exactly, and the hole threshold is borrowed, not invented

`'break'` is the default because spanning draws a line through time where no measurement existed — the
same untruth as two units on one axis. The widget defaults to `DEFAULT_CHART_GAP` (it does not restate
`'break'`), so if the format ever changes its default this follows without an edit; `red-1` shows the
break-by-default tests fail the moment the default is hardcoded wrong. `'span'` draws through a hole and
only when an author asks. A null reading contributes no coordinate under either setting — `span` decides
whether the pen lifts, never whether a missing measurement becomes a number. The definition of "a hole"
has no home in the chart contract, so it is borrowed from `store.staleAfterMs`: the one definition of
"a publisher went quiet" in the system, so a chart and the readout beside it agree about the same silence.

## 8. Awkwardness reported, not patched (1): a widget name resolves against one registry for two kinds

A `chart` element's `widget` resolves against the *same* `WidgetRegistry` as a `widget` element — the
same name check, the same `drawsScale`/`range` rule — which is correct, so "charts need ranges" is not a
second mechanism. But `ChartElement` carries `windowMs`/`gap` a `WidgetElement` has no field for, so the
catalogue entry is a union discriminated on `binding: 'widget' | 'chart'`, and each renderer gets its
narrowed element with no cast. The registry cannot make a mismatch impossible — it has one capability
flag and it is about scales — so `widget: line-chart` on a `kind: 'widget'` element, and `widget:
readout` on a `kind: 'chart'` element, both validate and are caught in `layout-canvas.tsx` as visible
failure boxes rather than handed to a renderer reading fields that are not there. This is the format's
limit, reported here per the schema worker's own call-site note; it is not a schema defect to patch.

## 9. Awkwardness reported, not patched (2): the chart contract has no place for the hole threshold

`ChartGap` says whether to break or span, but "how long a silence is a hole" is not in the element — it
is a property of the source's cadence, which the layout author does not know. Deriving it from
`staleAfterMs` (8, above) is the right answer, but it means a chart's break behaviour depends on a store
setting the layout file cannot see or set. Worth noting while the format is young: if per-chart control
is ever wanted, the field belongs on the element, and the contract would grow to carry it.

## Call sites — what the `packages/ui-kit` changes touch

- `packages/ui-kit/src/index.ts` — re-exports the new surface (`chartView`, `LineChart`,
  `LINE_CHART_STYLES`, the `CHART_*` constants, `WidgetBinding`, the history exports). Consumed by
  `apps/runtime` and `apps/editor` through `@perch/ui-kit`.
- `packages/ui-kit/src/widget-catalogue.tsx` — `WidgetCatalogueEntry` became a `binding`-discriminated
  union; a `line-chart` entry was added. `WIDGET_REGISTRY` (derived from it) is injected into
  `loadLayout` by both apps, so a new registry entry is a new widget both apps accept and draw.
- `packages/ui-kit/src/layout-canvas.tsx` — `renderChart` now dispatches through `widgetFor` with a
  binding check; `renderWidget` gained the mirror check. `LayoutCanvas` is rendered by `apps/runtime`
  and `apps/editor`; both reach this branch for any `kind: 'chart'` element.
- `packages/ui-kit/src/tokens.ts` — seven `--perch-chart-*` tokens added; read only by
  `LINE_CHART_STYLES`. `tokens.test.ts` enforces every token is referenced by a registered sheet, so
  `LINE_CHART_STYLES` joined `SHEETS`.
- `packages/ui-kit/src/{chart-view,line-chart}.ts(x)` — new; `line-chart.tsx` is reached only through
  the catalogue, `chart-view.ts` also directly by tests and any capture harness that wants geometry
  without mounting React.
- `layouts/trend-1920x400.json` — new content, outside every workspace. Picked up by the runtime's
  glob catalogue; sorts after `desk-1920x400`, so the default layout is unchanged.

## The `#8a7470` validator note

The `dataviz` validator FAILs `--perch-stale` (`#8a7470`) on its chroma floor in any paired run. It is
not "fixed": `--perch-stale` is perch's pre-existing status colour, and the validator's own scope line
says a lone status colour is checked by WCAG text contrast instead of the categorical-series chroma
floor. The series colour it is measured against, `--perch-chart-series` (`#4c9ad8`), was chosen by
running the validator against the canvas surface: it passes the lightness band, the chroma floor and 3:1
contrast alone, and sits 16.8 ΔE (normal) / 15.0 ΔE (deuteranopia) from `--perch-stale`, which is what
lets a stale series read as the same line in another state rather than as a second series.

## Evidence

Mock-driven throughout; the sensor host is offline. Under `.evidence/chart-widget/`: `RED-FIRST.md`
(three reverted-hunk red probes), `CAPTURES.md` and the two PNGs (`.evidence/chart-trend-1920x400.png`
at scale 1, `.evidence/chart-trend-1440x900-tab.png` letterboxed at 75%), `chart-capture-report.json`
(the machine-readable twin), and the root-gate logs. No adversarial-review file and no `code-review.md`,
per the standing rule.

# One command for the editing loop, and startup failures that read — decisions

`npm run dev` now brings up the editor and the runtime together and prints where to go. The relay
joins them when something would read it. Every startup failure that could be caused on this machine
was caused, and each one now says what it is and what to do in one read.

## 1. `npm run dev` *is* the stack; `dev:stack` is the same script under its older name

The instruction was fewest commands to remember, and the way to honour that is not a fourth script
or a flag on the third — it is the command everyone already types doing the obvious thing. So
`npm run dev` runs `tools/dev-stack.mjs`, and `dev:stack` stays pointed at the same file so nothing
already written down or in muscle memory breaks. The single-app loops did not disappear, they moved
to `dev:runtime` and `dev:editor`, which are escape hatches rather than a choice anybody has to make
at the start of a session.

Nothing new was added to run the two servers: a flag on `dev:stack` would have meant remembering a
flag, and a `dev:editor+runtime` script would have meant choosing between three.

## 2. The editor and the runtime are one command because they are one loop

The editor's save endpoint writes the real `layouts/<name>.json` and exists **only** under
`npm run dev` (`apps/editor/vite.config.ts` says why), and the runtime's dev server globs that same
directory. So a save in one tab reloads the other — proven in the evidence log: `PUT
/__perch/layout/desk-1920x400` answered 204 and both dev servers logged `page reload
.../layouts/desk-1920x400.json`. Two terminals made "the editor cannot save" something you could
arrange by accident, by starting the editor from a built bundle or forgetting it entirely.

## 3. The relay starts only when something would read it

This is the one behaviour change worth arguing. `PERCH_BROKER_URL` decides which source the page
reads and nothing else does — README.md states it, `sensor-sources` implements it — so with it unset
the page reads its generated mock and a relay is a broker this stack's own page will not dial. It
costs a `tsc -b`, it can prompt about somebody's Mosquitto, and against a sensor host that is
switched off it writes `[error] poll failed` into the first screen of a startup that worked. Three
costs, no reader.

So in `auto` (the default), the relay starts when `PERCH_BROKER_URL` or `PERCH_LHM_HOST` is set.
`--relay` starts it regardless and says plainly that the page is still on mock data; `--no-relay`
never does, and warns if `PERCH_BROKER_URL` is set, because then the page will show its error badge.
The alternative — always start it and label the noise — was rejected because the honest label is
"this is running for nobody".

## 4. A dev-server port clash is a message problem, not a behaviour problem

Both dev servers set `strictPort`, and that is correct: a capture navigates to a fixed URL, and a
server that drifts to 5174 turns a screenshot into a picture of whatever else was listening. What
Vite gives you for it is `Error: Port 5173 is already in use` over six stack frames, naming neither
the holder nor a way out — and with three worktrees of this repo on one machine, "which one is it"
is the actual question. So the ports are checked before anything is built, by *binding* them (the
same question Vite is about to ask, so an IPv4/IPv6 split cannot make the check disagree with the
failure), and a clash prints the port, what wanted it, the holding pid, that process's **full
command line** — which is what identifies the checkout — and three pasteable ways on: `kill <pid>`,
`--runtime-port <a port that is free right now>`, or the matching `PERCH_RUNTIME_PORT`.

`--editor-port` / `--runtime-port` (and `PERCH_EDITOR_PORT` / `PERCH_RUNTIME_PORT`) are passed to
Vite on its command line rather than written into either `vite.config.ts`, so `strictPort` keeps
meaning what it says — the URL is fixed for this run — while a second worktree can still have a port.
Resolution is flag then variable then default, the order the relay's own config already documents.

## 5. The unreachable sensor host is announced before the relay complains about it

The usual state of this machine is the sensor host switched off, and the relay reports that
correctly — one `[error] poll failed` line, then a summary on a widening interval. Correct and, as
the first thing under a banner, indistinguishable from a startup that failed. So when the relay is
starting, `localhost:8085` is probed and the banner says what the log is about to say and that it is
not a failure. A *probe* rather than a guess: with no answer from the probe (no resolver, no
permission) nothing is claimed.

## 6. The banner is printed last, and only after both servers answer

The complaint was that startup tells you nothing about where to go. A banner printed before Vite's
own output has scrolled away by the time the servers are up, so it waits for an HTTP response from
each URL and prints after — which also means the URLs in it have been checked rather than predicted.
If one never answers, that is said, naming the tag its output is under.

## 7. `layouts/` is listed, and an unparseable file is flagged — parseability only

The banner lists what `?layout=` accepts, mirroring `apps/runtime/src/layout-catalogue.ts` exactly
(`layouts/*.json`, sorted, first is the default), because a list that disagreed with the picker would
be worse than no list. A file that is not parseable JSON is listed *and* flagged with the parse
error, since the picker lists it too.

**Parseability and nothing deeper.** A document can be JSON and still not be a layout, and that check
is `loadLayoutJson` against `WIDGET_REGISTRY`, which lives in a React package: importing it here
would couple startup to `ui-kit` running outside a browser and to a prior `tsc -b`.
`apps/editor/vite.config.ts` refuses the same import for the same reason. The pages already put
schema issues on screen (`layout-problem.tsx`, `data-perch-problem="invalid-layout"`); what they
cannot do is warn you before you pick the file.

## 8. The broker-port courtesy was judged and left alone

1883/9001 held by a Homebrew `mosquitto` was caused: the existing offer-to-stop reads well, and
non-interactively it names the pid and the two variables and stops there without touching anyone's
service. When the ports are set explicitly the check is skipped and the relay's own bind failure
reports it — and that message is better than anything this script would write, naming the port, a
free one to move to, `--mqtt-port 0`, and why the default is not the thing to change. Pre-flighting
it here would mean re-deriving the relay's whole flag/variable/default resolution in the launcher.
The cost of leaving it is that the failure arrives after the relay's build; that is one `tsc -b`.

## 9. A stack that died reported success — fixed

Found by running it. `shutdown()` set the exit code inside an `unref`ed timer, so once the last
child's streams closed Node exited before the timer fired: `npm run dev -- --relay` against this
machine's Mosquitto printed `exited (1) — stopping the stack` and exited **0**. `process.exitCode` is
now set the moment shutdown begins. Pre-existing, and only visible because the relay was made to
fail on purpose. (Both captured logs are in the evidence directory, the 0 and the 1.)

One thing deliberately not changed: the relay dying still takes the whole stack down. It is the
existing documented policy — a half-stack that looks alive but cannot work is worse to debug — and
with `PERCH_BROKER_URL` set the pages really are broken without it.

## 10. The tested part is separated from the part that needs a socket

`tools/dev-startup.mjs` holds everything decided before a child is spawned — argument parsing, the
relay decision, and the **wording** of every message — as functions of their arguments, imported by
`dev-stack.mjs` and by `tools/dev-startup.test.mjs`. The wording is the deliverable here, so it has
to be assertable; `dev-stack.mjs` is a script with top-level `await` and cannot be imported without
starting a stack. `tools/` is not a workspace, so the root `test` script runs
`vitest run --root tools` after the workspace fan-out rather than making it one (which would mean a
`package-lock.json` change for two dependency-free files).

Still stdlib-only, and `dev-startup.mjs` imports nothing at all. No process runner, no argument
parser, no word wrapper — the wrapper is ten lines.

## 11. A clean stop said `npm error code 143` fourteen times — silenced

Also found by running it. Ctrl-C signals both dev servers, `npm run` treats a signalled script as a
failed one, and each wrapper prints a seven-line post-mortem: a deliberate stop ended in fourteen
lines of `npm error`, which is a success that reads as two failures — the same defect this task is
about, arriving at the end of it. Once shutdown begins, a child's output is no longer forwarded. The
exception is the child whose death *started* the shutdown, because its diagnostic can still be
flushing and it is the reason the stack is stopping: the Mosquitto run still prints the relay's own
`cannot listen on 0.0.0.0:1883` message in full, and still exits 1.

## Call sites

No `packages/*` symbol was touched, so there are no cross-package call sites. What changed outside
`tools/`:

- `package.json` — `dev` now runs the stack; `dev:stack` is an alias of it; `dev:runtime` and
  `dev:editor` are new; `test` gained `&& npm run test:tools`. No dependency added, `package-lock.json`
  untouched.
- `README.md` — the running section, rewritten around the one command.
- `apps/editor`, `apps/runtime`, `packages/*`, `layouts/`, every MQTT topic: unchanged. The port
  override reaches Vite through its own CLI precedence, so neither `vite.config.ts` needed an edit.

## Evidence

Under `.evidence/dev-startup/`: `startup-default.log` (the one command on its default ports, both
URLs answering 200, and the save-to-reload round trip), `startup-failures.log` (every failure caused
rather than imagined: both dev-server ports held by another instance, six argument refusals, an
unparseable `layouts/desk-1920x400.json`, the relay against a live Mosquitto before and after the
exit-code fix, the relay with no sensor host), `red-first.log` (six reverted-hunk probes, each
turning the suite red on exactly the claim it removes, the file restored byte-identical each time)
and the root `build.log` / `test.log`. No screenshots: nothing rendered changed. No `code-review.md`
and no adversarial review, per the standing rule.

# Two intents for one token map: Customize and Developer — decisions

The theme pane listed the keys a document happened to hold, under their raw `--perch-...` names, with
a text box each and a button marked `remove`. It is now two tabs: **Customize**, the whole vocabulary
under readable labels with a control per token type, and **Developer**, the document's own keys by raw
name. Presentation only — same document in, same document out. No `layout-schema` change, no MQTT
topic change, no dependency added, `package-lock.json` untouched.

## 1. "Remove" was useful and misnamed — confirmed in the code and in a browser

A token map is a map of **overrides**. `packages/ui-kit/src/tokens.ts` declares 29 widget tokens with
default values and every reference to one goes through `token()`, which emits
`var(--perch-fg, #f2f4f8)` — the default is written into the stylesheet, not into the layout. So
dropping a key from `theme` does not leave the token unset; the declared default takes over. That is
also why blanking a value is refused rather than treated as removal (`validateTokenMap` rejects an
empty value and says to remove the key), which the old form's comment already recorded.

Verified in the running editor rather than only read: resetting `--perch-fg` on `desk-1920x400`
cleared the inline custom property on the canvas (`fgOverride: ""`) and the readout's computed colour
moved from `rgb(232, 241, 255)` to `rgb(242, 244, 248)` — `#f2f4f8`, the value `tokens.ts` declares.
Nothing went unstyled. So the control stays, it is named **reset**, and it belongs in Customize: it is
the only removal a consumer needs and the only one that cannot lose anything.

## 2. The vocabulary is 31 tokens, and 12 of them are colours

Two corrections to the numbers this work started from. It is **31**, not 29: `tokens.ts` declares 29
and `layout-canvas.tsx` declares two more, `--perch-canvas-bg` and `--perch-letterbox-bg`, which all
three shipped layouts set in `theme`. A labels table that covered only `tokens.ts` would have left two
tokens every real layout uses without a label.

And colour is **12** of the 31, not eight: `--perch-fg`, `--perch-dim`, `--perch-faint`,
`--perch-stale`, `--perch-warn`, `--perch-alert`, `--perch-text-color`, `--perch-chart-series`,
`--perch-chart-grid`, `--perch-chart-surface`, and the canvas' two. The remaining 19 are 8 lengths
(sizes in `rem`), 5 unitless numbers (two weights, two opacities, a line height), 4 enumerated values
(`text-transform`, `justify-content`, `align-items`, `text-align`), and 2 open text — the font stack,
and `--perch-text-tracking`, which is a length *or* the keyword `normal` and so cannot be a stepper.

The human's point survives the correction intact: a text box for all 31 types blind over half the
theme. Each token now carries its control kind, and `token-labels.test.ts` holds the invariant that
keeps a wrong one from shipping — **every declared control must be able to hold the default this
package ships for that token**. A colour control on `--perch-font` fails the build.

## 3. The labels live in `ui-kit`, in a sibling module rather than inside `tokens.ts`

`ui-kit` owns the token vocabulary, so it owns the words for it; the editor would otherwise name a
vocabulary it does not own, and a token added here would arrive there unlabelled. The layout file was
rejected outright: that is a schema field, a migration, and a per-layout copy of a name identical in
every layout.

The one deviation is which file. The table is `packages/ui-kit/src/token-labels.ts`, not an addition to
`tokens.ts`, for a reason that is mechanical rather than aesthetic: it must describe **both** defaults
records, and merging `CANVAS_TOKEN_DEFAULTS` into `tokens.ts` would break `tokens.test.ts`'s standing
invariant that every declared token is referenced by some sheet — the canvas tokens are referenced by
`LAYOUT_CANVAS_STYLES`, which that test's `SHEETS` map does not include. `tokens.test.ts` is untouched
and still green; the joined lookup `PERCH_KNOWN_TOKEN_DEFAULTS` is built in the new module.

## 4. A disclosure, not a tooltip

The raw token name is behind a per-row button with `aria-expanded`, not a `title`. A `title` is
invisible to a keyboard and to a touch screen, cannot be selected or copied, and holds one string —
whereas what is worth revealing is more than one fact: the token name, the value it falls back to, and
on an element's map where that fallback comes from. The revealed name is real text an author can paste
into a layout file.

## 5. Customize shows every token, not only the colours — a default taken, not a decision given

This was explicitly not mine to decide, and it is not settled by having been built. Customize shows all
31 (29 at element scope) with a type-appropriate control, grouped colour / type / placement. Narrowing
it to colour later is one `filter` and a group title; widening it from colour would have meant building
the type-appropriate controls that are the substance of this slice. So the reversible direction was
built first. The counter-argument is real: twelve colours is a pane you skim, and thirty-one rows is a
pane you scroll.

## 6. The same removal, two sentences, because it has two consequences

On Developer a known name offers **remove override** and says what takes over; a name `ui-kit` does not
declare offers **delete** and says that nothing does, so the value is gone. Different words, different
colours, and the custom row is flagged `no label · ui-kit does not declare this token` rather than
hidden — a layout may legally hold any well-formed custom property, and a pane that dropped those rows
would hide part of the document.

## 7. An element's `style` sits under the layout's `theme`, and the pane says so

Found by looking at the element-level capture, not by reasoning: the first build of the pane answered
"default `#f2f4f8`" for `--perch-fg` on a text element while the author could see `#e8f1ff` painting,
because the layout's theme sets it one level up. Naming the package's number for a value the layout
owns is the exact failure this pane exists to prevent, so `TokenPane` takes an `inherited` map — the
layout's `theme`, passed down by `StyleFields`. A row the element does not set now reads **from the
layout theme**, its control is bound to the layout's value, its reset says the layout's value takes
over, and the disclosure prints the layout's value and the `ui-kit` default side by side. A token
neither sets still reads `default`. The element pane also drops the canvas' two tokens, which an
element box cannot change: `5 of 29 set`, against the theme's `13 of 31 set`.

## Call sites — `packages/ui-kit`

Additions only; nothing existing changed behaviour. The new module's exports
(`PERCH_TOKEN_LABELS`, `PERCH_KNOWN_TOKENS`, `PERCH_KNOWN_TOKEN_DEFAULTS`, `TOKEN_GROUPS`,
`isKnownToken`, `tokenLabel`, `knownTokenDefault`, and the types) are read by exactly four files:
`packages/ui-kit/src/index.ts` (re-export), `packages/ui-kit/src/token-labels.test.ts`,
`apps/editor/src/token-pane.tsx`, `apps/editor/src/token-pane.test.tsx`. `tokens.ts`,
`layout-canvas.tsx`, `tokens.test.ts` and every other consumer of `ui-kit` are unmodified —
`apps/runtime` does not import any of it.

## What did not change

`packages/layout-schema` (no field, no validator), every MQTT topic, the bytes a saved layout holds,
`package-lock.json`, and `apps/editor/src/app.test.tsx`'s byte-identical-markup assertion. The two
dependencies the pane uses, `react-colorful` and `react-rnd`, were already in `apps/editor`.

## Evidence

Under `.evidence/perch-editor-theme-tabs/`: `build.log`, `test.log`, `typecheck.log`, `lint.log` (all
exit 0; 101 editor tests, 277 in `ui-kit`), and three red-first captures —
`red-1-no-modules.log` (both new suites unresolved), `red-2-pane-unimplemented.log` (19 failures
against a stub), `red-3-inherited.log` (the five inherited-value assertions failing before decision 7
existed, with the sixth already passing as a regression guard).

Captures at 1920x400 and 1440x900: `customize-overridden-1920x400.png` /
`customize-overridden-1440x900.png` (an overridden row with its `set by this layout` flag, its reset,
the revealed token name and default, and the picker open), `developer-1920x400.png` /
`developer-1440x900.png` (raw names, and `--brand-hue` beside `--perch-fg` with the two different
removals), `element-style-inherited-1440x900.png` / `element-style-inherited-1920x400.png` and
`element-developer-1440x900.png` (decision 7 in the running editor). `browser-drive.log` and
`browser-drive-element.log` record what was read from the page at each step, including the computed
colour before and after the reset.

No `code-review.md` and no adversarial review, per the standing rule.

## Residual: a custom token cannot be given a label

Deliberately not built. A developer-set label for a name `ui-kit` does not declare has nowhere to live
that is not the layout file, which means a `layout-schema` field — a cross-component interface change,
a migration for three shipped layouts, and a second owner for a kind of name the package otherwise
owns. So a custom token appears on Developer under its raw name, honestly marked as unlabelled, and
the Developer tab sets no labels at all in this slice. The cost of changing that is the schema field
plus a migration plus the editing surface; the question it raises first is whether a custom token
should be labelled in one layout and not in another.

# Colour first, and two removals that are not the same act — decisions

The swatch now leads a colour row and the hex literal follows, in both panes, since both panes are one
component. Customize's "name" disclosure is gone, and the fact it carried — what an overridden row goes
back to — survives as quiet text beside the control. Both removals became icons, and revert and delete
are deliberately not the same icon. Presentation only: same document in, same document out. No
`layout-schema` change, no topic change, no dependency, `package-lock.json` untouched.

## Decisions to evaluate

D1 The removal icon is a revert arrow (U+21BA), not the requested minus. Why: a minus reads as "take
this away", and nothing is taken away — one layer is, and the ui-kit default takes over. If overruled:
swap the glyph; the accessible name already says what happens.

D2 A custom token's removal is a cross (U+2715) on a red border. Why: ui-kit declares no default for
it, so removal really is deletion, and one glyph for both is last slice's confusion a layer down. If
overruled: `DeveloperRow` stops branching on `isKnownToken`.

D3 Deleting a custom token asks once, inline; dropping an override does not. Why: no undo in this
slice, so a misaimed delete is unrecoverable until reload, while a dropped override is one click from
retyped. Inline, not `window.confirm`, which cannot name the token. If overruled: drop
`DeleteControl`'s confirming branch.

D4 Customize's reset is also an icon. Supersedes "Customize keeps the word reset", because the default
value this slice adds made that row head wider than the one the space complaint was about, and the
brief's own screenshot list asks for the icon and the default value together. The word moves into the
accessible name. If overruled: render label text in `CustomizeRow`, icon in Developer only.

D5 A row promises `inherited ?? knownTokenDefault(name)`, never the package default alone. Why: this is
`7c5b5a5`'s correction — the element pane said `#f2f4f8` while `#e8f1ff` painted. If overruled:
nothing; a non-regression, not a preference.

D6 Every `data-testid` is scoped by pane id. Why: the bare token name collided across the two panes,
the residual the last slice left. If overruled: revert `rowTestId`.

## Open questions

Q1 The brief says the desk layout already holds a custom token. It does not — 94 theme and style keys
across the three shipped layouts, 28 distinct, every one a known `--perch-*` name. Default taken: the
capture adds `--brand-hue: 210deg` live through the pane's own add control, in the draft only; nothing
saved, no layout file changed.

Q2 The icon is a 20px square, under the 24px touch target. Default taken: kept, with a comment, since
this is a dense desktop inspector.

## Call sites

None. `packages/*` is unmodified — `tokens.ts` and `token-labels.ts` were read to check D1/D2's
premise, not edited. The diff is `apps/editor/src/token-pane.tsx` and its test.

## Evidence

Under `.evidence/perch-editor-theme-polish/`: `build.log`, `test.log` (editor 101 → 109, the pane's own
suite 25 → 33), `typecheck.log`, `lint.log`, `format.log`, all exit 0. `red-token-pane.log` is the
red-first capture — exit 1, 24 failed / 8 passed of the 32 that existed at that point.

At 1920x400 and 1440x900 both: `customize-colour-rows-*.png` (swatch before hex, an overridden row
with its icon and `default #f2f4f8`, a row at its default showing nothing extra),
`style-pane-inherited-*.png` (the element pane reporting `layout theme #7f8da3`, which is D5 on
screen), `developer-custom-token-*.png` (revert arrows beside one red cross),
`developer-delete-confirm-*.png`, and `editor-customize-*.png`.

No adversarial review, per the standing rule; `code-review.md` sits in the same directory and says so.

## Residuals

The confirm wraps to its own line at 1920x400, pushing the value field down a row. It reads correctly
and is transient, but a fixed width would stop the reflow. No shipped layout has a custom token, so
that path's only exercise is the tests and the capture draft.

# The editor's connection control, and the relay's one control path - decisions

Outcome: the editor header picks the sensor host (localhost, or host[:port]); the relay, which
`npm run dev` now always starts, polls it. Preview and sensor picker read live data once connected,
sample data under a badge otherwise. The runtime's "still all mock" was the layouts' own caption.

Control message. Request `perch/relay/lhm/request` `{"host": string, "port"?: 1-65535}`, qos 1, not
retained; no port = the relay's `--lhm-port`. Status `perch/relay/lhm/status`
`{"host","port","state":"polling"|"ok"|"failed","reason"?}`, qos 1, retained, sent on change. Owned
by `packages/sensor-sources/src/relay-control.ts`; `apps/agent/src/lhm-control.ts` restates the two
topic strings. Sensor topic grammar untouched.

## Decisions to evaluate

D1 Protocol in sensor-sources, not sensor-contract. Why: contract rule 3 keeps hosts and ports out of it; the relay restates two strings as it does 9001. If overruled: move the guards into sensor-contract and import them in the agent.
D2 Removed the "mock source - generated values, not hardware" text from all three layouts; the layouts test now forbids source claims in canvas text. Supersedes: "a crop still says where the numbers came from", because the caption was painted over live relay data. If overruled: restore a source-neutral caption.
D3 The relay starts by default (`--relay` kept, a no-op). The editor gets `PERCH_RELAY_URL` from the port the relay reports. PERCH_BROKER_URL unset and 1883/9001 held: free ports, no mosquitto prompt; set: the old prompt/fail. Why: only the runtime dials a fixed URL. If overruled: always prompt.
D4 Any LAN client can retarget the poll (broker unauthenticated); host and port only, always GET /data.json. If overruled: loopback-only control, or a token.
D5 One relay, one host: an editor switch also moves a runtime page on that relay; the last tab to ask wins. If overruled: a relay per host.
D6 Briefed defaults: localhost default, immediate; choice and text in localStorage, re-requested on load; label with the relay's reason; connected = relay ok for that host AND live readings; host or host:port, 8085 default, empty rejected. Localhost sends no port (= relay's configured port).
D7 Connect is disabled while connecting or connected to the typed host; picking the host radio alone changes nothing until Connect.

## Open questions

Q1 desk-1920x400 still says "every other tile on this panel is reading"; on the real capture 4 of 8 tiles wait. Default: left as content.
Q2 Collapse not reused: a one-row header control has nothing to fold. Default: chrome variables, `.perch-input`, the focus-ring pattern.

## Gate facts

Nothing pushed, no review cut (brief forbids; GitHub repo, no CRUX, AutoSDE not run). No dependency or lockfile change.
Call sites, packages/sensor-sources, additions only: createRelayControl, isRelayBrokerUrl, createMqttSource -> apps/editor/src/main.tsx; isLhmHost, relayStatusMatches, RelayLhm* types -> apps/editor/src/connection.ts; RelayControl -> apps/editor/src/connection-control.tsx. Other packages untouched.
Lanes: build.log, typecheck.log, test.log all exit 0; lint.log clean on changed files. Adversarial review rounds: 0 (rule 14).

## Evidence (untracked, under .evidence/)

red-first.log; build/typecheck/test/lint logs; connection-{1920x400,1440x900}-{1..5}-*.png (localhost connected, host typed, sensor PC EHOSTUNREACH, host connected, lost ECONNREFUSED) with connection-capture-report.json; runtime-probe-before.png, runtime-after-fix-1920x400.png.

## Residuals

192.168.1.3 not verified live: EHOSTUNREACH from this shell (macOS Local Network privacy); a fixture server stood in. A source switch shows WAITING for about 1 s. A poll in flight at a switch may publish one tick from the old host.

# Readout spacing and sizing, Content first, picker readings - decisions

Outcome: Content sits above Transform. Units follow their numbers at 1ex. A readout's number is
sized from the glyphs it actually prints, not a fixed eight-digit width. Each picker entry shows its
live reading. Commits: 8e22582 (items 1, 2, 4) and one item-3 commit on top.

Root cause 2: `packages/ui-kit/src/readout.tsx:148` (at 54e0e8a) pinned the value to an 8ch field with
the digits at its start, so the unit sat eight digit widths out: an 80-98 px gap, measured live.
Ruled out: the justify token (unset), unit margin (none), the flex gap (0.35em = 6 px).
Root cause 3: `readout.tsx:306` (at 54e0e8a) set `clamp(min, 14cqw, max)`, which is 14% of the content
width. That is the size eight digits need, whatever is printed, so `9.4` was held to 30 px in a tile
that fits it at 40 px. Padding narrows the content box (`layout-canvas.tsx:414`), so it shrank further.
Ruled out: theme tokens (constant), root font (16 px), preview scale (computed size is in layout px).

## Decisions to evaluate

D1 The whole Content section moved above Transform, not only the topic row. Why: the brief's default. If overruled: the topic gets its own leading section.
D2 Unit follows the number, gap 1ex: the human's choice. The 1ex is on the row, so it follows the row's font (8 px at 16 px), not the number's. The unit moves one digit when a reading crosses a power of ten. Supersedes: fixed 8ch field. If overruled: put the 1ex on the value's font instead.
D3 Size = (100cqw - unit glyphs x 0.7 x unit-size - 1ex) / (value glyphs x 0.6475em), clamped to the theme ends. Padding and box size still scale it, as the human chose ("leave it as it is") with their correction applied. The component writes the two glyph counts as properties on the readout; the token test exempts them. Supersedes: 14cqw for eight glyphs. Visible change: desk readouts print at 40 px, not 30 px. If overruled: revert to 14cqw.
D4 Picker readings: one leaf per entry, subscribed to its own topic via `useSensor` and formatted by `readoutView`, so a tick re-renders one span. Waiting and null both read "no reading". If overruled: a snapshot taken when the picker opens.

## Open questions

none.

## Gate facts

Nothing pushed, no review cut (GitHub repo, no CRUX; AutoSDE not run). No dependency or lockfile change.
packages/ui-kit touched: Readout / READOUT_STYLES changed; READOUT_VALUE_FIELD_CHARS removed from exports, used nowhere else. Call sites:
- packages/ui-kit/src/widget-catalogue.tsx:139 renders `<Readout>` for widget "readout"
- apps/runtime/src/app.tsx:165 READOUT_STYLES; :255 LayoutCanvas (runtime page)
- apps/editor/src/app.tsx:214 READOUT_STYLES; apps/editor/src/preview.tsx:155 LayoutCanvas (editor preview)
- packages/ui-kit/src/index.ts exports; tests readout.test.tsx, tokens.test.ts, element-box.test.tsx
- layouts: desk-1920x400 (8 readouts), tower-720x1280 (6); trend-1920x400 none
Lanes: build.log, test.log, typecheck.log exit 0; lint.log clean on changed files; red-first.log (items 1, 4, 2, 3 failing first). Adversarial review rounds: 0 (rule 14).

## Evidence (untracked, under .evidence/)

before-*.png and readout-probe-before.json / padding-probe-before.json (both defects, live);
compare-units.png, compare-size.png (options shown to the human); after-probe.json with
after-runtime-*, after-padding-{0,24}, after-inspector-*, after-editor-8digit-*, after-picker-* at 1920x400 and 1440x900.

## Residuals

evidence_capture refuses files from this worktree, so the images and logs are only on disk.

# Per-side padding and per-corner radius - decisions

Outcome: `--perch-box-padding` and `--perch-box-radius` hold a 1-4 value CSS shorthand. The canvas
paints it as native `padding` and `border-radius`, and a chart sizes to the real sides. The inspector
edits each with a box diagram of linked sides or corners. One-number layouts render as before.
Commits: 884e5bf, 40b5a20, a9f151c, then the spacing commit. Research: RESEARCH.md.

## Decisions to evaluate

D1 One token holds the whole shorthand; there are no longhand tokens. Why: an element's value replaces the theme's in one piece, as today. If overruled: per-side tokens plus rules for combining them.
D2 No layout-schema change or version step: `"8 16"` was already a legal token string. If overruled: an identity 2 -> 3 step, so an old build refuses the file instead of drawing no padding.
D3 The canvas resolves radius and padding (element, theme, default) and writes them inline, because `calc()` cannot turn a list into px.
D4 Over-large padding shrinks by one factor so it fits both axes; for even padding this equals the old half-the-smaller-side rule.
D5 A token part CSS would reject (a negative, a unit, a fifth value) voids the whole token, as in CSS.
D6 The padding control is the human's design, Webflow's padding ring with links. The centre shows only `px`, and both rows get `margin-block: 1ex`, since the chrome has no vertical spacing variable. Supersedes: a shorthand field with a toggle to four fields, and the stored values in the centre, both at the human's request.
D7 Links follow CSS pairing, the human's rule. Bottom follows top. Right and left are a pair: both follow top until either is set, then the other follows that one. Corners use the matching border-radius rule: bottom-right follows top-left, and top-right with bottom-left are the pair. The four-corner layout is the brief's default. Supersedes: left linked to right and right to top.
D8 Links are not stored. A side reads as linked when it equals what it would follow, and an equal pair reads as right set with left following, as CSS writes it. Which half of an equal pair was set, and a side unlinked at an equal value, are remembered only while the field is mounted. What is drawn always matches CSS; after a reload, only which half of an equal pair shows the number can differ. If overruled: store link flags, which would change the format.
D9 Top also accepts a typed or pasted shorthand (`4px 8px 12px`). Dragging the row label moves every side together. Invalid input stays in its field with a message and is never written.
D10 The padding and radius maximums are now 999 for arrows and drags (previously 48 and 64). The only caps were the two token-label ranges; typing could always go past them, and the canvas clamps padding to the rect.

## Open questions

none.

## Gate facts

Nothing pushed and no review cut (GitHub repo, no CRUX, AutoSDE not run). No dependency or lockfile change.
packages/ui-kit call sites (changed: `ContentBox.padding` -> `BoxInsets`, `elementContentSize`, `ELEMENT_BOX_STYLES`, the canvas box styles, the padding/radius labels (range 0-999, `shorthand`); new: `box-shorthand.ts`, `CANVAS_RESOLVED_TOKENS`):
- ui-kit widget-catalogue.tsx render signatures; layout-canvas.tsx boxOf, elementStyle, LAYOUT_CANVAS_STYLES
- apps/runtime/src/app.tsx:174, :255; apps/editor/src/app.tsx:223, preview.tsx:155
- editor descriptors.ts tokenSpec; property-view.tsx scrubFor, SpecControl; token-pane.tsx; controls/box-diagram.tsx, box-input.ts, box-links.ts
- tests: ui-kit element-box, box-shorthand, tokens, token-labels, widget-catalogue; editor app, token-pane, descriptors, box-*
- layouts/*.json: none set a box token
Lanes: build.log, typecheck.log, test.log exit 0; lint.log clean on changed files; red-first.log. Adversarial review rounds: 0 (rule 14).

## Evidence (untracked, under .evidence/)

red-first.log, build.log, typecheck.log, test.log, lint.log.

## Residuals

Not checked in a real browser (no Playwright): the diagram layout at 420 px is unverified. Side drags are horizontal on every side.

# Editor settings in a zustand store - decisions

Outcome: one store per editor (`apps/editor/src/store.ts`), `devtools(persist(...), { name: 'perch-editor' })`.
Settings persist to localStorage key `perch-editor` (version 1). The draft and selection are in the store as
named actions but never persisted. The old connection key migrates on first load. Commits: 9e6a004 (dependency and lockfile), then the store commit.

| State (useState today) | Where now |
|---|---|
| connection radio, host in effect, host text (connection-control) | persisted |
| section and Advanced open state (was sessionStorage) | persisted |
| token pane tab and chip (token-pane) | persisted, keyed `theme` / `style` |
| layout last picked (new) | persisted |
| opened draft, selection (app) | store, not persisted |
| delete confirm, pending switch, notice, saving (app); status tick (connection) | local |
| token search, custom-token name and value (token-pane) | local |
| sensor search, device chip, hidden toggle, Add step (sensor-picker) | local |
| collapse phase x3, popover open and position, presence rows, box-diagram unlinks and text, reset confirm | local |

## Decisions to evaluate

D1 One element `style` tab and chip for every element (key `style`), as folds already were. Before, each selection reset it to Customize. Why: an index key would restore a tab onto a different element after a reload. If overruled: keep the tab local per element and persist only the theme pane's.
D2 Folds move from sessionStorage (one tab) to localStorage (every tab, and after a browser restart). Old sessionStorage folds are not carried over, so they reset once. Why: the ask was to remember disclosures between reloads. If overruled: persist only the other settings, and keep folds per tab.
D3 The radio is persisted as well as the host in effect. Picking "host" without Connect survives a reload, with localhost still connected. Why: the brief lists the connection mode. If overruled: derive the radio from the host in effect on load.
D4 The old `perch.editor.connection` key is read once, as version 0 through `migrate`, then never read or written, and left in place. Why: main, served on the same origin, still finds its host. If overruled: delete it after migrating.
D5 Only a header pick (including discard-and-open) is remembered as the layout; `?layout=` and revert are not. A remembered name the library no longer offers falls back to the first. Why: a link is a one-off. If overruled: remember whatever opens.
D6 Store per editor through a React context, made in `main.tsx` (so StrictMode cannot connect two DevTools instances). A primitive outside an editor gets a detached memory-only store that the test setup resets. Why: tests mount many editors. If overruled: a module singleton with a reset in the test setup.

## Open questions

Q1 The sensor picker's device chip is also a filter chip. Default: local, reset on each opening, because a chip for a device the new source lacks would hide every sensor.

## Gate facts

Nothing pushed and no review cut (GitHub repo, no CRUX; AutoSDE not run). Dependency: zustand ^5.0.15 in apps/editor only. The lockfile was regenerated, not edited. 43 other packages resolved to newer versions within their ranges, 4 dropped out, and 24 optional platform binaries were added (lockfile-diff.log).
packages/*: none touched.
Lanes: build.log, typecheck.log, test.log exit 0; lint.log clean on changed files; red-first.log. Adversarial review rounds: 0 (rule 14).

## Evidence (untracked, under .evidence/)

red-first.log (new tests failing before the store), build/typecheck/test/lint logs, lockfile-diff.log (every resolved-version change).

## Residuals

Not run in a browser: the DevTools timeline is checked against a stubbed extension only. Undo and panel placement are not built; `panels` is an empty reserved slot.

# Undo and redo for layout edits - decisions

Outcome: every change to the layout document can be undone and redone, from the header buttons or the platform's own keys, never from inside a text field. History: store session (`history.ts`), in memory, 200 steps. Step boundaries: `edit-gestures.ts`. Platform detection and key display: `platform.ts`. No new dependency.

## Decisions to evaluate

D1 A step's end is read from the page, not passed by each control: one pointer press, else one stay in a text field (focus to blur, Enter or change), else one dispatched event. Why: about twenty controls write as they go; threading a key through each is how one gets missed. If overruled: controls call an explicit begin/commit.
D2 One click that writes several tokens is one step (placement grid: two; linked box side: up to four). Why: the author did one thing. If overruled: one step per token.
D3 A step holds draft, preview and problems, never the saved copy, so "unsaved changes" follows undo and a save keeps the history. If overruled: a save clears the history.
D4 Selection follows its element by identity, keeps its index when the step rewrote it in place, and clears when it is gone. If overruled: plain index while in range.
D5 Revert clears the history, like a switch. If overruled: revert becomes an undoable step.
D6 An edit that changes nothing records no step. If overruled: every edit call is a step.
D7 Each platform accepts only its own keys, with no extra modifier: Mac (incl. iPhone, iPad) Cmd-Z / Shift-Cmd-Z; elsewhere Ctrl-Z / Ctrl-Shift-Z or Ctrl-Y. Ctrl combos on a Mac and Meta combos elsewhere reach the browser. Why: the human asked for it. If overruled: accept both sets everywhere. Supersedes: both sets accepted on every platform, because the human asked for platform-aware keys.
D8 Tooltips show only the current platform's keys, in the first listed form plus alternatives: "Undo (⌘Z)", "Redo (⇧⌘Z)"; "Undo (Ctrl+Z)", "Redo (Ctrl+Shift+Z or Ctrl+Y)". `aria-keyshortcuts` matches. Button text stays lowercase "undo"/"redo". Why: the hint and the accepted keys come from one table. If overruled: drop "or Ctrl+Y" from the tooltip.
D9 Platform is detected once per page (userAgentData, then platform, then userAgent). `Editor` takes a `platform` prop for tests. Non-Mac Meta shows as "Meta"; `aria-keyshortcuts` puts the platform modifier first ("Meta+Shift+Z"). If overruled: detect per render, or name the key Win/Super.

## Shortcut audit (apps/editor/src)

- Modifier shortcuts: undo/redo only (app.tsx, edit-gestures.ts). Now platform-aware.
- Displayed key hints: the undo/redo tooltips only. Now platform-aware.
- Shift as "ten times" in nudge, scrub and box diagram: same key everywhere, never shown. Unchanged.
- Plain keys (Delete/Backspace on canvas, Escape, Enter, arrows): no hint displays them, so no ⌫. Unchanged; the formatter maps Backspace to ⌫ on a Mac for any future hint.

## Open questions

Q1 Should delete stop asking first now that undo exists? Default: it still asks; wording says undo brings it back.
Q2 Switching layout with unsaved edits still parks behind a discard bar. Default: kept, as switching clears the history.

## Gate facts

Nothing pushed, no review cut (GitHub repo, no CRUX; AutoSDE not run: it sends the diff off-host). No dependency; lockfile untouched. packages/*: none touched. Lanes: build.log, typecheck.log, test.log exit 0; lint.log clean on changed files; red-first.log. Adversarial review rounds: 0 (standing rule 14, no code-review.md).

## Evidence (under the worktree's .evidence/)

red-first.log (new tests failing first), build.log, typecheck.log, test.log, lint.log. If capture refuses the self-made worktree, logs stay there and are captured as notes.

## Residuals

Not run in a browser: step boundaries and platform detection are checked in jsdom only.

# Keybinding spec, registry and dispatcher - decisions

Outcome: every editor shortcut is a typed command in `apps/editor/src/keybindings/`, dispatched by one window listener and shown from the same entry; the rules are `apps/editor/KEYBINDINGS.md`. Undo, redo, delete and deselect moved onto it with unchanged behaviour on both platforms. Overrides persist in `settings.keybindings`; no rebinding UI.

## Decisions to evaluate

D1 Binding strings `Mod+Shift+Z`; `Mod` = Meta on Mac, Control elsewhere; `Ctrl`/`Meta` literal; `Mod` never combined with either. Why: VS Code/tinykeys shape, one list serves both platforms. If overruled: per-platform strings only.
D2 Match on `event.key`; `event.code` only for letters/digits when no ASCII character was typed (Cyrillic, Mac Option, dead keys). Why: AZERTY Ctrl-W must never read as Ctrl-Z. If overruled: always accept `code` (tinykeys), or never.
D3 Precedence: innermost `keyScope` region first, then `global`; registry order within a scope; a command with no enabled handler passes the key on. Why: a scoped command must beat a global one inside its region. If overruled: registry order only.
D4 Key ownership is per key: text entries own every key; Escape is also owned by any input, select, dialog or the delete confirm (escape.ts's rule, moved). A `defaultPrevented` key is never a shortcut. Commands opt in with `inFields`. Why: keeps undo working from a select or popover, exactly as before. If overruled: dialogs and selects own every key.
D5 Overrides are one list per command for both platforms, `[]` unbinds, unknown ids kept in storage. `resolveKeymap` reports invalid, reserved (arrows, Home/End, PageUp/Down, Enter, Space, Tab with at most Shift), unknown and conflict (shared scope, `global` sharing every scope, with the winner). Why: a future rebinding UI needs problems as data. If overruled: per-platform overrides.
D6 Delete stays always registered on the canvas (prevents default even with nothing selected); deselect is enabled only while something is selected. Why: identical to the listeners it replaced. If overruled: disable delete with no selection.
D7 A test fails if the spec's command table and the registry differ. Why: the spec is normative. If overruled: drop the test.

## Open questions

none

## Gate facts

Nothing pushed, no review cut (GitHub repo, no CRUX; AutoSDE not run: it sends the diff off-host). No dependency; lockfile untouched. packages/*: none touched. Lanes: build.log, typecheck.log, test.log exit 0 from a clean checkout of the branch head; lint.log clean on apps/editor; red-first.log. Adversarial review rounds: 0 (standing rule 14, no code-review.md).

## Evidence (under the worktree's .evidence/)

red-first.log (new tests failing first), build.log, typecheck.log, test.log, lint.log.

## Residuals

Commit 707ea34 does not build alone (it deletes controls/escape.ts early); its follow-up does. Not run in a browser: dispatch is checked in jsdom only.

# Desktop runner: relay in process, a layout document from disk - decisions

Outcome: `npm run runner` launches apps/desktop (Electron 44): relay in the main process, a sandboxed window rendering the built runtime page from a watched layout document in `~/Documents/perch/layouts`, and a tray. Last document and LHM host resume. No editor, no packaging.

## Decisions to evaluate

D1 The relay export is `startRelayService` in apps/agent; desktop imports `@perch/agent`, the one app-to-app edge (ARCHITECTURE.md updated). Why: moving broker, control and loop to packages/ would move the whole CLI. If overruled: a packages/relay library imported by both.
D2 Page served over a privileged `app://` scheme, not file://. Why: Chromium blocks module scripts on file://; a real origin gives the CSP a 'self'; only mapped files are reachable. If overruled: a non-module runtime build.
D3 Page input is a two-function preload (`load`, `onDocument`), not perch-relay.json. Why: main.tsx never fetches that file, and in Vite dev a missing file answers index.html, so adding the fetch would change `npm run dev`. If overruled: serve the file over app:// and select MQTT on origin 'config'.
D4 The desktop relay binds loopback (the CLI keeps 0.0.0.0); `PERCH_BIND_HOST` overrides. Why: its only reader is its window, the broker is unauthenticated, and a wildcard bind prompts the macOS firewall. If overruled: LAN clients can reach and retarget it.
D5 A port counts as held if the bind fails OR something already answers on host:port; the listener then takes port 0 and logs it. Why: on this Mac 127.0.0.1:9001 bound beside the dev relay's *:9001 and would have taken its local clients. If overruled: fail like the CLI.
D6 Seeding runs whenever the folder has no .json document; it copies *.json and *.assets/**, not README or invalid/, with COPYFILE_EXCL. Why: a launch never opens an empty folder, and deleting a seed is not undone. If overruled: seed only when the folder is created.
D7 An edit re-renders in place; a tray switch reloads the page (the runtime's switching rule).
D8 macOS dock icon only while the window is visible; closing the window hides it. Why: the runner lives in the tray. If overruled: always show the dock icon.
D9 A remembered document outside the folder is reopened if it exists. Why: the editor may open files from anywhere. If overruled: folder-only.
D10 The LHM host is saved only when a client retargets over the control topic; `PERCH_LHM_*` override it for one launch and are never saved. If overruled: also save env values.
D11 CSP allows `worker-src 'self' blob:` for mqtt.js's keepalive worker. Why: while blocked, the broker once dropped the page's client for a missed keepalive; allowed, none. If overruled: a hidden window's keepalive may lapse.

## Open questions

Q1 Start at login in an unpackaged run registers the dev Electron binary. Default: off, untouched until packaging.
Q2 "Say so" on fallback is the tray's top line and the log, no page banner. Default: that.

## Gate facts

Nothing pushed; no review cut (GitHub repo, no CRUX; AutoSDE not run: it sends the diff off-host). Dependency: electron ^44.4.5, a devDependency of apps/desktop. package-lock.json regenerated by `npm install`: 18 other packages moved, all minor or patch, 0 major (lockfile-diff.log). packages/*: none touched. Lanes: build.log, test.log, typecheck.log all exit 0; lint.log repo-wide clean. Adversarial review rounds: 0 (standing rule 14, no code-review.md).

## Evidence (under the worktree's .evidence/)

red-first.log, red-first-port-shadow.log (tests failing first); build/test/typecheck/lint logs; npm-install.log, lockfile-diff.log; runner-launch.log (first run: seed, moved ports, live data, save/malformed/fix, retarget saved); runner-relaunch.log (resume); runner-fallback.log (gone document); runner-final.log (committed HEAD).

## Residuals

Tray clicks not driven (no GUI automation): the menu is unit-tested, a live switch is untested. `npm run dev` not opened in a browser; its main.tsx branch is unchanged. A window hidden for hours not observed.

# Desktop editor runner: the editor window over the runner - decisions

Outcome: `npm run editor` launches the runner with an editor window over it, one process, one relay. New/Open/Save/Save As with native dialogs, a dirty mark, a close/quit prompt, a standard menu. Closing the editor leaves the runner up. `npm run dev` unchanged.

## Decisions to evaluate

D1 One process, a single-instance lock per userData; `--editor` hands off through `additionalData` (argv as fallback) and the running app opens or focuses the editor. Why: one relay, tray and settings file; Electron needs no second. If overruled: two processes and IPC between them.
D2 The page never names a file: main gives each document a key (`desk`, `desk-2`) and writes only keys it gave out (folder, Open, Save As). Saves use `saveDraft` + `SaveTransport`; main checks like the Vite endpoint (JSON, 1 MB cap) and writes atomically. If overruled: pass paths to the page.
D3 New is a blank canvas with the open document's target and theme, untitled in memory; its first Save is a Save As. Why: a starter is a document to delete from. If overruled: copy a seed layout.
D4 Menu Undo/Redo are not roles: with the editor focused they go to the page, which does native undo in a text field and `history.undo` otherwise; other windows get native undo. Keys reach the page first; an accelerator fires only for a key the page did not take. If overruled: roles; Cmd-Z outside a field stops undoing edits.
D5 Menu accelerators come from the editor's keymap (overrides included), sent at mount; defaults held equal to `commands.ts` by a test. No Reload item. If overruled: a hand-written accelerator table.
D6 The four `document.*` commands run inside text fields (`inFields`). Mod+S saves in the browser too; New, Open, Save As have no handler there. If overruled: Mod+S types into a field.
D7 The editor opens the runner's document first, and adopts the relay's current LHM host before its first request, so opening it never retargets the runner; a retarget is saved by the runner as before. If overruled: the editor's own last layout and host.
D8 `npm run runner` now ends in `--` so flags reach Electron. Why: npm swallowed `--user-data-dir`. If overruled: env vars only.
D9 The runner's document watch reads the file once more 250 ms after it starts. Why: macOS drops writes in the first moments of an FSEvents stream (base commit failed 2 in 6, red-first-watch.log). If overruled: a save right after a switch can be missed.

## Open questions

Q1 Should opening a document in the editor also switch the runner to it? Default: no; the tray picks the runner's document.
Q2 A packaged macOS editor launcher goes through LaunchServices, which activates the running app, not a second process. Default: decide at packaging (open-url or `open -n`).

## Gate facts

Nothing pushed; no review cut (GitHub repo, no CRUX; AutoSDE not run: off-host). No dependency; lockfile untouched. packages/*: none touched. Lanes: build.log, test.log, typecheck.log exit 0 from a clean checkout of each commit; lint.log clean on changed files; red-first.log. Adversarial review rounds: 0 (no code-review.md, per the task's standing rule).

## Evidence (under the worktree's .evidence/)

red-first(-watch).log; build/test/typecheck/lint logs; editor-launch.log (editor opened, Mod+S save re-rendered the runner, handoff, retarget saved, editor closed with the runner up, quit); editor-drive.log; editor-second-launch.log; runner-launch.log.

## Residuals

Key presses and menu clicks not driven (no GUI automation): key order and the close prompt are unit-level only. One runner-only test launch ran about 50 s against the real userData (npm swallowed `--user-data-dir`): it rewrote perch-desktop.json with the values it read and wrote Chromium caches; ~/Documents/perch untouched. Outside clients reached both launches: a 192.168.1.3 retarget and two editor reopens in the first; in the runner-only one, which found 1883/9001 free and took them, a client with no editor window retargeted it, so a test launch on default ports can take the human's clients.
