/**
 * The layouts in `layouts/`, checked as content.
 *
 * Every other test in this package builds its own document. This one reads the real files off disk
 * and puts them through the same `loadLayout` the page uses, because a layout that stops validating
 * is not a test failure anywhere else in the repo: `layouts/` is outside every workspace, nothing
 * imports it, and the way the breakage surfaces otherwise is a refusal on the panel.
 *
 * Read with `node:fs` rather than through `LAYOUT_CATALOGUE`, deliberately. The catalogue's globs are
 * resolved by the bundler, so a test going through them proves the bundler's table is right and not
 * that the files are — and if a glob pattern ever stops matching, an empty catalogue would make every
 * assertion here vacuous rather than failing. `layout-catalogue.test.ts` covers the glob side.
 *
 * ## The mock is the vocabulary
 *
 * The sensor host is offline for days at a time, so `MOCK_SENSOR_SPECS` is the set of topics any
 * layout in this repo can actually show. That makes "which tiles are live and which are waiting" a
 * checkable property of a layout file, not a matter of running the page and looking: a layout is
 * supposed to be mostly live with one deliberate gap, and a layout that quietly became a screen of
 * waiting tiles should fail here.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadLayoutJson,
  type Layout,
  type TextElement,
  type WidgetElement,
} from '@perch/layout-schema';
import { MOCK_SENSOR_SPECS } from '@perch/sensor-sources';
import { normalizeSensorTopic, sensorTopic } from '@perch/sensor-contract';
import { WIDGET_REGISTRY } from './widget-catalogue.js';

/** The same options the page loads with. A layout that passes here passes there. */
const LOAD_OPTIONS = {
  widgets: WIDGET_REGISTRY,
  isTopic: (topic: string) => normalizeSensorTopic(topic) !== null,
};

/**
 * `layouts/`, found by climbing from the working directory.
 *
 * Not `new URL('../../../layouts', import.meta.url)`, which is the obvious spelling and does not
 * work: Vitest serves this module through Vite, so `import.meta.url` is an `/@fs/…` URL and
 * `fileURLToPath` of it is not a filesystem path. The working directory differs between `npm test -w
 * @perch/runtime` (this package) and a run from the repo root, so it is climbed rather than assumed.
 */
const LAYOUTS_ROOT = findLayoutsRoot(process.cwd());

function findLayoutsRoot(start: string): string {
  for (let directory = start; ; directory = dirname(directory)) {
    const candidate = resolve(directory, 'layouts');
    if (existsSync(resolve(candidate, 'README.md'))) return candidate;

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`no layouts/ directory above ${start}`);
    }
  }
}

function layoutsPath(relative: string): string {
  return resolve(LAYOUTS_ROOT, relative);
}

function read(relative: string): string {
  return readFileSync(layoutsPath(relative), 'utf8');
}

function loadShipped(name: string): Layout {
  const loaded = loadLayoutJson(read(`${name}.json`), LOAD_OPTIONS);
  if (!loaded.ok) {
    throw new Error(
      `layouts/${name}.json does not validate:\n${loaded.issues
        .map((issue) => `  ${issue.path}: ${issue.message}`)
        .join('\n')}`,
    );
  }

  return loaded.layout;
}

/**
 * Every canonical topic the mock publishes, and the one it publishes as a null reading.
 *
 * Widened to `ReadonlySet<string>`: the questions below are asked of a topic string read out of a
 * layout file, which is a `string` and not the `SensorTopic` template type, and narrowing it first
 * would mean the membership test could no longer be asked at all.
 */
const MOCK_TOPICS: ReadonlySet<string> = new Set<string>(
  MOCK_SENSOR_SPECS.map((spec) => sensorTopic(spec.device, spec.metric, spec.indices ?? {})),
);

const widgets = (layout: Layout): WidgetElement[] =>
  layout.elements.filter((element): element is WidgetElement => element.kind === 'widget');

const SHIPPED = ['desk-1920x400', 'tower-720x1280'] as const;

describe.each(SHIPPED)('layouts/%s.json', (name) => {
  const layout = loadShipped(name);

  it('validates against the registry the runtime injects', () => {
    // `loadShipped` throws with the issue list if it does not, so reaching here is the assertion —
    // stated anyway so the failure names this property rather than appearing as a module error.
    expect(layout.schemaVersion).toBe(1);
  });

  it('declares the target its filename claims', () => {
    const [, size] = name.split('-');
    const [width, height] = (size ?? '').split('x').map(Number);

    expect(layout.target.width).toBe(width);
    expect(layout.target.height).toBe(height);
  });

  it('references only assets that are on disk', () => {
    for (const element of layout.elements) {
      if (element.kind !== 'media') continue;
      // `readFileSync` throwing *is* the assertion: the schema checks the shape of the path, and
      // nothing but the filesystem can say whether the file is there.
      expect(read(element.src).length).toBeGreaterThan(0);
    }
  });

  it('reads at least one indexed topic, so the five-segment form is exercised', () => {
    const indexed = widgets(layout).filter((element) => {
      const parts = element.topic.split('/');
      return parts[2] !== '0' || parts[4] !== '0';
    });

    expect(indexed.length).toBeGreaterThan(0);
  });

  it('waits on at least one topic this source never publishes, deliberately', () => {
    const waiting = widgets(layout).filter(
      (element) => !MOCK_TOPICS.has(normalizeSensorTopic(element.topic) ?? element.topic),
    );

    expect(waiting.length).toBeGreaterThan(0);
  });

  it('is mostly live, so the panel does not read as broken', () => {
    const bound = widgets(layout);
    const live = bound.filter((element) =>
      MOCK_TOPICS.has(normalizeSensorTopic(element.topic) ?? element.topic),
    );

    // Two thirds, not all: a screen of "waiting" tiles looks like a failure rather than a layout,
    // and a layout with no gap never shows the waiting state at all.
    expect(live.length * 3).toBeGreaterThanOrEqual(bound.length * 2);
    expect(live.length).toBeLessThan(bound.length);
  });

  it('paints every element inside or across the canvas, never entirely outside it', () => {
    for (const { rect } of layout.elements) {
      expect(rect.x).toBeLessThan(layout.target.width);
      expect(rect.y).toBeLessThan(layout.target.height);
      expect(rect.x + rect.w).toBeGreaterThan(0);
      expect(rect.y + rect.h).toBeGreaterThan(0);
    }
  });

  it('says on the canvas that its numbers are generated', () => {
    // Not only in the page chrome: the chrome is the runtime's guarantee, and this is the layout's
    // own. A capture cropped to the canvas still has to carry the provenance.
    const text = layout.elements
      .filter((element): element is TextElement => element.kind === 'text')
      .map((element) => element.text)
      .join(' ')
      .toLowerCase();

    expect(text).toContain('mock');
    expect(text).toContain('not hardware');
  });
});

describe('the two layouts against each other', () => {
  const desk = loadShipped('desk-1920x400');
  const tower = loadShipped('tower-720x1280');

  it('target different canvases, in different orientations', () => {
    expect(desk.target.width).toBeGreaterThan(desk.target.height);
    expect(tower.target.height).toBeGreaterThan(tower.target.width);
  });

  it('declare different capture ceilings', () => {
    expect(desk.target.frameRate).not.toBe(tower.target.frameRate);
  });

  it('theme differently rather than being the same grid twice', () => {
    // Same token, different values: the point of the token vocabulary is that two layouts reading the
    // same widget look unalike. A shared value here would mean one of them is not really themed.
    for (const token of ['--perch-canvas-bg', '--perch-fg', '--perch-font']) {
      expect(desk.theme[token], `desk sets ${token}`).toBeDefined();
      expect(tower.theme[token], `tower sets ${token}`).toBeDefined();
      expect(desk.theme[token]).not.toBe(tower.theme[token]);
    }
  });

  it('differ in density, not only in size', () => {
    // The desk panel is a dense strip of small tiles; the tower is a sparse column of large ones.
    expect(meanTileArea(tower)).toBeGreaterThan(meanTileArea(desk) * 2);
  });
});

/** Mean widget area in canvas pixels — the number that makes "dense" and "sparse" checkable. */
function meanTileArea(layout: Layout): number {
  const tiles = widgets(layout);
  return tiles.reduce((sum, tile) => sum + tile.rect.w * tile.rect.h, 0) / tiles.length;
}

describe('layouts/invalid/', () => {
  it('holds a document that is refused, with an issue per mistake', () => {
    const loaded = loadLayoutJson(read('invalid/broken-desk.json'), LOAD_OPTIONS);

    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;

    // Parsed fine and refused on its contents: the interesting refusal, since `invalid-json` would
    // report one issue with no field path and prove nothing about the validator.
    expect(loaded.issues.map((issue) => issue.code)).not.toContain('invalid-json');
    expect(loaded.issues.length).toBeGreaterThan(5);

    // Each issue has to point somewhere in the file, or the on-page report is unusable.
    for (const issue of loaded.issues) {
      expect(issue.path.length).toBeGreaterThan(0);
    }

    // The mistakes it is there to demonstrate, so a future edit cannot make it trivially wrong.
    expect(loaded.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'malformed-theme-token',
        'unknown-widget',
        'malformed-topic',
        'off-canvas',
        'not-an-integer',
        'missing-field',
        'malformed-media-path',
        'unknown-element-kind',
      ]),
    );
  });
});
