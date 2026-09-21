/**
 * The gate: an edit that produces a layout, and an edit that does not.
 *
 * These are the two cases the whole editor is arranged around, so they are tested against the *real*
 * options the app uses — `WIDGET_REGISTRY` and `normalizeSensorTopic` from the packages the runtime
 * also injects — rather than against a permissive stub. A test that validated against an empty
 * registry would pass while the editor refused every layout on disk.
 */

import {
  LAYOUT_SCHEMA_VERSION,
  formatLayoutIssues,
  loadLayoutJson,
  type Layout,
  type ValidateLayoutOptions,
} from '@perch/layout-schema';
import { normalizeSensorTopic } from '@perch/sensor-contract';
import { WIDGET_REGISTRY } from '@perch/ui-kit';
import { describe, expect, it } from 'vitest';
import { canSave, draftSaved, editDraft, isDirty, openDraft } from './draft.js';
import {
  numberFromInput,
  setElementRectField,
  setElementText,
  setElementTopic,
  setThemeToken,
} from './layout-edits.js';

const OPTIONS: ValidateLayoutOptions = Object.freeze({
  widgets: WIDGET_REGISTRY,
  isTopic: (topic: string) => normalizeSensorTopic(topic) !== null,
});

/** A small layout at the current schema version, shaped like the shipped ones. */
function validLayout(): Layout {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    target: { width: 640, height: 200, frameRate: 30 },
    theme: { '--perch-fg': '#e8f1ff' },
    elements: [
      { kind: 'text', text: 'mock source, not hardware', rect: { x: 10, y: 10, w: 300, h: 30 } },
      {
        kind: 'widget',
        widget: 'readout',
        topic: 'sensors/cpu/0/temperature/0',
        rect: { x: 10, y: 50, w: 200, h: 120 },
      },
    ],
  };
}

describe('openDraft', () => {
  it('opens a valid layout with nothing to report and nothing to save', () => {
    const state = openDraft('desk', validLayout(), OPTIONS);

    expect(state.issues).toEqual([]);
    expect(isDirty(state)).toBe(false);
    // Nothing has changed, so there is nothing to write. The gate is issues *and* a difference.
    expect(canSave(state)).toBe(false);
  });

  it("paints the validator's own rebuild, not the object it was handed", () => {
    const layout = validLayout();
    const state = openDraft('desk', layout, OPTIONS);

    expect(state.rendered).not.toBe(layout);
    expect(state.rendered).toEqual(layout);
  });
});

describe('editDraft — an edit that produces a valid document', () => {
  it('validates, becomes dirty, and may be saved', () => {
    const state = editDraft(
      openDraft('desk', validLayout(), OPTIONS),
      setElementRectField(1, 'w', 180),
    );

    expect(state.issues).toEqual([]);
    expect(isDirty(state)).toBe(true);
    expect(canSave(state)).toBe(true);
  });

  it('moves the preview to the edited document', () => {
    const state = editDraft(
      openDraft('desk', validLayout(), OPTIONS),
      setElementRectField(1, 'w', 180),
    );

    expect(state.rendered.elements[1]?.rect.w).toBe(180);
  });

  it('leaves every other field alone', () => {
    const before = validLayout();
    const state = editDraft(openDraft('desk', before, OPTIONS), setElementRectField(1, 'w', 180));

    expect(state.rendered.target).toEqual(before.target);
    expect(state.rendered.theme).toEqual(before.theme);
    expect(state.rendered.elements[0]).toEqual(before.elements[0]);
  });

  it('is clean again once the edit is written', () => {
    const edited = editDraft(
      openDraft('desk', validLayout(), OPTIONS),
      setElementRectField(1, 'w', 180),
    );
    const saved = draftSaved(edited, edited.rendered);

    expect(isDirty(saved)).toBe(false);
    expect(canSave(saved)).toBe(false);
  });
});

describe('editDraft — an edit that does not', () => {
  /**
   * Each case is a field an ordinary control writes, invalidated the way an ordinary author would
   * invalidate it: a zero width, a cleared number, an emptied string, a token value with a semicolon,
   * a topic that is not one. None of them needs a document shape only a test could build, which is the
   * point of the draft being a typed `Layout` — see `layout-edits.ts`.
   */
  it('refuses a zero width and names the element and the field', () => {
    const state = editDraft(
      openDraft('desk', validLayout(), OPTIONS),
      setElementRectField(1, 'w', 0),
    );

    expect(state.issues.length).toBeGreaterThan(0);
    expect(canSave(state)).toBe(false);
    expect(state.issues.some((issue) => issue.elementIndex === 1)).toBe(true);
    expect(formatLayoutIssues(state.issues)).toContain('elements[1].rect.w');
  });

  it('refuses a cleared numeric field rather than substituting a number nobody typed', () => {
    const state = editDraft(
      openDraft('desk', validLayout(), OPTIONS),
      setElementRectField(1, 'h', numberFromInput('')),
    );

    expect(state.issues.length).toBeGreaterThan(0);
    expect(formatLayoutIssues(state.issues)).toContain('elements[1].rect.h');
  });

  it('refuses an emptied text element', () => {
    const state = editDraft(openDraft('desk', validLayout(), OPTIONS), setElementText(0, ''));

    expect(state.issues.length).toBeGreaterThan(0);
    expect(state.issues.some((issue) => issue.elementIndex === 0)).toBe(true);
  });

  it('refuses a theme token value that would smuggle a second declaration', () => {
    const state = editDraft(
      openDraft('desk', validLayout(), OPTIONS),
      setThemeToken('--perch-fg', 'red; display: none'),
    );

    expect(state.issues.length).toBeGreaterThan(0);
    expect(formatLayoutIssues(state.issues)).toContain('theme');
  });

  it('refuses a topic the runtime could not subscribe to', () => {
    const state = editDraft(
      openDraft('desk', validLayout(), OPTIONS),
      setElementTopic(1, 'not a topic'),
    );

    expect(state.issues.length).toBeGreaterThan(0);
    expect(state.issues.some((issue) => issue.elementIndex === 1)).toBe(true);
  });

  it('holds the preview on the last document that validated', () => {
    const valid = editDraft(
      openDraft('desk', validLayout(), OPTIONS),
      setElementRectField(1, 'w', 180),
    );
    const invalid = editDraft(valid, setElementRectField(1, 'w', 0));

    // The draft carries what was typed, so the control still shows the author their own `0` …
    expect(invalid.draft.elements[1]?.rect.w).toBe(0);
    // … while the canvas keeps painting the last document the runtime would have accepted.
    expect(invalid.rendered).toBe(valid.rendered);
  });

  it('recovers when the field is fixed, without reopening the document', () => {
    const invalid = editDraft(
      openDraft('desk', validLayout(), OPTIONS),
      setElementRectField(1, 'w', 0),
    );
    const fixed = editDraft(invalid, setElementRectField(1, 'w', 210));

    expect(fixed.issues).toEqual([]);
    expect(canSave(fixed)).toBe(true);
    expect(fixed.rendered.elements[1]?.rect.w).toBe(210);
  });
});

describe('opening a document that has been migrated', () => {
  /**
   * Both shipped layouts are `schemaVersion` 1 and a save writes 2. The migration rewrites no other
   * field, but the version line moves and it is the editor that moves it, so the report is carried on
   * the draft for the header to print before the author saves.
   */
  const v1 = JSON.stringify({ ...validLayout(), schemaVersion: 1 });

  it('carries the migration report onto the draft', () => {
    const loaded = loadLayoutJson(v1, OPTIONS);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const state = openDraft('desk', loaded.layout, OPTIONS, loaded.migrations);

    expect(loaded.migrations.length).toBeGreaterThan(0);
    expect(state.migrations).not.toBe('');
    expect(state.draft.schemaVersion).toBe(LAYOUT_SCHEMA_VERSION);
  });

  it('drops the report once the migrated document is on disk', () => {
    const loaded = loadLayoutJson(v1, OPTIONS);
    if (!loaded.ok) return;

    const state = openDraft('desk', loaded.layout, OPTIONS, loaded.migrations);

    expect(draftSaved(state, state.rendered).migrations).toBe('');
  });
});
