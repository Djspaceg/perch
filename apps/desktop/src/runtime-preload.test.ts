/**
 * The preload, run the way a sandboxed renderer runs it: as a CommonJS script whose `require`
 * knows exactly one module, `electron`.
 *
 * It is transpiled here from source and evaluated in a fresh context rather than imported, for
 * two reasons. Importing it would need a real `electron`, which exists only inside the Electron
 * binary. And the sandbox's constraint — no relative `require`, no Node built-ins — is the thing
 * most worth pinning: a `require` of anything else here throws, exactly as it would in the window.
 */

import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  DESKTOP_BRIDGE_GLOBAL,
  RUNNER_DOCUMENT_CHANNEL,
  RUNNER_LOAD_CHANNEL,
} from './runner-channels.js';

type Listener = (event: unknown, ...args: unknown[]) => void;

interface Loaded {
  readonly exposed: Map<string, unknown>;
  readonly invoked: unknown[][];
  readonly listeners: Map<string, Set<Listener>>;
  readonly required: string[];
}

async function loadPreload(): Promise<Loaded> {
  const source = await readFile(new URL('./runtime-preload.cts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  const exposed = new Map<string, unknown>();
  const invoked: unknown[][] = [];
  const listeners = new Map<string, Set<Listener>>();
  const required: string[] = [];

  const electron = {
    contextBridge: {
      exposeInMainWorld: (key: string, api: unknown) => exposed.set(key, api),
    },
    ipcRenderer: {
      invoke: (...args: unknown[]) => {
        invoked.push(args);
        return Promise.resolve({ brokerUrl: 'ws://127.0.0.1:1', document: null });
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

  return { exposed, invoked, listeners, required };
}

interface Bridge {
  load(): Promise<unknown>;
  onDocument(listener: (document: unknown) => void): () => void;
}

async function bridge(): Promise<{ loaded: Loaded; api: Bridge }> {
  const loaded = await loadPreload();
  return { loaded, api: loaded.exposed.get(DESKTOP_BRIDGE_GLOBAL) as Bridge };
}

describe('the runtime preload', () => {
  it('requires only electron', async () => {
    expect((await loadPreload()).required).toEqual(['electron']);
  });

  it('exposes one global, holding exactly load and onDocument', async () => {
    const { loaded, api } = await bridge();

    expect([...loaded.exposed.keys()]).toEqual([DESKTOP_BRIDGE_GLOBAL]);
    expect(Object.keys(api).sort()).toEqual(['load', 'onDocument']);
    expect(typeof api.load).toBe('function');
    expect(typeof api.onDocument).toBe('function');
  });

  it('load asks the main process on the load channel, passing nothing from the page', async () => {
    const { loaded, api } = await bridge();

    await api.load();

    expect(loaded.invoked).toEqual([[RUNNER_LOAD_CHANNEL]]);
  });

  it('onDocument hands the page the document only, never the IPC event', async () => {
    const { loaded, api } = await bridge();
    const seen: unknown[][] = [];

    api.onDocument((...args: unknown[]) => seen.push(args));
    const [listener] = loaded.listeners.get(RUNNER_DOCUMENT_CHANNEL) ?? [];
    listener?.({ sender: 'the ipc event' }, { name: 'desk' }, 'extra');

    expect(seen).toEqual([[{ name: 'desk' }]]);
  });

  it('onDocument returns a function that removes the listener', async () => {
    const { loaded, api } = await bridge();

    const stop = api.onDocument(() => undefined);
    expect(loaded.listeners.get(RUNNER_DOCUMENT_CHANNEL)?.size).toBe(1);
    stop();

    expect(loaded.listeners.get(RUNNER_DOCUMENT_CHANNEL)?.size).toBe(0);
  });
});
