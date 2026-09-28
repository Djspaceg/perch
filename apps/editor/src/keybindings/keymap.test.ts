/**
 * `resolveKeymap`: the registry's defaults per platform, overrides layered over them, and every
 * problem with an override reported as data rather than thrown (KEYBINDINGS.md section 7). Also that
 * the spec's command table is the registry, so the two cannot drift.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatChord } from './binding.js';
import { COMMANDS, type CommandSpec } from './commands.js';
import { boundCommand, resolveKeymap } from './keymap.js';

describe('the default keymap', () => {
  it('parses every default, on both platforms, with no issue', () => {
    for (const platform of ['mac', 'other'] as const) {
      const keymap = resolveKeymap(COMMANDS, {}, platform);
      expect(keymap.issues, platform).toEqual([]);
      for (const command of keymap.commands) {
        expect(command.chords.length, `${platform} ${command.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the registry order, and gives redo Ctrl+Y off the Mac only', () => {
    const mac = resolveKeymap(COMMANDS, {}, 'mac');
    const other = resolveKeymap(COMMANDS, {}, 'other');

    expect(mac.commands.map((command) => command.id)).toEqual(Object.keys(COMMANDS));
    expect(boundCommand(mac, 'history.redo').bindings).toEqual(['Mod+Shift+Z']);
    expect(boundCommand(other, 'history.redo').bindings).toEqual(['Mod+Shift+Z', 'Ctrl+Y']);
    expect(boundCommand(mac, 'history.undo').bindings).toEqual(['Mod+Z']);
    expect(boundCommand(other, 'selection.delete').bindings).toEqual(['Delete', 'Backspace']);
    expect(boundCommand(other, 'selection.clear').scopes).toEqual(['canvas', 'sidebar']);
    expect(boundCommand(other, 'history.undo').scopes).toEqual(['global']);
  });
});

describe('overrides', () => {
  it('replace a command`s defaults on every platform, canonically, and [] unbinds it', () => {
    const overrides = { 'history.undo': ['mod+u', 'F2'], 'selection.clear': [] };
    for (const platform of ['mac', 'other'] as const) {
      const keymap = resolveKeymap(COMMANDS, overrides, platform);
      expect(boundCommand(keymap, 'history.undo').bindings).toEqual(['Mod+U', 'F2']);
      expect(boundCommand(keymap, 'history.undo').overridden).toBe(true);
      expect(boundCommand(keymap, 'selection.clear').chords).toEqual([]);
      expect(boundCommand(keymap, 'history.redo').overridden).toBe(false);
      expect(keymap.issues).toEqual([]);
    }
  });

  it('drop a duplicate of a binding already in the list', () => {
    const keymap = resolveKeymap(COMMANDS, { 'history.undo': ['Mod+U', 'mod+u'] }, 'mac');

    expect(boundCommand(keymap, 'history.undo').bindings).toEqual(['Mod+U']);
  });

  it('report a binding that does not parse, and drop it', () => {
    const keymap = resolveKeymap(COMMANDS, { 'history.undo': ['Hyper+Z', 'Mod+U'] }, 'other');

    expect(boundCommand(keymap, 'history.undo').bindings).toEqual(['Mod+U']);
    expect(keymap.issues).toEqual([
      { kind: 'invalid', command: 'history.undo', binding: 'Hyper+Z' },
    ]);
  });

  it('report a plain key a control uses as its own, and drop it', () => {
    const keymap = resolveKeymap(
      COMMANDS,
      { 'selection.clear': ['ArrowUp', 'Tab', 'Enter', 'Space', 'Shift+Home', 'Mod+ArrowUp'] },
      'other',
    );

    expect(boundCommand(keymap, 'selection.clear').bindings).toEqual(['Mod+ArrowUp']);
    expect(keymap.issues.map((issue) => issue.kind)).toEqual([
      'reserved',
      'reserved',
      'reserved',
      'reserved',
      'reserved',
    ]);
  });

  it('report an id no command has, and ignore it', () => {
    const keymap = resolveKeymap(COMMANDS, { 'layout.frobnicate': ['Mod+F'] }, 'mac');

    expect(keymap.issues).toEqual([{ kind: 'unknown', command: 'layout.frobnicate' }]);
    expect(keymap.commands.map((command) => command.id)).toEqual(Object.keys(COMMANDS));
  });
});

describe('conflicts', () => {
  it('report two commands on one key in one scope, the earlier in the registry winning', () => {
    const keymap = resolveKeymap(COMMANDS, { 'history.redo': ['Mod+Z'] }, 'other');

    expect(keymap.issues).toEqual([
      {
        kind: 'conflict',
        chord: 'Ctrl+Z',
        commands: ['history.undo', 'history.redo'],
        scopes: ['global'],
        winner: 'history.undo',
      },
    ]);
  });

  it('report a scoped command over a global one, the scoped one winning inside its region', () => {
    const keymap = resolveKeymap(COMMANDS, { 'selection.clear': ['Mod+Z'] }, 'mac');

    expect(keymap.issues).toEqual([
      {
        kind: 'conflict',
        chord: 'Meta+Z',
        commands: ['history.undo', 'selection.clear'],
        scopes: ['canvas', 'sidebar'],
        winner: 'selection.clear',
      },
    ]);
  });

  it('compare the keys each platform actually gets, so Mod+Y and Ctrl+Y clash off the Mac only', () => {
    const overrides = { 'history.undo': ['Mod+Y'] };

    expect(resolveKeymap(COMMANDS, overrides, 'mac').issues).toEqual([]);
    expect(resolveKeymap(COMMANDS, overrides, 'other').issues).toEqual([
      expect.objectContaining({ kind: 'conflict', chord: 'Ctrl+Y', winner: 'history.undo' }),
    ]);
  });

  it('do not report commands whose scopes never meet', () => {
    const registry = {
      'a.one': { label: 'One', scope: 'canvas', keys: ['K'] },
      'a.two': { label: 'Two', scope: 'sidebar', keys: ['K'] },
    } satisfies Record<string, CommandSpec>;

    expect(resolveKeymap(registry, {}, 'other').issues).toEqual([]);
  });
});

describe('KEYBINDINGS.md', () => {
  it('lists every command with its label, scope and default keys on each platform', () => {
    const spec = readFileSync(join(import.meta.dirname, '../../KEYBINDINGS.md'), 'utf8');
    const rows = new Map(
      spec
        .split('\n')
        .filter((line) => line.startsWith('| `'))
        .map((line) => {
          const cells = line
            .split('|')
            .slice(1, -1)
            .map((cell) => cell.trim());

          return [cells[0]?.replaceAll('`', ''), cells.slice(1)] as const;
        }),
    );
    const mac = resolveKeymap(COMMANDS, {}, 'mac');
    const other = resolveKeymap(COMMANDS, {}, 'other');

    expect([...rows.keys()]).toEqual(Object.keys(COMMANDS));
    for (const command of mac.commands) {
      const keys = (platform: typeof mac) =>
        boundCommand(platform, command.id)
          .chords.map((chord) => formatChord(chord, platform.platform))
          .join(', ');
      expect(rows.get(command.id), command.id).toEqual([
        command.label,
        command.scopes.join(', '),
        keys(mac),
        keys(other),
      ]);
    }
  });
});
