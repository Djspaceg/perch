/**
 * The drift test: the registry the validator uses and the components the page renders are the same
 * set of names, or this file fails.
 *
 * The failure it guards is specific and silent. A name in the registry with no component means a
 * layout using it **passes validation and paints nothing** — the format says the file is correct
 * while the panel shows an empty rectangle, so the author looks at their CSS, their topic and their
 * rect before they look at the widget name. The reverse, a component nobody registered, is louder
 * but no better: the layout is refused for using a widget the page can in fact draw.
 *
 * `widget-catalogue.tsx` makes that unrepresentable rather than merely wrong — both halves are
 * derived from one declaration, and an entry cannot carry one half. So these assertions are not
 * defence in depth against a mistake someone might make in two lists; they are a check that the
 * derivation is still a derivation. The way this file starts failing is someone adding a second
 * declaration.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { loadLayoutJson } from '@perch/layout-schema';
import type { SensorSource } from '@perch/sensor-contract';
import { SensorProvider } from '@perch/ui-kit';
import { WIDGET_NAMES, WIDGET_REGISTRY, widgetFor } from './widget-catalogue.js';

/**
 * A source that never publishes. `ui-kit` may not import `sensor-sources`, and this file does not
 * need readings anyway: what it asserts is that a registered name *renders*, so every widget below
 * is examined in its no-reading state. That is the state where a missing component shows up.
 */
const SILENT_SOURCE: SensorSource = {
  status: 'live',
  subscribe: () => () => {
    // Nothing was ever subscribed, so there is nothing to tear down.
  },
  meta: () => undefined,
};

describe('the widget catalogue', () => {
  it('registers exactly the names it can render, in both directions', () => {
    // Sorted, because the registry sorts its own `names` for byte-identical error messages and the
    // catalogue keeps declaration order. The claim is about the *set*.
    expect([...WIDGET_REGISTRY.names].sort()).toEqual([...WIDGET_NAMES].sort());
  });

  it('resolves a component for every registered name', () => {
    for (const name of WIDGET_REGISTRY.names) {
      expect(widgetFor(name), `no component for registered widget ${name}`).toBeDefined();
    }
  });

  it('registers every name it has a component for', () => {
    for (const name of WIDGET_NAMES) {
      expect(WIDGET_REGISTRY.has(name), `component ${name} is not in the registry`).toBe(true);
    }
  });

  it('declares whether each widget draws a scale, which is what the registry is for', () => {
    for (const name of WIDGET_REGISTRY.names) {
      expect(typeof WIDGET_REGISTRY.get(name)?.drawsScale).toBe('boolean');
    }
  });

  it('has no component for a name nobody registered', () => {
    // The gauge and the sparkline the layout format anticipates: absent here because they are absent
    // from `ui-kit`. A catalogue entry ahead of the component would be the silent failure above.
    expect(widgetFor('gauge')).toBeUndefined();
    expect(widgetFor('sparkline')).toBeUndefined();
    expect(WIDGET_REGISTRY.has('gauge')).toBe(false);
  });
});

describe('the catalogue against the validator that shares it', () => {
  const layoutUsing = (widget: string): string =>
    JSON.stringify({
      schemaVersion: 1,
      target: { width: 400, height: 200, frameRate: 30 },
      theme: {},
      elements: [
        {
          kind: 'widget',
          widget,
          topic: 'sensors/cpu/0/load/0',
          rect: { x: 0, y: 0, w: 400, h: 200 },
        },
      ],
    });

  it('accepts every registered widget and renders it', () => {
    for (const name of WIDGET_REGISTRY.names) {
      const loaded = loadLayoutJson(layoutUsing(name), { widgets: WIDGET_REGISTRY });
      expect(loaded.ok, `registry accepts ${name}`).toBe(true);
      if (!loaded.ok) continue;

      const element = loaded.layout.elements[0];
      if (element?.kind !== 'widget') throw new Error('expected a widget element');

      // Rendered through the same `widgetFor` the canvas uses: a registered name that validates
      // must also produce pixels, which is the whole claim.
      const entry = widgetFor(element.widget);
      render(<SensorProvider source={SILENT_SOURCE}>{entry?.render(element)}</SensorProvider>);

      expect(screen.getByRole('group')).toBeInTheDocument();
    }
  });

  it('refuses a widget it could not render, naming what it does have', () => {
    const loaded = loadLayoutJson(layoutUsing('sparkline'), { widgets: WIDGET_REGISTRY });

    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;

    const [issue] = loaded.issues;
    expect(issue?.code).toBe('unknown-widget');
    // The registry's own names in the message, so the refusal is a fix rather than a dead end.
    expect(issue?.message).toContain('readout');
  });
});
