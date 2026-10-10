/**
 * Schema version 4: the layout's background, and `hidden` on every layer.
 *
 * The background is a field of the layout rather than an element, so it is painted first by
 * construction; these pin the field's own rules and that a version 3 file opens with none.
 */

import { describe, expect, it } from 'vitest';
import {
  ELEMENT_KINDS,
  LAYOUT_SCHEMA_VERSION,
  loadLayout,
  validateLayout,
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

describe('the layout background', () => {
  it('is optional, and absent means no background', () => {
    const layout = layoutOf(validateLayout(validLayoutDocument(), options));

    expect('background' in layout).toBe(false);
  });

  it.each([
    ['a cloud background', { src: 'thermalright:a042' }],
    [
      'a local image, with every field',
      { src: 'desk.assets/wall.png', fit: 'contain', opacity: 0.4, hidden: true },
    ],
    ['a shown background', { src: 'desk.assets/wall.png', hidden: false }],
  ])('accepts %s and rebuilds exactly its fields', (_what, background) => {
    const layout = layoutOf(validateLayout(layoutWith({ background }), options));

    expect(layout.background).toEqual(background);
  });

  it('is painted under the elements by construction: it is not one of them', () => {
    const document = layoutWith({ background: { src: 'thermalright:a042' } });
    const layout = layoutOf(validateLayout(document, options));

    expect(layout.elements).toEqual(
      layoutOf(validateLayout(validLayoutDocument(), options)).elements,
    );
  });

  it('refuses a background that is not an object', () => {
    const result = validateLayout(layoutWith({ background: 'thermalright:a042' }), options);

    expect(codesOf(result)).toEqual(['not-an-object']);
    expect(issueAt(result, 'background').message).toContain('leave the field out');
  });

  it('refuses a background with no src, rather than reading it as none', () => {
    const result = validateLayout(layoutWith({ background: { fit: 'cover' } }), options);

    expect(codesOf(result)).toEqual(['missing-field']);
    expect(issueAt(result, 'background.src').code).toBe('missing-field');
  });

  it('holds src to the media path rules', () => {
    const result = validateLayout(layoutWith({ background: { src: '../escape.png' } }), options);

    expect(codesOf(result)).toEqual(['malformed-media-path']);
    expect(issueAt(result, 'background.src').elementIndex).toBeUndefined();
  });

  it('refuses a malformed cloud reference by name', () => {
    const result = validateLayout(layoutWith({ background: { src: 'thermalright:42' } }), options);

    expect(codesOf(result)).toEqual(['malformed-background-ref']);
  });

  it('refuses an unknown field, a rect included: the background always covers the canvas', () => {
    const result = validateLayout(
      layoutWith({ background: { src: 'thermalright:a042', rect: { x: 0, y: 0, w: 1, h: 1 } } }),
      options,
    );

    expect(codesOf(result)).toEqual(['unknown-field']);
    expect(issueAt(result, 'background.rect').code).toBe('unknown-field');
  });

  it.each([
    ['fit', 'stretch', 'wrong-type'],
    ['opacity', 2, 'out-of-range'],
    ['hidden', 'yes', 'wrong-type'],
  ])('checks %s as a media element checks it', (field, value, code) => {
    const result = validateLayout(
      layoutWith({ background: { src: 'thermalright:a042', [field]: value } }),
      options,
    );

    expect(codesOf(result)).toEqual([code]);
    expect(issueAt(result, `background.${field}`).code).toBe(code);
  });
});

describe('hidden on every element kind', () => {
  const documents = validLayoutDocument()['elements'] as Record<string, unknown>[];

  it('has one element of each kind to try', () => {
    expect(new Set(documents.map((element) => element['kind']))).toEqual(new Set(ELEMENT_KINDS));
  });

  it.each(ELEMENT_KINDS)('a %s element may be hidden, and keeps everything else', (kind) => {
    const element = { ...documents.find((candidate) => candidate['kind'] === kind), hidden: true };
    const layout = layoutOf(validateLayout(layoutWithElements([element]), options));

    expect(layout.elements[0]).toEqual(element);
  });

  it.each(ELEMENT_KINDS)('a %s element refuses a hidden that is not a boolean', (kind) => {
    const element = { ...documents.find((candidate) => candidate['kind'] === kind), hidden: 1 };
    const result = validateLayout(layoutWithElements([element]), options);

    expect(codesOf(result)).toEqual(['wrong-type']);
    expect(issueAt(result, 'elements[0].hidden').elementIndex).toBe(0);
  });
});

describe('the version 3 to version 4 boundary', () => {
  it('is the current version', () => {
    expect(LAYOUT_SCHEMA_VERSION).toBe(4);
  });

  it('opens a version 3 file with no background, every layer shown, and its backdrop still an element', () => {
    const v3 = { ...validLayoutDocument(), schemaVersion: 3 };
    const result = loadLayout(v3, options);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fromVersion).toBe(3);
    expect(result.migrations.map((step) => `${step.from}->${step.to}`)).toEqual(['3->4']);
    expect(result.layout.background).toBeUndefined();
    expect(result.layout.elements.every((element) => element.hidden === undefined)).toBe(true);
    expect(result.layout.elements[0]?.kind).toBe('media');
  });
});
