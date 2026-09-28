import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENT_BYTES,
  SAVE_URL_PREFIX,
  createDocumentRegistry,
  documentKey,
  handleSaveRequest,
  withJsonExtension,
  writeLayoutDocument,
} from './editor-documents.js';

let root: string;
let folder: string;
let outside: string;

const LAYOUT = '{\n  "schemaVersion": 2,\n  "target": {},\n  "theme": {},\n  "elements": []\n}\n';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'perch-editor-documents-'));
  folder = join(root, 'layouts');
  outside = join(root, 'elsewhere');
  await mkdir(join(folder, 'desk.assets'), { recursive: true });
  await mkdir(outside);
  await writeFile(join(folder, 'desk.json'), LAYOUT);
  await writeFile(join(folder, 'tower.json'), LAYOUT);
  await writeFile(join(folder, '.hidden.json'), LAYOUT);
  await writeFile(join(folder, 'desk.assets', 'rails.svg'), '<svg/>');
  await writeFile(join(outside, 'desk.json'), LAYOUT);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('documentKey', () => {
  it('is the file name without .json, when that is a name the editor can save', () => {
    expect(documentKey('/l/desk-1920x400.json', new Map())).toBe('desk-1920x400');
  });

  it('makes any other file name into one', () => {
    expect(documentKey('/l/My Desk (v2).json', new Map())).toBe('My-Desk-v2');
    expect(documentKey('/l/.._x.json', new Map())).toBe('x');
    expect(documentKey('/l/%%%.json', new Map())).toBe('layout');
  });

  it('never gives one key to two paths', () => {
    const taken = new Map([
      ['desk', '/l/desk.json'],
      ['desk-2', '/m/desk.json'],
    ]);

    expect(documentKey('/l/desk.json', taken)).toBe('desk');
    expect(documentKey('/n/desk.json', taken)).toBe('desk-3');
  });
});

describe('withJsonExtension', () => {
  it('adds .json to a Save As name that has none', () => {
    expect(withJsonExtension('/l/new-desk')).toBe('/l/new-desk.json');
    expect(withJsonExtension('/l/new-desk.json')).toBe('/l/new-desk.json');
    expect(withJsonExtension('/l/NEW.JSON')).toBe('/l/NEW.JSON');
  });
});

describe('the document registry', () => {
  it("lists the folder's documents with their text and media, skipping dotfiles", async () => {
    const registry = createDocumentRegistry(folder);
    const entries = await registry.entries();

    expect(entries.map((entry) => entry.name)).toEqual(['desk', 'tower']);
    expect(entries[0]?.path).toBe(join(folder, 'desk.json'));
    expect(entries[0]?.text).toBe(LAYOUT);
    expect(entries[0]?.assets).toEqual({
      'desk.assets/rails.svg': 'app://editor-document/desk/desk.assets/rails.svg',
    });
  });

  it('adds a document opened from elsewhere under a key of its own, stable across listings', async () => {
    const registry = createDocumentRegistry(folder);
    await registry.entries();
    const key = registry.keyOf(join(outside, 'desk.json'));

    expect(key).toBe('desk-2');
    expect(registry.keyOf(join(outside, 'desk.json'))).toBe('desk-2');
    expect(registry.pathOf('desk-2')).toBe(join(outside, 'desk.json'));
    expect(registry.folderOf('desk-2')).toBe(outside);
    expect((await registry.entries()).map((entry) => entry.name)).toEqual([
      'desk',
      'tower',
      'desk-2',
    ]);
  });

  it('lists a Save As target only once it exists on disk', async () => {
    const registry = createDocumentRegistry(folder);
    const key = registry.keyOf(join(folder, 'fresh.json'));

    expect((await registry.entries()).map((entry) => entry.name)).not.toContain(key);
    await writeFile(join(folder, 'fresh.json'), LAYOUT);
    expect((await registry.entries()).map((entry) => entry.name)).toContain(key);
  });

  it('knows no path for a key it never gave out', () => {
    const registry = createDocumentRegistry(folder);

    expect(registry.pathOf('desk')).toBeUndefined();
    expect(registry.folderOf('nothing')).toBeNull();
  });
});

describe('writeLayoutDocument', () => {
  it('writes atomically: the whole text lands and no temporary file is left', async () => {
    const path = join(folder, 'desk.json');
    await writeLayoutDocument(path, '{"elements":[1]}\n');

    expect(await readFile(path, 'utf8')).toBe('{"elements":[1]}\n');
    expect((await readdir(folder)).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('creates a file that is not there yet, for Save As', async () => {
    const path = join(outside, 'copy.json');
    await writeLayoutDocument(path, LAYOUT);

    expect(await readFile(path, 'utf8')).toBe(LAYOUT);
  });

  it('refuses text that is not JSON, and writes nothing', async () => {
    const path = join(folder, 'desk.json');

    await expect(writeLayoutDocument(path, '{ "schemaVersion": 2 ')).rejects.toThrow(/not JSON/);
    expect(await readFile(path, 'utf8')).toBe(LAYOUT);
  });

  it('cleans up its temporary file when the rename fails', async () => {
    const path = join(folder, 'desk.assets');

    await expect(writeLayoutDocument(path, LAYOUT)).rejects.toThrow();
    expect((await readdir(folder)).filter((name) => name.includes('.tmp'))).toEqual([]);
  });
});

describe('handleSaveRequest', () => {
  const url = (name: string) => `${SAVE_URL_PREFIX}${encodeURIComponent(name)}`;

  it('writes a registered document, answering 204', async () => {
    const registry = createDocumentRegistry(folder);
    await registry.entries();

    const reply = await handleSaveRequest(registry, url('desk'), '{"saved":true}\n');

    expect(reply).toEqual({ ok: true, status: 204, text: '' });
    expect(await readFile(join(folder, 'desk.json'), 'utf8')).toBe('{"saved":true}\n');
  });

  it('refuses a name it never registered, creating nothing', async () => {
    const registry = createDocumentRegistry(folder);
    await registry.entries();

    const reply = await handleSaveRequest(registry, url('../../etc/passwd'), LAYOUT);

    expect(reply.ok).toBe(false);
    expect(reply.status).toBe(404);
    expect(reply.text).toContain('../../etc/passwd');
    expect(await readdir(folder)).toEqual([
      '.hidden.json',
      'desk.assets',
      'desk.json',
      'tower.json',
    ]);
  });

  it('refuses a body that is not JSON, leaving the file as it was', async () => {
    const registry = createDocumentRegistry(folder);
    await registry.entries();

    const reply = await handleSaveRequest(registry, url('desk'), '{ nope');

    expect(reply.status).toBe(400);
    expect(reply.text).toMatch(/not JSON/);
    expect(await readFile(join(folder, 'desk.json'), 'utf8')).toBe(LAYOUT);
  });

  it('refuses a body over the size cap, and a URL that is not a save', async () => {
    const registry = createDocumentRegistry(folder);
    await registry.entries();

    const big = await handleSaveRequest(registry, url('desk'), ' '.repeat(MAX_DOCUMENT_BYTES + 1));
    const elsewhere = await handleSaveRequest(registry, '/somewhere/else', LAYOUT);
    const undecodable = await handleSaveRequest(registry, `${SAVE_URL_PREFIX}%E0%A4%A`, LAYOUT);

    expect(big.status).toBe(413);
    expect(elsewhere.status).toBe(400);
    expect(undecodable.status).toBe(400);
    expect(await readFile(join(folder, 'desk.json'), 'utf8')).toBe(LAYOUT);
  });
});
