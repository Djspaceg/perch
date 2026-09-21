/**
 * The element union: the kinds, the injected widget vocabulary, and the range rule.
 *
 * Every case is "one element in an otherwise valid layout", so a failure names `elements[0]` and
 * nothing else is in the way. The `chart` kind's own rules live in `chart.test.ts`; what is here is
 * the union it joined and the widget-binding rules it shares.
 */

import { describe, expect, it } from 'vitest';
import {
  ELEMENT_KINDS,
  EMPTY_WIDGET_REGISTRY,
  isElementKind,
  validateLayout,
  type ValidateLayoutOptions,
} from '@perch/layout-schema';
import {
  codesOf,
  issueAt,
  layoutWithElements,
  layoutOf,
  TEST_WIDGETS,
  without,
} from './layout-fixture.test-support.js';

const options: ValidateLayoutOptions = { widgets: TEST_WIDGETS };

const widget = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'widget',
  widget: 'readout',
  topic: 'sensors/cpu/0/temperature/0',
  rect: { x: 0, y: 0, w: 240, h: 120 },
  ...overrides,
});

const text = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'text',
  text: 'CPU',
  rect: { x: 0, y: 0, w: 200, h: 40 },
  ...overrides,
});

const media = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'media',
  src: 'panel.assets/backdrop.png',
  rect: { x: 0, y: 0, w: 1920, h: 400 },
  ...overrides,
});

/** Validate a layout whose only element is `element`. */
const oneElement = (element: unknown): ReturnType<typeof validateLayout> =>
  validateLayout(layoutWithElements([element]), options);

describe('kind is the discriminant, and an unknown one is not guessed at', () => {
  it('lists exactly the kinds there are', () => {
    expect(ELEMENT_KINDS).toEqual(['widget', 'text', 'media', 'chart']);
    expect(isElementKind('widget')).toBe(true);
    expect(isElementKind('group')).toBe(false);
  });

  it('rejects a missing kind', () => {
    expect(issueAt(oneElement(without(text(), 'kind')), 'elements[0].kind').code).toBe(
      'missing-field',
    );
  });

  it('rejects an unknown kind, printing the kinds there are', () => {
    const issue = issueAt(oneElement(text({ kind: 'group' })), 'elements[0].kind');

    expect(issue.code).toBe('unknown-element-kind');
    expect(issue.message).toContain('"widget"');
    expect(issue.message).toContain('"media"');
  });

  it.each([
    ['a number', 3],
    ['null', null],
    ['an object', {}],
  ])('rejects %s as a kind', (_why, kind) => {
    expect(issueAt(oneElement(text({ kind })), 'elements[0].kind').code).toBe(
      'unknown-element-kind',
    );
  });

  it.each([
    ['a string', 'text'],
    ['null', null],
    ['an array', []],
    ['a number', 1],
  ])('rejects %s where an element object belongs', (_why, element) => {
    expect(issueAt(oneElement(element), 'elements[0]').code).toBe('not-an-object');
  });

  it('does not infer a kind from which fields are present', () => {
    // A text element with an `src` typo must not become a media element with no source.
    expect(codesOf(oneElement({ src: 'x.png', rect: { x: 0, y: 0, w: 10, h: 10 } }))).toEqual([
      'missing-field',
    ]);
  });
});

describe('widget elements: the injected registry is what makes a typo fail', () => {
  it('accepts a widget the registry knows', () => {
    expect(layoutOf(oneElement(widget())).elements[0]).toEqual(widget());
  });

  it('rejects a widget the registry does not know, listing the ones it does', () => {
    const issue = issueAt(
      oneElement(widget({ widget: 'guage', range: [0, 100] })),
      'elements[0].widget',
    );

    expect(issue.code).toBe('unknown-widget');
    expect(issue.message).toContain('"guage"');
    expect(issue.message).toContain('gauge, readout, sparkline');
  });

  it('rejects every widget against an empty registry, and says the registry is empty', () => {
    const issue = issueAt(
      validateLayout(layoutWithElements([widget()]), { widgets: EMPTY_WIDGET_REGISTRY }),
      'elements[0].widget',
    );

    expect(issue.code).toBe('unknown-widget');
    expect(issue.message).toContain('(nothing)');
  });

  it.each([
    ['capitals', 'Gauge'],
    ['a space', 'cpu gauge'],
    ['a trailing hyphen', 'gauge-'],
    ['a doubled hyphen', 'cpu--gauge'],
    ['an underscore', 'cpu_gauge'],
    ['a dot', 'ui.gauge'],
  ])('rejects a widget name with %s as malformed rather than merely unregistered', (_why, name) => {
    expect(issueAt(oneElement(widget({ widget: name })), 'elements[0].widget').code).toBe(
      'malformed-widget-name',
    );
  });

  it.each([
    ['a missing widget', without(widget(), 'widget'), 'missing-field'],
    ['an empty widget', widget({ widget: '' }), 'empty-string'],
    ['a non-string widget', widget({ widget: 42 }), 'wrong-type'],
  ])('rejects %s', (_why, element, code) => {
    expect(issueAt(oneElement(element), 'elements[0].widget').code).toBe(code);
  });

  it('does not also demand a range for a widget it could not resolve', () => {
    // "This widget needs a range" is the registry's knowledge, and an unresolved name has none.
    expect(codesOf(oneElement(widget({ widget: 'guage' })))).toEqual(['unknown-widget']);
  });
});

describe('range is authored here, and required for anything that draws a scale', () => {
  it.each(['gauge', 'sparkline'])('rejects %s with no range, saying why', (name) => {
    const issue = issueAt(oneElement(widget({ widget: name })), 'elements[0].range');

    expect(issue.code).toBe('missing-range');
    expect(issue.message).toMatch(/draws a scale/);
    expect(issue.message).toMatch(/observed extremes|rescales/);
  });

  it('accepts a scale widget with a range', () => {
    expect(
      layoutOf(oneElement(widget({ widget: 'gauge', range: [0, 100] }))).elements,
    ).toHaveLength(1);
  });

  it('does not require a range of a widget that draws no scale', () => {
    expect(layoutOf(oneElement(widget({ widget: 'readout' }))).elements).toHaveLength(1);
  });

  it('allows a range on a widget that does not need one, because it is not harmful to declare', () => {
    expect(
      layoutOf(oneElement(widget({ widget: 'readout', range: [-20, 120] }))).elements,
    ).toHaveLength(1);
  });

  it.each([
    ['a non-array range', { range: 100 }, 'elements[0].range', 'wrong-type'],
    ['a one-element range', { range: [0] }, 'elements[0].range', 'invalid-range'],
    ['a three-element range', { range: [0, 50, 100] }, 'elements[0].range', 'invalid-range'],
    ['a stringified minimum', { range: ['0', 100] }, 'elements[0].range[0]', 'wrong-type'],
    ['a null maximum', { range: [0, null] }, 'elements[0].range[1]', 'wrong-type'],
    ['a non-finite maximum', { range: [0, Number.NaN] }, 'elements[0].range[1]', 'wrong-type'],
    ['a reversed range', { range: [100, 0] }, 'elements[0].range', 'invalid-range'],
    ['a zero-width range', { range: [50, 50] }, 'elements[0].range', 'invalid-range'],
  ])('rejects %s', (_why, overrides, path, code) => {
    expect(issueAt(oneElement(widget({ widget: 'gauge', ...overrides })), path).code).toBe(code);
  });

  it('does not tell an author who wrote a bad range that they wrote no range', () => {
    // Two issues for one field, one of them false, is worse than one: "requires an authored range"
    // is unfollowable advice when the range is on the screen in front of you.
    expect(codesOf(oneElement(widget({ widget: 'gauge', range: [100, 0] })))).toEqual([
      'invalid-range',
    ]);
    expect(codesOf(oneElement(widget({ widget: 'gauge', range: 'nope' })))).toEqual(['wrong-type']);
  });

  it('accepts a negative and a fractional scale, which are real authoring choices', () => {
    expect(
      layoutOf(oneElement(widget({ widget: 'gauge', range: [-40, 1.5] }))).elements,
    ).toHaveLength(1);
  });
});

describe('topics are checked by the injected validator, never by a vocabulary held here', () => {
  it.each([
    ['an MQTT single-level wildcard', 'sensors/+/temperature/0'],
    ['an MQTT multi-level wildcard', 'sensors/cpu/#'],
    ['an empty segment', 'sensors//temperature/0'],
    ['a leading slash', '/sensors/cpu/0/temperature/0'],
    ['a trailing slash', 'sensors/cpu/0/temperature/0/'],
    ['trailing whitespace', 'sensors/cpu/0/temperature/0 '],
    ['a tab', 'sensors/cpu\t/0'],
  ])('rejects %s as a binding', (_why, topic) => {
    expect(issueAt(oneElement(widget({ topic })), 'elements[0].topic').code).toBe(
      'malformed-topic',
    );
  });

  it.each([
    ['a missing topic', without(widget(), 'topic'), 'missing-field'],
    ['an empty topic', widget({ topic: '' }), 'empty-string'],
    ['a non-string topic', widget({ topic: ['a', 'b'] }), 'wrong-type'],
  ])('rejects %s', (_why, element, code) => {
    expect(issueAt(oneElement(element), 'elements[0].topic').code).toBe(code);
  });

  it('uses an injected validator in place of the structural default', () => {
    const shorthandOnly: ValidateLayoutOptions = {
      widgets: TEST_WIDGETS,
      isTopic: (topic) => topic === 'cpu.temp',
    };

    expect(
      layoutOf(validateLayout(layoutWithElements([widget({ topic: 'cpu.temp' })]), shorthandOnly))
        .elements,
    ).toHaveLength(1);
    expect(
      issueAt(validateLayout(layoutWithElements([widget()]), shorthandOnly), 'elements[0].topic')
        .code,
    ).toBe('malformed-topic');
  });
});

describe('text elements', () => {
  it('accepts a text element with and without style', () => {
    expect(layoutOf(oneElement(text())).elements[0]).toEqual(text());
    expect(layoutOf(oneElement(text({ style: { '--perch-fg': '#fff' } }))).elements).toHaveLength(
      1,
    );
  });

  it('rejects empty text, because a blank rect is indistinguishable from a broken binding', () => {
    expect(issueAt(oneElement(text({ text: '' })), 'elements[0].text').code).toBe('empty-string');
  });

  it.each([
    ['missing text', without(text(), 'text'), 'missing-field'],
    ['non-string text', text({ text: 42 }), 'wrong-type'],
  ])('rejects %s', (_why, element, code) => {
    expect(issueAt(oneElement(element), 'elements[0].text').code).toBe(code);
  });

  it('rejects a widget field on a text element', () => {
    expect(issueAt(oneElement(text({ widget: 'gauge' })), 'elements[0].widget').code).toBe(
      'unknown-field',
    );
  });
});

describe('media elements', () => {
  it('accepts a media element, with either fit', () => {
    expect(layoutOf(oneElement(media())).elements[0]).toEqual(media());
    expect(layoutOf(oneElement(media({ fit: 'cover' }))).elements).toHaveLength(1);
    expect(layoutOf(oneElement(media({ fit: 'contain' }))).elements).toHaveLength(1);
  });

  it('rejects a fit that is not one of the two, printing both', () => {
    const issue = issueAt(oneElement(media({ fit: 'fill' })), 'elements[0].fit');

    expect(issue.code).toBe('wrong-type');
    expect(issue.message).toContain('"cover"');
    expect(issue.message).toContain('"contain"');
  });

  it.each([
    ['a missing src', without(media(), 'src'), 'missing-field'],
    ['an empty src', media({ src: '' }), 'empty-string'],
    ['a non-string src', media({ src: 3 }), 'wrong-type'],
  ])('rejects %s', (_why, element, code) => {
    expect(issueAt(oneElement(element), 'elements[0].src').code).toBe(code);
  });

  it('rejects a range on a media element as an unknown field', () => {
    expect(issueAt(oneElement(media({ range: [0, 1] })), 'elements[0].range').code).toBe(
      'unknown-field',
    );
  });
});

describe('unknown fields inside an element', () => {
  it('rejects one, printing the fields that kind defines', () => {
    const issue = issueAt(oneElement(widget({ opacity: 0.5 })), 'elements[0].opacity');

    expect(issue.code).toBe('unknown-field');
    expect(issue.message).toContain('"topic"');
    expect(issue.elementIndex).toBe(0);
  });

  it('rejects the element entirely rather than accepting it with the field dropped', () => {
    expect(validateLayout(layoutWithElements([widget({ visible: false })]), options).ok).toBe(
      false,
    );
  });
});
