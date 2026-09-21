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
 * The value is now exempt in two co-operating ways, and both are about geometry rather than text:
 *
 * - **A field sized in characters, not in content.** A width of `READOUT_VALUE_FIELD_CHARS` `ch`
 *   with `tabular-nums` is exactly that many digit advances whatever the reading is, so `0.0` and
 *   `37699580` occupy the same box and the unit beside it never moves. Nothing here reflows when a
 *   value crosses a digit boundary.
 * - **A type scale taken from the widget's own width.** `.perch-readout` is an inline-size query
 *   container and the value's `font-size` is `clamp(1.5rem, 14cqw, 3rem)`, which is the largest
 *   size at which that eight-character field plus a unit still fits the width the page granted.
 *   The size therefore depends on the *container*, never on the reading — the same input that was
 *   already constant across a capture.
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

/**
 * How many characters the value's field holds.
 *
 * The one number that decides whether a reading is printed or truncated, and the reason it lives
 * here rather than in `READOUT_STYLES`: it is a claim about *data* — how many characters a reading
 * may need — where the type scale beside it is a claim about pixels. A claim about data belongs in
 * code, where the value that motivates it can be cited and a test can read it back off the element.
 *
 * Eight, measured against the hardware this reads rather than chosen: `fixtures/lhm-data.sample.json`
 * reports GPU PCIe Rx as `6699008 B/s` — the seven-digit figure the README names as the tell that
 * the page is on MQTT — and GPU PCIe Tx, on the same card in the same payload, as `37699580 B/s`.
 * Eight characters also covers a signed six-digit reading and `-40.0`, and every placeholder.
 *
 * Applied as a width on the element, in `ch`, which with `tabular-nums` is exactly one digit: the
 * field is eight digit advances wide in whatever font and at whatever size renders it, so no font
 * metric is assumed and no reading changes the geometry.
 */
export const READOUT_VALUE_FIELD_CHARS = 8;

/** The field, as a CSS length. Derived once so the number above is the only place to change it. */
const READOUT_VALUE_FIELD_WIDTH = `${String(READOUT_VALUE_FIELD_CHARS)}ch`;

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
        {/*
         * The field is a constant, so this is the same `style` attribute in every state and for
         * every reading — React writes it once and never patches it, and the unit beside it never
         * moves. See `READOUT_VALUE_FIELD_CHARS` for why the width is here and not in the sheet.
         */}
        <span className="perch-readout__value" style={{ width: READOUT_VALUE_FIELD_WIDTH }}>
          {view.value}
        </span>
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
 * For the value it is *only* a backstop — the field below is sized so no plausible reading reaches
 * it — because a clipped value is the one thing this widget must never quietly do.
 *
 * The value's size is measured, not chosen, and it is now measured per widget instead of once:
 *
 * - **The field** is `READOUT_VALUE_FIELD_CHARS` digit advances wide, written on the element rather
 *   than here — see that constant for the reading that sized it and why it is code, not CSS. A
 *   ninth character ellipsises, and the answer to that is a display-unit scale, which belongs with
 *   `layout-schema` rather than with a defect fix.
 * - **`clamp(1.5rem, 14cqw, 3rem)`** is the type scale, against the widget's own inline size. At
 *   weight 650 in the system sans a digit advances 0.6475em, so eight of them plus the 0.35em gap
 *   and a three-glyph unit fit a container down to ~174px — which is what a 13rem tile grants, the
 *   narrowest this page produces. The old fixed 3rem needs 249px for the same eight characters and
 *   is kept as the cap, so a widget with room to spare still prints at the size it always did.
 *
 * `container-type: inline-size` is what makes `cqw` mean the widget's width, and it earns its place
 * twice: the same containment makes the widget's inline size independent of its contents, so the
 * raw-topic fallback label *cannot* size it rather than merely declining to.
 */
export const READOUT_STYLES = `
.perch-readout {
  display: flex;
  flex-direction: column;
  container-type: inline-size;
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
  font-size: clamp(1.5rem, 14cqw, 3rem);
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
