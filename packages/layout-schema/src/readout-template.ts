/**
 * A readout, written as a text template: the converter that folding readouts into text would use.
 *
 * Nothing calls `readoutElementAsText` on a layout yet. Readouts stay widgets until the human has
 * seen the annotation syntax (`template.ts`) in the editor and approved it; this is the conversion
 * that would follow, tested now so the syntax is known to say everything a readout shows. The editor
 * uses `readoutTemplate` to turn one placeholder into a readout's three rows, which converts nothing.
 */

import type { TextElement, WidgetElement } from './element.js';

/**
 * A readout's three rows for `topic`: the sensor's name in the label style, the value fitted to
 * the box and held while stale, and the note. A readout's decimals are the metric's, which is what
 * `fit` without `fixed` prints.
 */
export function readoutTemplate(topic: string): string {
  return [
    `{#label}{${topic} | label}{/label}`,
    `{${topic} | fit | hold}`,
    `{${topic} | note}`,
  ].join('\n');
}

/**
 * The readout's placement tokens, as the text element's. A readout sits at the top-start of its box
 * (`--perch-readout-anchor` and `--perch-readout-justify` default to `start`); a text element centres
 * vertically by default, so the anchor is always written.
 */
const PLACEMENT: Readonly<Record<string, string>> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
};

/** A readout element as the text element that paints the same rows in the same rect. */
export function readoutElementAsText(element: WidgetElement): TextElement {
  const {
    '--perch-readout-anchor': anchor,
    '--perch-readout-justify': justify,
    ...rest
  } = element.style ?? {};
  const style: Record<string, string> = {
    '--perch-text-anchor': PLACEMENT[anchor ?? 'start'] ?? 'flex-start',
  };
  if (justify !== undefined) {
    style['--perch-text-justify'] = PLACEMENT[justify] ?? 'flex-start';
    style['--perch-text-align'] = justify;
  }

  return {
    kind: 'text',
    text: readoutTemplate(element.topic),
    rect: element.rect,
    style: { ...style, ...rest },
    ...(element.opacity === undefined ? {} : { opacity: element.opacity }),
    ...(element.hidden === undefined ? {} : { hidden: element.hidden }),
  };
}
