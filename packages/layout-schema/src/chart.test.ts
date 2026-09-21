/**
 * The chart element: its time axis, its gap policy, and the rules it shares rather than repeats.
 *
 * Two things are being pinned here. The first is the usual standard — every malformed chart fails
 * with a precise code, a field path and an element index. The second matters more to the format:
 * that a chart's `range` requirement is the *same rule* as a widget's, sourced from the registry's
 * `drawsScale`, and not a second rule that happens to agree with it today.
 */

import { describe, expect, it } from 'vitest';
import {
  CHART_GAPS,
  CHART_MAX_WINDOW_MS,
  CHART_MIN_WINDOW_MS,
  DEFAULT_CHART_GAP,
  isElementKind,
  validateLayout,
  type ValidateLayoutOptions,
} from '@perch/layout-schema';
import {
  codesOf,
  issueAt,
  layoutOf,
  layoutWithElements,
  TEST_WIDGETS,
  without,
} from './layout-fixture.test-support.js';

const options: ValidateLayoutOptions = { widgets: TEST_WIDGETS };

/** A valid chart element. `sparkline` is registered with `drawsScale: true`, hence the range. */
const chart = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'chart',
  widget: 'sparkline',
  topic: 'sensors/cpu/0/load/0',
  rect: { x: 0, y: 0, w: 480, h: 200 },
  windowMs: 300_000,
  range: [0, 100],
  ...overrides,
});

const oneElement = (element: unknown): ReturnType<typeof validateLayout> =>
  validateLayout(layoutWithElements([element]), options);

describe('chart is a kind of its own', () => {
  it('is an element kind', () => {
    // The whole list is asserted in `element.test.ts`, which owns the union.
    expect(isElementKind('chart')).toBe(true);
  });

  it('accepts a chart and returns it unchanged', () => {
    expect(layoutOf(oneElement(chart())).elements[0]).toEqual(chart());
  });

  it('survives a JSON round trip, per hard rule 1', () => {
    const layout = layoutOf(oneElement(chart({ gap: 'span' })));

    expect(JSON.parse(JSON.stringify(layout))).toEqual(layout);
  });

  it('is not a widget element with extra fields: windowMs on a widget is an unknown field', () => {
    // The reason `chart` is its own kind. If a chart were a widget with an optional `windowMs`,
    // this would validate and the field would mean nothing on a gauge.
    const issue = issueAt(
      oneElement({
        kind: 'widget',
        widget: 'gauge',
        topic: 'sensors/cpu/0/load/0',
        rect: { x: 0, y: 0, w: 100, h: 100 },
        range: [0, 100],
        windowMs: 60_000,
      }),
      'elements[0].windowMs',
    );

    expect(issue.code).toBe('unknown-field');
    expect(issue.elementIndex).toBe(0);
  });

  it('rejects a chart-only field on the other kinds', () => {
    expect(
      issueAt(
        oneElement({ kind: 'text', text: 'x', rect: { x: 0, y: 0, w: 10, h: 10 }, gap: 'span' }),
        'elements[0].gap',
      ).code,
    ).toBe('unknown-field');
  });
});

describe('windowMs: the time axis is authored, and required', () => {
  it('rejects a chart with no window, naming the field and the element', () => {
    const issue = issueAt(oneElement(without(chart(), 'windowMs')), 'elements[0].windowMs');

    expect(issue.code).toBe('missing-field');
    expect(issue.message).toContain('"windowMs"');
    expect(issue.elementIndex).toBe(0);
  });

  it.each([
    ['zero', 0],
    ['negative', -1000],
  ])('rejects a %s window, saying there is no span to plot', (_why, windowMs) => {
    const issue = issueAt(oneElement(chart({ windowMs })), 'elements[0].windowMs');

    expect(issue.code).toBe('out-of-range');
    expect(issue.message).toMatch(/above 0 ms/);
  });

  it('rejects a window below the floor, naming seconds as the likely mistake', () => {
    // `windowMs: 5` is overwhelmingly "five seconds" written into a field that wants milliseconds.
    const issue = issueAt(oneElement(chart({ windowMs: 5 })), 'elements[0].windowMs');

    expect(issue.code).toBe('out-of-range');
    expect(issue.message).toContain(String(CHART_MIN_WINDOW_MS));
    expect(issue.message).toMatch(/seconds/);
  });

  it('rejects an absurd window, naming the ceiling and why there is one', () => {
    const issue = issueAt(
      oneElement(chart({ windowMs: CHART_MAX_WINDOW_MS + 1 })),
      'elements[0].windowMs',
    );

    expect(issue.code).toBe('out-of-range');
    expect(issue.message).toContain(String(CHART_MAX_WINDOW_MS));
    expect(issue.message).toMatch(/buffers/);
  });

  it.each([
    ['a stringified window', '300000', 'wrong-type'],
    ['a null window', null, 'wrong-type'],
    ['an array window', [0, 300_000], 'wrong-type'],
    ['a non-finite window a GUI computed', Number.POSITIVE_INFINITY, 'out-of-range'],
    ['a NaN window', Number.NaN, 'out-of-range'],
  ])('rejects %s', (_why, windowMs, code) => {
    expect(issueAt(oneElement(chart({ windowMs })), 'elements[0].windowMs').code).toBe(code);
  });

  it('accepts both ends of the accepted band, and a fractional window inside it', () => {
    for (const windowMs of [CHART_MIN_WINDOW_MS, CHART_MAX_WINDOW_MS, 1500.5]) {
      expect(layoutOf(oneElement(chart({ windowMs }))).elements).toHaveLength(1);
    }
  });
});

describe('gap: whether a chart draws the gap or spans it', () => {
  it('offers exactly two policies and defaults to the honest one', () => {
    expect(CHART_GAPS).toEqual(['break', 'span']);
    expect(DEFAULT_CHART_GAP).toBe('break');
  });

  it('accepts either policy', () => {
    for (const gap of CHART_GAPS) {
      expect(layoutOf(oneElement(chart({ gap }))).elements).toHaveLength(1);
    }
  });

  it('leaves an absent gap absent rather than materialising the default into the file', () => {
    // The renderer applies `DEFAULT_CHART_GAP`. A validator that filled it in would make the
    // saved file differ from the one the author wrote, which is how a diff stops being reviewable.
    const [element] = layoutOf(oneElement(without(chart(), 'gap'))).elements;

    expect(element).toBeDefined();
    expect(element === undefined ? [] : Object.keys(element)).not.toContain('gap');
  });

  it('rejects a policy that is neither, printing both', () => {
    const issue = issueAt(oneElement(chart({ gap: 'interpolate' })), 'elements[0].gap');

    expect(issue.code).toBe('wrong-type');
    expect(issue.message).toContain('"break"');
    expect(issue.message).toContain('"span"');
  });

  it.each([
    ['a boolean', true],
    ['null', null],
  ])('rejects %s as a gap policy', (_why, gap) => {
    expect(issueAt(oneElement(chart({ gap })), 'elements[0].gap').code).toBe('wrong-type');
  });
});

describe('range on a chart is the registry rule, not a chart rule', () => {
  it('requires a range because the registry says this widget draws a scale', () => {
    const issue = issueAt(oneElement(without(chart(), 'range')), 'elements[0].range');

    expect(issue.code).toBe('missing-range');
    expect(issue.message).toMatch(/draws a scale/);
  });

  it('does not require one of a chart whose widget draws no scale', () => {
    // `readout` is registered with `drawsScale: false`. The registry knows nothing about element
    // kinds, so a chart naming it inherits exactly that answer — which is the point: the
    // requirement lives in one place and charts did not get a second copy of it.
    expect(
      layoutOf(oneElement(without(chart({ widget: 'readout' }), 'range'))).elements,
    ).toHaveLength(1);
  });

  it.each([
    ['a reversed range', [100, 0], 'elements[0].range', 'invalid-range'],
    ['a zero-width range', [50, 50], 'elements[0].range', 'invalid-range'],
    ['a one-element range', [0], 'elements[0].range', 'invalid-range'],
    ['a non-array range', 100, 'elements[0].range', 'wrong-type'],
    ['a stringified minimum', ['0', 100], 'elements[0].range[0]', 'wrong-type'],
  ])('rejects %s on a chart, exactly as on a widget', (_why, range, path, code) => {
    expect(issueAt(oneElement(chart({ range })), path).code).toBe(code);
  });

  it('does not tell an author who wrote a bad range that they wrote no range', () => {
    expect(codesOf(oneElement(chart({ range: [100, 0] })))).toEqual(['invalid-range']);
  });
});

describe('a chart binds one topic, checked by the injected validator', () => {
  it.each([
    ['an MQTT single-level wildcard', 'sensors/+/load/0'],
    ['an MQTT multi-level wildcard', 'sensors/cpu/#'],
    ['an empty segment', 'sensors//load/0'],
    ['a trailing slash', 'sensors/cpu/0/load/0/'],
    ['trailing whitespace', 'sensors/cpu/0/load/0 '],
  ])('rejects %s as a binding', (_why, topic) => {
    expect(issueAt(oneElement(chart({ topic })), 'elements[0].topic').code).toBe('malformed-topic');
  });

  it.each([
    ['a missing topic', without(chart(), 'topic'), 'missing-field'],
    ['an empty topic', chart({ topic: '' }), 'empty-string'],
    ['a non-string topic', chart({ topic: ['a', 'b'] }), 'wrong-type'],
  ])('rejects %s', (_why, element, code) => {
    expect(issueAt(oneElement(element), 'elements[0].topic').code).toBe(code);
  });

  it('rejects a series array where a topic belongs, rather than accepting multi-series by accident', () => {
    // v1's answer to multi-series is "two chart elements". `topics` is not a field, and a `topic`
    // that is a list is not a topic.
    const codes = codesOf(
      oneElement(chart({ topics: ['sensors/cpu/0/load/0', 'sensors/gpu/0/load/0'] })),
    );

    expect(codes).toContain('unknown-field');
  });

  it('stacks two charts on one rect, which is how two series sharing a scale are drawn', () => {
    const layout = layoutOf(
      validateLayout(
        layoutWithElements([
          chart({ topic: 'sensors/cpu/0/load/0' }),
          chart({ topic: 'sensors/gpu/0/load/0' }),
        ]),
        options,
      ),
    );

    expect(layout.elements).toHaveLength(2);
    expect(layout.elements.map((element) => element.kind)).toEqual(['chart', 'chart']);
  });
});

describe('a chart is held to the same standards as every other element', () => {
  it('rejects an unknown chart field, printing the fields this kind defines', () => {
    const issue = issueAt(oneElement(chart({ smoothing: 0.4 })), 'elements[0].smoothing');

    expect(issue.code).toBe('unknown-field');
    expect(issue.message).toContain('"windowMs"');
    expect(issue.message).toContain('"gap"');
    expect(issue.elementIndex).toBe(0);
  });

  it('rejects a widget name the registry does not know', () => {
    expect(issueAt(oneElement(chart({ widget: 'sparkine' })), 'elements[0].widget').code).toBe(
      'unknown-widget',
    );
  });

  it('rejects a malformed widget name as malformed rather than merely unregistered', () => {
    expect(issueAt(oneElement(chart({ widget: 'Sparkline' })), 'elements[0].widget').code).toBe(
      'malformed-widget-name',
    );
  });

  it('rejects a rect that cannot paint a pixel', () => {
    expect(
      issueAt(oneElement(chart({ rect: { x: 0, y: 0, w: 0, h: 200 } })), 'elements[0].rect.w').code,
    ).toBe('out-of-range');
  });

  it('carries the element index when the chart is not the first element', () => {
    const issues = validateLayout(
      layoutWithElements([
        { kind: 'text', text: 'CPU', rect: { x: 0, y: 0, w: 10, h: 10 } },
        chart({ windowMs: 0 }),
      ]),
      options,
    );

    expect(issueAt(issues, 'elements[1].windowMs').elementIndex).toBe(1);
  });

  it('reports every problem with a chart in one pass rather than the first', () => {
    const codes = codesOf(
      oneElement(chart({ windowMs: 0, range: [100, 0], gap: 'nope', boost: true })),
    );

    expect(codes).toContain('unknown-field');
    expect(codes).toContain('out-of-range');
    expect(codes).toContain('invalid-range');
    expect(codes).toContain('wrong-type');
  });
});
