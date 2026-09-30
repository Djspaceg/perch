/**
 * The committed layouts paint every element at the opacity they painted at before opacity became an
 * element's own field.
 *
 * Until schema version 3 a layout held its media back with one theme token, `--perch-media-opacity`,
 * which `.perch-media` read. The token is retired: each element now carries `opacity`, written on its
 * box by the canvas, and the files in `layouts/` were migrated. `PAINTED_BEFORE` is what each element
 * painted at under the old rule, recorded from the files as they were at the commit before the change
 * (30e8511): the theme's value on every media element, 1 on everything else.
 * This renders each file as it is now and reads the opacity each element's box is painted at.
 *
 * jsdom resolves no `var()`, so the painted opacity is read from the inline declarations the canvas
 * writes, and the retired token is checked for separately: no sheet the canvas mounts may read it,
 * or a layout that still carried it would be held back twice.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LAYOUT_SCHEMA_VERSION, loadLayoutJson } from '@perch/layout-schema';
import { normalizeSensorTopic } from '@perch/sensor-contract';
import { createMockSource } from '@perch/sensor-sources';
import {
  LAYOUT_CANVAS_STYLES,
  LayoutCanvas,
  MEDIA_FRAME_STYLES,
  PERCH_TOKENS,
  PERCH_TOKEN_LABELS,
  SensorProvider,
  WIDGET_REGISTRY,
} from '@perch/ui-kit';

/** `layouts/`, found by climbing from the working directory, for the reason `layouts.test.ts` gives. */
const LAYOUTS_ROOT = findLayoutsRoot(process.cwd());

function findLayoutsRoot(start: string): string {
  for (let directory = start; ; directory = dirname(directory)) {
    const candidate = resolve(directory, 'layouts');
    if (existsSync(resolve(candidate, 'README.md'))) return candidate;
    if (dirname(directory) === directory) throw new Error(`no layouts/ directory above ${start}`);
  }
}

const LOAD_OPTIONS = {
  widgets: WIDGET_REGISTRY,
  isTopic: (topic: string) => normalizeSensorTopic(topic) !== null,
};

/** Each element's painted opacity, in paint order, under the old rule. */
const PAINTED_BEFORE: Readonly<Record<string, readonly number[]>> = {
  'desk-1920x400': [0.55, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  'tower-720x1280': [0.5, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  'trend-1920x400': [1, 1, 1, 1, 1, 1, 1],
};

function text(name: string): string {
  return readFileSync(resolve(LAYOUTS_ROOT, `${name}.json`), 'utf8');
}

/** The opacity a box and everything inside it are painted at, from the declarations on the way down. */
function paintedOpacity(box: HTMLElement): number {
  const own = box.style.opacity === '' ? 1 : Number(box.style.opacity);
  const inner = [...box.querySelectorAll<HTMLElement>('[style]')].reduce(
    (product, element) =>
      product * (element.style.opacity === '' ? 1 : Number(element.style.opacity)),
    1,
  );

  return own * inner;
}

describe.each(Object.keys(PAINTED_BEFORE))('layouts/%s.json', (name) => {
  it('is written at the current schema version, without the retired token', () => {
    const document = JSON.parse(text(name)) as Record<string, unknown>;

    expect(document['schemaVersion']).toBe(LAYOUT_SCHEMA_VERSION);
    expect(text(name)).not.toContain('--perch-media-opacity');
  });

  it('paints every element at the opacity it painted at before', () => {
    const loaded = loadLayoutJson(text(name), LOAD_OPTIONS);
    if (!loaded.ok) throw new Error(`layouts/${name}.json does not load`);
    const { container } = render(
      <SensorProvider source={createMockSource({ seed: 1 })}>
        <LayoutCanvas layout={loaded.layout} scale={1} resolveAsset={(src) => `/${src}`} />
      </SensorProvider>,
    );
    const boxes = [...container.querySelectorAll<HTMLElement>('.perch-element')];

    expect(boxes.map(paintedOpacity)).toEqual(PAINTED_BEFORE[name]);
  });
});

describe('the retired media opacity token', () => {
  it('is read by no sheet the canvas mounts', () => {
    expect(LAYOUT_CANVAS_STYLES).not.toContain('--perch-media-opacity');
    expect(MEDIA_FRAME_STYLES).not.toContain('--perch-media-opacity');
  });

  it('is gone from the vocabulary, so no pane offers it', () => {
    expect(PERCH_TOKENS).not.toContain('--perch-media-opacity');
    expect(Object.keys(PERCH_TOKEN_LABELS)).not.toContain('--perch-media-opacity');
  });
});
