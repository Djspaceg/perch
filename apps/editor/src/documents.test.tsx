/**
 * Documents, IDE-style: New, Open, Save and Save As, the dirty state the host is told, and the menu's
 * commands reaching the registry. Through the rendered editor with a recording `EditorHost`, the seam
 * the desktop's preload fills, and a recording transport, the seam every save already goes through.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import { createMockSource } from '@perch/sensor-sources';
import { act, fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Editor } from './app.js';
import type { EditorHost } from './editor-host.js';
import { createLayoutLibrary, type LayoutLibraryEntry } from './layout-library.js';
import type { SaveTransport } from './save.js';

function layoutText(width: number, text: string): string {
  const layout: Layout = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    target: { width, height: 200, frameRate: 30 },
    theme: { '--perch-fg': '#e8f1ff' },
    elements: [{ kind: 'text', text, rect: { x: 10, y: 10, w: 200, h: 30 } }],
  };
  return JSON.stringify(layout);
}

const library = createLayoutLibrary({
  layouts: { 'desk-test': layoutText(640, 'desk'), 'tower-test': layoutText(200, 'tower') },
});

interface Recorded {
  readonly calls: unknown[][];
  readonly writes: { url: string; body: string }[];
  command(id: string): void;
  saveRequest(id: number): void;
}

function recordingHost(
  answers: {
    saveAs?: { name: string; path: string } | null;
    open?: LayoutLibraryEntry | null;
  } = {},
): { host: EditorHost; recorded: Recorded; transport: SaveTransport } {
  const calls: unknown[][] = [];
  const writes: { url: string; body: string }[] = [];
  const commandListeners = new Set<(id: string) => void>();
  const saveListeners = new Set<(id: number) => void>();

  const host: EditorHost = {
    saveAs: (suggested) => {
      calls.push(['saveAs', suggested]);
      return Promise.resolve(answers.saveAs ?? null);
    },
    open: () => {
      calls.push(['open']);
      return Promise.resolve(answers.open ?? null);
    },
    setDocumentState: (state) => calls.push(['state', state]),
    setMenuBindings: (bindings) => calls.push(['bindings', bindings]),
    onCommand: (listener) => {
      commandListeners.add(listener);
      return () => commandListeners.delete(listener);
    },
    onSaveRequest: (listener) => {
      saveListeners.add(listener);
      return () => saveListeners.delete(listener);
    },
    saveDone: (id, saved) => calls.push(['saveDone', id, saved]),
    nativeEdit: (which) => calls.push(['nativeEdit', which]),
    setMenuState: (state) => calls.push(['menuState', state]),
    openSettings: () => calls.push(['openSettings']),
    onOpenDocument: () => () => undefined,
  };

  const transport: SaveTransport = (url, init) => {
    writes.push({ url, body: init.body });
    return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });
  };

  return {
    host,
    transport,
    recorded: {
      calls,
      writes,
      command: (id) => {
        act(() => {
          for (const listener of commandListeners) listener(id);
        });
      },
      saveRequest: (id) => {
        act(() => {
          for (const listener of saveListeners) listener(id);
        });
      },
    },
  };
}

function renderEditor(host?: EditorHost, transport?: SaveTransport) {
  const source = createMockSource({ autoStart: false, seed: 1 });
  const fallback: SaveTransport = () =>
    Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });

  return render(
    <Editor
      library={library}
      source={source}
      topics={source.topics}
      transport={transport ?? fallback}
      host={host}
      initialLayout="desk-test"
      platform="mac"
    />,
  );
}

type Result = ReturnType<typeof renderEditor>;

function selectElement(result: Result, index: number): void {
  const list = within(result.getByTestId('perch-editor-elements')).getAllByRole('button');
  const button = list[index];
  if (button === undefined) throw new Error(`no element ${index}`);
  fireEvent.click(button);
}

function makeDirty(result: Result): void {
  selectElement(result, 0);
  fireEvent.change(result.getByLabelText('w'), { target: { value: '150' } });
}

function canvasWidth(result: Result): string | null {
  return (
    result
      .getByTestId('perch-editor-preview')
      .querySelector('[data-testid="perch-canvas"]')
      ?.getAttribute('data-perch-canvas-width') ?? null
  );
}

function openName(result: Result): string | null {
  return result.container.querySelector('#perch-editor')?.getAttribute('data-perch-layout') ?? null;
}

const states = (recorded: Recorded) => recorded.calls.filter((call) => call[0] === 'state');

describe('Save, from the keyboard and the menu', () => {
  it('Mod+S saves the open document through the transport, even from inside a field', async () => {
    const { host, transport, recorded } = recordingHost();
    const result = renderEditor(host, transport);
    makeDirty(result);

    fireEvent.keyDown(result.getByLabelText('w'), { key: 's', metaKey: true });

    await result.findByText(/^saved /);
    expect(recorded.writes).toEqual([
      { url: '/__perch/layout/desk-test', body: expect.stringContaining('"w": 150') as string },
    ]);
  });

  it('works in the browser too, where there is no host', async () => {
    const writes: string[] = [];
    const result = renderEditor(undefined, (url) => {
      writes.push(url);
      return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });
    });
    makeDirty(result);

    fireEvent.keyDown(document.body, { key: 's', metaKey: true });

    await result.findByText('saved layouts/desk-test.json');
    expect(writes).toEqual(['/__perch/layout/desk-test']);
  });

  it('leaves Mod+N, Mod+O and Mod+Shift+S to the browser when there is no host', () => {
    renderEditor();

    for (const press of [
      { key: 'n', metaKey: true },
      { key: 'o', metaKey: true },
      { key: 'S', metaKey: true, shiftKey: true },
    ]) {
      expect(fireEvent.keyDown(document.body, press), JSON.stringify(press)).toBe(true);
    }
  });

  it('runs a menu command through the registry', async () => {
    const { host, transport, recorded } = recordingHost();
    const result = renderEditor(host, transport);
    makeDirty(result);

    recorded.command('document.save');

    await result.findByText(/^saved /);
    expect(recorded.writes).toHaveLength(1);
  });

  it('tells the host the menu bindings in effect, once mounted', () => {
    const { host, recorded } = recordingHost();
    renderEditor(host);

    const [bindings] = recorded.calls.filter((call) => call[0] === 'bindings');
    expect(bindings?.[1]).toMatchObject({
      'document.new': ['Mod+N'],
      'document.save': ['Mod+S'],
      'history.undo': ['Mod+Z'],
    });
  });
});

describe('the dirty state', () => {
  it('is told to the host as it changes, and clean again after a save', async () => {
    const { host, transport, recorded } = recordingHost();
    const result = renderEditor(host, transport);

    expect(states(recorded).at(-1)).toEqual(['state', { name: 'desk-test', dirty: false }]);
    makeDirty(result);
    expect(states(recorded).at(-1)).toEqual(['state', { name: 'desk-test', dirty: true }]);

    recorded.command('document.save');
    await result.findByText(/^saved /);
    expect(states(recorded).at(-1)).toEqual(['state', { name: 'desk-test', dirty: false }]);
  });

  it('answers a save request from the host, for a close with unsaved changes', async () => {
    const { host, transport, recorded } = recordingHost();
    const result = renderEditor(host, transport);
    makeDirty(result);

    recorded.saveRequest(7);

    await result.findByText(/^saved /);
    expect(recorded.calls).toContainEqual(['saveDone', 7, true]);
  });

  it('answers a save request it had to refuse with false, and writes nothing', async () => {
    const { host, transport, recorded } = recordingHost();
    const result = renderEditor(host, transport);
    selectElement(result, 0);
    fireEvent.change(result.getByLabelText('w'), { target: { value: '-5' } });

    recorded.saveRequest(8);

    await result.findByText(/refusing to save/);
    expect(recorded.calls).toContainEqual(['saveDone', 8, false]);
    expect(recorded.writes).toEqual([]);
  });
});

describe('New', () => {
  it("opens a blank untitled canvas at the open document's size, clean", () => {
    const { host, recorded } = recordingHost();
    const result = renderEditor(host);

    recorded.command('document.new');

    expect(openName(result)).toBe('untitled');
    expect(canvasWidth(result)).toBe('640');
    expect(within(result.getByTestId('perch-editor-elements')).queryAllByRole('button')).toEqual(
      [],
    );
    expect(states(recorded).at(-1)).toEqual(['state', { name: 'untitled', dirty: false }]);
  });

  it('parks behind the unsaved-changes bar when the open document is dirty', () => {
    const { host, recorded } = recordingHost();
    const result = renderEditor(host);
    makeDirty(result);

    recorded.command('document.new');

    expect(openName(result)).toBe('desk-test');
    fireEvent.click(result.getByRole('button', { name: 'discard and open untitled' }));
    expect(openName(result)).toBe('untitled');
  });
});

describe('Save As', () => {
  it('asks where, then writes under the name the host registered, clean, history kept', async () => {
    const { host, transport, recorded } = recordingHost({
      saveAs: { name: 'desk-copy', path: '/l/desk-copy.json' },
    });
    const result = renderEditor(host, transport);
    makeDirty(result);

    recorded.command('document.saveAs');

    await result.findByText('saved /l/desk-copy.json');
    expect(recorded.calls).toContainEqual(['saveAs', 'desk-test']);
    expect(recorded.writes.map((write) => write.url)).toEqual(['/__perch/layout/desk-copy']);
    expect(openName(result)).toBe('desk-copy');
    expect(result.queryByTestId('perch-editor-dirty')).toBeNull();
    // The history is kept: the host's menu still offers Undo.
    const menu = recorded.calls.filter((call) => call[0] === 'menuState').at(-1);
    expect(menu?.[1]).toMatchObject({ undo: true });
  });

  it('writes nothing when the dialog is cancelled, and the edits stay unsaved', async () => {
    const { host, transport, recorded } = recordingHost({ saveAs: null });
    const result = renderEditor(host, transport);
    makeDirty(result);

    recorded.command('document.saveAs');
    await act(async () => {
      await Promise.resolve();
    });

    expect(recorded.writes).toEqual([]);
    expect(result.getByTestId('perch-editor-dirty')).toBeDefined();
    expect(openName(result)).toBe('desk-test');
  });

  it('refuses an invalid document before it asks where', async () => {
    const { host, transport, recorded } = recordingHost({
      saveAs: { name: 'x', path: '/l/x.json' },
    });
    const result = renderEditor(host, transport);
    selectElement(result, 0);
    fireEvent.change(result.getByLabelText('w'), { target: { value: '-5' } });

    recorded.command('document.saveAs');

    await result.findByText(/refusing to save/);
    expect(recorded.calls.filter((call) => call[0] === 'saveAs')).toEqual([]);
    expect(recorded.writes).toEqual([]);
  });

  it('is what Save does for an untitled document', async () => {
    const { host, transport, recorded } = recordingHost({
      saveAs: { name: 'fresh', path: '/l/fresh.json' },
    });
    const result = renderEditor(host, transport);

    recorded.command('document.new');
    recorded.command('document.save');

    await result.findByText('saved /l/fresh.json');
    expect(recorded.calls).toContainEqual(['saveAs', 'untitled']);
    expect(recorded.writes.map((write) => write.url)).toEqual(['/__perch/layout/fresh']);
    expect(JSON.parse(recorded.writes[0]?.body ?? '{}')).toMatchObject({ elements: [] });
  });
});

describe('Open', () => {
  const opened: LayoutLibraryEntry = {
    name: 'far-away',
    text: layoutText(300, 'far'),
    offered: true,
    path: '/elsewhere/far-away.json',
  };

  it('opens the document the host dialog chose', async () => {
    const { host, recorded } = recordingHost({ open: opened });
    const result = renderEditor(host);

    recorded.command('document.open');

    await act(async () => {
      await Promise.resolve();
    });
    expect(openName(result)).toBe('far-away');
    expect(canvasWidth(result)).toBe('300');
  });

  it('parks behind the unsaved-changes bar when the open document is dirty', async () => {
    const { host, recorded } = recordingHost({ open: opened });
    const result = renderEditor(host);
    makeDirty(result);

    recorded.command('document.open');

    fireEvent.click(await result.findByRole('button', { name: 'discard and open far-away' }));
    expect(openName(result)).toBe('far-away');
  });

  it('does nothing when the dialog is cancelled', async () => {
    const { host, recorded } = recordingHost({ open: null });
    const result = renderEditor(host);

    recorded.command('document.open');
    await act(async () => {
      await Promise.resolve();
    });

    expect(openName(result)).toBe('desk-test');
  });
});

describe('the menu Undo and Redo', () => {
  it('do the native text undo while a field has focus, leaving the document alone', () => {
    const { host, recorded } = recordingHost();
    const result = renderEditor(host);
    makeDirty(result);
    const field = result.getByLabelText('w');
    field.focus();

    recorded.command('history.undo');

    expect(recorded.calls).toContainEqual(['nativeEdit', 'undo']);
    expect(result.getByTestId('perch-editor-dirty')).toBeDefined();
  });

  it("run the editor's undo when no field has focus", () => {
    const { host, recorded } = recordingHost();
    const result = renderEditor(host);
    makeDirty(result);
    (document.activeElement as HTMLElement | null)?.blur();

    recorded.command('history.undo');

    expect(recorded.calls.filter((call) => call[0] === 'nativeEdit')).toEqual([]);
    expect(result.queryByTestId('perch-editor-dirty')).toBeNull();
  });
});
