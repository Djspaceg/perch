/**
 * The chrome's two schemes. Dark is the palette the editor was designed in; light is the same roles
 * with new values, and it is held to WCAG 2.2 AA here rather than by eye: 4.5:1 for every role that
 * is text against every surface it is drawn on, and 3:1 (1.4.11) for the edges that say where a
 * control is and for the focus ring.
 *
 * Which one shows: the operating system's (`prefers-color-scheme`) unless the author picked one,
 * which `<html data-ed-scheme>` carries.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EDITOR_STYLES } from '../app.js';
import { INSPECTOR_STYLES } from '../inspector.js';
import { PREVIEW_STYLES } from '../preview.js';
import { SIDEBAR_STYLES } from '../sidebar.js';
import { CHROME_SCHEMES, CHROME_STYLES, contrastRatio, type ChromeColour } from './chrome.js';
import { COLOR_FIELD_STYLES } from './color-field.js';
import { CONTROLS_STYLES } from './index.js';

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

describe('touch', () => {
  /** The `@media (pointer: coarse)` block's declarations, by name. */
  function coarse(): Record<string, string> {
    const block =
      /@media \(pointer: coarse\) \{\s*:root \{([^}]*)\}/.exec(CHROME_STYLES)?.[1] ?? '';

    const sizes: Record<string, string> = {};
    for (const [, name, value] of block.matchAll(/(--ed-[a-z-]+):\s*([^;]+);/g)) {
      if (name !== undefined && value !== undefined) sizes[name] = value;
    }

    return sizes;
  }

  it('grows every target to at least 24px under a coarse pointer, and only there', () => {
    const sizes = coarse();
    for (const name of [
      '--ed-field-h',
      '--ed-control',
      '--ed-list-row-h',
      '--ed-target',
      '--ed-hit',
    ]) {
      expect(Number.parseFloat(sizes[name] ?? '0'), name).toBeGreaterThanOrEqual(24);
    }
    expect(Number.parseFloat(sizes['--ed-row-h'] ?? '0')).toBeGreaterThanOrEqual(26);
    // The mouse's density is unchanged.
    expect(CHROME_STYLES).toContain('--ed-control: 18px;');
    expect(CHROME_STYLES).toContain('--ed-row-h: 22px;');
  });

  it('sizes the small targets from those tokens rather than in pixels of their own', () => {
    expect(CONTROLS_STYLES).toMatch(/\.perch-reset \{[^}]*width: var\(--ed-control\);/);
    expect(CONTROLS_STYLES).toMatch(
      /grid-template-columns: var\(--ed-label-col\) minmax\(0, 1fr\) var\(--ed-control\);/,
    );
    expect(CONTROLS_STYLES).toMatch(/\.perch-filter__search \{[^}]*height: var\(--ed-control\);/);
    expect(CONTROLS_STYLES).toMatch(/\.perch-align__cell \{[^}]*width: var\(--ed-control\);/);
    expect(INSPECTOR_STYLES).toMatch(
      /\.perch-editor-element \{[^}]*height: var\(--ed-list-row-h\);/,
    );
    expect(EDITOR_STYLES).toMatch(/\.perch-editor-button \{[^}]*min-height: var\(--ed-target\);/);
    expect(SIDEBAR_STYLES).toMatch(/\.perch-sidebar-splitter \{[^}]*width: var\(--ed-hit\);/);
  });
});

describe('the colour picker', () => {
  // react-colorful's own sheet assumes a white page. Its gradients are the colour being picked and
  // stay; everything around them is the chrome's.
  it('takes its edges, checkerboard, pointer ring and focus from the chrome', () => {
    expect(COLOR_FIELD_STYLES).toMatch(
      /\.react-colorful__saturation[^{]*\{[^}]*box-shadow: inset 0 0 0 1px var\(--ed-swatch-edge\)/,
    );
    expect(COLOR_FIELD_STYLES).toMatch(
      /\.react-colorful__alpha[^{]*\{[^}]*background-image: repeating-conic-gradient\(var\(--ed-checker-light\)/,
    );
    expect(COLOR_FIELD_STYLES).toMatch(
      /\.react-colorful__pointer \{[^}]*box-shadow: 0 0 0 1px var\(--ed-picker-ring\)/,
    );
    expect(COLOR_FIELD_STYLES).toMatch(
      /\.react-colorful__interactive:focus-visible \.react-colorful__pointer \{[^}]*var\(--ed-focus-ring\)/,
    );
    expect(LIGHT['picker-ring']).toBeDefined();
  });
});

describe('DESIGN.md', () => {
  /** A front matter colour map, by DESIGN.md's name. */
  function colours(key: string): Record<string, string> {
    const text = readFileSync(join(import.meta.dirname, '../../../../DESIGN.md'), 'utf8');
    const block = new RegExp(`^${key}:\\n((?:  .*\\n)+)`, 'm').exec(text)?.[1] ?? '';
    const found: Record<string, string> = {};
    for (const [, name, value] of block.matchAll(/^ {2}([a-z0-9-]+): "([^"]+)"$/gm)) {
      if (name !== undefined && value !== undefined) found[name] = value;
    }

    return found;
  }

  /** DESIGN.md's names for the roles the chrome spells differently. */
  const RENAMED: Readonly<Record<string, ChromeColour>> = {
    primary: 'accent',
    'on-primary': 'on-accent',
    'primary-fill': 'accent-fill',
    'primary-edge': 'accent-edge',
    panel: 'bg',
    'panel-recessed': 'bg-recessed',
    ink: 'text',
    'ink-2': 'text-2',
  };

  it.each([
    ['colors', 'dark'],
    ['colors-light', 'light'],
  ] as const)('%s are the chrome %s palette, role for role', (key, scheme) => {
    const documented = colours(key);
    expect(Object.keys(documented).length).toBeGreaterThan(40);
    for (const [name, value] of Object.entries(documented)) {
      const role = RENAMED[name] ?? (name as ChromeColour);
      expect(CHROME_SCHEMES[scheme][role], `${key}.${name}`).toBe(value);
    }
  });
});
