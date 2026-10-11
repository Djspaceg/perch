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
  templateHasClock,
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
