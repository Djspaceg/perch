/**
 * What the Add menu makes: one element of a kind, with defaults that validate.
 *
 * Every kind: a live reading (`widget` with `readout`), a chart (`chart` with `line-chart`), a label
 * (`text`), and media twice over, an image or video from the files beside the layout and a video
 * from the cloud catalogue. Media was left out while choosing one meant typing a path, since an element whose
 * `src` names nothing paints the missing-asset box the moment it is made. Both media entries choose
 * from what is there instead: files the host found beside the layout, or a video downloaded before it
 * is set, so a new media element always paints.
 *
 * Every default here is a value the author is expected to change, chosen so the element is valid and
 * visible straight away: centred on the canvas, at a size its widget draws legibly, and clamped to the
 * canvas so a small target still gets an element that fits. The element then goes through `addElement`
 * and `editDraft` like every other edit, so `validateLayout` is what finally says it is acceptable.
 */

import type { LayoutElement, LayoutTarget, Range, Rect } from '@perch/layout-schema';
import { parseSensorTopic, type SensorMetric } from '@perch/sensor-contract';
import { assertNever, type WidgetName } from '@perch/ui-kit';

/** The element kinds the Add menu offers. */
export type AddableKind = 'widget' | 'chart' | 'text' | 'media';

/**
 * What choosing an entry goes on to ask for: a sensor, a file beside the layout, a cloud video, or
 * nothing.
 */
export type AddStep = 'sensor' | 'local' | 'cloud' | null;

export interface AddableEntry {
  readonly kind: AddableKind;
  /** What the menu calls it. */
  readonly label: string;
  /** One line under the label, saying what it is. */
  readonly hint: string;
  readonly step: AddStep;
}

export const ADDABLE_KINDS: readonly AddableEntry[] = Object.freeze([
  { kind: 'widget', label: 'Live reading', hint: 'one sensor, as a number', step: 'sensor' },
  { kind: 'chart', label: 'Chart', hint: 'one sensor over time', step: 'sensor' },
  { kind: 'text', label: 'Label', hint: 'a line of text', step: null },
  { kind: 'media', label: 'Image or video', hint: 'a file beside the layout', step: 'local' },
  { kind: 'media', label: 'Cloud video', hint: 'from the Thermalright catalogue', step: 'cloud' },
]);

/** The widget each bound kind is drawn with. Typed against `ui-kit`'s catalogue, so a rename fails here. */
const READOUT: WidgetName = 'readout';
const LINE_CHART: WidgetName = 'line-chart';

/** How much history a new chart shows: a minute, like the shipped trend layout. */
const NEW_CHART_WINDOW_MS = 60_000;

/** What a new label says: something to select and overwrite, never the empty string the format refuses. */
const NEW_LABEL_TEXT = 'label';

/** A new element's size before clamping, per kind: what each draws legibly at a 1920x400 panel. */
const NEW_SIZE: Readonly<Record<AddableKind, { readonly w: number; readonly h: number }>> = {
  widget: { w: 214, h: 150 },
  chart: { w: 352, h: 240 },
  text: { w: 360, h: 48 },
  // 16:9, and short enough for a 400px-tall panel.
  media: { w: 480, h: 270 },
};

/** The rect a new element of `kind` gets: its size, clamped to the canvas, centred on it. */
export function newRect(kind: AddableKind, target: LayoutTarget): Rect {
  const w = Math.max(1, Math.min(NEW_SIZE[kind].w, target.width));
  const h = Math.max(1, Math.min(NEW_SIZE[kind].h, target.height));

  return {
    x: Math.floor((target.width - w) / 2),
    y: Math.floor((target.height - h) / 2),
    w,
    h,
  };
}

/**
 * Scales to start a chart from, by what the sensor measures. A starting point the author moves, not
 * a claim about the hardware: the format requires an authored range on a line chart precisely because
 * a scale taken from observed extremes rescales as the day's peak moves.
 */
const METRIC_RANGES: Partial<Readonly<Record<SensorMetric, Range>>> = {
  temperature: [20, 100],
  fan: [0, 3000],
  clock: [0, 6000],
  power: [0, 300],
  voltage: [0, 15],
};

/** Everything measured in percent, and the start for anything the table does not name. */
const PERCENT_RANGE: Range = [0, 100];

/** The range a new chart on `topic` starts with. Always min < max. */
export function defaultRange(topic: string): Range {
  const parts = parseSensorTopic(topic);
  if (parts === null) return PERCENT_RANGE;

  return METRIC_RANGES[parts.metric] ?? PERCENT_RANGE;
}

/**
 * A new element of `kind`. `binding` is what the entry's step chose: the sensor a reading or chart is
 * bound to, or the `src` of media, a path beside the layout or a cloud reference. A label ignores it.
 */
export function newElement(
  kind: AddableKind,
  target: LayoutTarget,
  binding: string | undefined,
): LayoutElement {
  const topic = binding;
  const rect = newRect(kind, target);

  switch (kind) {
    case 'widget':
      return { kind: 'widget', widget: READOUT, topic: topic ?? '', rect };
    case 'chart':
      return {
        kind: 'chart',
        widget: LINE_CHART,
        topic: topic ?? '',
        rect,
        windowMs: NEW_CHART_WINDOW_MS,
        range: defaultRange(topic ?? ''),
      };
    case 'text':
      return { kind: 'text', text: NEW_LABEL_TEXT, rect };
    case 'media':
      return { kind: 'media', src: binding ?? '', rect, fit: 'cover' };
    default:
      return assertNever(kind, 'addable kind');
  }
}
