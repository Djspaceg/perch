/**
 * The save path, and the one thing it must never do.
 *
 * The central assertion here is negative: an invalid draft produces **no request at all**. Not a
 * request the server rejects — no HTTP. That is what "validate before saving" has to mean in a design
 * where the server's own checks are deliberately shallow (see `vite.config.ts`), and a negative
 * property is only ever confirmed by a transport that records what it was asked to do.
 *
 * The positive case is a round trip: what the transport received is fed back through `loadLayoutJson`
 * with the same options the runtime uses, so "the editor wrote a valid layout" is checked by the
 * validator the runtime will check it with rather than by comparing it to itself.
 */

import {
  LAYOUT_SCHEMA_VERSION,
  loadLayoutJson,
  type Layout,
  type ValidateLayoutOptions,
} from '@perch/layout-schema';
import { normalizeSensorTopic } from '@perch/sensor-contract';
import { WIDGET_REGISTRY } from '@perch/ui-kit';
import { describe, expect, it } from 'vitest';
import { editDraft, openDraft } from './draft.js';
import { setElementRectField, setElementText } from './layout-edits.js';
import { SAVE_ENDPOINT_PREFIX, saveDraft, serializeLayout, type SaveTransport } from './save.js';

const OPTIONS: ValidateLayoutOptions = Object.freeze({
  widgets: WIDGET_REGISTRY,
  isTopic: (topic: string) => normalizeSensorTopic(topic) !== null,
});

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

/** A transport that records every request instead of making one. */
function recordingTransport(
  reply: { readonly ok: boolean; readonly status: number; readonly body: string } = {
    ok: true,
    status: 204,
    body: '',
  },
): { readonly calls: { url: string; body: string }[]; readonly transport: SaveTransport } {
  const calls: { url: string; body: string }[] = [];

  return {
    calls,
    transport: (url, init) => {
      calls.push({ url, body: init.body });

      return Promise.resolve({
        ok: reply.ok,
        status: reply.status,
        text: () => Promise.resolve(reply.body),
      });
    },
  };
}

describe('saveDraft — an invalid draft', () => {
  it('makes no request at all', async () => {
    const { calls, transport } = recordingTransport();
    const state = editDraft(
      openDraft('desk', validLayout(), OPTIONS),
      setElementRectField(1, 'w', 0),
    );

    const outcome = await saveDraft(state, transport);

    expect(outcome.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('refuses with the problems in the reason, so the author sees what to fix', async () => {
    const { transport } = recordingTransport();
    const state = editDraft(openDraft('desk', validLayout(), OPTIONS), setElementText(0, ''));

    const outcome = await saveDraft(state, transport);

    expect(outcome.ok ? '' : outcome.reason).toContain('elements[0]');
  });

  it('makes no request for a name that is not a legal target either', async () => {
    const { calls, transport } = recordingTransport();
    const state = openDraft('invalid/broken-desk', validLayout(), OPTIONS);

    const outcome = await saveDraft(state, transport);

    expect(outcome.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('saveDraft — a valid draft', () => {
  it('writes the document the preview painted, and reports the path', async () => {
    const { calls, transport } = recordingTransport();
    const state = editDraft(
      openDraft('desk', validLayout(), OPTIONS),
      setElementRectField(1, 'w', 180),
    );

    const outcome = await saveDraft(state, transport);

    expect(outcome).toEqual({ ok: true, written: state.rendered, path: 'layouts/desk.json' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${SAVE_ENDPOINT_PREFIX}desk`);
  });

  it("sends a body the runtime's own loader accepts", async () => {
    const { calls, transport } = recordingTransport();
    const state = editDraft(
      openDraft('desk', validLayout(), OPTIONS),
      setElementRectField(1, 'w', 180),
    );

    await saveDraft(state, transport);
    const loaded = loadLayoutJson(calls[0]?.body ?? '', OPTIONS);

    expect(loaded.ok).toBe(true);
    expect(loaded.ok ? loaded.layout : null).toEqual(state.rendered);
  });

  it("reports the server's own sentence when the write is refused", async () => {
    const { transport } = recordingTransport({
      ok: false,
      status: 404,
      body: 'layouts/desk.json does not exist',
    });
    const state = editDraft(
      openDraft('desk', validLayout(), OPTIONS),
      setElementRectField(1, 'w', 180),
    );

    const outcome = await saveDraft(state, transport);

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? '' : outcome.reason).toContain('404');
    expect(outcome.ok ? '' : outcome.reason).toContain('layouts/desk.json does not exist');
  });
});

describe('serializeLayout', () => {
  it('writes two-space JSON with a trailing newline, matching the files in layouts/', () => {
    const text = serializeLayout(validLayout());

    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "schemaVersion": 2');
  });

  it('round-trips through the loader unchanged', () => {
    const layout = validLayout();
    const loaded = loadLayoutJson(serializeLayout(layout), OPTIONS);

    expect(loaded.ok ? loaded.layout : null).toEqual(layout);
  });
});
