/**
 * Schema version 5: text templates, the layout's locale and time zone, and the 4 -> 5 migration.
 */

import { describe, expect, it } from 'vitest';
import {
  CLOCK_TOKENS,
  escapeTemplateText,
  isPlainTemplate,
  loadLayout,
  parseTextTemplate,
  readoutElementAsText,
  readoutTemplate,
  TEMPLATE_FILTERS,
  TEMPLATE_STYLES,
  templateHasClock,
  templatePlaceholders,
  validateLayout,
  type TemplatePart,
  type ValidateLayoutOptions,
} from '@perch/layout-schema';
import {
  codesOf,
  issueAt,
  layoutOf,
  layoutWith,
  layoutWithElements,
  TEST_WIDGETS,
  validLayoutDocument,
} from './layout-fixture.test-support.js';

const options: ValidateLayoutOptions = { widgets: TEST_WIDGETS };

function parts(text: string): readonly TemplatePart[] {
  const result = parseTextTemplate(text);
  if (!result.ok) throw new Error(`expected a template: ${result.error.message}`);
  return result.parts;
}

function error(text: string): { offset: number; message: string } {
  const result = parseTextTemplate(text);
  if (result.ok) throw new Error(`expected ${JSON.stringify(text)} to be refused`);
  return result.error;
}

const FAN = 'sensors/cooler/0/fan/0';

describe('parseTextTemplate', () => {
  it('reads a plain caption as one literal', () => {
    expect(parts('CPU temperature')).toEqual([{ kind: 'literal', text: 'CPU temperature' }]);
    expect(isPlainTemplate(parts('CPU temperature'))).toBe(true);
  });

  it('reads doubled braces as literal braces', () => {
    expect(parts('{{x}} and }}')).toEqual([{ kind: 'literal', text: '{x} and }' }]);
  });

  it('reads a sensor, with the default fallback', () => {
    expect(parts(`fan {${FAN}} rpm`)).toEqual([
      { kind: 'literal', text: 'fan ' },
      { kind: 'sensor', topic: FAN, filters: [], fallback: '--' },
      { kind: 'literal', text: ' rpm' },
    ]);
  });

  it('reads filters after | and a fallback after ||, trimmed', () => {
    expect(parts(`{ ${FAN} | fixed:0 || Dunno! }`)).toEqual([
      { kind: 'sensor', topic: FAN, filters: [{ name: 'fixed', places: 0 }], fallback: 'Dunno!' },
    ]);
    expect(parts(`{${FAN} | label}`)[0]).toMatchObject({ filters: [{ name: 'label' }] });
    expect(parts(`{${FAN} | unit}`)[0]).toMatchObject({ filters: [{ name: 'unit' }] });
    expect(parts(`{${FAN} | value | fixed:2}`)[0]).toMatchObject({
      filters: [{ name: 'value' }, { name: 'fixed', places: 2 }],
    });
  });

  it('takes an empty fallback, and }} inside one as a brace', () => {
    expect(parts(`{${FAN} ||}`)[0]).toMatchObject({ fallback: '' });
    expect(parts(`{${FAN} || {{ :) }}}`)[0]).toMatchObject({ fallback: '{{ :) }' });
  });

  it('reads the example from the request: a month and a fan', () => {
    expect(parts(`{month:short} {${FAN}}`)).toEqual([
      { kind: 'clock', token: 'month', variant: 'short' },
      { kind: 'literal', text: ' ' },
      { kind: 'sensor', topic: FAN, filters: [], fallback: '--' },
    ]);
  });

  it('reads every clock token, bare and with each variant', () => {
    for (const [token, variants] of Object.entries(CLOCK_TOKENS)) {
      expect(parts(`{${token}}`)).toEqual([{ kind: 'clock', token, variant: variants[0] }]);
      for (const variant of variants) {
        expect(parts(`{${token}:${variant}}`)).toEqual([{ kind: 'clock', token, variant }]);
      }
    }
    expect(templateHasClock(parts('{time}'))).toBe(true);
    expect(templateHasClock(parts(`{${FAN}}`))).toBe(false);
  });

  it.each([
    ['an unclosed brace', `fan {${FAN}`, 4, 'never closed'],
    ['a lone closing brace', 'a } b', 2, 'write "}}"'],
    ['an empty placeholder', 'x {} y', 2, 'empty placeholder'],
    ['a nested brace', '{time {date}}', 6, 'inside a placeholder'],
    ['an unknown token', '{mmm}', 0, 'unknown token "mmm"'],
    ['an unknown variant', '{time:long}', 0, 'time:short, time:seconds'],
    ['an unknown filter, never shown as text', `{${FAN} | fixd:0}`, 0, 'unknown filter "fixd:0"'],
    ['a single | before a fallback', `{${FAN} | Dunno!}`, 0, 'a fallback follows "||"'],
    ['too many decimals', `{${FAN} | fixed:9}`, 0, '0 to 6'],
    ['two things to show', `{${FAN} | unit | label}`, 0, 'use one'],
    ['a fallback on the clock', '{time || never}', 0, 'always has a value'],
    ['a filter on the clock', '{time | fixed:0}', 0, 'takes no filters'],
  ])('refuses %s, saying where and why', (_what, text, offset, says) => {
    const refused = error(text);
    expect(refused.offset).toBe(offset);
    expect(refused.message).toContain(says);
  });
});

describe('escapeTemplateText', () => {
  it('turns any string into a template that says exactly it', () => {
    const text = 'a {b} }c{ {{';
    expect(parts(escapeTemplateText(text))).toEqual([{ kind: 'literal', text }]);
  });
});

const label = (text: string): Record<string, unknown> => ({
  kind: 'text',
  text,
  rect: { x: 0, y: 0, w: 200, h: 40 },
});

describe('a text element is a template', () => {
  it('accepts a template and keeps it as written', () => {
    const text = `{weekday}, {date:long} · fan {${FAN} | fixed:0 || Dunno!}`;
    const layout = layoutOf(validateLayout(layoutWithElements([label(text)]), options));

    expect(layout.elements[0]).toMatchObject({ kind: 'text', text });
  });

  it('refuses a malformed one at its text, naming the character', () => {
    const result = validateLayout(layoutWithElements([label('it is {mmm}')]), options);

    expect(codesOf(result)).toEqual(['malformed-template']);
    expect(issueAt(result, 'elements[0].text').message).toMatch(/^at character 7: unknown token/);
  });

  it('holds each sensor to the injected topic check', () => {
    const result = validateLayout(layoutWithElements([label(`{sensors/nope}`)]), {
      ...options,
      isTopic: (topic) => topic !== 'sensors/nope',
    });

    expect(codesOf(result)).toEqual(['malformed-topic']);
    expect(issueAt(result, 'elements[0].text').elementIndex).toBe(0);
  });
});

describe('the layout locale and time zone', () => {
  it('are optional, and kept as written when valid', () => {
    expect('locale' in layoutOf(validateLayout(validLayoutDocument(), options))).toBe(false);
    const layout = layoutOf(
      validateLayout(layoutWith({ locale: 'de-DE', timeZone: 'Europe/Berlin' }), options),
    );
    expect(layout.locale).toBe('de-DE');
    expect(layout.timeZone).toBe('Europe/Berlin');
  });

  it.each([
    [{ locale: 'en-gb' }, 'locale', 'malformed-locale', '"en-GB"'],
    [{ locale: 'not a locale!' }, 'locale', 'malformed-locale', 'not a locale'],
    [{ locale: 42 }, 'locale', 'wrong-type', 'en-GB'],
    [{ timeZone: 'Mars/Olympus' }, 'timeZone', 'malformed-locale', 'not a time zone'],
    [{ timeZone: '' }, 'timeZone', 'wrong-type', 'Europe/London'],
  ])('refuses %o', (fields, path, code, says) => {
    const result = validateLayout(layoutWith(fields), options);

    expect(codesOf(result)).toEqual([code]);
    expect(issueAt(result, path).message).toContain(says);
  });
});

describe('the version 4 to version 5 boundary', () => {
  it('doubles the braces in every caption, so it paints as it did', () => {
    const v4 = {
      ...validLayoutDocument(),
      schemaVersion: 4,
      elements: [label('{not a token} and }'), label('plain')],
    };
    const result = loadLayout(v4, options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrations.map((step) => `${step.from}->${step.to}`)).toEqual(['4->5']);
    expect(
      result.layout.elements.map((element) => (element.kind === 'text' ? element.text : '')),
    ).toEqual(['{{not a token}} and }}', 'plain']);
    expect(parts((result.layout.elements[0] as { text: string }).text)).toEqual([
      { kind: 'literal', text: '{not a token} and }' },
    ]);
  });
});

describe('annotations: the readout filters', () => {
  it('reads fit, hold and note as filters, in any order', () => {
    expect(parts(`{${FAN} | fit | hold}`)[0]).toMatchObject({
      filters: [{ name: 'fit' }, { name: 'hold' }],
    });
    expect(parts(`{${FAN} | hold | fixed:1 | fit | value}`)[0]).toMatchObject({
      filters: [{ name: 'hold' }, { name: 'fixed', places: 1 }, { name: 'fit' }, { name: 'value' }],
    });
    expect(parts(`{${FAN} | note}`)[0]).toMatchObject({ filters: [{ name: 'note' }] });
    expect(TEMPLATE_FILTERS).toEqual(['fixed', 'value', 'unit', 'label', 'note', 'fit', 'hold']);
  });

  it.each([
    ['fit on a unit', `{${FAN} | unit | fit}`, 0, '"fit" sizes a reading'],
    ['hold on a label', `{${FAN} | label | hold}`, 0, '"hold" keeps a reading'],
    ['fit on a note', `{${FAN} | note | fit}`, 0, '"fit" sizes a reading'],
    ['two notes and a label', `{${FAN} | note | label}`, 0, 'use one'],
    ['fit twice', `{${FAN} | fit | fit}`, 0, 'more than one "fit"'],
    ['hold twice', `x {${FAN} | hold | hold}`, 2, 'more than one "hold"'],
    ['a fallback on a note', `{${FAN} | note || never}`, 0, '"note" always says something'],
    ['fixed on a note', `{${FAN} | note | fixed:1}`, 0, '"fixed" is for a value'],
    ['a typo of fit', `{${FAN} | fitt}`, 0, 'unknown filter "fitt"'],
  ])('refuses %s, saying where and why', (_what, text, offset, says) => {
    const refused = error(text);
    expect(refused.offset).toBe(offset);
    expect(refused.message).toContain(says);
  });
});

describe('annotations: style spans', () => {
  it('styles the parts inside a span, outermost first, and nothing outside it', () => {
    expect(parts(`a {#label}CPU {${FAN} | label}{/label} b`)).toEqual([
      { kind: 'literal', text: 'a ' },
      { kind: 'literal', text: 'CPU ', styles: ['label'] },
      {
        kind: 'sensor',
        topic: FAN,
        filters: [{ name: 'label' }],
        fallback: '--',
        styles: ['label'],
      },
      { kind: 'literal', text: ' b' },
    ]);
    expect(parts('{#value}12{#unit} V{/unit}{/value}{time}')).toEqual([
      { kind: 'literal', text: '12', styles: ['value'] },
      { kind: 'literal', text: ' V', styles: ['value', 'unit'] },
      { kind: 'clock', token: 'time', variant: 'short' },
    ]);
    expect(TEMPLATE_STYLES).toEqual(['label', 'unit', 'value', 'note']);
  });

  it('takes spaces inside the tag, a span across lines, and an empty span', () => {
    expect(parts('{ #note }a\nb{ /note }')).toEqual([
      { kind: 'literal', text: 'a\nb', styles: ['note'] },
    ]);
    expect(parts('x{#unit}{/unit}')).toEqual([{ kind: 'literal', text: 'x' }]);
  });

  it('keeps {{#label}} a literal, as any doubled brace is', () => {
    expect(parts('{{#label}}')).toEqual([{ kind: 'literal', text: '{#label}' }]);
  });

  it('is not plain when it is styled, though it has no placeholder', () => {
    expect(isPlainTemplate(parts('{#label}CPU{/label}'))).toBe(false);
    expect(isPlainTemplate(parts('CPU'))).toBe(true);
  });

  it.each([
    [
      'an unknown style',
      'a {#big}x{/big}',
      2,
      'unknown style "big"; styles are label, unit, value, note',
    ],
    ['an unclosed span', 'a {#label}x', 2, '"{#label}" is never closed'],
    ['a close with nothing open', 'x {/unit}', 2, 'nothing is open'],
    ['a close out of order', '{#label}{#unit}x{/label}{/unit}', 16, 'close "unit" first'],
    ['an empty style name', '{#}', 0, 'a style name after "#"'],
    ['a fallback on a tag', '{#label || x}y{/label}', 0, 'takes no "||"'],
    ['a filter on a tag', '{#label | fit}y{/label}', 0, 'unknown style "label | fit"'],
  ])('refuses %s, saying where and why', (_what, text, offset, says) => {
    const refused = error(text);
    expect(refused.offset).toBe(offset);
    expect(refused.message).toContain(says);
  });

  it('holds a sensor inside a span to the topic check', () => {
    const result = validateLayout(layoutWithElements([label(`{#label}{sensors/nope}{/label}`)]), {
      ...options,
      isTopic: (topic) => topic !== 'sensors/nope',
    });

    expect(codesOf(result)).toEqual(['malformed-topic']);
  });

  it('refuses an unclosed span in a layout, naming the character', () => {
    const result = validateLayout(layoutWithElements([label('ok {#note}x')]), options);

    expect(codesOf(result)).toEqual(['malformed-template']);
    expect(issueAt(result, 'elements[0].text').message).toMatch(/^at character 4: /);
  });
});

describe('templatePlaceholders', () => {
  it('finds each placeholder, where its head ends, and skips doubled braces', () => {
    const text = `{{x}} {${FAN} | fixed:0 || Dunno} {time}`;
    const found = templatePlaceholders(text);

    expect(found.map((one) => text.slice(one.start, one.end))).toEqual([
      `{${FAN} | fixed:0 || Dunno}`,
      '{time}',
    ]);
    expect(found.map((one) => one.head)).toEqual([`${FAN} | fixed:0 `, 'time']);
    const [first] = found;
    expect(text.slice(first?.start, first?.headEnd)).toBe(`{${FAN} | fixed:0 `);
  });

  it('stops at the first malformed placeholder, keeping those before it', () => {
    expect(templatePlaceholders('{time} } {date}').map((one) => one.head)).toEqual(['time']);
  });
});

describe('readoutTemplate', () => {
  it('writes a readout as three rows: its label, its fitted value held while stale, its note', () => {
    expect(readoutTemplate('sensors/cpu/0/temperature/0')).toBe(
      '{#label}{sensors/cpu/0/temperature/0 | label}{/label}\n' +
        '{sensors/cpu/0/temperature/0 | fit | hold}\n' +
        '{sensors/cpu/0/temperature/0 | note}',
    );
    for (const topic of ['sensors/gpu/0/fan/0', FAN]) {
      expect(parseTextTemplate(readoutTemplate(topic)).ok).toBe(true);
    }
  });

  it('turns a readout element into a text element in the same place, unused by any layout yet', () => {
    const readout = {
      kind: 'widget' as const,
      widget: 'readout',
      topic: FAN,
      rect: { x: 1, y: 2, w: 3, h: 4 },
      style: { '--perch-fg': '#fff', '--perch-readout-justify': 'center' },
      opacity: 0.5,
    };

    expect(readoutElementAsText(readout)).toEqual({
      kind: 'text',
      text: readoutTemplate(FAN),
      rect: { x: 1, y: 2, w: 3, h: 4 },
      style: {
        '--perch-text-anchor': 'flex-start',
        '--perch-text-justify': 'center',
        '--perch-text-align': 'center',
        '--perch-fg': '#fff',
      },
      opacity: 0.5,
    });
  });
});
