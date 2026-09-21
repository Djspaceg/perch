/**
 * The injection point itself.
 *
 * A malformed registry is programmer input, not authored content, so it throws rather than
 * producing issues — these tests pin which error type, because a caller writing a registry needs
 * the failure to be about their call and not about somebody's layout file.
 */

import { describe, expect, it } from 'vitest';
import {
  createWidgetRegistry,
  EMPTY_WIDGET_REGISTRY,
  isWidgetName,
  type WidgetSpec,
} from '@perch/layout-schema';
import { hostile } from './layout-fixture.test-support.js';

describe('isWidgetName', () => {
  it.each([['gauge'], ['cpu-gauge'], ['bar-chart-2'], ['a'], ['x9']])('accepts %s', (name) => {
    expect(isWidgetName(name)).toBe(true);
  });

  it.each([
    ['an empty name', ''],
    ['capitals', 'Gauge'],
    ['a space', 'cpu gauge'],
    ['a leading hyphen', '-gauge'],
    ['a trailing hyphen', 'gauge-'],
    ['a doubled hyphen', 'cpu--gauge'],
    ['an underscore', 'cpu_gauge'],
    ['a dot', 'ui.gauge'],
    ['a name over the ceiling', 'a'.repeat(65)],
  ])('rejects %s', (_why, name) => {
    expect(isWidgetName(name)).toBe(false);
  });
});

describe('createWidgetRegistry', () => {
  const registry = createWidgetRegistry({
    gauge: { drawsScale: true },
    readout: { drawsScale: false },
  });

  it('resolves a registered widget and its scale flag', () => {
    expect(registry.has('gauge')).toBe(true);
    expect(registry.get('gauge')).toEqual({ drawsScale: true });
    expect(registry.get('readout')).toEqual({ drawsScale: false });
  });

  it('resolves nothing for a name it does not have', () => {
    expect(registry.has('guage')).toBe(false);
    expect(registry.get('guage')).toBeUndefined();
  });

  it('enumerates its names in sorted order, so two identical tables produce identical messages', () => {
    expect(registry.names).toEqual(['gauge', 'readout']);
    expect(
      createWidgetRegistry({ readout: { drawsScale: false }, gauge: { drawsScale: true } }).names,
    ).toEqual(registry.names);
  });

  it('is frozen, spec and all', () => {
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.get('gauge'))).toBe(true);
  });

  it('does not resolve an inherited property as a widget', () => {
    expect(registry.has('toString')).toBe(false);
    expect(registry.get('constructor')).toBeUndefined();
  });

  it('builds an empty registry without complaint', () => {
    expect(createWidgetRegistry({}).names).toEqual([]);
  });

  it.each([
    ['capitals', 'Gauge'],
    ['a space', 'cpu gauge'],
    ['an empty name', ''],
    ['a trailing hyphen', 'gauge-'],
    ['a name over the ceiling', 'a'.repeat(65)],
  ])('throws TypeError for a table key with %s', (_why, name) => {
    expect(() => createWidgetRegistry({ [name]: { drawsScale: false } })).toThrow(TypeError);
  });

  it.each([
    ['a string', 'yes'],
    ['a number', 1],
    ['nothing', undefined],
    ['null', null],
  ])('throws TypeError for a drawsScale that is %s', (_why, drawsScale) => {
    expect(() => createWidgetRegistry({ gauge: hostile<WidgetSpec>({ drawsScale }) })).toThrow(
      /drawsScale/,
    );
  });

  it('names the offending key in the error, because a registry is a call site to fix', () => {
    expect(() => createWidgetRegistry({ Gauge: { drawsScale: true } })).toThrow(/"Gauge"/);
  });

  it("copies each spec rather than holding the caller's object", () => {
    const spec = { drawsScale: false };
    const built = createWidgetRegistry({ readout: spec });

    expect(built.get('readout')).not.toBe(spec);
  });
});

describe('EMPTY_WIDGET_REGISTRY', () => {
  it('knows nothing, explicitly', () => {
    expect(EMPTY_WIDGET_REGISTRY.names).toEqual([]);
    expect(EMPTY_WIDGET_REGISTRY.has('gauge')).toBe(false);
    expect(EMPTY_WIDGET_REGISTRY.get('gauge')).toBeUndefined();
  });
});
