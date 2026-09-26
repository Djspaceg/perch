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
  CANVAS_RESOLVED_TOKENS,
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

  it('paints the background from its token, and leaves corners and padding to the canvas', () => {
    const styled = rule(
      ELEMENT_BOX_STYLES,
      ".perch-element:not([data-perch-element-kind='media'])",
    );

    expect(styled).toContain(`background: ${token('--perch-box-bg')}`);
    // A one-to-four-value shorthand cannot be multiplied into px by `calc()`, so the canvas resolves
    // radius and padding and writes them as native declarations on the box instead.
    expect(styled).not.toContain('border-radius');
    expect(styled).not.toContain('padding');
    expect(CANVAS_RESOLVED_TOKENS).toEqual(['--perch-box-radius', '--perch-box-padding']);
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
  const even = (n: number): Record<string, number> => ({ top: n, right: n, bottom: n, left: n });

  it('is the rect when nothing sets a padding', () => {
    expect(elementContentSize(rect, undefined, undefined)).toEqual({
      w: 400,
      h: 200,
      padding: even(0),
    });
  });

  it("takes the element's own padding off both sides", () => {
    expect(elementContentSize(rect, { '--perch-box-padding': '16' }, {})).toEqual({
      w: 368,
      h: 168,
      padding: even(16),
    });
  });

  it('takes each side off its own edge, from a CSS shorthand', () => {
    expect(elementContentSize(rect, { '--perch-box-padding': '8 16' }, {})).toEqual({
      w: 368,
      h: 184,
      padding: { top: 8, right: 16, bottom: 8, left: 16 },
    });
    expect(elementContentSize(rect, { '--perch-box-padding': '1 2 3 4' }, {})).toEqual({
      w: 394,
      h: 196,
      padding: { top: 1, right: 2, bottom: 3, left: 4 },
    });
  });

  it('inherits the layout theme padding, exactly as the custom property does', () => {
    expect(elementContentSize(rect, {}, { '--perch-box-padding': '10' })).toEqual({
      w: 380,
      h: 180,
      padding: even(10),
    });
    // The element's shorthand replaces the theme's whole, as one custom property replaces another.
    expect(
      elementContentSize(rect, { '--perch-box-padding': '4' }, { '--perch-box-padding': '10 20' }),
    ).toMatchObject({ padding: even(4) });
    expect(elementContentSize(rect, {}, { '--perch-box-padding': '0 20' })).toMatchObject({
      w: 360,
      h: 200,
    });
  });

  it('treats a value CSS would reject as no padding, as CSS does', () => {
    // `calc(12px * 1px)` and `calc(abc * 1px)` are invalid at computed-value time, so the box gets no
    // padding; the chart must be sized for that same box.
    for (const value of ['12px', 'abc', '0x10', 'Infinity', '-8', '8 -8', '1 2 3 4 5']) {
      expect(elementContentSize(rect, { '--perch-box-padding': value }, {}).padding, value).toEqual(
        even(0),
      );
    }
  });

  it('never lets padding exceed half the smaller side, which would grow a border-box past its rect', () => {
    expect(elementContentSize(rect, { '--perch-box-padding': '500' }, {})).toEqual({
      w: 200,
      h: 0,
      padding: even(100),
    });
  });

  it('shrinks uneven padding by one factor, so it keeps its shape and fits both axes', () => {
    // Left and right ask for 600 of a 400 wide box: everything is scaled by 400/600.
    expect(elementContentSize(rect, { '--perch-box-padding': '30 300 0' }, {})).toEqual({
      w: 0,
      h: 180,
      padding: { top: 20, right: 200, bottom: 0, left: 200 },
    });
  });
});

describe('<LayoutCanvas> and the box tokens', () => {
  it('adds nothing to an element that sets no box token, so an existing layout is untouched', () => {
    const [box] = mount(doc([READOUT]));

    expect(box?.getAttribute('style')).toBe('left: 10px; top: 10px; width: 214px; height: 176px;');
  });

  it('writes the resolved, clamped padding onto the box as native padding, the value the chart was sized to', () => {
    const [box] = mount(doc([{ ...CHART, style: { '--perch-box-padding': '500' } }]));

    expect(box?.style.padding).toBe('100px');
  });

  it('writes a per-side padding as the shortest native shorthand', () => {
    const [box] = mount(doc([{ ...CHART, style: { '--perch-box-padding': '8 16 8 16' } }]));

    expect(box?.style.padding).toBe('8px 16px');
    expect(box?.style.paddingLeft).toBe('16px');
    expect(box?.style.paddingTop).toBe('8px');
  });

  it('writes a theme padding onto each box it reaches, and leaves media alone', () => {
    const boxes = mount(
      doc([{ kind: 'media', src: 'a.svg', rect: { x: 0, y: 0, w: 800, h: 400 } }, CHART], {
        '--perch-box-padding': '10',
      }),
    );

    expect(boxes[0]?.style.padding).toBe('');
    expect(boxes[1]?.style.padding).toBe('10px');
  });

  it('keeps the background and radius the author wrote, alpha included', () => {
    const [box] = mount(
      doc([{ ...READOUT, style: { '--perch-box-bg': '#1a2b3c80', '--perch-box-radius': '12' } }]),
    );

    expect(box?.style.getPropertyValue('--perch-box-bg')).toBe('#1a2b3c80');
    expect(box?.style.getPropertyValue('--perch-box-radius')).toBe('12');
    expect(box?.style.borderRadius).toBe('12px');
  });

  it('writes a per-corner radius in CSS corner order: top-left, top-right, bottom-right, bottom-left', () => {
    const [box] = mount(doc([{ ...READOUT, style: { '--perch-box-radius': '12 0 4 8' } }]));

    // The shorthand only: jsdom does not expand `border-radius` into its four longhands.
    expect(box?.style.borderRadius).toBe('12px 0px 4px 8px');
  });

  it('carries a theme radius to every styled box, and an element radius replaces it whole', () => {
    const boxes = mount(
      doc(
        [
          { kind: 'media', src: 'a.svg', rect: { x: 0, y: 0, w: 800, h: 400 } },
          READOUT,
          { ...READOUT, style: { '--perch-box-radius': '4' } },
        ],
        { '--perch-box-radius': '6 12' },
      ),
    );

    expect(boxes[0]?.style.borderRadius).toBe('');
    expect(boxes[1]?.style.borderRadius).toBe('6px 12px');
    expect(boxes[2]?.style.borderRadius).toBe('4px');
  });

  it('sizes a chart with per-side padding to the real left, right, top and bottom', () => {
    mount(doc([{ ...CHART, style: { '--perch-box-padding': '10 20 30 40' } }]));

    const plot = screen.getByRole('group').querySelector('.perch-chart__plot');
    expect(plot?.getAttribute('width')).toBe(String(400 - 20 - 40));
    expect(plot?.getAttribute('height')).toBe(
      String(200 - 10 - 30 - CHART_HEADER_PX - CHART_FOOTER_PX),
    );
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
