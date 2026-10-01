/**
 * The chrome's two schemes. Dark is the palette the editor was designed in; light is the same roles
 * with new values, and it is held to WCAG 2.2 AA here rather than by eye: 4.5:1 for every role that
 * is text against every surface it is drawn on, and 3:1 (1.4.11) for the edges that say where a
 * control is and for the focus ring.
 *
 * Which one shows: the operating system's (`prefers-color-scheme`) unless the author picked one,
 * which `<html data-ed-scheme>` carries.
 */

import { describe, expect, it } from 'vitest';
import { PREVIEW_STYLES } from '../preview.js';
import { CHROME_SCHEMES, CHROME_STYLES, contrastRatio, type ChromeColour } from './chrome.js';

const LIGHT = CHROME_SCHEMES.light;

/** The surfaces text is drawn on. */
const SURFACES: readonly ChromeColour[] = [
  'bg',
  'bg-recessed',
  'bar',
  'field',
  'hover',
  'row-hover',
  'popover',
  'header',
];

/** Every role that is text somewhere in the chrome. */
const TEXT: readonly ChromeColour[] = [
  'text',
  'text-2',
  'heading',
  'heading-hover',
  'label',
  'quiet',
  'faint',
  'header-text',
  'accent',
  'own-text',
  'inherited-text',
  'danger',
  'success',
  'warning',
];

/** Text on a fill of its own: a chosen chip, a ranged number's bar, a confirm, a badge. */
const ON_FILL: readonly (readonly [ChromeColour, ChromeColour])[] = [
  ['on-accent', 'accent-fill'],
  ['text', 'accent-fill'],
  ['text', 'fill-bar'],
  ['danger-strong', 'danger-fill'],
  ['danger', 'danger-fill'],
  ['danger', 'danger-surface'],
  ['success', 'success-fill'],
  ['warning', 'warning-fill'],
];

/** Edges and marks that identify a control or its state, and the surfaces they sit on. */
const GRAPHIC: readonly ChromeColour[] = [
  'field-edge',
  'swatch-edge',
  'focus-ring',
  'accent',
  'accent-edge',
  'own',
  'inherited',
  'danger-edge',
  'success-edge',
  'warning-edge',
  'axis-x',
  'axis-y',
  'axis-w',
  'axis-h',
];
const GRAPHIC_ON: readonly ChromeColour[] = ['bg', 'field', 'bar', 'popover'];

function pairs(
  fronts: readonly ChromeColour[],
  backs: readonly ChromeColour[],
): (readonly [ChromeColour, ChromeColour])[] {
  return fronts.flatMap((front) => backs.map((back) => [front, back] as const));
}

describe('the light scheme', () => {
  it('gives every dark role a light value, and no role dark does not have', () => {
    expect(Object.keys(LIGHT).sort()).toEqual(Object.keys(CHROME_SCHEMES.dark).sort());
  });

  it.each(pairs(TEXT, SURFACES))('%s on %s is at least 4.5:1', (front, back) => {
    expect(contrastRatio(LIGHT[front], LIGHT[back])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(ON_FILL)('%s on %s is at least 4.5:1', (front, back) => {
    expect(contrastRatio(LIGHT[front], LIGHT[back])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(pairs(GRAPHIC, GRAPHIC_ON))('%s on %s is at least 3:1', (front, back) => {
    expect(contrastRatio(LIGHT[front], LIGHT[back])).toBeGreaterThanOrEqual(3);
  });
});

describe('which scheme shows', () => {
  it('follows the system unless the author picked one', () => {
    // An explicit light, and the system's light while nothing is picked; an explicit dark beats it.
    expect(CHROME_STYLES).toContain(":root[data-ed-scheme='light'] {");
    expect(CHROME_STYLES).toMatch(
      /@media \(prefers-color-scheme: light\) \{\s*:root:not\(\[data-ed-scheme='dark'\]\) \{/,
    );
    expect(CHROME_STYLES).toContain(`--ed-bg: ${LIGHT.bg};`);
    expect(CHROME_STYLES).toContain('color-scheme: light;');
  });

  it('never reaches the layout being edited', () => {
    // The preview holds the scheme the canvas was always drawn under, and reads no chrome token.
    expect(PREVIEW_STYLES).toMatch(/\.perch-editor-preview \{[^}]*color-scheme: dark;/);
    expect(PREVIEW_STYLES).not.toContain('--ed-');
  });
});

describe('contrastRatio', () => {
  it('is WCAG 2 relative luminance', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});
