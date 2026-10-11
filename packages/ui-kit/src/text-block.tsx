/**
 * A string painted at a rect — the `text` element of a layout, as pixels.
 *
 * Since schema version 5 the string is a template (`layout-schema`'s `template.ts`): literal text
 * with `{sensors/...}` values and `{time}`-style clock tokens in it. A caption with no placeholder
 * is still exactly what it was: no subscription, no state, no timer, so it costs a caption nothing
 * that templates exist.
 *
 * ## A template keeps the frame budget
 *
 * The parts are parsed once per string, and each placeholder is its own `<span>` with its own
 * subscription, so a reading arriving rewrites one text node and adds or removes none: the skeleton
 * is fixed for as long as the string is, as `<Readout>`'s is. A sensor shows what a readout's value
 * row would (`readoutView`), or the template's fallback while there is nothing to believe; the clock
 * repaints on the minute, or on the second only where a token shows seconds, from one timer per
 * element aligned to the boundary, so a capture never sees `3:41` a second after `3:42`.
 *
 * ## The shape is fixed, and the rect is the shape
 *
 * The element fills the rect the layout gave it and never asks for more. Two consequences:
 *
 * - **It cannot push anything.** Every element on the canvas is absolutely positioned at authored
 *   coordinates, so a string longer than its rect must clip rather than grow — a caption that
 *   widened its box would move nothing (there is nothing to move) but would paint over its
 *   neighbour, which on a panel reads as two broken widgets rather than one long caption.
 * - **The author controls the break, not the renderer.** Lines break where the authored string has
 *   a newline (`white-space: pre-line`) and nowhere else by default. A caption that reflowed at a
 *   width the author never saw is the responsive-layout failure this project's coordinate system
 *   exists to avoid.
 *
 * Placement inside the rect is a theme token pair rather than a prop, because it is presentation:
 * `--perch-text-justify` and `--perch-text-anchor` are the flex values, so a layout can centre a
 * title in its band or pin a footnote to the bottom-left without a schema field for either.
 */

import {
  parseTextTemplate,
  type ClockToken,
  type ClockVariant,
  type TemplateFilter,
  type TemplatePart,
} from '@perch/layout-schema';
import {
  normalizeSensorTopic,
  parseSensorTopic,
  SENSOR_METRIC_UNITS,
} from '@perch/sensor-contract';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { clockGranularityMs, formatClockToken } from './clock-format.js';
import { READOUT_NO_READING_TEXT, readoutView } from './readout-view.js';
import { useSensor, useSensorMeta } from './sensor-context.js';
import { token } from './tokens.js';

export interface TextBlockProps {
  /**
   * The string to paint. Required and non-empty by the layout format's own rule: an element with
   * nothing to say paints a blank rectangle, which on a panel is indistinguishable from a broken
   * binding, so it is rejected at load rather than rendered as air.
   */
  text: string;
  /** The layout's `locale`, for clock tokens. The host's own when absent. */
  locale?: string | undefined;
  /** The layout's `timeZone`, for clock tokens. The host's own when absent. */
  timeZone?: string | undefined;
}

export function TextBlock({ text, locale, timeZone }: TextBlockProps): ReactNode {
  const parts = useMemo(() => templateParts(text), [text]);

  return (
    <div className="perch-text">
      <span className="perch-text__body">
        {parts.length === 1 && parts[0]?.kind === 'literal' ? (
          parts[0].text
        ) : (
          <TemplateParts parts={parts} locale={locale} timeZone={timeZone} />
        )}
      </span>
    </div>
  );
}

/**
 * The parts to paint. A string the format refused cannot reach a canvas, so a failed parse is only
 * reachable from a caller with no layout; it paints as the characters it is rather than as nothing.
 */
function templateParts(text: string): readonly TemplatePart[] {
  const parsed = parseTextTemplate(text);
  return parsed.ok ? parsed.parts : [{ kind: 'literal', text }];
}

function TemplateParts({
  parts,
  locale,
  timeZone,
}: {
  readonly parts: readonly TemplatePart[];
  readonly locale: string | undefined;
  readonly timeZone: string | undefined;
}): ReactNode {
  const granularity = parts.reduce(
    (finest, part) =>
      part.kind === 'clock'
        ? Math.min(finest, clockGranularityMs(part.token, part.variant))
        : finest,
    Number.POSITIVE_INFINITY,
  );
  const now = useClock(granularity);

  return parts.map((part, index) => {
    switch (part.kind) {
      case 'literal':
        // Index keys are right here: the parts are fixed for as long as the string is.
        return <span key={index}>{part.text}</span>;
      case 'sensor':
        return (
          <SensorPart
            key={index}
            topic={part.topic}
            filters={part.filters}
            fallback={part.fallback}
          />
        );
      case 'clock':
        return (
          <ClockPart
            key={index}
            token={part.token}
            variant={part.variant}
            now={now}
            locale={locale}
            timeZone={timeZone}
          />
        );
    }
  });
}

/**
 * Now, repainted every `granularityMs` on the boundary; never, for a template with no clock
 * (`Infinity`), which then sets no timer at all.
 */
function useClock(granularityMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!Number.isFinite(granularityMs)) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (): void => {
      const at = Date.now();
      timer = setTimeout(
        () => {
          setNow(Date.now());
          schedule();
        },
        granularityMs - (at % granularityMs) + 5,
      );
    };
    schedule();
    return () => {
      clearTimeout(timer);
    };
  }, [granularityMs]);

  return now;
}

function ClockPart({
  token: name,
  variant,
  now,
  locale,
  timeZone,
}: {
  readonly token: ClockToken;
  readonly variant: ClockVariant;
  readonly now: number;
  readonly locale: string | undefined;
  readonly timeZone: string | undefined;
}): ReactNode {
  return (
    <span data-perch-template="clock" data-perch-token={`${name}:${variant}`}>
      {formatClockToken(name, variant, now, locale, timeZone)}
    </span>
  );
}

/**
 * One sensor in a template: what a readout's value row would say, filtered, or the fallback while
 * there is no reading to believe — nothing heard yet, or stale. A sensor present and reporting
 * nothing says `n/a`, as a readout does, since that is a fact and not an absence of one. `unit` and
 * `label` show whatever the reading's state, since neither is a measurement.
 */
function SensorPart({
  topic,
  filters,
  fallback,
}: {
  readonly topic: string;
  readonly filters: readonly TemplateFilter[];
  readonly fallback: string;
}): ReactNode {
  const snapshot = useSensor(topic);
  const meta = useSensorMeta(topic);
  const metric = useMemo(() => parseSensorTopic(topic)?.metric, [topic]);
  const show = filters.find((filter) => filter.name !== 'fixed')?.name ?? 'text';
  const fixed = filters.find((filter) => filter.name === 'fixed');
  const places = fixed?.name === 'fixed' ? fixed.places : undefined;

  let text: string;
  let state: string;
  if (show === 'label') {
    text = meta?.label ?? normalizeSensorTopic(topic) ?? topic;
    state = 'label';
  } else if (show === 'unit') {
    text = metric === undefined ? '' : SENSOR_METRIC_UNITS[metric];
    state = 'unit';
  } else if (metric === undefined) {
    text = fallback;
    state = 'waiting';
  } else {
    const view = readoutView({ snapshot, metric, decimals: places });
    state = view.state;
    text =
      view.state === 'waiting' || view.state === 'stale'
        ? fallback
        : view.state === 'no-reading'
          ? READOUT_NO_READING_TEXT
          : show === 'value'
            ? view.value
            : view.text;
  }

  return (
    <span data-perch-template="sensor" data-state={state}>
      {text}
    </span>
  );
}

/**
 * The text element's styles, as a string for the page to inject once — the same shape and for the
 * same reasons as `READOUT_STYLES`.
 *
 * No hover, focus or active rule: the panel has no pointer. No transition or keyframe: a capture
 * samples one frame, and anything mid-flight is photographed half-done.
 *
 * `overflow: hidden` on the outer box with `min-width: 0` is the containment guarantee — a string
 * that does not fit is clipped inside its own rect instead of painting over the element beside it.
 * It is deliberately a hard clip rather than an ellipsis: a truncated *number* must look truncated
 * (which is why the readout ellipsises), but a caption reading `GPU` where the author wrote
 * `GPU CORE` is still a correct word, and an ellipsis on a centred title looks like a defect in the
 * layout rather than in the text.
 */
export const TEXT_BLOCK_STYLES = `
.perch-text {
  display: flex;
  min-width: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  justify-content: ${token('--perch-text-justify')};
  align-items: ${token('--perch-text-anchor')};
  font-family: ${token('--perch-font')};
}
.perch-text__body {
  min-width: 0;
  white-space: pre-line;
  text-align: ${token('--perch-text-align')};
  font-size: ${token('--perch-text-size')};
  font-weight: ${token('--perch-text-weight')};
  line-height: ${token('--perch-text-line-height')};
  letter-spacing: ${token('--perch-text-tracking')};
  text-transform: ${token('--perch-text-transform')};
  color: ${token('--perch-text-color')};
}
`;
