/**
 * The chrome's colours come from one place. A scheme is a second set of values for the same
 * `--ed-*` names, so a colour written straight into a component's sheet is a colour no scheme can
 * reach: it stays dark in the light scheme. Two sheets are exempt, because they draw over the
 * layout being edited rather than over the chrome, and must look the same whichever scheme the
 * chrome is in: the preview's frame and the canvas handles.
 */

import { describe, expect, it } from 'vitest';
import { EDITOR_STYLES } from '../app.js';
import { BACKGROUND_PICKER_STYLES } from '../background-picker.js';
import { CONNECTION_STYLES } from '../connection-control.js';
import { INSPECTOR_STYLES } from '../inspector.js';
import { LAYOUT_PROBLEMS_STYLES } from '../problems.js';
import { PROPERTY_VIEW_STYLES } from '../property-view.js';
import { SENSOR_PICKER_STYLES } from '../sensor-picker.js';
import { SETTINGS_STYLES } from '../settings-page.js';
import { TOKEN_PANE_STYLES } from '../token-pane.js';
import { CHROME_STYLES } from './chrome.js';
import { swatchStyle } from './color-field.js';
import { CONTROLS_STYLES } from './index.js';

/** A colour literal: hex, or a functional notation. Inside a `--ed-*` declaration it is a token. */
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;

/** The sheet with every token declaration taken out, so what is left is what reads them. */
function consumers(sheet: string): string {
  return sheet.replace(/--ed-[a-z0-9-]+\s*:[^;]*;/g, '');
}

const SHEETS: Readonly<Record<string, string>> = {
  CONTROLS_STYLES: consumers(CONTROLS_STYLES),
  EDITOR_STYLES,
  BACKGROUND_PICKER_STYLES,
  CONNECTION_STYLES,
  INSPECTOR_STYLES,
  LAYOUT_PROBLEMS_STYLES,
  PROPERTY_VIEW_STYLES,
  SENSOR_PICKER_STYLES,
  SETTINGS_STYLES,
  TOKEN_PANE_STYLES,
};

describe('the chrome palette', () => {
  it.each(Object.entries(SHEETS))('%s writes no colour of its own', (_name, sheet) => {
    const lines = sheet.split('\n').filter((line) => LITERAL.test(line));

    expect(lines).toEqual([]);
  });

  it('declares every token it reads', () => {
    const declared = new Set(
      [...CHROME_STYLES.matchAll(/(--ed-[a-z0-9-]+)\s*:/g)].map((match) => match[1]),
    );
    const read = new Set(
      [...Object.values(SHEETS), CONTROLS_STYLES]
        .flatMap((sheet) => [...sheet.matchAll(/var\((--ed-[a-z0-9-]+)/g)])
        .map((match) => match[1]),
    );

    expect([...read].filter((name) => !declared.has(name))).toEqual([]);
  });

  it('paints a swatch\'s checkerboard and its "not a colour" mark in chrome tokens', () => {
    // The swatch's own colour is the author's, and is the one literal allowed.
    expect(swatchStyle('#1a2b3c').background.replaceAll('#1a2b3c', '')).not.toMatch(LITERAL);
    expect(swatchStyle('#1a2b3c').background).toContain('var(--ed-checker-light)');
    expect(swatchStyle('var(--perch-fg)').background).not.toMatch(LITERAL);
  });
});
