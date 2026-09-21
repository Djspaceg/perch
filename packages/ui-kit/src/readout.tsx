/**
 * One number on a wall, and the truth about how much to believe it.
 *
 * `<Readout>` is the whole of the widget: it reads one topic through `useSensor`, hands the
 * snapshot to the pure `readoutView`, and places the resulting strings into a **fixed** element
 * skeleton. It owns no subscription, holds no state, starts no timer and never sees the source.
 * Everything it knows arrives as props and context.
 *
 * ## Why the skeleton never changes shape
 *
 * Every state renders the same four elements with the same class names in the same order. Only
 * text content and two attributes differ. That is not tidiness — it is the frame budget:
 *
 * - The panel is **captured**, not interacted with. A capture reads one composited frame, so a
 *   widget that adds or removes an element between states risks being photographed mid-layout.
 * - React reconciles same-type, same-key elements by patching text nodes and attributes. Keeping
 *   the tree constant means an update writes text and never inserts, moves or removes a node — no
 *   reflow, so the geometry a capture sees is the geometry the previous frame had.
 * - The note row keeps a fixed height even when it is empty, so the widget is exactly as tall
 *   with a `stale 8s` note as without one. Otherwise a value ageing out would resize every widget
 *   in its row, which a reader sees as the whole panel twitching once every few seconds.
 *
 * ## The defect this file fixes
 *
 * The previous DOM version laid the widget out as `grid-template-columns: max-content max-content`
 * with the label spanning both tracks. When a topic has no metadata label the fallback label is
 * the *raw canonical topic* — `sensors/gpu/0/fan/0` — and a spanning item contributes its
 * max-content width to track sizing, so that one string set the width of the entire widget. At
 * panel width it merely looked wrong; in a narrower column it wrapped and pushed the value out of
 * line. `overflow: hidden` alone could not fix it, because the track was already sized by then:
 * the grid had to go. It is now a flex column with `min-width: 0`, and the label and note are
 * stretched, `nowrap` and ellipsised, so neither can contribute width to anything.
 */

import { useMemo, type ReactNode } from 'react';
import { normalizeSensorTopic, parseSensorTopic, type SensorMetric } from '@perch/sensor-contract';
import { assertNever } from './exhaustive.js';
import { readoutView, type ReadoutStateKind } from './readout-view.js';
import { useSensor, useSensorMeta } from './sensor-context.js';

export interface ReadoutProps {
  /** The topic to read. Canonical or the authored shorthand. */
  topic: string;
  /**
   * What to call it.
   *
   * Falls back to the source's metadata label, then to the canonical topic — because a topic
   * carries no display name and a widget with no caption is worse than one captioned awkwardly.
   */
  label?: string | undefined;
  /** Override the metric's decimal count. */
  decimals?: number | undefined;
}

/**
 * How loud a state should look.
 *
 * A second axis, separate from `data-state`, and separate on purpose. `data-state` says *which*
 * state this is; `tone` says how much attention it deserves. Keeping them apart is what lets the
 * mapping be enforced: CSS has no exhaustiveness check, so a fifth state added to `ReadoutState`
 * with no `data-state` rule written for it would simply render unstyled — a silent visual bug on a
 * panel nobody is watching. Deciding severity in TypeScript instead makes the same omission a
 * compile error in `toneOf` below.
 */
type ReadoutTone = 'none' | 'quiet' | 'warn' | 'alert';

export function Readout(props: ReadoutProps): ReactNode {
  const { topic, label, decimals } = props;

  // Every hook first and unconditionally, before anything that can throw or branch.
  const snapshot = useSensor(topic);
  const meta = useSensorMeta(topic);
  const parsed = useMemo(() => parseTopic(topic), [topic]);

  const view = readoutView({
    snapshot,
    metric: parsed.metric,
    label: label ?? meta?.label ?? parsed.canonical,
    decimals,
  });

  return (
    <div
      className="perch-readout"
      role="group"
      aria-label={view.label}
      data-state={view.state}
      data-tone={toneOf(view.state)}
      data-topic={parsed.canonical}
    >
      <div className="perch-readout__primary">
        <span className="perch-readout__value">{view.value}</span>
        {/*
         * The space lives in the text, not only in the CSS gap, so the widget's textContent reads
         * as `61.3 °C` rather than `61.3°C`. It is a leading space inside a flex item, so it is
         * stripped at the start of the line box and does not double the gap on screen. An empty
         * unit — `factor` is genuinely dimensionless — contributes no space at all.
         */}
        <span className="perch-readout__unit">{view.unit === '' ? '' : ` ${view.unit}`}</span>
      </div>
      <span className="perch-readout__label">{view.label}</span>
      {/* Always rendered, empty or not: a row that appears and disappears changes the height. */}
      <span className="perch-readout__note">{view.note}</span>
    </div>
  );
}

/**
 * The component's own exhaustiveness check.
 *
 * The third of four: `readoutState` and `readoutView`'s `describe` are the others, plus the
 * `Record<ReadoutStateKind, true>` behind `READOUT_STATE_KINDS`. A fifth state fails to compile
 * here until somebody decides how loud it is.
 */
function toneOf(state: ReadoutStateKind): ReadoutTone {
  switch (state) {
    case 'value':
      // A number that is simply correct needs no annotation.
      return 'none';
    case 'waiting':
      // Not yet an event. Recede, so a panel starting up does not read as a panel in trouble.
      return 'quiet';
    case 'no-reading':
      // Worth noticing but not acting on: the sensor is there and has nothing to say.
      return 'warn';
    case 'stale':
      // The one state that means something is wrong upstream.
      return 'alert';
    default:
      return assertNever(state, 'readout state kind');
  }
}

/**
 * The topic, split into the two things the widget needs from it.
 *
 * Throws rather than degrading: a typo that renders as a permanent `--` is indistinguishable from
 * a dead publisher, and the person who has to tell them apart is standing in front of a panel.
 */
function parseTopic(topic: string): { canonical: string; metric: SensorMetric } {
  const canonical = normalizeSensorTopic(topic);
  const parts = parseSensorTopic(topic);
  if (canonical === null || parts === null) {
    throw new RangeError(`not a sensor topic: ${topic}`);
  }
  return { canonical, metric: parts.metric };
}

/**
 * The widget's styles, as a string for the page to inject once.
 *
 * Deliberately not a CSS module or a styled-component: `ui-kit` ships as plain ESM consumed by a
 * Vite app and by tests with no bundler CSS pipeline, and a string is the one form that works
 * identically in both and can be asserted on directly — which is how the no-hover and
 * fixed-height rules below are actually enforced rather than merely intended.
 *
 * What is absent is as deliberate as what is present. There is no hover, focus or active rule,
 * because the panel has no pointer and no keyboard: an affordance nobody can use is an
 * affordance that can only mislead. There is no transition and no keyframe, because a capture
 * samples one frame — anything mid-flight is photographed half-done.
 *
 * Base rules come first, then the two attribute axes: `data-state` colours the value (is this a
 * number or a placeholder), `data-tone` colours the note (how much does it matter). Neither
 * axis restates the other, and neither changes geometry — only colour — so an update still
 * cannot reflow the widget.
 *
 * Every text run is clipped to its box, the primary row included. That row is the one place a
 * *number* can be too wide, and a number is the worst thing to spill: a 1440px capture caught
 * `1448 RPM` painting across the tile beside it, which is unreadable in both tiles at once. Ellipsis
 * rather than a bare clip, because a clipped numeral silently reads as a smaller number — `55.97`
 * becoming `55.9` is wrong, where `55.9…` is visibly incomplete. This is a containment guarantee,
 * not a layout: a widget given too little room should look starved, and the room is the page's job.
 *
 * The value is 3rem rather than the 3.5rem it started at, and that number was *measured*, not
 * chosen: at 3.5rem a four-digit fan speed with its unit needs ~189px, and eight readouts across a
 * 1920px canvas get 182px each, so the ellipsis above fired on a normal reading — visible in the
 * captures as `10…` where `1094` belonged. Clipping a live value is worse than printing it smaller.
 * A layout-driven type scale is the eventual answer; until layouts exist, the widget's default has
 * to fit the panel it is aimed at.
 */
export const READOUT_STYLES = `
.perch-readout {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.15rem;
  font-family: ui-sans-serif, system-ui, sans-serif;
  color: #f2f4f8;
}
.perch-readout__primary {
  display: flex;
  align-items: baseline;
  min-width: 0;
  overflow: hidden;
  gap: 0.35em;
}
.perch-readout__value {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 3rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.perch-readout__unit {
  font-size: 1.25rem;
  font-weight: 500;
  white-space: nowrap;
  color: #9aa4b2;
}
.perch-readout__label {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  height: 1.375rem;
  font-size: 1rem;
  line-height: 1.375rem;
  letter-spacing: 0.02em;
  color: #9aa4b2;
}
.perch-readout__note {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  height: 1.125rem;
  font-size: 0.875rem;
  line-height: 1.125rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #6b7480;
}
.perch-readout[data-state='waiting'] .perch-readout__value { color: #6b7480; }
.perch-readout[data-state='no-reading'] .perch-readout__value { color: #6b7480; }
.perch-readout[data-state='value'] .perch-readout__value { color: #f2f4f8; }
.perch-readout[data-state='stale'] .perch-readout__value { color: #8a7470; }
.perch-readout[data-tone='none'] .perch-readout__note { color: transparent; }
.perch-readout[data-tone='quiet'] .perch-readout__note { color: #6b7480; }
.perch-readout[data-tone='warn'] .perch-readout__note { color: #c8b06b; }
.perch-readout[data-tone='alert'] .perch-readout__note { color: #d08770; }
`;
