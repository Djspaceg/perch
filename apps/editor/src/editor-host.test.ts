import { LAYOUT_SCHEMA_VERSION, validateLayout, type Layout } from '@perch/layout-schema';
import { normalizeSensorTopic } from '@perch/sensor-contract';
import { WIDGET_REGISTRY } from '@perch/ui-kit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MENU_COMMAND_IDS,
  blankLayoutLike,
  choiceForRelay,
  menuBindings,
  menuCommandRoute,
  untitledName,
} from './editor-host.js';
import { COMMANDS, resolveKeymap } from './keybindings/index.js';

afterEach(() => {
  document.body.replaceChildren();
});

function focused<T extends HTMLElement>(element: T): T {
  document.body.append(element);
  element.focus();
  return element;
}

describe('menuCommandRoute: the menu Undo and Redo', () => {
  it('do the native text undo while a text field has focus', () => {
    const field = focused(document.createElement('input'));

    expect(menuCommandRoute('history.undo', field)).toEqual({ kind: 'native', edit: 'undo' });
    expect(menuCommandRoute('history.redo', field)).toEqual({ kind: 'native', edit: 'redo' });
    const area = focused(document.createElement('textarea'));
    expect(menuCommandRoute('history.undo', area)).toEqual({ kind: 'native', edit: 'undo' });
  });

  it("run the editor's history everywhere else", () => {
    const button = focused(document.createElement('button'));
    const checkbox = focused(Object.assign(document.createElement('input'), { type: 'checkbox' }));

    expect(menuCommandRoute('history.undo', button)).toEqual({
      kind: 'command',
      id: 'history.undo',
    });
    expect(menuCommandRoute('history.redo', checkbox)).toEqual({
      kind: 'command',
      id: 'history.redo',
    });
    expect(menuCommandRoute('history.undo', null)).toEqual({ kind: 'command', id: 'history.undo' });
  });

  it('never route a document command natively, even from a field', () => {
    const field = focused(document.createElement('input'));

    expect(menuCommandRoute('document.save', field)).toEqual({
      kind: 'command',
      id: 'document.save',
    });
  });

  it('ignore anything that is not a menu command', () => {
    expect(menuCommandRoute('selection.delete', null)).toBeNull();
    expect(menuCommandRoute('rm -rf', null)).toBeNull();
  });
});

describe('menuBindings', () => {
  it('are the keymap in effect for each menu command, overrides included', () => {
    const keymap = resolveKeymap(COMMANDS, { 'document.save': ['Alt+S'] }, 'mac');
    const bindings = menuBindings(keymap);

    expect(Object.keys(bindings)).toEqual([...MENU_COMMAND_IDS]);
    expect(bindings['document.save']).toEqual(['Alt+S']);
    expect(bindings['document.saveAs']).toEqual(['Mod+Shift+S']);
    expect(bindings['history.redo']).toEqual(['Mod+Shift+Z']);
    expect(menuBindings(resolveKeymap(COMMANDS, {}, 'other'))['history.redo']).toEqual([
      'Mod+Shift+Z',
      'Ctrl+Y',
    ]);
  });
});

describe('choiceForRelay', () => {
  it("is the localhost radio for the relay's own default host", () => {
    expect(choiceForRelay({ host: 'localhost', port: 8085, defaultPort: 8085 })).toEqual({
      kind: 'localhost',
    });
  });

  it('is the host radio for any other host or port', () => {
    expect(choiceForRelay({ host: '192.168.1.3', port: 8085, defaultPort: 8085 })).toEqual({
      kind: 'remote',
      host: '192.168.1.3',
      port: 8085,
    });
    expect(choiceForRelay({ host: 'localhost', port: 9000, defaultPort: 8085 })).toEqual({
      kind: 'remote',
      host: 'localhost',
      port: 9000,
    });
  });
});

describe('New', () => {
  const open: Layout = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    target: { width: 720, height: 1280, frameRate: 30 },
    theme: { '--perch-fg': '#e8f1ff' },
    elements: [{ kind: 'text', text: 'x', rect: { x: 0, y: 0, w: 10, h: 10 } }],
  };

  it("is a blank canvas with the open document's target and theme, and valid", () => {
    const blank = blankLayoutLike(open);

    expect(blank).toEqual({ ...open, elements: [] });
    const checked = validateLayout(blank, {
      widgets: WIDGET_REGISTRY,
      isTopic: (topic: string) => normalizeSensorTopic(topic) !== null,
    });
    expect(checked.ok).toBe(true);
  });

  it('is 1920x400 when nothing valid is open', () => {
    expect(blankLayoutLike(undefined).target).toEqual({ width: 1920, height: 400, frameRate: 30 });
  });

  it('is called untitled, numbered past any name already taken', () => {
    expect(untitledName([])).toBe('untitled');
    expect(untitledName(['untitled', 'untitled-2', 'desk'])).toBe('untitled-3');
  });
});
