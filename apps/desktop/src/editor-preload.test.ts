/**
 * The editor window's preload, run as a sandboxed renderer runs it: a CommonJS script whose `require`
 * knows only `electron`. The same harness as `runtime-preload.test.ts`, for the same two reasons.
 */

import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { EDITOR_BRIDGE_GLOBAL, EDITOR_CHANNELS } from './editor-channels.js';

type Listener = (event: unknown, ...args: unknown[]) => void;

interface Loaded {
  readonly exposed: Map<string, unknown>;
  readonly invoked: unknown[][];
  readonly sent: unknown[][];
  readonly listeners: Map<string, Set<Listener>>;
  readonly required: string[];
}

async function loadPreload(): Promise<Loaded> {
  const source = await readFile(new URL('./editor-preload.cts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  const exposed = new Map<string, unknown>();
  const invoked: unknown[][] = [];
  const sent: unknown[][] = [];
  const listeners = new Map<string, Set<Listener>>();
  const required: string[] = [];

  const electron = {
    contextBridge: {
      exposeInMainWorld: (key: string, api: unknown) => exposed.set(key, api),
    },
    ipcRenderer: {
      invoke: (...args: unknown[]) => {
        invoked.push(args);
        return Promise.resolve(null);
      },
      send: (...args: unknown[]) => {
        sent.push(args);
      },
      on: (channel: string, listener: Listener) => {
        const set = listeners.get(channel) ?? new Set<Listener>();
        set.add(listener);
        listeners.set(channel, set);
      },
      removeListener: (channel: string, listener: Listener) => {
        listeners.get(channel)?.delete(listener);
      },
    },
  };

  const module = { exports: {} };
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (id: string) => {
      required.push(id);
      if (id !== 'electron') throw new Error(`a sandboxed preload cannot require ${id}`);
      return electron;
    },
  });

  return { exposed, invoked, sent, listeners, required };
}

type Api = Record<string, (...args: unknown[]) => unknown>;

async function bridge(): Promise<{ loaded: Loaded; api: Api }> {
  const loaded = await loadPreload();
  return { loaded, api: loaded.exposed.get(EDITOR_BRIDGE_GLOBAL) as Api };
}

function call(api: Api, name: string, ...args: unknown[]): unknown {
  const fn = api[name];
  if (fn === undefined) throw new Error(`no ${name}`);
  return fn(...args);
}

describe('the editor preload', () => {
  it('requires only electron, and exposes one global of its own', async () => {
    const { loaded, api } = await bridge();

    expect(loaded.required).toEqual(['electron']);
    expect(EDITOR_BRIDGE_GLOBAL).toBe('perchEditorHost');
    expect([...loaded.exposed.keys()]).toEqual([EDITOR_BRIDGE_GLOBAL]);
    expect(Object.keys(api).sort()).toEqual([
      'load',
      'nativeEdit',
      'onCommand',
      'onDocuments',
      'onSaveRequest',
      'open',
      'save',
      'saveAs',
      'saveDone',
      'setDocumentState',
      'setMenuBindings',
    ]);
  });

  it('asks the main process on its channels, passing on exactly what it was given', async () => {
    const { loaded, api } = await bridge();

    await call(api, 'load', 'ignored');
    await call(api, 'open');
    await call(api, 'saveAs', 'desk', 'extra');
    await call(api, 'save', '/__perch/layout/desk', '{}', 'extra');

    expect(loaded.invoked).toEqual([
      [EDITOR_CHANNELS.load],
      [EDITOR_CHANNELS.open],
      [EDITOR_CHANNELS.saveAs, 'desk'],
      [EDITOR_CHANNELS.save, '/__perch/layout/desk', '{}'],
    ]);
  });

  it('tells the main process what it reports, one way', async () => {
    const { loaded, api } = await bridge();

    call(api, 'setDocumentState', { name: 'desk', dirty: true });
    call(api, 'setMenuBindings', { 'document.save': ['Mod+S'] });
    call(api, 'nativeEdit', 'undo');
    call(api, 'saveDone', 3, true);

    expect(loaded.sent).toEqual([
      [EDITOR_CHANNELS.documentState, { name: 'desk', dirty: true }],
      [EDITOR_CHANNELS.menuBindings, { 'document.save': ['Mod+S'] }],
      [EDITOR_CHANNELS.nativeEdit, 'undo'],
      [EDITOR_CHANNELS.saveDone, 3, true],
    ]);
  });

  it('hands each listener its payload only, never the IPC event, and can unsubscribe', async () => {
    const { loaded, api } = await bridge();
    const seen: unknown[][] = [];

    const stops = [
      call(api, 'onDocuments', (...args: unknown[]) => seen.push(['documents', ...args])),
      call(api, 'onCommand', (...args: unknown[]) => seen.push(['command', ...args])),
      call(api, 'onSaveRequest', (...args: unknown[]) => seen.push(['save', ...args])),
    ] as (() => void)[];
    const fire = (channel: string, payload: unknown) => {
      for (const listener of loaded.listeners.get(channel) ?? []) {
        listener({ sender: 'the ipc event' }, payload, 'extra');
      }
    };
    fire(EDITOR_CHANNELS.documents, [{ name: 'desk' }]);
    fire(EDITOR_CHANNELS.command, 'document.save');
    fire(EDITOR_CHANNELS.saveRequest, 4);

    expect(seen).toEqual([
      ['documents', [{ name: 'desk' }]],
      ['command', 'document.save'],
      ['save', 4],
    ]);

    for (const stop of stops) stop();
    for (const channel of [
      EDITOR_CHANNELS.documents,
      EDITOR_CHANNELS.command,
      EDITOR_CHANNELS.saveRequest,
    ]) {
      expect(loaded.listeners.get(channel)?.size, channel).toBe(0);
    }
  });
});
