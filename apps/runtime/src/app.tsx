/**
 * THE RUNTIME: a layout loader and a widget factory.
 *
 * This file used to hard-code a list of tiles and say, at the top, that it would shrink "to a layout
 * loader and a widget factory the moment `layout-schema` lands". It has. There is no tile list here
 * any more and no topic string either: what appears on screen is entirely `layouts/*.json`, and the
 * only way a widget reaches the page is by being named in one.
 *
 * ## The pipeline, in the order it runs
 *
 * ```text
 * ?layout=<name>  ->  catalogue.entry(name)        a file, as text
 *                 ->  loadLayoutJson(text, {…})    migrate, then validate, against WIDGET_REGISTRY
 *                 ->  fitCanvas(target, viewport)  a scale, or a refusal
 *                 ->  <LayoutCanvas>               absolute rects on a fixed canvas, scaled once
 * ```
 *
 * Every step can refuse, and each refusal is rendered **on the page** by `LayoutProblem` rather than
 * logged: the panel has no console attached, and a capture of a failure has to show the failure.
 *
 * `loadLayoutJson`, not `validateLayout`. The document comes from outside — a file somebody edited —
 * so it is migrated forward first and the steps that ran are reported. `validateLayout` is for a
 * document already known to be at the current version, which is the editor's case, not this one.
 *
 * ## What survived the rewrite, deliberately
 *
 * - **The source is injected.** `Dashboard` constructs nothing; `main.tsx` picks mock or MQTT. A
 *   layout renders identically from either, which is the property that makes the mock permanent
 *   rather than a placeholder.
 * - **The page says where its numbers came from, in both modes.** `SourceProvenance` and the status
 *   badge are rendered over the canvas in capture mode as well as in a window — see the note on
 *   `PageChrome` for why that is not negotiable.
 * - **The ready signal.** `data-perch-ready` on the root, flipped by a reading actually arriving.
 */

import { useMemo, type ReactNode } from 'react';
import {
  loadLayoutJson,
  type Layout,
  type LoadLayoutOptions,
  type LoadLayoutResult,
} from '@perch/layout-schema';
import {
  normalizeSensorTopic,
  sensorTopic,
  type SensorSource,
  type SensorSourceStatus,
} from '@perch/sensor-contract';
import {
  LAYOUT_CANVAS_STYLES,
  LayoutCanvas,
  MEDIA_FRAME_STYLES,
  READOUT_STYLES,
  SensorProvider,
  TEXT_BLOCK_STYLES,
  WIDGET_REGISTRY,
  assertNever,
  useSensor,
  useSensorStatus,
} from '@perch/ui-kit';
import {
  LAYOUT_PROBLEM_STYLES,
  LayoutProblem,
  invalidLayoutProblem,
  targetMismatchProblem,
  unknownLayoutProblem,
  type LayoutProblemProps,
} from './layout-problem.js';
import { fitCanvas, useViewport, type PageRequest } from './viewport.js';
import type { LayoutCatalogue } from './layout-catalogue.js';

/**
 * What every layout on this page is validated against.
 *
 * `isTopic` accepts the authored shorthand — `sensors/cpu/temperature` as well as
 * `sensors/cpu/0/temperature/0` — because `<Readout>` accepts exactly that set: it calls
 * `normalizeSensorTopic` on whatever it is handed. The validator and the renderer therefore agree on
 * which strings are topics, which is the only property that matters here. A stricter `isSensorTopic`
 * would refuse layouts the page can in fact render, and a looser one would let a layout validate and
 * then throw inside a widget.
 *
 * No `targetVersion`: production code leaves that alone. `LAYOUT_MIGRATIONS` is empty today, so the
 * migration half of `loadLayoutJson` is a pass-through — but it is called through the loader anyway,
 * so the first real migration needs no change here.
 */
const LOAD_OPTIONS: LoadLayoutOptions = Object.freeze({
  widgets: WIDGET_REGISTRY,
  isTopic: (topic: string) => normalizeSensorTopic(topic) !== null,
});

/**
 * The topic the chrome reports on, so the page has a visible heartbeat and a ready signal.
 *
 * `cpu/load` because both sources publish it, and because the provider subscribes to the whole
 * sensor tree rather than to the topics a layout happens to name — so this works whether or not the
 * rendered layout has a widget bound to it. On `cpu/temperature`, which was the obvious choice and
 * the wrong one, the line read "last published never" against a relay delivering 213 readings a
 * second, because that machine's first CPU temperature is sensor index 2.
 */
const HEARTBEAT_TOPIC = sensorTopic('cpu', 'load');

/** Which topic the chrome names, without re-deriving it from the canonical string. */
const HEARTBEAT_LABEL = 'cpu/load';

/**
 * Where `source` came from, so the page can say it.
 *
 * Passed in rather than sniffed: `SensorSource` deliberately exposes no transport, and a page that
 * guessed by looking for an MQTT-shaped field would be wrong the first time a third implementation
 * appeared. `main.tsx` knows, because `main.tsx` chose.
 */
export type LiveSourceIdentity =
  | { readonly kind: 'mock' }
  /** The URL actually dialled — the number that matters when a broker is on the wrong port. */
  | { readonly kind: 'mqtt'; readonly url: string };

/**
 * What each source status is called on screen.
 *
 * Four distinct sentences, because the four statuses need four different actions from whoever is
 * looking at the panel, and a wall display gets read in a glance from across a room:
 *
 * - `connecting` — give it a second; nothing has failed.
 * - `live` — believe the numbers.
 * - `stale` — the transport is fine and the *publisher* stopped: the relay is up but has quit
 *   polling, or LibreHardwareMonitor went away behind it.
 * - `error` — the link itself is down: wrong port, relay not running, machine asleep.
 *
 * Exported so a test can assert they stay distinct. Collapsing any two into "no data" is the
 * failure this record exists to prevent.
 */
export const SOURCE_STATUS_WORDING: Readonly<Record<SensorSourceStatus, string>> = Object.freeze({
  connecting: 'waiting for the first reading',
  live: 'readings arriving',
  stale: 'connected, but nothing published recently',
  error: 'source unreachable - nothing is arriving',
});

export interface DashboardProps {
  /** The one sensor source. Built in `main.tsx`; never constructed here. */
  readonly source: SensorSource;
  readonly liveSource: LiveSourceIdentity;
  /** Which layouts exist. Injected for the same reason the source is: so a test can supply two. */
  readonly catalogue: LayoutCatalogue;
  /** What the URL asked for. */
  readonly request: PageRequest;
}

export function Dashboard({ source, liveSource, catalogue, request }: DashboardProps): ReactNode {
  return (
    <SensorProvider source={source}>
      {/*
       * React 19 hoists a `<style>` carrying `href` and `precedence` into `<head>` and dedupes it by
       * `href`, so each sheet arrives with the code that needs it and lands once however many
       * Dashboards render. They are strings rather than `.css` imports because `ui-kit` is consumed
       * both by this bundler and by tests that have none.
       *
       * All three `ui-kit` sheets are mounted unconditionally rather than per element kind present:
       * a layout switched by `?layout=` would otherwise add or remove a stylesheet at the moment the
       * canvas changes, and a sheet arriving one frame after the element it styles is a flash of
       * unstyled content on a page whose whole contract is that frame one is correct.
       */}
      <style href="perch-readout" precedence="default">
        {READOUT_STYLES}
      </style>
      <style href="perch-text-block" precedence="default">
        {TEXT_BLOCK_STYLES}
      </style>
      <style href="perch-media-frame" precedence="default">
        {MEDIA_FRAME_STYLES}
      </style>
      <style href="perch-layout-canvas" precedence="default">
        {LAYOUT_CANVAS_STYLES}
      </style>
      <style href="perch-layout-problem" precedence="default">
        {LAYOUT_PROBLEM_STYLES}
      </style>
      <style href="perch-page" precedence="default">
        {PAGE_STYLES}
      </style>

      <Page catalogue={catalogue} request={request} liveSource={liveSource} />
    </SensorProvider>
  );
}

/**
 * The page body: resolve a layout, then either paint it or say why not.
 *
 * Separate from `Dashboard` because it uses hooks that need the provider above them, and because
 * every hook here has to run on every path — including the refusal paths. Hence the resolution
 * happens in `useMemo` and the branching happens in the returned JSX, rather than the other way
 * around: an early `return` before `useViewport()` would change the hook order between a valid layout
 * and an invalid one, which React forbids and which would turn a layout typo into a crash.
 */
function Page({
  catalogue,
  request,
  liveSource,
}: {
  readonly catalogue: LayoutCatalogue;
  readonly request: PageRequest;
  readonly liveSource: LiveSourceIdentity;
}): ReactNode {
  const viewport = useViewport();
  const heartbeat = useSensor(HEARTBEAT_TOPIC);

  /**
   * The default is the catalogue's first name, sorted.
   *
   * Defaulting at all is a judgement: `?layout=` missing could equally be a refusal listing the
   * choices. But the overwhelmingly common case is `npm run dev` with no query string, and a page
   * that showed a menu instead of a dashboard would make the interesting state — a rendered layout —
   * the one that needs extra typing. The name is printed in the chrome, so a reader always knows
   * which file they are looking at.
   */
  const name = request.layout ?? catalogue.names[0] ?? null;
  const entry = name === null ? undefined : catalogue.entry(name);

  // Parsing and validating a layout is pure and depends only on its text, so it happens once per
  // document rather than on every resize — and a resize is the one thing that re-renders this
  // component continuously.
  const loaded = useMemo<LoadLayoutResult | null>(
    () => (entry === undefined ? null : loadLayoutJson(entry.text, LOAD_OPTIONS)),
    [entry],
  );

  const resolved = resolvePage(name, entry === undefined ? null : loaded, catalogue.names);
  const fit = resolved.ok ? fitCanvas(resolved.layout.target, viewport, request.mode) : undefined;

  const problem: LayoutProblemProps | null = !resolved.ok
    ? resolved.problem
    : fit?.ok === false
      ? targetMismatchProblem(resolved.name, fit.mismatch)
      : null;

  return (
    <div
      id="perch-page"
      data-perch-mode={request.mode}
      data-perch-layout={name ?? ''}
      /**
       * The ready signal: a reading has actually arrived.
       *
       * The wall clock is useless for this — it advances in a screenshot of a dead page — where a
       * reading's own timestamp can only change if the subscription delivered. A capture harness
       * waits for `true` and knows the first frame it takes has numbers in it rather than
       * placeholders.
       */
      data-perch-ready={heartbeat.state === 'waiting' ? 'false' : 'true'}
    >
      {problem === null && resolved.ok && fit?.ok === true ? (
        <div className="perch-stage" data-perch-fit={fit.fit.kind} data-perch-scale={fit.fit.scale}>
          <LayoutCanvas
            layout={resolved.layout}
            scale={fit.fit.scale}
            resolveAsset={catalogue.resolveAsset}
          />
        </div>
      ) : problem === null ? null : (
        <LayoutProblem {...problem} />
      )}

      <PageChrome
        liveSource={liveSource}
        layoutName={name}
        mode={request.mode}
        fitKind={fit?.ok === true ? fit.fit.kind : null}
        scale={fit?.ok === true ? fit.fit.scale : null}
        heartbeatAt={publishedAt(heartbeat)}
        migrations={resolved.ok ? resolved.migrations : ''}
      />
    </div>
  );
}

/** A layout ready to paint, or the refusal to show instead. */
type ResolvedPage =
  | {
      readonly ok: true;
      readonly name: string;
      readonly layout: Layout;
      /** `formatMigrationReport`'s output when anything was rewritten, else `''`. */
      readonly migrations: string;
    }
  | { readonly ok: false; readonly problem: LayoutProblemProps };

/**
 * Turn "the name and what loading it produced" into one of the two outcomes.
 *
 * Pulled out of the component so the branching is testable as a function and so `Page` has one
 * expression per concern. `loaded === null` means there was no such document — the name was absent or
 * the catalogue had nothing under it.
 */
function resolvePage(
  name: string | null,
  loaded: LoadLayoutResult | null,
  available: readonly string[],
): ResolvedPage {
  if (name === null || loaded === null) {
    return {
      ok: false,
      problem: unknownLayoutProblem(name ?? '(none requested)', available),
    };
  }

  if (!loaded.ok) {
    return { ok: false, problem: invalidLayoutProblem(name, loaded.issues) };
  }

  return {
    ok: true,
    name,
    layout: loaded.layout,
    // Empty today — `LAYOUT_MIGRATIONS` has no entries — and reported rather than dropped, because an
    // author whose file was rewritten under them is owed the list of what changed.
    migrations:
      loaded.migrations.length === 0
        ? ''
        : `migrated from schemaVersion ${loaded.fromVersion}: ${loaded.migrations
            .map((step) => step.description)
            .join('; ')}`,
  };
}

/**
 * The strip that says what you are looking at, over the top of whatever is behind it.
 *
 * **Rendered in capture mode too, and that is the point.** The mock and a real relay look identical
 * at a glance — plausible values, moving, correctly labelled — so a capture with no provenance on it
 * is a picture that can be mistaken for hardware readings months later by someone who was not here.
 * The sensor host is off for days at a time and every screenshot in this repo is mock-driven; the
 * only thing standing between that fact and a misread image is this strip being *in* the image.
 * `data-perch-source-kind` is the same fact for a script.
 *
 * Fixed to the viewport rather than placed on the canvas, so it is not a layout element: it does not
 * move under the canvas transform, does not scale, and cannot be themed or hidden by a layout file.
 * A layout that could suppress it would be a layout that could make a mock capture look live.
 */
function PageChrome({
  liveSource,
  layoutName,
  mode,
  fitKind,
  scale,
  heartbeatAt,
  migrations,
}: {
  readonly liveSource: LiveSourceIdentity;
  readonly layoutName: string | null;
  readonly mode: PageRequest['mode'];
  readonly fitKind: string | null;
  readonly scale: number | null;
  readonly heartbeatAt: string;
  readonly migrations: string;
}): ReactNode {
  const status = useSensorStatus();

  return (
    <div id="perch-chrome" data-testid="perch-chrome">
      <span className="perch-chrome__item" data-testid="perch-layout-name">
        {layoutName ?? '(no layout)'}
      </span>
      <span className="perch-chrome__item">
        {`${mode}${fitKind === null ? '' : ` · ${fitKind}`}${scale === null ? '' : ` · ${formatScale(scale)}`}`}
      </span>
      <span
        className="perch-chrome__item"
        data-testid="perch-source"
        data-perch-source-kind={liveSource.kind}
      >
        {liveSource.kind === 'mqtt'
          ? `mqtt · ${liveSource.url}`
          : 'mock data · generated here, not hardware'}
      </span>
      <span className="perch-badge" data-testid="perch-status" data-perch-status={status}>
        {`${status} · ${SOURCE_STATUS_WORDING[status]}`}
      </span>
      <span className="perch-chrome__item">{`${HEARTBEAT_LABEL} ${heartbeatAt}`}</span>
      {migrations === '' ? null : (
        <span className="perch-chrome__item" data-testid="perch-migrations">
          {migrations}
        </span>
      )}
    </div>
  );
}

/** The scale, short enough to read at a glance and precise enough to tell 1 from 0.99. */
function formatScale(scale: number): string {
  return `${scale === 1 ? '1' : scale.toFixed(3)}x`;
}

/** When the heartbeat topic last published, or why it has not. */
function publishedAt(snapshot: ReturnType<typeof useSensor>): string {
  switch (snapshot.state) {
    case 'waiting':
      return 'never published';
    case 'live':
    case 'stale':
      return new Date(snapshot.reading.at).toLocaleTimeString();
    default:
      return assertNever(snapshot, 'sensor snapshot state');
  }
}

/**
 * Page chrome only.
 *
 * Nothing here styles a widget or an element — those live in `ui-kit` and in
 * `LAYOUT_CANVAS_STYLES` — and nothing here reads a layout's theme. The strip has to be legible over
 * a canvas whose colours a layout file chose, including one that chose the same colours as the strip,
 * so it carries its own background rather than inheriting anything.
 *
 * `overflow: hidden` on `html, body` and no scrollbars anywhere: capture mode's "no scrollbars, ever"
 * is a hard requirement (README.md), and a scrollbar also steals the ~15px that would make an
 * exactly-sized viewport inexact — turning a legitimate capture into a target mismatch.
 */
const PAGE_STYLES = `
html, body {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #07080a;
}
#perch-page { position: relative; }
#perch-chrome {
  position: fixed;
  left: 0;
  bottom: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 100vw;
  padding: 4px 10px;
  border-top-right-radius: 6px;
  background: rgba(7, 8, 10, 0.82);
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 0.75rem;
  line-height: 1.4;
  color: #9aa4b2;
  font-variant-numeric: tabular-nums;
}
.perch-chrome__item {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/*
 * The status badge is colour *and* words, never colour alone: this page is read on a wall panel from
 * across a room by whoever walks past, and a red dot is not a sentence. The colours only rank
 * urgency — the text is what says what to do about it.
 */
.perch-badge {
  white-space: nowrap;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid #262c36;
  color: #9aa4b2;
  background: #171b22;
}
.perch-badge[data-perch-status='live'] { color: #7ee2a8; border-color: #23503a; background: #10241a; }
.perch-badge[data-perch-status='connecting'] { color: #8fb7e8; border-color: #23405e; background: #101a26; }
.perch-badge[data-perch-status='stale'] { color: #e8c98f; border-color: #5e4a23; background: #261e10; }
.perch-badge[data-perch-status='error'] { color: #ff9b9b; border-color: #6b2626; background: #2a1212; }
`;
