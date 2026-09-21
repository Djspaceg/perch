# Call sites of the shared package surfaces

This change adds the workspace wiring around `packages/*`, which several consumers share.
Anyone touching `@perch/sensor-contract` or `@perch/sensor-sources` changes every row
below. Rows marked **not written yet** are the consumers `ARCHITECTURE.md` and the SPECs
commit to; they have a declared dependency edge and an entry point, but no product code —
list them when you change a surface, because they are where the next breakage lands.

## `@perch/sensor-contract`

Exported surface (`packages/sensor-contract/src/index.ts`), **as widened to SPEC.md**:
`SENSOR_TOPIC_ROOT`, `SENSOR_TOPIC_WILDCARD`, `SENSOR_META_SUFFIX`, `SENSOR_DEVICES` (12),
`SENSOR_METRICS` (21), `SENSOR_METRIC_UNITS`, `sensorTopic()`, `sensorMetaTopic()`,
`parseSensorTopic()`, `normalizeSensorTopic()`, `isSensorTopic()`, `isSensorDevice()`,
`isSensorMetric()`, `isSensorReading()`, `isSensorMeta()`, `lhmSensorIdToTopic()`,
`lhmVendor()`, `LHM_RAW_VALUE_FIELDS`, and the types `SensorDevice`, `SensorMetric`,
`SensorTopic`, `SensorTopicShorthand`, `SensorMetaTopic`, `SensorTopicParts`,
`SensorTopicIndices`, `SensorReading`, `SensorMeta`.

### Existing call sites, in this repo, today

| Call site | Uses |
|---|---|
| `packages/sensor-contract/src/index.ts` | re-exports everything from `topics.ts`, `reading.ts`, `meta.ts`, `lhm.ts` |
| `packages/sensor-contract/src/lhm.ts` | `sensorTopic`, `isSensorDevice`, `isSensorMetric`, types `SensorDevice`, `SensorMetric`, `SensorTopic` |
| `packages/sensor-contract/src/topics.test.ts` | `sensorTopic`, `sensorMetaTopic`, `parseSensorTopic`, `normalizeSensorTopic`, `isSensorTopic`, `isSensorDevice`, `isSensorMetric`, `SENSOR_DEVICES`, `SENSOR_METRICS`, `SENSOR_METRIC_UNITS`, `SENSOR_META_SUFFIX`, `SENSOR_TOPIC_ROOT`, `SENSOR_TOPIC_WILDCARD`, types `SensorTopic`, `SensorTopicShorthand` |
| `packages/sensor-contract/src/reading.test.ts` | `isSensorReading`, type `SensorReading` |
| `packages/sensor-contract/src/meta.test.ts` | `isSensorMeta`, type `SensorMeta` |
| `packages/sensor-contract/src/lhm.test.ts` | `lhmSensorIdToTopic`, `lhmVendor`, `LHM_RAW_VALUE_FIELDS`, `isSensorTopic`, `parseSensorTopic` |
| `packages/ui-kit/src/dependency-edges.test.ts` | `sensorTopic`, `isSensorReading` |
| `packages/sensor-sources/src/dependency-edges.test.ts` | `sensorTopic` |
| `apps/runtime/src/dependency-edges.test.ts` | `sensorTopic`, `isSensorReading` |
| `apps/editor/src/dependency-edges.test.ts` | `sensorTopic` |
| `apps/agent/src/environment.test.ts` | `sensorTopic` |

Declared-edge holders whose `src/index.ts` does not yet import it: `packages/ui-kit`,
`packages/sensor-sources`, `apps/runtime`, `apps/editor`, `apps/agent` (all empty entry
points).

Config-level references, which must move together with any package rename:
`vitest.aliases.js`, `tsconfig.tests.json` (`paths`), and the `references` array of
`packages/ui-kit`, `packages/sensor-sources`, `apps/runtime`, `apps/editor`,
`apps/agent` tsconfigs.

### Call sites the docs commit to — not written yet

| Consumer | What it will call | Source |
|---|---|---|
| `ui-kit` widgets (readout, gauge, sparkline) | `SensorReading` for values, `SensorTopic` for bindings | `packages/ui-kit/README.md` |
| `sensor-sources` `SensorSource` interface | `SensorReading` in `onReading`, topic types in `subscribe` | `packages/sensor-sources/README.md` |
| `sensor-sources` mock source | `SENSOR_DEVICES` x `SENSOR_METRICS` to generate plausible topics | same |
| `sensor-sources` mqtt source | `SENSOR_TOPIC_WILDCARD` to subscribe, `isSensorReading` to validate every payload | same |
| `sensor-sources` http-poll, external-metrics (later) | same validation seam | same |
| `runtime` | `isSensorReading` on inbound payloads, `parseSensorTopic` to route a value to a widget, staleness from `at` | `apps/runtime/README.md` |
| `editor` topic picker | `SENSOR_DEVICES`, `SENSOR_METRICS` to populate; `isSensorTopic` to validate free-text entry | `apps/editor/SPEC.md` open questions |
| `agent` | `sensorTopic()` for every publish, the retained `…/meta` companion topic, `at` from read time | `apps/agent/SPEC.md` (its rule 2 makes a literal topic string a bug) |

Not a consumer, deliberately: `layout-schema` (it names widgets and topics as opaque
strings) and `caster` (no code edge at all).

### Consumers outside this repo

None. All eight workspaces are `private: true` and nothing is published. The contract's
reach is still entirely inside this repo — which is the cheapest moment to settle the
closed-union question, because after `agent` or a real source exists, that change touches
every topic string in the repo.

### When the topic grammar widens, these are the files that move — **DONE**

> **Status: this widening has been implemented.** All six steps below were carried out;
> see `DECISIONS.md`, "Widening `@perch/sensor-contract` to its full vocabulary", section
> 12 for the per-file record of what changed. The list is kept as written because it is
> still the correct map of this surface's reach, and the next change to the contract
> touches the same rows.

`packages/sensor-contract/SPEC.md` was rewritten in the working tree while this wiring was
being made (uncommitted, and not part of that change) to specify
`sensors/<device>/<deviceIndex>/<metric>/<sensorIndex>`, an LHM-derived device and metric
vocabulary, a nullable `value`, and no `unit` field in the reading. Whoever implements
that touches, in this order:

1. `packages/sensor-contract/src/topics.ts` — the unions, `SensorTopic`, `sensorTopic()`,
   `parseSensorTopic()`, and the three-segment assumption inside the parser.
2. `packages/sensor-contract/src/reading.ts` — `value: number | null` means
   `isSensorReading` must stop rejecting `null`, and dropping `unit` means it must stop
   requiring a string there.
3. `packages/sensor-contract/src/index.ts` — the metric/unit table and `SensorMeta` become
   new exports.
4. `packages/sensor-contract/src/topics.test.ts` and `reading.test.ts` — every case listed
   in `DECISIONS.md` section 7 is written against the narrow grammar; the SPEC rewrite
   says plainly that it invalidates them. Rejection cases become acceptance cases, in
   particular `sensors/cpu/0/temperature/3`.
5. Every row in the two "existing call sites" tables above — each calls `sensorTopic()`
   with `('cpu', 'temp')`-style arguments that the new vocabulary renames.
6. Every row in the two "not written yet" tables — they are unwritten, so they cost
   nothing now and everything later. This is the argument for settling the grammar first.

## `@perch/sensor-sources`

Exported surface (`packages/sensor-sources/src/index.ts`):
`RELAY_WEBSOCKET_PORT`, `RELAY_DEFAULT_HOST`, `relayWebSocketUrl()`. The
`SensorSource` interface and the mock/mqtt implementations in the README do not exist
yet; `index.ts` re-exports only `relay-endpoint.ts`, which was salvaged with the package.

### Existing call sites, in this repo, today

| Call site | Uses |
|---|---|
| `packages/sensor-sources/src/index.ts` | re-exports all three from `relay-endpoint.ts` |
| `packages/sensor-sources/src/relay-endpoint.test.ts` | all three |
| `apps/runtime/src/dependency-edges.test.ts` | `relayWebSocketUrl()` |
| `apps/editor/src/dependency-edges.test.ts` | `relayWebSocketUrl('desk.local')` |

Config-level references: `vitest.aliases.js`, `tsconfig.tests.json` (`paths`), and the
`references` arrays of `apps/runtime` and `apps/editor`.

### Call sites the docs commit to — not written yet

| Consumer | What it will call | Source |
|---|---|---|
| `runtime` | constructs a source, reads `status`, subscribes; broker URL from config beside the bundle | `apps/runtime/README.md` |
| `editor` | the **mock** source by default, so authoring needs no broker; live topics feed the picker | `apps/editor/SPEC.md` |
| `agent` | only if the bridge outcome wins — it would publish through a source in this package rather than being its own app | `apps/agent/SPEC.md`, "Does this need to exist?" |

Not a consumer: `ui-kit` (rule 1 — widgets never touch transport), `layout-schema`,
`caster`.

### Live hazard for whoever changes `relay-endpoint.ts`

`RELAY_DEFAULT_HOST = 'localhost'` and `RELAY_WEBSOCKET_PORT = 9001` are currently
asserted verbatim by `relay-endpoint.test.ts`, and `relayWebSocketUrl()`'s default is
asserted in `apps/runtime` and `apps/editor` tests. The README already says the hardcoded
`localhost:9001` default is a development convenience, not shipping behaviour — when the
resolution order (env, config file, layout file, default) is settled, those three test
files are the call sites to update together, and `apps/runtime` and `apps/editor` are the
consumers whose config plumbing changes.

---

# Added by "the first rendered sensor value"

Three `packages/*` surfaces grew. Everything below is **new** surface: no existing export
changed shape or behaviour, so no existing call site needed a matching edit.

## `@perch/sensor-contract` — new exports

`packages/sensor-contract/src/source.ts`, re-exported from `src/index.ts`:
`SENSOR_SOURCE_STATUSES`, and the types `SensorSource`, `SensorSourceStatus`,
`SensorReadingHandler`, `Unsubscribe`.

The `SensorSource` interface moved **into** this package from the sketch in
`packages/sensor-sources/README.md`, because `ui-kit` needs it and has no edge to
`sensor-sources`. `ARCHITECTURE.md`'s `sensor-contract` and `sensor-sources` rows and that
README's interface section were corrected to match.

| Call site | Uses |
|---|---|
| `packages/sensor-contract/src/index.ts` | re-exports all five |
| `packages/sensor-contract/src/source.test.ts` | all five |
| `packages/sensor-sources/src/mock-source.ts` | `SensorSource`, `SensorSourceStatus`, `SensorReadingHandler`, `Unsubscribe` |
| `packages/sensor-sources/src/mock-source.test.ts` | `SensorTopic` (delivered topic type) |
| `packages/ui-kit/src/sensor-provider.ts` | `SensorSource`, `SensorSourceStatus`, `Unsubscribe` |
| `packages/ui-kit/src/sensor-provider.test.ts` | `SensorSource`, `SensorSourceStatus` |
| `packages/ui-kit/src/readout.test.ts` | `SensorSource` |

**Whoever changes `SensorSource` changes all of the above at once.** The two live hazards:
`status` is a `readonly` getter on both implementations, so widening it to a method breaks
both; and `meta(topic: SensorTopic)` is typed, so loosening it to `string` makes the
provider's `normalizeSensorTopic` call redundant rather than load-bearing (see DECISIONS.md,
"The first rendered sensor value", decision 3).

## `@perch/sensor-sources` — new exports

`topicMatchesPattern` (`src/topic-pattern.ts`), and `createMockSource`, `MOCK_SENSOR_SPECS`
and the types `MockSensorSource`, `MockSensorSpec`, `MockSourceOptions`
(`src/mock-source.ts`).

| Call site | Uses |
|---|---|
| `packages/sensor-sources/src/index.ts` | re-exports all six |
| `packages/sensor-sources/src/mock-source.ts` | `topicMatchesPattern` |
| `packages/sensor-sources/src/mock-source.test.ts` | `createMockSource`, `MOCK_SENSOR_SPECS` |
| `packages/sensor-sources/src/topic-pattern.test.ts` | `topicMatchesPattern` |
| `.evidence/demo/entry.ts` (not in the repo, not staged) | `createMockSource` — the screenshot harness, playing the app-root role |

Declared consumers with no code yet: `apps/runtime` and `apps/editor`. The editor's default
source is the mock, per its SPEC, so `MOCK_SENSOR_SPECS` becomes what its picker shows before
any broker exists.

**Live hazard:** `MOCK_SENSOR_SPECS` is asserted on by shape and by content in
`mock-source.test.ts` — the count is bounded (5-12), at least one spec must have
`metric: 'factor'` (the empty-unit case) and at least one `reportsNothing: true` (the `null`
case). Removing either sensor silently removes the only coverage of a contract case, so the
tests fail on purpose rather than the coverage disappearing quietly.

## `@perch/ui-kit` — first real exports

`src/sensor-provider.ts`: `DEFAULT_STALE_AFTER_MS`, `createSensorProvider`,
`currentSensorProvider`, `installSensorProvider`, `useSensor`, and the types
`SensorProvider`, `SensorProviderOptions`, `SensorSnapshot`.

`src/readout.ts`: `READOUT_STYLES`, `READOUT_WAITING_TEXT`, `READOUT_NO_READING_TEXT`,
`createReadout`, `readoutView`, and the types `Readout`, `ReadoutOptions`, `ReadoutState`,
`ReadoutView`, `ReadoutViewInput`.

| Call site | Uses |
|---|---|
| `packages/ui-kit/src/index.ts` | re-exports all of it |
| `packages/ui-kit/src/readout.ts` | `currentSensorProvider`, `SensorProvider`, `SensorSnapshot` |
| `packages/ui-kit/src/sensor-provider.test.ts` | the provider surface |
| `packages/ui-kit/src/readout.test.ts` | the readout surface plus `createSensorProvider` |
| `.evidence/demo/entry.ts` (not in the repo, not staged) | `createReadout`, `createSensorProvider`, `READOUT_STYLES` |

Declared consumers with no code yet: `apps/runtime` (renders a layout) and `apps/editor`
(canvas). Both will call `createSensorProvider` once at their root and `createReadout` per
widget; neither may construct a source inside `ui-kit`, which is why `source` is a required
option rather than a default.

**Live hazard:** `DEFAULT_STALE_AFTER_MS` is asserted verbatim as `5_000` in
`sensor-provider.test.ts`, and the threshold's meaning (`age > threshold` is stale, so
exactly-at-threshold is live) is asserted either side of the boundary. Changing the number is
a one-line test edit; changing the comparison changes what every widget paints.

Still not a consumer, deliberately: `ui-kit` does **not** import `@perch/sensor-sources`, and
its tests use hand-rolled source doubles rather than the mock, so that the absent edge stays
absent under test as well as in the build graph.

---

# Added by "the LHM mapping against real captured data"

Two kinds of change, and the second is the one that reaches outside this package.

**New surface, nothing to update:** `parseLhmValue` (`packages/sensor-contract/src/lhm.ts`)
and `isSensorDeviceToken` (`src/topics.ts`), both re-exported from `src/index.ts`.

**Widened surface — the topic grammar's device-instance segment.** The `<deviceIndex>` level
is no longer always an ordinal: it is `number | string`, the new exported type
`SensorDeviceInstance`. `sensors/network/684d7057-f1c7-4928-8500-6160b637cc46/data/2` is now a
canonical topic. See `DECISIONS.md`, "Opaque device-instance tokens", and the SPEC subsection
of the same name.

## What changed shape

| Surface | Before | After |
|---|---|---|
| `SensorTopic` | `…/${SensorDevice}/${number}/${SensorMetric}/${number}` | the device-instance hole is `${string}` |
| `SensorTopicParts.deviceIndex` | `number` | `SensorDeviceInstance` |
| `SensorTopicIndices.deviceIndex` | `number \| undefined` | `SensorDeviceInstance \| undefined` |
| `parseSensorTopic()` | rejected a non-numeric device segment | returns a `string` there for a token, still a `number` for an ordinal |
| `isSensorTopic()` | `false` on `sensors/cpu/first/temperature/0` | `true` — a token is indistinguishable from a typo |
| `lhmSensorIdToTopic()` | `/nic/%7BGUID%7D/…` collapsed onto `sensors/network/0/…` | one topic per adapter |

`SensorTopicIndices` widening in step with `SensorTopicParts` is what kept this change inside
`packages/sensor-contract`: the round-trip idiom `sensorTopic(parts.device, parts.metric, parts)`
still type-checks, and a parsed ordinal is still the `number` it was.

## Existing call sites, checked one by one

| Call site | Reads the device instance? | Verdict |
|---|---|---|
| `packages/ui-kit/src/readout.ts:151` | yes — `sensorTopic(parts.device, parts.metric, parts)`, the canonicalisation round-trip | compiles and behaves unchanged; carries a token through verbatim |
| `packages/ui-kit/src/sensor-provider.ts:214` | no — `normalizeSensorTopic(topic)`, whole topics only | unaffected; a token topic normalises to itself |
| `packages/sensor-sources/src/mock-source.ts:128` | writes only — `{ deviceIndex: 1 }` | unaffected; every mock spec passes a number |
| `packages/sensor-sources/src/mock-source.test.ts:134` | writes only — `{ deviceIndex: 9 }` | unaffected |
| `apps/runtime/src/dev-harness.ts:67` | writes only — `{ deviceIndex: 1 }` | unaffected |
| every other row of the tables above | builds or matches whole topics | unaffected |

No file outside `packages/sensor-contract` needed an edit; root `build`, `test` and
`typecheck` are green, which is the check that says so for the type-level change as well.

## The rows that inherit this, and what each has to do

These are unwritten, so they cost nothing today — which is exactly why the list has to be
accurate now.

| Consumer | What it must do with a device instance |
|---|---|
| `apps/agent` (the relay) | It publishes. It must call `lhmSensorIdToTopic()` and publish that string, never build `sensors/network/<n>/…` from an ordinal of its own — its SPEC rule 2 already makes a literal topic string a bug, and an invented ordinal is the same bug with extra steps. It must also read `RawValue` through `parseLhmValue` (see `LHM_RAW_VALUE_FIELDS`), and be ready for `null`: one sensor in a 214-sensor capture reports nothing. |
| the browser MQTT source (`packages/sensor-sources`, `mqtt-source.ts`, not written) | It subscribes to `SENSOR_TOPIC_WILDCARD` and validates payloads. Nothing about a token changes that — but any code that *derives* a display name or grouping from the topic must treat the segment as opaque: no `Number(parts.deviceIndex)`, no sorting by it, no "adapter 0 / adapter 1" numbering. Device identity for display belongs in the retained `…/meta` companion, not in the token. |
| `apps/editor` topic picker | `isSensorTopic()` is now a weaker check on free-text entry, because a token position accepts any lower-case alphanumeric-hyphen word. The picker should offer **discovered** topics (its SPEC's discovery open question) rather than lean on the grammar to catch a typed mistake. A GUID is also 36 characters, which a picker's layout has to survive. |
| `apps/runtime` | Routes a value to a widget by topic string. String equality is unaffected. Anything that groups widgets by device instance treats the token as a key, not a number. |
| `layouts/*.json`, `packages/layout-schema` | Topics are opaque strings there already, so a saved layout can bind a NIC topic today. But an adapter GUID is machine-specific: a layout naming one does not move to another machine. That is a real product question, unanswered, and it is the reason a token must not be quietly translated into an ordinal to make layouts portable — that would silently re-point a widget at a different adapter. |

## Live hazards for whoever touches this next

- **`LHM_INSTANCE_IDENTITY_FAMILIES`** (`lhm.ts`) is a one-entry set — `nic`. `/nic/{GUID}` and
  `/lpc/nct6798d/0` are structurally identical shapes, so this set is the *only* thing that
  tells an instance identity from a chip model. Adding a family changes what `deviceIndex` is
  for every sensor under it, and therefore every topic. Removing `nic` silently collapses five
  adapters onto one topic again.
- **`isSensorDeviceToken` is the single definition of the spelling.** `lhm.ts` asks it rather
  than re-stating the rules, which is rule 5 applied to a spelling. Loosening it to allow `/`,
  `+` or `#` turns one device's topic into an MQTT wildcard; `lhm.test.ts` pins all three as
  `null`, along with a malformed `%` escape.
- **`fixtures/lhm-data.sample.json` is load-bearing test input.** `src/lhm-fixture.test.ts`
  (11 tests) and part of `src/lhm-value.test.ts` read it through
  `src/lhm-fixture.test-support.ts`, which is excluded from the package `tsconfig` because it
  uses `node:fs` and must not reach `dist`. Replacing the capture will move the asserted 214/13
  counts, the device distribution, and the pinned duplicate `/gpu-nvidia/0/load/3`. It also
  contains a real hostname, motherboard model and five real adapter GUIDs — scrub before
  publishing.

---

# Added by "the layout format, its validation and its migration machinery"

`@perch/layout-schema` had **no** consumer that imported a single named export before this change.
Its public surface went from one placeholder to 42 exports, so every row below is new reach rather
than a changed shape — nothing existing had to move.

## `@perch/layout-schema` — the surface as it now stands

| Export | Kind | Who is meant to call it |
|---|---|---|
| `loadLayout`, `loadLayoutJson` | fn | `runtime` and `editor`, for a document from outside: a file, a fetch, a paste. Migrates then validates. **This is the default entry point.** |
| `validateLayout`, `parseLayoutJson` | fn | `editor`, for in-memory state on its way to disk — already known to be at the current version. |
| `assertLayout` | fn | a caller with nowhere to render a list of problems (a CLI, a test). |
| `isLayout` | guard | a caller that only needs yes or no. |
| `createWidgetRegistry`, `EMPTY_WIDGET_REGISTRY`, `isWidgetName` | fn/const | **`runtime` and `editor` only.** The injection point: they own the `ui-kit` widget table. |
| `isTopicShaped` | fn | the default `isTopic`. Consumers that have `sensor-contract` should inject `isSensorTopic` instead. |
| `LAYOUT_MIGRATIONS`, `migrateLayoutDocument`, `assertLayoutMigrationTable`, `earliestMigratableVersion`, `formatMigrationReport` | fn/const | the migration machinery. `formatMigrationReport` is the one a UI calls; the rest are for a caller that wants migration without validation. |
| `fitLayoutTarget`, `describeTargetMismatch` | fn | `runtime` and `caster`, to decide whether an output can honour a layout's `target`. |
| `rectIntersectsCanvas` | fn | `editor`, to ask while dragging the same question the validator asks on save. |
| `formatLayoutIssues`, `LayoutValidationError`, `LAYOUT_ISSUE_CODES` | fn/class/const | error presentation. `LAYOUT_ISSUE_CODES` lets a GUI map a code to an affordance. |
| `LAYOUT_SCHEMA_VERSION`, `LAYOUT_MAX_DIMENSION`, `LAYOUT_MAX_FRAME_RATE`, `MEDIA_FITS`, `ELEMENT_KINDS`, `isElementKind` | const/fn | the vocabulary a GUI enumerates. |
| `Layout`, `LayoutTarget`, `LayoutElement`, `WidgetElement`, `TextElement`, `MediaElement`, `ElementKind`, `Rect`, `Range`, `MediaFit`, `Style`, `ThemeTokens`, `WidgetRegistry`, `WidgetSpec`, `TopicValidator`, `ValidateLayoutOptions`, `ValidateLayoutResult`, `LayoutIssue`, `LayoutIssueCode`, `LayoutMigration`, `LayoutMigrationStep`, `LoadLayoutOptions`, `LoadLayoutResult`, `MigrateLayoutOptions`, `MigrateLayoutResult`, `OutputCapabilities`, `TargetFit` | type | — |

`Element` is deliberately **not** an export name; `LayoutElement` is, because `Element` is a DOM
global and shadowing it produces a confusing assignability error in somebody else's file.

## Existing call sites, checked one by one

| File | What it does with the package | Action needed |
|---|---|---|
| `apps/runtime/src/dependency-edges.test.ts:4` | `import * as layoutSchema`, asserts it is an object | **None.** Still passes. It is a wiring test, not a usage test; the row below is where real usage lands. |
| `apps/editor/src/dependency-edges.test.ts:4` | same | **None.** |
| `apps/runtime/package.json:16`, `apps/editor/package.json:15` | `"@perch/layout-schema": "0.0.0"` | **None.** No version bump: nothing is published and the workspace link is by name. |
| `apps/runtime/tsconfig.json:16`, `apps/editor/tsconfig.json:16` | project reference | **None.** `tsc -b` picks up the widened `.d.ts` with no edit. |
| `tsconfig.json:7` | root project reference | **None.** |
| `tsconfig.tests.json:18` | path mapping to `src/index.ts` | **None.** This is what lets the 11 test files in this package import `@perch/layout-schema` and see source. |
| `vitest.aliases.js:20` | runtime alias to `src/index.ts` | **None.** |
| `apps/runtime/src/dev-harness.ts:5` | comment: the real runtime will read a layout from this package | **None**, but it is now possible — see below. |
| `layouts/README.md:6` | "validated against `@perch/layout-schema`" | **None.** The claim is now true. There are still no layout files. |
| `packages/ui-kit/src/sensor-provider.ts:217`, `sensor-store.ts:336` | comments deferring authored-topic validation to this package | **None.** Now accurate: `isTopicShaped` is the fallback and `isTopic` the injection point. |
| `packages/sensor-contract/src/meta.ts:22`, `SPEC.md:155` | "range is authored in the layout, and `layout-schema` owns it" | **None**, and nothing was added to `sensor-contract` — the brief's decision 3 held. `range` lives only here. |

## The rows that inherit this, and what each has to do

| Consumer | The call it now has to write |
|---|---|
| `apps/runtime` | Build one `WidgetRegistry` from `ui-kit`'s widget table — the `drawsScale` flag per widget is the runtime's knowledge, not this package's — and call `loadLayoutJson(text, { widgets, isTopic: isSensorTopic })`. On `ok: false`, render `formatLayoutIssues(issues)` rather than a blank panel. On `ok: true` with a non-empty `migrations`, show `formatMigrationReport` — the author is owed the list of what was rewritten under them. Then `fitLayoutTarget(layout.target, output)` before painting anything. |
| `apps/editor` | The same registry, plus `validateLayout` on save and `rectIntersectsCanvas` while dragging. `LAYOUT_ISSUE_CODES` is the list to map to inline affordances; `missing-range` in particular wants "pick a scale", not a red underline. |
| `apps/caster` | `fitLayoutTarget` / `describeTargetMismatch` only, to refuse a target it cannot honour. It has no reason to validate. |
| `layouts/*.json` | The first real layout file. It must carry `schemaVersion: 1`, and `packages/layout-schema/src/layout-fixture.test-support.ts` is the shape to copy — a 1920x400 / 30 Hz panel with one element of each kind. |
| `@perch/agent` | Nothing. It publishes readings and has no layout. |

## Live hazards for whoever touches this next

- **Do not add a default `widgets`.** `ValidateLayoutOptions.widgets` is required deliberately. An
  optional registry means a caller that forgets it gets a layout that validates and renders nothing,
  which is the exact failure the registry exists to prevent, now reachable by omission. Pass
  `EMPTY_WIDGET_REGISTRY` explicitly if you genuinely have no table.
- **`targetVersion` is a test seam, not a feature.** Production code must not set it. It exists
  because the migration machinery has to be exercisable with only one version in existence.
- **Adding version 2 is one change, never two.** Append a `LayoutMigration` from 1 to 2, bump
  `LAYOUT_SCHEMA_VERSION`, and update the field checks together. A bumped constant with no migration
  into it strands every file written by the previous build, and
  `assertLayoutMigrationTable` will throw on a table that no longer reaches the target — which is the
  intended tripwire, so do not widen it to make the build pass.
- **`range` must not migrate back into `sensor-contract`.** Observed extremes are not a design range;
  a gauge that rescales as the day's peak moves is unreadable. Both SPECs say so.
- **The leaf-ness test will fail on the first `@perch/*` or `node:` import** in a non-test file under
  `packages/layout-schema/src/`. That is the point. If you need a vocabulary from another package,
  inject it the way `widgets` and `isTopic` are injected.
- **A widget's `drawsScale` is owned by whoever builds the registry.** If `ui-kit` adds a gauge and
  the runtime's table forgets `drawsScale: true`, the validator will happily accept a scale widget
  with no range and the panel will draw an unlabelled arc. The registry table is the thing to review
  when a widget is added, and it lives in the consumer.

# Added by "React, Vite, strict TypeScript, ESLint and Prettier"

No exported signature gained or lost a member in this change. Every edit to a shared surface is a
**widening** or a **de-casting** — the compiler now states something that was already true at
runtime. So there is no call site that must change to keep compiling, and the interest here is in
what callers may now legitimately pass, and in one hazard that is new.

## What changed shape, without changing meaning

| Surface | Before | Now | Does a caller care? |
|---|---|---|---|
| `ui-kit` `ReadoutOptions`, `ReadoutViewInput` | `label?: string` | `label?: string \| undefined` | No, and that is the point: a caller may now spread an object that carries an explicit `undefined` instead of conditionally omitting the key. |
| `ui-kit` `SensorProviderOptions` | `pattern?: string`, `now?: () => number`, … | each `?: T \| undefined` | Same. Every one of these is read through a destructuring default, which fires on `undefined` exactly as it does on absence. |
| `sensor-sources` `MockSourceOptions` | `seed?: number`, … | each `?: T \| undefined` | Same. |
| `sensor-sources` `MockSensorSpec` | `vendor?: string`, `hidden?: boolean` | **unchanged** | Deliberately. This is a payload, not an options bag. |
| `sensor-contract` `resolveHardware` (internal) | returned via `as string` | returns `T \| undefined` honestly | Internal; no external caller. |

### The rule behind that table, because it will come up again

**An options bag widens to `?: T | undefined`. A payload does not.**

Under `exactOptionalPropertyTypes` an absent property and an explicitly-`undefined` one are
different types, and the flag exists to keep them apart. For an options bag that reads every member
through a destructuring default, the two genuinely *are* the same thing, and the type should say so
rather than forcing every caller into a conditional spread. For a payload such as `SensorMeta` or
`MockSensorSpec` they are *not* the same: omitting `vendor` says "this sensor has no vendor", and
setting it to `undefined` is a caller bug worth catching.

Apply that test when you add an optional member anywhere. Getting it backwards on a payload is how
`exactOptionalPropertyTypes` stops earning its keep.

## `@perch/ui-kit` — readout DOM attributes are now bracket-read

`root.dataset.topic = …` became `root.dataset['topic'] = …`, and likewise `state`, because
`noPropertyAccessFromIndexSignature` requires an index-signature read to be written as the lookup it
is. Four assertions in `readout.test.ts` moved with it.

Nothing about the emitted DOM changed — `data-topic` and `data-state` are still the attributes, and
any CSS or test selecting on them is unaffected. What changed is that a typo'd key is now a compile
error instead of a `data-*` attribute nothing paints.

> Both files named in this section, `readout.ts` and `sensor-provider.ts`, have since been replaced
> by the concurrent React rewrite (session `54954f5a`), which owns them. The rule above survives the
> rewrite; the specific line numbers do not.

## `@perch/sensor-sources` — the mock's internals are now structurally correct

`createMockSource` has the same signature and the same observable behaviour, including the same
seeded value stream. Internally, two parallel arrays indexed in lockstep became one array of
`{ spec, topic }` pairs. See DECISIONS.md decision 5: the old shape could have published one
sensor's value on another's topic and looked entirely plausible doing it.

No caller changes. Recorded because the *shape* is the guarantee now, and a future edit that
re-splits those two arrays would re-open the hole.

## New files a consumer needs to know exist

| File | What depends on it |
|---|---|
| `eslint.config.js` | One flat config for the repo. A new workspace under `packages/*` or `apps/*` is linted by tier 1 automatically; a workspace that renders must be added to `REACT_SOURCES` by hand to get the React and hooks rules. |
| `.prettierrc.json`, `.prettierignore` | `printWidth: 100`, single quotes, trailing commas. `*.md` is not formatted — see DECISIONS.md decision 7. |
| `packages/ui-kit/vitest.setup.ts`, `apps/runtime/vitest.setup.ts`, `apps/editor/vitest.setup.ts` | jest-dom matchers. A **new jsdom workspace must add its own**, reference it from `setupFiles`, and it is picked up by `tsconfig.tests.json`'s `apps/*/vitest.setup.ts` glob without further edits. |

## Live hazards for whoever touches this next

- **Do not add `eslint-plugin-prettier`.** `eslint-config-prettier` is last in the chain precisely
  so ESLint has no formatting opinions. Adding the plugin gives you two tools formatting the same
  characters, and the slower one reports through the lint gate.
- **ESLint is 10, and it is held there by an `overrides` entry.** `eslint-plugin-react@7.37.5` is
  the latest release and peers at `^9.7`, so a plain `npm install` fails `ERESOLVE`. The root
  manifest carries `overrides: { "eslint-plugin-react": { "eslint": "$eslint" } }`, which points the
  plugin's peer at the one installed ESLint instead of resolving a second copy. **Do not remove that
  entry** without moving ESLint back to 9 in the same change; deleting it breaks `npm install`
  itself, not just the lint lane.
- **`settings.react.version` is pinned to `19.3.0` on purpose — do not restore `'detect'`.** Under
  ESLint 10, detection calls the `context.getFilename()` that ESLint 10 removed, and the lint lane
  *crashes* with `contextOrFilename.getFilename is not a function` rather than reporting a lint
  error. **This pin must be bumped by hand whenever `react` moves**, in `eslint.config.js`, or the
  version-gated React rules silently judge against the wrong React.
- **The React plugin is unsupported on ESLint 10, so recognise its failure shape.** It already
  called one removed API; if it reaches another on code not yet written, the symptom is the lint
  lane exiting **2** with a `TypeError` naming a rule (`Error while loading rule 'react/...'`) and a
  stack inside `node_modules/eslint-plugin-react/`, **not** a lint error against your file. Read
  that as the override coming due, not as a bug in the code being linted.
- **Vite is one major again.** The root, `runtime` and `editor` all declare `vite@^8.3.0` and
  resolve to a single installed copy; the root declares it because Vitest 5 has a non-optional
  `vite` peer. This retires the old "two Vite majors" hazard: the Vitest-3-pins-an-older-Vite
  constraint that forced the split is gone, since Vitest 5 accepts `^6.4 || ^7 || ^8` and
  `@vitejs/plugin-react` 6 wants Vite 8. Vite 8 also means Rolldown and Oxc rather than Rollup
  and esbuild.
- **`--max-warnings 0` is deliberate.** `react-hooks`'s recommended set ships rules at `warn`. If a
  future rule produces noise, fix the code or turn that rule off with a stated reason — do not raise
  the threshold, which turns every hooks rule into a no-op at once.
- **A `vitest.setup.ts` belongs at the package root, never in `src/`.** Everything under `src/` is
  compiled into `dist/` and published. Moving it into `src/` ships your test vocabulary.
- **`tsconfig.tests.json` is the only place path mapping exists**, and ESLint resolves type-aware
  rules for test files through it via `parserOptions.project`. If you replace it with
  `projectService`, test files become "out of project" and every type-aware rule silently stops
  running on them — which looks like a clean lint, not a broken one.

---

# Added by "the React ui-kit and the Vite runtime page"

`@perch/ui-kit` is the only shared surface this change touches, and it is the one case the
sections above do not cover: **an export was deleted, not widened.** The imperative
`createReadout` / `installSensorProvider` surface recorded under *"the first rendered sensor
value"* and amended under *"React, Vite, strict TypeScript"* no longer exists. Read those two
sections as history; this one is the surface.

## What was removed, and what replaced it

| Deleted export | File | Replacement |
|---|---|---|
| `createSensorProvider` | `src/sensor-provider.ts` | `createSensorStore` (`src/sensor-store.ts`) — same job, no React, no globals |
| `installSensorProvider`, `currentSensorProvider` | same | `<SensorProvider source={…}>` + `useSensorStore()`. **There is no module-level mutable state left in the package**, which is the point: the old pair was a process-wide singleton, so two providers in one page were unrepresentable and test isolation depended on re-installing it. |
| `useSensor` (a plain function reading the singleton) | same | `useSensor(topic)`, an actual hook over `useSyncExternalStore` |
| `createReadout` | `src/readout.ts` | `<Readout topic=… />` (`src/readout.tsx`) |
| type `SensorProvider` | same | type `SensorStore`; the name `SensorProvider` is now the **component** |
| type `SensorProviderOptions` | same | `SensorStoreOptions` (store) and `SensorProviderProps` (component) |
| type `Readout`, `ReadoutOptions`, `ReadoutView` | `src/readout.ts` | `ReadoutProps`, `ReadoutViewModel`. `Readout` is now the **component**. |
| type `ReadoutState` | same | still `ReadoutState`, but a **four-member discriminated union** rather than a string union — see the hazard below |

Kept, same name and same meaning: `DEFAULT_STALE_AFTER_MS`, `READOUT_STYLES`,
`READOUT_WAITING_TEXT`, `READOUT_NO_READING_TEXT`, `readoutView`, `SensorSnapshot`,
`ReadoutViewInput`.

New: `assertNever`, `createSensorStore`, `SensorProvider`, `useSensor`, `useSensorMeta`,
`useSensorStatus`, `useSensorStore`, `Readout`, `readoutState`, `staleNote`,
`READOUT_STATE_KINDS`, `READOUT_DECIMALS`, `DEFAULT_DECIMALS`, and the types `SensorStore`,
`SensorStoreOptions`, `SensorProviderProps`, `ReadoutProps`, `ReadoutStateKind`,
`ReadoutViewModel`.

## Every call site, checked one by one

| Call site | What it uses | Action taken |
|---|---|---|
| `packages/ui-kit/src/index.ts` | re-exports the whole surface above | rewritten |
| `packages/ui-kit/src/readout.tsx` | `useSensor`, `useSensorMeta`, `readoutView`, `assertNever`, `SensorSnapshot` | new file |
| `packages/ui-kit/src/sensor-context.tsx` | `createSensorStore`, `SensorStore`, `SensorSnapshot` | new file |
| `packages/ui-kit/src/readout-view.ts` | `assertNever`, `SensorSnapshot` | new file |
| `packages/ui-kit/src/sensor-store.test.ts` | the store surface | new, 30 tests |
| `packages/ui-kit/src/sensor-context.test.tsx` | the provider and all four hooks | new |
| `packages/ui-kit/src/readout-view.test.ts` | `readoutView`, `readoutState`, `staleNote`, `READOUT_STATE_KINDS` | new |
| `packages/ui-kit/src/readout.test.tsx` | `Readout`, `SensorProvider`, `READOUT_STYLES` | new |
| `packages/ui-kit/src/sensor-provider.test.ts`, `src/readout.test.ts` | the deleted surface | **deleted with it** |
| `apps/runtime/src/app.tsx` | `SensorProvider`, `Readout`, `useSensor`, `useSensorStatus`, `READOUT_STYLES`, `assertNever` | the first real consumer |
| `apps/runtime/src/dependency-edges.test.ts:5`, `apps/editor/src/dependency-edges.test.ts:5` | `import * as uiKit`, asserts it is an object | **none.** Namespace imports, no named binding; both still pass. |
| `packages/layout-schema/src/environment.test.ts:18` | names `@perch/ui-kit` in a comment and forbids importing it | **none.** The prohibition is unchanged and still enforced. |
| `apps/editor/package.json`, `apps/runtime/package.json` | `"@perch/ui-kit": "0.0.0"` | **none.** Workspace link by name; nothing published. |
| `tsconfig.tests.json`, `vitest.aliases.js` | path/alias to `src/index.ts` | **none.** `vite.config.ts` now imports `perchAliases` from `vitest.aliases.js`, so the page and the tests share one table. |
| `.evidence/demo/entry.ts` (untracked evidence, not in the diff) | `createReadout`, `createSensorProvider`, `READOUT_STYLES` | **stale and left stale.** It is a screenshot harness from a previous change and will not compile against this surface. It is not built, linted or type-checked by any lane. |

`apps/editor` is the one declared consumer that renders and does **not** call the new surface
yet. When it does, `<SensorProvider>` goes at its canvas root — not per widget, and not two of
them for one source.

## Live hazards for whoever touches this next

- **`ReadoutState` is exhaustiveness-enforced in three places, and `SensorSnapshot` in one.**
  Adding a fifth `ReadoutState` member is a compile error at `readout-view.ts`'s
  `READOUT_STATE_KIND_PRESENCE` (a `Readonly<Record<ReadoutStateKind, true>>`, TS2741), at
  `describe()`'s `assertNever` (TS2345) and at `readout.tsx`'s `toneOf()` (TS2345). Adding a
  fourth `SensorSnapshot` state fails at `readoutState()`'s `assertNever` plus four narrowing
  errors in `materiallySame`. This was verified by adding each member and reading the error
  list — `.evidence/exhaustiveness-probe.log`. **Do not "fix" one of those by widening a
  `default:` branch**; they are the mechanism, not the obstacle.
- **The store owns exactly one subscription to its source.** `SensorProvider` calls
  `store.open()` in an effect and `store.close()` on teardown; `open()` is idempotent
  (`unsubscribeSource ??= source.subscribe(...)`) so StrictMode's double-invoked effects cannot
  double-subscribe. A widget that adds its own `useEffect(() => source.subscribe(...))` breaks
  the property the frame budget depends on. Widgets subscribe to the **store**, per topic, via
  `useSensor`.
- **The store must be held by `useMemo`, not `useRef`.** `react-hooks/refs` (plugin v7) forbids
  reading `ref.current` during render, and the store is needed during render. See DECISIONS.md.
- **The source is injected and must stay injected.** `SensorProviderProps.source` is required
  with no default. `apps/runtime/src/main.tsx` is the only file in the repo that calls
  `createMockSource`; that is what makes the MQTT swap a two-line change.
- **`READOUT_STYLES` has no `:hover`, `:focus`, `transition` or `animation`, and no rule that
  changes geometry per state.** `data-state` and `data-tone` are colour-only. A capture samples
  one frame; anything mid-flight is photographed half-done. `readout.test.tsx` asserts the
  absence, so adding one fails a test rather than quietly costing a frame.
- **The value's `3rem` font size is measured, not chosen.** At `3.5rem` a four-digit fan speed
  with its unit needs ~189px and eight readouts across 1920px get 182px each, so the ellipsis
  backstop fired on ordinary readings. Raising it again re-opens that, and the page's
  `.perch-tile { min-width: 13rem }` floor is calibrated against it.
- **The repo is on Vite 8.** `apps/runtime` and `apps/editor` declare `vite@^8.3.0` with
  `@vitejs/plugin-react@^6.1.1`, and the root declares `vite@^8.3.0` as well, so there is one
  installed copy rather than two majors. The alignment that earlier notes deferred to "the next
  `npm install`" has happened.
