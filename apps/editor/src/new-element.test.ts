/**
 * What a freshly added element is: a document `validateLayout` accepts, against the same options the
 * app opens every layout with, sitting on the visible canvas.
 */

import {
  LAYOUT_SCHEMA_VERSION,
  formatLayoutIssues,
  validateLayout,
  type Layout,
  type LayoutTarget,
  type ValidateLayoutOptions,
} from '@perch/layout-schema';
import { normalizeSensorTopic, sensorTopic } from '@perch/sensor-contract';
import { WIDGET_REGISTRY } from '@perch/ui-kit';
import { describe, expect, it } from 'vitest';
import { addElement } from './layout-edits.js';
import { ADDABLE_KINDS, defaultRange, newElement } from './new-element.js';

const OPTIONS: ValidateLayoutOptions = Object.freeze({
  widgets: WIDGET_REGISTRY,
  isTopic: (topic: string) => normalizeSensorTopic(topic) !== null,
});

function empty(target: LayoutTarget): Layout {
  return { schemaVersion: LAYOUT_SCHEMA_VERSION, target, theme: {}, elements: [] };
}

const DESK: LayoutTarget = { width: 1920, height: 400, frameRate: 30 };
const TINY: LayoutTarget = { width: 100, height: 40, frameRate: 30 };
const CPU_TEMP = sensorTopic('cpu', 'temperature');

describe('ADDABLE_KINDS', () => {
  it('offers every kind, media as an image beside the layout and a cloud video', () => {
    expect(ADDABLE_KINDS.map((entry) => entry.kind)).toEqual([
      'widget',
      'chart',
      'text',
      'media',
      'media',
    ]);
    expect(ADDABLE_KINDS.map((entry) => entry.label)).toEqual([
      'Live reading',
      'Chart',
      'Label',
      'Image or video',
      'Cloud video',
    ]);
    expect(ADDABLE_KINDS.map((entry) => entry.step)).toEqual([
      'sensor',
      'sensor',
      null,
      'local',
      'cloud',
    ]);
  });
});

describe('newElement', () => {
  for (const target of [DESK, TINY]) {
    for (const entry of ADDABLE_KINDS) {
      it(`makes a ${entry.label} that validates on a ${target.width}x${target.height} canvas`, () => {
        const binding =
          entry.step === 'sensor'
            ? CPU_TEMP
            : entry.step === 'local'
              ? 'desk.assets/wall.png'
              : entry.step === 'cloud'
                ? 'thermalright:a042'
                : undefined;
        const element = newElement(entry.kind, target, binding);
        const result = validateLayout(addElement(element)(empty(target)), OPTIONS);

        expect(result.ok ? '' : formatLayoutIssues(result.issues)).toBe('');
        const { x, y, w, h } = element.rect;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(target.width);
        expect(y + h).toBeLessThanOrEqual(target.height);
      });
    }
  }

  it('centres the new element on the canvas', () => {
    const { rect } = newElement('widget', DESK, CPU_TEMP);

    expect(rect.x + rect.w / 2).toBeCloseTo(DESK.width / 2, -1);
    expect(rect.y + rect.h / 2).toBeCloseTo(DESK.height / 2, -1);
  });

  it('binds a reading and a chart to the chosen topic, with the widget that draws each', () => {
    const reading = newElement('widget', DESK, CPU_TEMP);
    const chart = newElement('chart', DESK, CPU_TEMP);

    expect(reading).toMatchObject({ kind: 'widget', widget: 'readout', topic: CPU_TEMP });
    expect(reading).not.toHaveProperty('range');
    expect(chart).toMatchObject({ kind: 'chart', widget: 'line-chart', topic: CPU_TEMP });
    // The line chart draws a scale, so the format requires a range: it gets one to start from.
    expect(chart.kind === 'chart' ? chart.range : undefined).toEqual(defaultRange(CPU_TEMP));
  });

  it('makes media from the chosen src, at a 16:9 size clamped to the canvas, covering it', () => {
    const image = newElement('media', DESK, 'desk.assets/wall.png');
    const video = newElement('media', TINY, 'thermalright:a042');

    expect(image).toEqual({
      kind: 'media',
      src: 'desk.assets/wall.png',
      rect: { x: 720, y: 65, w: 480, h: 270 },
      fit: 'cover',
    });
    expect(video.rect).toEqual({ x: 0, y: 0, w: 100, h: 40 });
  });

  it('gives a label text to edit, never the empty string the format refuses', () => {
    const label = newElement('text', DESK, undefined);

    expect(label.kind === 'text' ? label.text : '').not.toBe('');
  });
});

describe('defaultRange', () => {
  it('starts a percentage at 0-100 and a temperature at a room-to-hot span', () => {
    expect(defaultRange(sensorTopic('cpu', 'load'))).toEqual([0, 100]);
    expect(defaultRange(CPU_TEMP)).toEqual([20, 100]);
  });

  it('is always min < max, for every metric, and for a topic it cannot parse', () => {
    for (const topic of [
      sensorTopic('gpu', 'fan'),
      sensorTopic('cpu', 'clock'),
      sensorTopic('psu', 'voltage'),
      sensorTopic('storage', 'throughput'),
      'not a topic',
    ]) {
      const [min, max] = defaultRange(topic);
      expect(min).toBeLessThan(max);
    }
  });
});
