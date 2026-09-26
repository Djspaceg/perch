/**
 * Properties are data, and the pane stamps them. These tests pin the data side: which primitive each
 * token's label maps to for the value it holds, and which properties each element kind carries in
 * which section. The primitives' behaviour is tested once, in `controls/`; nothing here re-tests it.
 */

import { CHART_MAX_WINDOW_MS, CHART_MIN_WINDOW_MS, type LayoutElement } from '@perch/layout-schema';
import { PERCH_TOKEN_LABELS } from '@perch/ui-kit';
import { describe, expect, it } from 'vitest';
import { entitySections, targetProperties, tokenSpec } from './descriptors.js';

describe('tokenSpec', () => {
  it('makes a padding or radius a box field of CSS shorthand, bounded in layout px', () => {
    expect(tokenSpec(PERCH_TOKEN_LABELS['--perch-box-radius'], '6')).toEqual({
      kind: 'box',
      box: 'corners',
      min: 0,
      max: 999,
    });
    expect(tokenSpec(PERCH_TOKEN_LABELS['--perch-box-padding'], '8 16 4')).toEqual({
      kind: 'box',
      box: 'sides',
      min: 0,
      max: 999,
    });
  });

  it('makes a colour a colour field, with alpha where the token takes alpha', () => {
    expect(tokenSpec(PERCH_TOKEN_LABELS['--perch-box-bg'], '#00000000')).toEqual({
      kind: 'colour',
      alpha: true,
    });
    expect(tokenSpec(PERCH_TOKEN_LABELS['--perch-fg'], '#e8f1ff')).toEqual({
      kind: 'colour',
      alpha: false,
    });
  });

  it('makes a few-option vocabulary a segmented control, labelled for a person', () => {
    expect(tokenSpec(PERCH_TOKEN_LABELS['--perch-text-align'], 'left')).toEqual({
      kind: 'segmented',
      options: [
        { value: 'left', label: 'left' },
        { value: 'center', label: 'center' },
        { value: 'right', label: 'right' },
        { value: 'justify', label: 'justify' },
      ],
    });
  });

  it('makes a size a number and a unit, stepping by the unit', () => {
    expect(tokenSpec(PERCH_TOKEN_LABELS['--perch-text-size'], '1.25rem')).toEqual({
      kind: 'length',
      units: ['rem', 'px', 'em', '%'],
    });
  });

  it('carries a unitless number’s range and step from the label', () => {
    expect(tokenSpec(PERCH_TOKEN_LABELS['--perch-media-opacity'], '0.85')).toEqual({
      kind: 'number',
      min: 0,
      max: 1,
      step: 0.05,
      bar: true,
    });
    expect(tokenSpec(PERCH_TOKEN_LABELS['--perch-value-weight'], '700')).toMatchObject({
      step: 100,
      min: 100,
      max: 900,
    });
  });

  it('falls back to a text box for a value the typed control cannot hold', () => {
    expect(tokenSpec(PERCH_TOKEN_LABELS['--perch-text-size'], 'clamp(1rem, 2vw, 3rem)')).toEqual({
      kind: 'text',
    });
    expect(tokenSpec(PERCH_TOKEN_LABELS['--perch-fg'], 'rgb(1, 2, 3)')).toEqual({ kind: 'text' });
    expect(tokenSpec(PERCH_TOKEN_LABELS['--perch-fg'], '#1a2b3c80')).toEqual({ kind: 'text' });
    // A unit, or a fifth value, is a token the canvas would paint as no radius: shown as it is.
    for (const value of ['6px', '1 2 3 4 5', '-2', '1.5']) {
      expect(tokenSpec(PERCH_TOKEN_LABELS['--perch-box-radius'], value), value).toEqual({
        kind: 'text',
        numeric: true,
      });
    }
    expect(tokenSpec(PERCH_TOKEN_LABELS['--perch-text-align'], 'start')).toEqual({ kind: 'text' });
    expect(tokenSpec(PERCH_TOKEN_LABELS['--perch-font'], 'ui-serif')).toEqual({ kind: 'text' });
  });
});

const READOUT: LayoutElement = {
  kind: 'widget',
  widget: 'readout',
  topic: 'sensors/cpu/0/temperature/0',
  rect: { x: 34, y: 96, w: 214, h: 176 },
};

/** The ids of each section's properties, for comparing shapes. */
function shape(element: LayoutElement): readonly [string, readonly string[]][] {
  return entitySections(element).map((section) => [
    section.id,
    section.properties.map((p) => p.id),
  ]);
}

describe('entitySections', () => {
  it('gives every kind a Transform of two vector rows: position, then size', () => {
    const transform = entitySections(READOUT).find((section) => section.id === 'transform');

    expect(transform?.title).toBe('Transform');
    expect(
      transform?.properties.map((p) => [
        p.id,
        p.kind === 'vector' ? p.fields.map((f) => f.key) : [],
      ]),
    ).toEqual([
      ['position', ['x', 'y']],
      ['size', ['w', 'h']],
    ]);
  });

  it('gives each kind the Content its format carries, and nothing else, above Transform', () => {
    expect(shape(READOUT)).toEqual([
      ['content', ['widget', 'topic']],
      ['transform', ['position', 'size']],
    ]);
    expect(shape({ kind: 'text', text: 'hi', rect: READOUT.rect })).toEqual([
      ['content', ['text']],
      ['transform', ['position', 'size']],
    ]);
    expect(shape({ kind: 'media', src: 'a.svg', rect: READOUT.rect })).toEqual([
      ['content', ['src', 'fit']],
      ['transform', ['position', 'size']],
    ]);
    expect(
      shape({
        kind: 'chart',
        widget: 'line',
        topic: 't',
        windowMs: 60000,
        rect: READOUT.rect,
        range: [0, 100],
      }),
    ).toEqual([
      ['content', ['widget', 'topic', 'windowMs', 'gap', 'range']],
      ['transform', ['position', 'size']],
    ]);
  });

  it('reads each value as the text its field shows', () => {
    const [content, transform] = entitySections(READOUT);
    const position = transform?.properties[0];

    expect(position?.kind === 'vector' ? position.fields.map((f) => f.get(READOUT)) : []).toEqual([
      '34',
      '96',
    ]);
    const topic = content?.properties[1];
    expect(topic?.kind === 'scalar' ? topic.get(READOUT) : '').toBe('sensors/cpu/0/temperature/0');
  });

  it('bounds a chart window with a fill bar in ms', () => {
    const chart: LayoutElement = {
      kind: 'chart',
      widget: 'line',
      topic: 't',
      windowMs: 60000,
      rect: READOUT.rect,
    };
    const windowMs = entitySections(chart)[0]?.properties.find((p) => p.id === 'windowMs');

    expect(windowMs?.kind === 'scalar' ? windowMs.spec : undefined).toMatchObject({
      kind: 'number',
      unit: 'ms',
      min: CHART_MIN_WINDOW_MS,
      max: CHART_MAX_WINDOW_MS,
      bar: true,
    });
  });
});

describe('targetProperties', () => {
  it('is the canvas size as one vector row, then the frame rate', () => {
    expect(targetProperties().map((p) => p.id)).toEqual(['canvas', 'frameRate']);
  });
});
