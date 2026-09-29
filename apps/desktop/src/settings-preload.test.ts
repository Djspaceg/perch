/**
 * The Settings window's preload, run as a sandboxed renderer runs it: a CommonJS script whose
 * `require` knows only `electron`. The same harness as `editor-preload.test.ts`.
 */

import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { SETTINGS_BRIDGE_GLOBAL, SETTINGS_CHANNELS } from './settings-channels.js';

async function loadPreload(): Promise<{
  exposed: Map<string, unknown>;
  invoked: unknown[][];
  required: string[];
}> {
  const source = await readFile(new URL('./settings-preload.cts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  const exposed = new Map<string, unknown>();
  const invoked: unknown[][] = [];
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

  return { exposed, invoked, required };
}

describe('the Settings preload', () => {
  it('requires only electron, and exposes one global of its own with one method', async () => {
    const loaded = await loadPreload();
    const api = loaded.exposed.get(SETTINGS_BRIDGE_GLOBAL) as Record<string, unknown>;

    expect(loaded.required).toEqual(['electron']);
    expect(SETTINGS_BRIDGE_GLOBAL).toBe('perchSettingsHost');
    expect([...loaded.exposed.keys()]).toEqual([SETTINGS_BRIDGE_GLOBAL]);
    expect(Object.keys(api)).toEqual(['load']);
  });

  it('asks the main process on its channel, and passes nothing the page gives it', async () => {
    const loaded = await loadPreload();
    const api = loaded.exposed.get(SETTINGS_BRIDGE_GLOBAL) as { load(...args: unknown[]): unknown };

    await api.load('ignored');

    expect(SETTINGS_CHANNELS.load).toBe('perch:settings:load');
    expect(loaded.invoked).toEqual([[SETTINGS_CHANNELS.load]]);
  });
});
