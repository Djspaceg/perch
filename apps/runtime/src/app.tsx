/**
 * THE PAGE, NOT YET THE RUNTIME.
 *
 * This file **hard-codes its widgets**. The real runtime will read a layout through
 * `@perch/layout-schema` and instantiate widgets from it; the tile list below is not the shape
 * that will take, and nothing here should be mistaken for the runtime's final structure. It
 * exists so the widget work can be looked at as pixels instead of assertions, and it shrinks —
 * to a layout loader and a widget factory — the moment `layout-schema` lands.
 *
 * What it does hold to, because these are the seams under test:
 *
 * - **The sources are injected.** `Dashboard` takes them as a prop and constructs nothing. The
 *   mock/MQTT swap happens in `main.tsx`, one line, and this file does not change.
 * - **Every state is driven, not waited for.** A second source that publishes once and stops
 *   produces the stale rendering; a topic the mock does not publish at all produces the waiting
 *   rendering; `cooler/fan` reports `null` by design. All four renderings are on screen within a
 *   second of load, which is what makes a screenshot of this page evidence rather than luck.
 * - **Every topic is built with `sensorTopic()`.** There is not a hand-written topic string here.
 * - **Two providers, because one source cannot be both live and dead at once.** The nested
 *   provider also demonstrates the thing the old module-global singleton made impossible: two
 *   independent stores in one page, each feeding its own subtree.
 *
 * ## Fluid, deliberately — this page does not implement capture mode
 *
 * The canvas fills the viewport instead of being a fixed 1920×400 box scaled to fit. That is not
 * a shortcut, it is staying out of the runtime's way: windowed-versus-capture mode, `layout.target`
 * and rejecting a target the layout cannot honour are the runtime's job (README.md, "Two modes"),
 * and a page that half-implemented letterboxing would have to be un-implemented later.
 *
 * It also makes this page a better test surface. Because the layout is fluid, a browser tab and a
 * 1920×400 panel viewport produce genuinely different geometry — narrow tall columns versus wide
 * short ones — rather than the same layout at two scales. A widget whose label could push its
 * column wider shows that at tab width; a widget whose rows could reflow shows it at 400px of
 * height. Both are real checks.
 */

import type { ReactNode } from 'react';
import { sensorTopic, type SensorSource } from '@perch/sensor-contract';
import {
  READOUT_STYLES,
  Readout,
  SensorProvider,
  assertNever,
  useSensor,
  useSensorStatus,
} from '@perch/ui-kit';

/**
 * How stale the frozen tile's reading is allowed to get before it says so.
 *
 * Short on purpose. The tile exists to *show* the stale rendering, so waiting out the real
 * 5 s default would mean the page spends its first five seconds not demonstrating the thing the
 * tile is for — and a capture taken in that window would silently show a live value instead. This
 * is the page choosing what to demonstrate, through a normal provider prop; the default the real
 * panel runs on is unchanged and lives in `ui-kit`.
 */
const FROZEN_STALE_AFTER_MS = 1_500;

interface TileSpec {
  /** What this tile is here to demonstrate, printed above it. */
  readonly caption: string;
  readonly topic: string;
  readonly label?: string | undefined;
  readonly decimals?: number | undefined;
}

/** The tiles fed by the running source. */
const LIVE_TILES: readonly TileSpec[] = Object.freeze([
  { caption: 'live', topic: sensorTopic('cpu', 'temperature') },
  { caption: 'live · 0 decimals', topic: sensorTopic('gpu', 'fan') },
  { caption: 'live · indexed topic', topic: sensorTopic('storage', 'temperature', { deviceIndex: 1 }) },
  { caption: 'live · dimensionless', topic: sensorTopic('cpu', 'factor') },
  { caption: 'live · 2 decimals', topic: sensorTopic('cpu', 'power'), decimals: 2 },
  { caption: 'null · reports nothing', topic: sensorTopic('cooler', 'fan') },
  /**
   * The tile that carries the fixed defect.
   *
   * Nothing publishes `psu/voltage`, so it has no metadata and no label, and the readout falls
   * back to the canonical topic — `sensors/psu/0/voltage/0`, by far the longest string on the
   * page. Under the old two-`max-content`-column grid that string set the width of the whole
   * widget, because a grid item spanning both tracks contributes its max-content width to track
   * sizing. It is kept as a tile rather than fixed by giving it a label precisely so a capture can
   * show it staying inside its column.
   */
  { caption: 'waiting · no metadata label', topic: sensorTopic('psu', 'voltage') },
]);

/** The tile fed by the source that published once and stopped. */
const FROZEN_TILE: TileSpec = Object.freeze({
  caption: 'stale · publisher stopped',
  topic: sensorTopic('gpu', 'temperature'),
});

/** The topic the footer reports on, so the page has a visible heartbeat. */
const HEARTBEAT_TOPIC = sensorTopic('cpu', 'temperature');

export interface DashboardSources {
  /** Publishes on a timer. The tiles that show live values read from this. */
  readonly live: SensorSource;
  /** Publishes once and stops, so its topics age out. Feeds exactly one tile. */
  readonly frozen: SensorSource;
}

export function Dashboard({ sources }: { readonly sources: DashboardSources }): ReactNode {
  return (
    <SensorProvider source={sources.live}>
      {/*
       * React 19 hoists a `<style>` carrying `href` and `precedence` into `<head>` and dedupes it
       * by `href`, so the widget's stylesheet arrives with the component that needs it and lands
       * once however many Dashboards render. `READOUT_STYLES` is a string rather than a `.css`
       * import because `ui-kit` is consumed both by this bundler and by tests that have none.
       */}
      <style href="perch-readout" precedence="default">
        {READOUT_STYLES}
      </style>
      <style href="perch-page" precedence="default">
        {PAGE_STYLES}
      </style>

      <div id="perch-canvas">
        <header id="perch-header">
          <span className="perch-header__title">perch · runtime</span>
          <span className="perch-header__meta">hard-coded tiles · mock source</span>
        </header>

        <div id="perch-strip">
          {LIVE_TILES.map((spec) => (
            <Tile key={spec.topic} spec={spec} />
          ))}
          {/*
           * Its own provider, and therefore its own store and its own subscription. One source
           * cannot be both publishing and dead, so the stale rendering needs a second one — and
           * being able to nest a provider at all is what replaced the installed singleton.
           */}
          <SensorProvider source={sources.frozen} staleAfterMs={FROZEN_STALE_AFTER_MS}>
            <Tile spec={FROZEN_TILE} />
          </SensorProvider>
        </div>

        <Footer />
      </div>
    </SensorProvider>
  );
}

function Tile({ spec }: { readonly spec: TileSpec }): ReactNode {
  return (
    <div className="perch-tile">
      <span className="perch-tile__caption">{spec.caption}</span>
      <Readout topic={spec.topic} label={spec.label} decimals={spec.decimals} />
    </div>
  );
}

/**
 * The heartbeat.
 *
 * Reports the source's status and the timestamp *carried by the data*, not the wall clock. That
 * distinction is the whole point: a wall clock advances in a screenshot of a dead page, whereas
 * this line can only change if a reading actually arrived. Two captures moments apart showing two
 * different times is therefore evidence that the subscription is delivering.
 */
function Footer(): ReactNode {
  const status = useSensorStatus();
  const snapshot = useSensor(HEARTBEAT_TOPIC);
  const arrived = snapshot.state !== 'waiting';

  return (
    <footer id="perch-footer" data-perch-ready={arrived ? 'true' : 'false'}>
      {`source ${status} · cpu/temperature last published ${publishedAt(snapshot)}`}
    </footer>
  );
}

/** When the heartbeat topic last published, or why it has not. */
function publishedAt(snapshot: ReturnType<typeof useSensor>): string {
  switch (snapshot.state) {
    case 'waiting':
      return 'never';
    case 'live':
    case 'stale':
      return new Date(snapshot.reading.at).toLocaleTimeString();
    default:
      return assertNever(snapshot, 'sensor snapshot state');
  }
}

/**
 * Page chrome only. Everything that styles a widget lives in `READOUT_STYLES`, in `ui-kit`,
 * where the widget is — a page that restyled its widgets would make every capture of this page
 * evidence about this page rather than about the widget.
 *
 * An explicit `min-width` on the tile is the other half of the label fix: a flex item defaults to
 * `min-width: auto`, which floors it at its content's min-content width, and no amount of
 * `overflow: hidden` inside the widget helps if its container refuses to be narrower than the
 * text. The widget guarantees it will not *demand* width; the tile has to allow it. See the note
 * on `.perch-tile` for why the floor is a measured 13rem rather than 0.
 */
const PAGE_STYLES = `
html, body { margin: 0; min-height: 100%; background: #07080a; }
#perch-canvas {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 24px 40px;
  display: flex;
  flex-direction: column;
  background: #101318;
  font-family: ui-sans-serif, system-ui, sans-serif;
  color: #f2f4f8;
}
#perch-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 1px solid #262c36;
  padding-bottom: 10px;
}
.perch-header__title { font-size: 1.25rem; font-weight: 650; letter-spacing: 0.01em; }
.perch-header__meta { font-size: 0.875rem; color: #6b7480; }
#perch-strip {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  align-content: center;
  column-gap: 16px;
  row-gap: 28px;
  min-height: 0;
}
/*
 * min-width is a number, not auto, and both halves of that matter.
 *
 * Not auto, because auto on a flex item means max-content: the unpublished tile's label is the raw
 * topic sensors/psu/0/voltage/0, and under auto that one string would set the width of every tile
 * in the row. That is the defect this page exists to disprove, and it is why the widget never
 * demands width either.
 *
 * But not 0 either, which is what it was until a 1440px capture showed eight tiles squeezed to
 * ~160px and the values overflowing into each other. A floor of 13rem is the width at which a
 * five-digit value plus its unit still fits — measured against the 1920x400 row, where tiles land
 * at ~216px and render cleanly. Below the floor the row wraps rather than shrinking further, so
 * every value stays whole at every viewport. The widget clips as a backstop; wrapping is the fix.
 *
 * border-box, because the floor is a floor on the tile, not on its text box: under content-box the
 * 34px of padding and border land on top of 13rem, and eight of those overflow 1920 — which wrapped
 * the panel row that had fitted in one line before the floor existed.
 */
.perch-tile {
  box-sizing: border-box;
  flex: 1 1 13rem;
  min-width: 13rem;
  padding: 14px 16px;
  border-left: 2px solid #262c36;
}
.perch-tile__caption {
  display: block;
  margin-bottom: 10px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #4d5561;
}
#perch-footer {
  border-top: 1px solid #262c36;
  padding-top: 10px;
  font-size: 0.8125rem;
  color: #6b7480;
  font-variant-numeric: tabular-nums;
}
`;
