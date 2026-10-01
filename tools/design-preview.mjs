#!/usr/bin/env node
/**
 * Regenerate preview.html's tokens from DESIGN.md's front matter: `node tools/design-preview.mjs`.
 *
 * preview.html is a static, self-contained catalogue, and every colour, radius, size and type style
 * in it is a custom property from DESIGN.md. This writes the parts that are the front matter — the
 * `:root` blocks for both schemes and for touch, the type classes, the colour swatches and the type
 * specimens — between the `BEGIN generated` and `END generated` markers, and leaves everything else
 * (the component CSS and markup, the scripts) as it is. Run it after changing a token.
 *
 * The front matter is read by a parser for exactly its own shape (maps nested by two spaces, quoted
 * or bare scalars, one block scalar), not a YAML library: the repository takes no dependency for a
 * docs tool.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const designPath = join(root, 'DESIGN.md');
const previewPath = join(root, 'preview.html');

/** The front matter as nested objects of strings. */
export function readFrontMatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (match === null) throw new Error('DESIGN.md has no front matter');
  const result = {};
  const stack = [{ indent: -1, value: result }];
  let block = null;
  for (const line of match[1].split('\n')) {
    if (block !== null) {
      if (line.startsWith(' '.repeat(block.indent)) || line.trim() === '') {
        block.target[block.key] += `${line.trim()}\n`;
        continue;
      }
      block = null;
    }
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    const pair = /^([^:]+):\s*(.*)$/.exec(line.trim());
    if (pair === null) throw new Error(`cannot read front matter line: ${line}`);
    const [, key, raw] = pair;
    while (stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1).value;
    if (raw === '') {
      parent[key] = {};
      stack.push({ indent, value: parent[key] });
    } else if (raw === '|') {
      parent[key] = '';
      block = { indent: indent + 2, target: parent, key };
    } else {
      parent[key] = raw.replace(/^"(.*)"$/, '$1');
    }
  }

  return result;
}

const FAMILIES = {
  'ui-sans-serif': 'ui-sans-serif, system-ui, sans-serif',
  'ui-monospace': 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

function declarations(map, prefix) {
  return Object.entries(map).map(([name, value]) => `  --${prefix}-${name}: ${value};`);
}

/** The generated stylesheet: both schemes, touch, and the type classes. */
export function tokenCss(front) {
  const { colors, rounded, spacing, typography } = front;
  const light = front['colors-light'];
  const lines = [
    `/* ${String(Object.keys(colors).length)} colours in each of two schemes, ${String(Object.keys(typography).length)} type styles, ${String(Object.keys(rounded).length)} radii, ${String(Object.keys(spacing).length)} spacing values. */`,
    ':root {',
    ...declarations(colors, 'color'),
    ...declarations(rounded, 'rounded'),
    ...declarations(spacing, 'spacing'),
    ...Object.entries(typography).map(
      ([name, style]) => `  --typography-${name}-fontSize: ${style.fontSize};`,
    ),
    '  color-scheme: dark;',
    '}',
    ":root[data-scheme='light'] {",
    ...declarations(light, 'color'),
    '  color-scheme: light;',
    '}',
    '@media (prefers-color-scheme: light) {',
    "  :root:not([data-scheme='dark']) {",
    ...declarations(light, 'color').map((line) => `  ${line}`),
    '    color-scheme: light;',
    '  }',
    '}',
    '@media (pointer: coarse) {',
    '  :root {',
    `    --spacing-control: ${spacing['touch-target']};`,
    `    --spacing-field-height: ${spacing['touch-field-height']};`,
    `    --spacing-row-height: ${spacing['touch-row-height']};`,
    `    --spacing-splitter-hit: ${spacing['touch-target']};`,
    '  }',
    '}',
    ...Object.entries(typography).map(([name, style]) => {
      const feature =
        style.fontFeature === undefined ? '' : ` font-feature-settings: "${style.fontFeature}";`;
      const spacingValue = style.letterSpacing === '0' ? 'normal' : style.letterSpacing;
      return `.t-${name} { font-family: ${FAMILIES[style.fontFamily] ?? style.fontFamily}; font-size: ${style.fontSize}; font-weight: ${style.fontWeight}; line-height: ${style.lineHeight}; letter-spacing: ${spacingValue};${feature} }`;
    }),
  ];

  return lines.join('\n');
}

/** One swatch per role, painted in the scheme showing, with both values written. */
export function swatchesHtml(front) {
  const light = front['colors-light'];

  return Object.entries(front.colors)
    .map(
      ([name, dark]) =>
        `<div class="chipc"><i style="background: var(--color-${name})"></i><span>${name}<br><code>${dark}</code> <code>${light[name] ?? ''}</code></span></div>`,
    )
    .join('\n');
}

/** One specimen per type style. */
export function typesHtml(front) {
  return Object.entries(front.typography)
    .map(([name, style]) => {
      const upper = name === 'group-title' ? ' style="text-transform: uppercase"' : '';
      return `<div><code>${name}<br>${style.fontSize} / ${style.fontWeight}</code><span class="t-${name}"${upper}>Opacity 55% · Selected item 0123456789</span></div>`;
    })
    .join('\n');
}

function replaceBetween(text, name, body, open, close) {
  const start = `${open} BEGIN generated ${name} ${close}`;
  const end = `${open} END generated ${name} ${close}`;
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from === -1 || to === -1) throw new Error(`preview.html has no generated ${name} markers`);

  return `${text.slice(0, from + start.length)}\n${body}\n${text.slice(to)}`;
}

export function regenerate(design, preview) {
  const front = readFrontMatter(design);
  let next = replaceBetween(preview, 'tokens', tokenCss(front), '/*', '*/');
  next = replaceBetween(next, 'swatches', swatchesHtml(front), '<!--', '-->');
  next = replaceBetween(next, 'types', typesHtml(front), '<!--', '-->');

  return next;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const before = readFileSync(previewPath, 'utf8');
  const after = regenerate(readFileSync(designPath, 'utf8'), before);
  writeFileSync(previewPath, after);
  console.log(before === after ? 'preview.html: already current' : 'preview.html: regenerated');
}
