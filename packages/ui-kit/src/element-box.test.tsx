/**
 * The element box: the one box every styled entity has, and the four things an author can now do to
 * it — a background with alpha, rounded corners, padding, and (for a readout) where its content sits.
 *
 * Three claims, and why each is here rather than only in a capture:
 *
 * 1. **The rect is the footprint.** The box is `border-box`, so padding comes out of the content and
 *    never grows the painted box past the rect the author dragged and `validateLayout` checked. That was
 *    the human's call; this file holds it in place.
 * 2. **JavaScript and CSS agree about padding.** A chart is sized by arithmetic from its box, never by
 *    measurement (see `line-chart.tsx`), so the canvas has to know the padding the sheet will apply.
 *    `elementContentSize` is that one resolution, and the canvas writes the value it resolved onto the
 *    box so the sheet reads exactly the number the chart was sized to.
 * 3. **A layout that sets none of this is untouched.** No inline declaration is added to an element
 *    that sets no box token, which is what keeps the shipped layouts' markup and pixels as they were.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LAYOUT_SCHEMA_VERSION, loadLayoutJson, type Layout } from '@perch/layout-schema';
import type { SensorSource } from '@perch/sensor-contract';
import { SensorProvider } from './sensor-context.js';
import {
  ELEMENT_BOX_STYLES,
  LAYOUT_CANVAS_STYLES,
  LayoutCanvas,
  elementContentSize,
} from './layout-canvas.js';
import { CHART_FOOTER_PX, CHART_HEADER_PX } from './line-chart.js';
import { READOUT_STYLES } from './readout.js';
import { PERCH_TOKEN_DEFAULTS, token } from './tokens.js';
import { WIDGET_REGISTRY } from './widget-catalogue.js';

/** A source that never publishes: every widget paints its deterministic waiting state. */
const silent: SensorSource = {
  status: 'live',
  subscribe: () => () => undefined,
  meta: () => undefined,
};

function load(document: unknown): Layout {
  const loaded = loadLayoutJson(JSON.stringify(document), { widgets: WIDGET_REGISTRY });
  if (!loaded.ok) throw new Error(loaded.issues.map((issue) => issue.message).join('; '));

  return loaded.layout;
}

function doc(
  elements: readonly Record<string, unknown>[],
  theme: Record<string, string> = {},
): Record<string, unknown> {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    target: { width: 800, height: 400, frameRate: 30 },
    theme,
    elements,
  };
}

const CHART = {
  kind: 'chart',
  widget: 'line-chart',
  topic: 'sensors/cpu/0/temperature/0',
  rect: { x: 16, y: 16, w: 400, h: 200 },
  windowMs: 60_000,
  range: [0, 100],
};

const READOUT = {
  kind: 'widget',
  widget: 'readout',
  topic: 'sensors/cpu/0/temperature/0',
  rect: { x: 10, y: 10, w: 214, h: 176 },
};

function mount(document: unknown): HTMLElement[] {
  render(
    <SensorProvider source={silent}>
      <LayoutCanvas layout={load(document)} scale={1} resolveAsset={() => '/a.svg'} />
    </SensorProvider>,
  );

  return [...screen.getByTestId('perch-canvas').querySelectorAll<HTMLElement>('.perch-element')];
}

/** The body of the first rule in `sheet` whose selector is exactly `selector`. */
function rule(sheet: string, selector: string): string {
  const start = sheet.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no rule for ${selector}`);

  return sheet.slice(start, sheet.indexOf('}', start));
}

describe('the element box sheet', () => {
  it('is border-box, so padding comes out of the content and the rect stays the footprint', () => {
    expect(rule(ELEMENT_BOX_STYLES, '.perch-element')).toContain('box-sizing: border-box');
  });

  it('paints the background, corners and padding from the box tokens, in layout pixels', () => {
    const styled = rule(
      ELEMENT_BOX_STYLES,
      ".perch-element:not([data-perch-element-kind='media'])",
    );

    expect(styled).toContain(`background: ${token('--perch-box-bg')}`);
    // Unitless numbers, multiplied into px: one CSS px is one layout px on the scaled canvas, so a radius
    // scales with the panel exactly as the rects do.
    expect(styled).toContain(`border-radius: calc(${token('--perch-box-radius')} * 1px)`);
    expect(styled).toContain(`padding: calc(${token('--perch-box-padding')} * 1px)`);
  });

  it('defaults to a box that paints nothing: transparent, square, unpadded', () => {
    expect(PERCH_TOKEN_DEFAULTS['--perch-box-bg']).toBe('#00000000');
    expect(PERCH_TOKEN_DEFAULTS['--perch-box-radius']).toBe('0');
    expect(PERCH_TOKEN_DEFAULTS['--perch-box-padding']).toBe('0');
  });

  it('is part of the canvas sheet every app already mounts, so the runtime needs no new code', () => {
    expect(LAYOUT_CANVAS_STYLES).toContain(ELEMENT_BOX_STYLES);
  });
});

describe('elementContentSize', () => {
  const rect = { x: 0, y: 0, w: 400, h: 200 };

  it('is the rect when nothing sets a padding', () => {
    expect(elementContentSize(rect, undefined, undefined)).toEqual({ w: 400, h: 200, padding: 0 });
  });

  it("takes the element's own padding off both sides", () => {
    expect(elementContentSize(rect, { '--perch-box-padding': '16' }, {})).toEqual({
      w: 368,
      h: 168,
      padding: 16,
    });
  });

  it('inherits the layout theme padding, exactly as the custom property does', () => {
    expect(elementContentSize(rect, {}, { '--perch-box-padding': '10' })).toEqual({
      w: 380,
      h: 180,
      padding: 10,
    });
    expect(
      elementContentSize(rect, { '--perch-box-padding': '4' }, { '--perch-box-padding': '10' }),
    ).toMatchObject({ padding: 4 });
  });

  it('treats a value CSS would reject as no padding, as CSS does', () => {
    // `calc(12px * 1px)` and `calc(abc * 1px)` are invalid at computed-value time, so the box gets no
    // padding; the chart must be sized for that same box.
    for (const value of ['12px', 'abc', '0x10', 'Infinity']) {
      expect(elementContentSize(rect, { '--perch-box-padding': value }, {}).padding, value).toBe(0);
    }
    expect(elementContentSize(rect, { '--perch-box-padding': '-8' }, {}).padding).toBe(0);
  });

  it('never lets padding exceed half the smaller side, which would grow a border-box past its rect', () => {
    expect(elementContentSize(rect, { '--perch-box-padding': '500' }, {})).toEqual({
      w: 200,
      h: 0,
      padding: 100,
    });
  });
});

describe('<LayoutCanvas> and the box tokens', () => {
  it('adds nothing to an element that sets no box token, so an existing layout is untouched', () => {
    const [box] = mount(doc([READOUT]));

    expect(box?.getAttribute('style')).toBe('left: 10px; top: 10px; width: 214px; height: 176px;');
  });

  it('writes the resolved, clamped padding onto the box, so the sheet reads what the chart was sized to', () => {
    const [box] = mount(doc([{ ...CHART, style: { '--perch-box-padding': '500' } }]));

    expect(box?.style.getPropertyValue('--perch-box-padding')).toBe('100');
  });

  it('writes a theme padding onto each box it reaches, and leaves media alone', () => {
    const boxes = mount(
      doc([{ kind: 'media', src: 'a.svg', rect: { x: 0, y: 0, w: 800, h: 400 } }, CHART], {
        '--perch-box-padding': '10',
      }),
    );

    expect(boxes[0]?.style.getPropertyValue('--perch-box-padding')).toBe('');
    expect(boxes[1]?.style.getPropertyValue('--perch-box-padding')).toBe('10');
  });

  it('keeps the background and radius the author wrote, alpha included', () => {
    const [box] = mount(
      doc([{ ...READOUT, style: { '--perch-box-bg': '#1a2b3c80', '--perch-box-radius': '12' } }]),
    );

    expect(box?.style.getPropertyValue('--perch-box-bg')).toBe('#1a2b3c80');
    expect(box?.style.getPropertyValue('--perch-box-radius')).toBe('12');
  });

  it('sizes a padded chart to its content box, so it plots inside the frame budget', () => {
    mount(doc([{ ...CHART, style: { '--perch-box-padding': '16' } }]));

    const plot = screen.getByRole('group').querySelector('.perch-chart__plot');
    expect(plot?.getAttribute('width')).toBe('368');
    expect(plot?.getAttribute('height')).toBe(String(168 - CHART_HEADER_PX - CHART_FOOTER_PX));
  });

  it('sizes an unpadded chart to its rect, as before', () => {
    mount(doc([CHART]));

    expect(
      screen.getByRole('group').querySelector('.perch-chart__plot')?.getAttribute('width'),
    ).toBe('400');
  });
});

describe('where a readout puts its content', () => {
  it('reads its horizontal placement once, for the row and for every text run in it', () => {
    const readout = rule(READOUT_STYLES, '.perch-readout');

    expect(readout).toContain(`text-align: ${token('--perch-readout-justify')}`);
    expect(rule(READOUT_STYLES, '.perch-readout__primary')).toContain(
      `justify-content: ${token('--perch-readout-justify')}`,
    );
  });

  it('fills its content box and places its column vertically in it', () => {
    const readout = rule(READOUT_STYLES, '.perch-readout');

    expect(readout).toContain('height: 100%');
    expect(readout).toContain(`justify-content: ${token('--perch-readout-anchor')}`);
  });

  it('defaults to top-left, which is where every readout sat before the tokens existed', () => {
    expect(PERCH_TOKEN_DEFAULTS['--perch-readout-justify']).toBe('start');
    expect(PERCH_TOKEN_DEFAULTS['--perch-readout-anchor']).toBe('start');
  });
});
