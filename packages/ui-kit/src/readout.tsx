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
 *
 * ## The defect that fix caused, and what exempts the value from it
 *
 * The same ellipsis that keeps a label from widening the widget was also clipping the *number*.
 * `.perch-readout__value` was a flex item with `min-width: 0; overflow: hidden; text-overflow:
 * ellipsis` at a fixed `3rem`, so it — the only shrinkable item in the primary row, since the unit
 * has no `min-width: 0` — absorbed every pixel of shortfall: `6699008 B/s` painted as `669…` in a
 * 216px tile, at both captured viewports. An unreadable value would be obvious; `669` is a
 * plausible reading four orders of magnitude out, and nothing on the panel says so.
 *
 * The value is now exempt by its **type scale**, taken from the widget's own width: `.perch-readout`
 * is an inline-size query container and the value's `font-size` is `clamp(1.5rem, 14cqw, 3rem)`,
 * the largest size at which eight digits plus a unit still fit the width the page granted. The size
 * depends on the *container*, never on the reading, so it is constant across a capture.
 *
 * ## The unit follows the number
 *
 * The value used to be a fixed field eight digit advances wide, so the unit never moved when a
 * reading gained a digit. With the digits at the field's start, a `9.4` was followed by five empty
 * advances before its `%` — about 90px on a desk tile — and the human asked for the unit beside the
 * number. The value now takes the width of its own text and the unit sits one `ex` after it. The
 * cost is that the unit moves by one digit when a reading crosses a power of ten (`9.9` to `10.0`);
 * within a decade it holds still, because the decimals are fixed and the digits are `tabular-nums`.
 *
 * Making the widget a query container also hardens the label fix rather than weakening it: an
 * inline-size container's width cannot depend on its contents at all, so the raw-topic fallback
 * label is now structurally unable to set the widget's width, not merely ellipsised out of trying.
 * The value keeps `overflow: hidden` with an ellipsis as a containment backstop for the reading
 * that outgrows even eight characters — a starved widget must look starved, not spill into its
 * neighbour — but no plausible reading reaches it.
 */

import { useMemo, type ReactNode } from 'react';
import { normalizeSensorTopic, parseSensorTopic, type SensorMetric } from '@perch/sensor-contract';
import { assertNever } from './exhaustive.js';
import { readoutView, type ReadoutStateKind } from './readout-view.js';
import { useSensor, useSensorMeta } from './sensor-context.js';
import { token } from './tokens.js';

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
 * For the value it is *only* a backstop — the type scale below is sized so no plausible reading
 * reaches it — because a clipped value is the one thing this widget must never quietly do.
 *
 * The value's size is measured, not chosen, and it is now measured per widget instead of once:
 *
 * - **Eight digits** is the widest reading the scale is sized for, measured rather than chosen:
 *   `fixtures/lhm-data.sample.json` reports GPU PCIe Tx as `37699580 B/s`. A ninth character may
 *   ellipsise in the narrowest tile, and the answer to that is a display-unit scale, which belongs
 *   with `layout-schema` rather than with a defect fix.
 * - **`clamp(1.5rem, 14cqw, 3rem)`** is the type scale, against the widget's own inline size. At
 *   weight 650 in the system sans a digit advances 0.6475em, so eight of them plus the 1ex gap
 *   and a three-glyph unit fit a container down to ~174px — which is what a 13rem tile grants, the
 *   narrowest this page produces. The old fixed 3rem needs 249px for the same eight characters and
 *   is kept as the cap, so a widget with room to spare still prints at the size it always did.
 *
 * `container-type: inline-size` is what makes `cqw` mean the widget's width, and it earns its place
 * twice: the same containment makes the widget's inline size independent of its contents, so the
 * raw-topic fallback label *cannot* size it rather than merely declining to.
 *
 * ## Colours and type ends are tokens; geometry is not
 *
 * Every colour, the value's weight, and the two ends of its type ramp are read through `token()`,
 * so a layout's `theme` can retheme a readout without this package knowing what a layout is. Each
 * reference carries the default this sheet used before tokens existed, so a layout with `theme: {}`
 * renders byte-identically to the hard-coded page this replaced.
 *
 * What is deliberately *not* tokenised is the geometry that the frame budget depends on: the note
 * row's fixed height, the `min-width: 0`/`nowrap`/ellipsis triple on the label and note, and the
 * `14cqw` measurement. Those are not presentation — they are the
 * guarantees that an update cannot reflow the widget and that a label cannot set its width. A theme
 * token able to switch one of them off would make a layout file capable of reintroducing the defect
 * this file's history is mostly about.
 *
 * ## Placement moves the content, never the rows
 *
 * `--perch-readout-justify` and `--perch-readout-anchor` say where the content sits in the readout's
 * box, which is the element's content box — `height: 100%` so there is a height to place it down.
 * Across, one value is read twice: as `justify-content` on the number-and-unit row and as `text-align`
 * on the readout, which the caption, the note and the number all inherit. Every row
 * keeps its full width — the stretch that makes the ellipsis work is untouched — so placement is a
 * matter of where the ink sits inside rows whose geometry does not change: a centred readout centres
 * the number and its unit together. Both default to `start`, which is where a readout sat before.
 *
 * Padding, read by the element box rather than here, narrows the container the `14cqw` scale is
 * measured against. So a padded readout's number scales down with the room padding leaves it, exactly
 * as a narrower rect's would, and the measured floor above — eight digits and a unit need about 174px
 * of content width at the default floor — is now a claim about the content box, not the rect.
 */
export const READOUT_STYLES = `
.perch-readout {
  display: flex;
  flex-direction: column;
  container-type: inline-size;
  min-width: 0;
  height: 100%;
  justify-content: ${token('--perch-readout-anchor')};
  text-align: ${token('--perch-readout-justify')};
  gap: 0.15rem;
  font-family: ${token('--perch-font')};
  color: ${token('--perch-fg')};
}
.perch-readout__primary {
  display: flex;
  align-items: baseline;
  justify-content: ${token('--perch-readout-justify')};
  min-width: 0;
  overflow: hidden;
  gap: 1ex;
}
.perch-readout__value {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: clamp(${token('--perch-value-size-min')}, 14cqw, ${token('--perch-value-size-max')});
  font-weight: ${token('--perch-value-weight')};
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.perch-readout__unit {
  font-size: ${token('--perch-unit-size')};
  font-weight: 500;
  white-space: nowrap;
  color: ${token('--perch-dim')};
}
.perch-readout__label {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  height: 1.375rem;
  font-size: ${token('--perch-label-size')};
  line-height: 1.375rem;
  letter-spacing: 0.02em;
  color: ${token('--perch-dim')};
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
  color: ${token('--perch-faint')};
}
.perch-readout[data-state='waiting'] .perch-readout__value { color: ${token('--perch-faint')}; }
.perch-readout[data-state='no-reading'] .perch-readout__value { color: ${token('--perch-faint')}; }
.perch-readout[data-state='value'] .perch-readout__value { color: ${token('--perch-fg')}; }
.perch-readout[data-state='stale'] .perch-readout__value { color: ${token('--perch-stale')}; }
.perch-readout[data-tone='none'] .perch-readout__note { color: transparent; }
.perch-readout[data-tone='quiet'] .perch-readout__note { color: ${token('--perch-faint')}; }
.perch-readout[data-tone='warn'] .perch-readout__note { color: ${token('--perch-warn')}; }
.perch-readout[data-tone='alert'] .perch-readout__note { color: ${token('--perch-alert')}; }
`;
