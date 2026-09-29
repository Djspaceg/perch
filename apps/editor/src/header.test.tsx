/**
 * The header in its two homes. In a browser (`npm run dev`, no host) it is the whole toolbar it has
 * always been: the layout picker, the connection control, undo, redo and save. In the desktop app's
 * editor window (a host) those live in the menu bar and the Settings window, and the header keeps a
 * connection indicator that opens Settings. The host is the seam that decides, as it already does
 * for New, Open and Save As.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import type { SensorSource, SensorSourceStatus } from '@perch/sensor-contract';
import { createMockSource, type RelayLhmRequest, type RelayLhmStatus } from '@perch/sensor-sources';
import { act, fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Editor } from './app.js';
import type { RelayLink } from './connection-control.js';
import type { EditorHost, HostMenuState } from './editor-host.js';
import { createLayoutLibrary, type LayoutLibraryEntry } from './layout-library.js';
import type { SaveTransport } from './save.js';

function layoutText(width: number): string {
  const layout: Layout = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    target: { width, height: 200, frameRate: 30 },
    theme: {},
    elements: [{ kind: 'text', text: 'x', rect: { x: 10, y: 10, w: 200, h: 30 } }],
  };
  return JSON.stringify(layout);
}

const library = createLayoutLibrary({
  layouts: { 'desk-test': layoutText(640), 'tower-test': layoutText(200) },
});

const transport: SaveTransport = () =>
  Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });

function recordingHost(): {
  host: EditorHost;
  calls: unknown[][];
  menuStates: () => HostMenuState[];
  openDocument(entry: LayoutLibraryEntry): void;
} {
  const calls: unknown[][] = [];
  const openListeners = new Set<(entry: LayoutLibraryEntry) => void>();
  const host: EditorHost = {
    saveAs: () => Promise.resolve(null),
    open: () => Promise.resolve(null),
    setDocumentState: (state) => calls.push(['state', state]),
    setMenuBindings: (bindings) => calls.push(['bindings', bindings]),
    onCommand: () => () => undefined,
    onSaveRequest: () => () => undefined,
    saveDone: () => undefined,
    nativeEdit: () => undefined,
    setMenuState: (state) => calls.push(['menuState', state]),
    openSettings: () => calls.push(['openSettings']),
    onOpenDocument: (listener) => {
      openListeners.add(listener);
      return () => openListeners.delete(listener);
    },
  };
  return {
    host,
    calls,
    menuStates: () =>
      calls.filter((call) => call[0] === 'menuState').map((call) => call[1] as HostMenuState),
    openDocument: (entry) => {
      act(() => {
        for (const listener of openListeners) listener(entry);
      });
    },
  };
}

/** A relay the test drives by hand: its link, its retained status and the live source's status. */
function fakeRelay(): RelayLink & {
  requests: RelayLhmRequest[];
  set(next: {
    link?: 'opening' | 'up' | 'down';
    status?: RelayLhmStatus;
    source?: SensorSourceStatus;
  }): void;
} {
  const listeners = new Set<() => void>();
  const requests: RelayLhmRequest[] = [];
  let link: 'opening' | 'up' | 'down' = 'opening';
  let status: RelayLhmStatus | undefined;
  let sourceStatus: SensorSourceStatus = 'connecting';
  const source: SensorSource = {
    subscribe: () => () => undefined,
    meta: () => undefined,
    get status() {
      return sourceStatus;
    },
  };

  return {
    url: 'ws://127.0.0.1:53123',
    source,
    requests,
    control: {
      get link() {
        return link;
      },
      get status() {
        return status;
      },
      request: (target) => {
        requests.push(target);
      },
      onChange: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    set(next) {
      if (next.link !== undefined) link = next.link;
      if (next.status !== undefined) status = next.status;
      if (next.source !== undefined) sourceStatus = next.source;
      act(() => {
        for (const listener of listeners) listener();
      });
    },
  };
}

function renderEditor(options: { host?: EditorHost; relay?: RelayLink } = {}) {
  const mock = createMockSource({ autoStart: false, seed: 1 });
  return render(
    <Editor
      library={library}
      source={mock}
      topics={mock.topics}
      transport={transport}
      relay={options.relay}
      host={options.host}
      initialLayout="desk-test"
      platform="mac"
    />,
  );
}

type Result = ReturnType<typeof renderEditor>;

const header = (result: Result) => within(result.getByTestId('perch-editor-header'));

function makeDirty(result: Result): void {
  const list = within(result.getByTestId('perch-editor-elements')).getAllByRole('button');
  if (list[0] === undefined) throw new Error('no element');
  fireEvent.click(list[0]);
  fireEvent.change(result.getByLabelText('w'), { target: { value: '150' } });
}

describe('the header in a browser, with no host', () => {
  it('keeps the picker, the connection control, undo, redo and save', () => {
    const result = renderEditor();

    expect(header(result).getByLabelText('layout')).toBeDefined();
    expect(result.getByTestId('perch-editor-connection')).toBeDefined();
    expect(header(result).getByRole('button', { name: 'undo' })).toBeDefined();
    expect(header(result).getByRole('button', { name: 'redo' })).toBeDefined();
    expect(result.getByTestId('perch-editor-save')).toBeDefined();
    expect(result.queryByTestId('perch-editor-connection-indicator')).toBeNull();
  });

  it('leaves Mod+Comma to the browser', () => {
    renderEditor();

    expect(fireEvent.keyDown(document.body, { key: ',', metaKey: true })).toBe(true);
  });
});

describe('the header in the desktop app, with a host', () => {
  it('has no picker, connection control, undo, redo or save: the menu bar has them', () => {
    const result = renderEditor({ host: recordingHost().host });

    expect(header(result).queryByLabelText('layout')).toBeNull();
    expect(header(result).queryByRole('combobox')).toBeNull();
    expect(result.queryByTestId('perch-editor-connection')).toBeNull();
    expect(header(result).queryByRole('radio')).toBeNull();
    for (const name of ['undo', 'redo', 'save', 'save as', 'open', 'connect']) {
      expect(header(result).queryByRole('button', { name }), name).toBeNull();
    }
    expect(result.queryByTestId('perch-editor-save')).toBeNull();
  });

  it('keeps the fit, the sample-data badge, the unsaved mark and revert', () => {
    const result = renderEditor({ host: recordingHost().host });
    makeDirty(result);

    expect(result.getByTestId('perch-editor-fit')).toBeDefined();
    expect(result.getByTestId('perch-editor-source').getAttribute('data-perch-source-kind')).toBe(
      'mock',
    );
    expect(result.getByTestId('perch-editor-dirty')).toBeDefined();
    expect(header(result).getByRole('button', { name: 'revert' })).toBeEnabled();
  });

  it('shows the connection as a dot and a few words, and opens Settings when clicked', () => {
    const { host, calls } = recordingHost();
    const result = renderEditor({ host });
    const indicator = result.getByTestId('perch-editor-connection-indicator');

    expect(indicator.tagName).toBe('BUTTON');
    expect(indicator.getAttribute('data-perch-connection')).toBe('disconnected');
    expect(indicator.textContent).toBe('disconnected · localhost');
    expect(indicator.getAttribute('title')).toMatch(/no relay/);
    expect(indicator.querySelector('.perch-connection__dot')).not.toBeNull();

    fireEvent.click(indicator);
    expect(calls).toContainEqual(['openSettings']);
  });

  it('follows what the relay polls, wherever that was chosen, and asks the relay for nothing', () => {
    const relay = fakeRelay();
    const result = renderEditor({ host: recordingHost().host, relay });
    const indicator = () => result.getByTestId('perch-editor-connection-indicator');

    // The Settings window moved the relay to another machine: this window hears it on the relay's
    // retained status and says so, rather than waiting for the localhost it last knew.
    relay.set({
      link: 'up',
      status: { host: '192.168.1.3', port: 8085, state: 'ok' },
      source: 'live',
    });

    expect(indicator().getAttribute('data-perch-connection')).toBe('connected');
    expect(indicator().textContent).toBe('connected · 192.168.1.3:8085');
    expect(result.getByTestId('perch-editor-source').getAttribute('data-perch-source-kind')).toBe(
      'mqtt',
    );

    relay.set({
      status: { host: '192.168.1.3', port: 8085, state: 'failed', reason: 'EHOSTUNREACH' },
    });
    expect(indicator().textContent).toBe('disconnected · 192.168.1.3:8085');
    expect(indicator().getAttribute('title')).toContain('EHOSTUNREACH');
    expect(relay.requests).toEqual([]);
  });

  it('opens Settings on Mod+Comma, from inside a field too', () => {
    const { host, calls } = recordingHost();
    const result = renderEditor({ host });
    makeDirty(result);

    const pressed = fireEvent.keyDown(result.getByLabelText('w'), { key: ',', metaKey: true });

    expect(pressed).toBe(false);
    expect(calls.filter((call) => call[0] === 'openSettings')).toHaveLength(1);
  });

  it('tells the host what the menu may offer: Undo once there is a step, Save once it is unsaved', () => {
    const { host, menuStates } = recordingHost();
    const result = renderEditor({ host });

    expect(menuStates().at(-1)).toEqual({ undo: false, redo: false, save: false, saveAs: true });

    makeDirty(result);
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.focusOut(document.body);

    expect(menuStates().at(-1)).toEqual({ undo: true, redo: false, save: true, saveAs: true });
  });

  it("offers Undo while a text field has focus, where the menu's Undo is the field's", () => {
    const { host, menuStates } = recordingHost();
    const result = renderEditor({ host });
    const list = within(result.getByTestId('perch-editor-elements')).getAllByRole('button');
    if (list[0] === undefined) throw new Error('no element');
    fireEvent.click(list[0]);

    const field = result.getByLabelText('w');
    act(() => {
      field.focus();
    });

    expect(menuStates().at(-1)).toMatchObject({ undo: true, redo: true });
  });

  it('opens a document the menu picked, and parks it behind the bar over unsaved edits', () => {
    const recorded = recordingHost();
    const result = renderEditor({ host: recorded.host });
    const name = () =>
      result.container.querySelector('#perch-editor')?.getAttribute('data-perch-layout');
    const tower: LayoutLibraryEntry = {
      name: 'tower-test',
      text: layoutText(200),
      offered: true,
      path: '/l/tower-test.json',
    };

    recorded.openDocument(tower);
    expect(name()).toBe('tower-test');

    makeDirty(result);
    recorded.openDocument({ ...tower, name: 'desk-test', text: layoutText(640) });
    expect(name()).toBe('tower-test');
    fireEvent.click(result.getByRole('button', { name: 'discard and open desk-test' }));
    expect(name()).toBe('desk-test');
  });
});
