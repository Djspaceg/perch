/**
 * The one dispatcher (KEYBINDINGS.md sections 3 to 5): which command a key press reaches, if any —
 * the most specific scope first, fields, popovers and confirms getting the key before any shortcut —
 * and the hooks that register a handler and show its keys.
 *
 * The migrated shortcuts' tables are here too, from before the registry: on each platform its own
 * undo and redo act, and every other combination, the other platform's included, does nothing.
 */

import { fireEvent, render } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Platform } from '../platform.js';
import { COMMANDS, type CommandSpec } from './commands.js';
import { KEY_SCOPE_ATTRIBUTE, commandFor, keyScope } from './dispatch.js';
import { resolveKeymap, type KeybindingOverrides } from './keymap.js';
import { isTextEntry } from './local-keys.js';
import { KeybindingsProvider, useCommand, useKeybinding } from './provider.js';
import type { CommandId } from './commands.js';

interface Press {
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
}

function press(
  { metaKey = false, ctrlKey = false, shiftKey = false, altKey = false, key }: Press,
  target: EventTarget | null = document.body,
) {
  return { key, metaKey, ctrlKey, shiftKey, altKey, target };
}

const EVERY_COMMAND = (): boolean => true;

function region(scope: 'canvas' | 'sidebar', ...children: Element[]): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute(KEY_SCOPE_ATTRIBUTE, scope);
  element.append(...children);

  return element;
}

describe('the migrated undo and redo keys', () => {
  const history = (key: Press, platform: Platform): CommandId | null =>
    commandFor(press(key), resolveKeymap(COMMANDS, {}, platform), EVERY_COMMAND);

  it('on a Mac, undo with Cmd-Z and redo with Shift-Cmd-Z', () => {
    expect(history({ key: 'z', metaKey: true }, 'mac')).toBe('history.undo');
    expect(history({ key: 'Z', metaKey: true, shiftKey: true }, 'mac')).toBe('history.redo');
  });

  it('on a Mac, ignore Ctrl-Z, Ctrl-Shift-Z, Ctrl-Y, Cmd-Y and extra modifiers', () => {
    for (const ignored of [
      { key: 'z', ctrlKey: true },
      { key: 'Z', ctrlKey: true, shiftKey: true },
      { key: 'y', ctrlKey: true },
      { key: 'y', metaKey: true },
      { key: 'z', metaKey: true, ctrlKey: true },
      { key: 'z', metaKey: true, altKey: true },
      { key: 'z' },
    ]) {
      expect(history(ignored, 'mac'), JSON.stringify(ignored)).toBeNull();
    }
  });

  it('elsewhere, undo with Ctrl-Z and redo with Ctrl-Shift-Z or Ctrl-Y', () => {
    expect(history({ key: 'z', ctrlKey: true }, 'other')).toBe('history.undo');
    expect(history({ key: 'Z', ctrlKey: true, shiftKey: true }, 'other')).toBe('history.redo');
    expect(history({ key: 'y', ctrlKey: true }, 'other')).toBe('history.redo');
  });

  it('elsewhere, ignore Meta combinations, Ctrl-Shift-Y and extra modifiers', () => {
    for (const ignored of [
      { key: 'z', metaKey: true },
      { key: 'Z', metaKey: true, shiftKey: true },
      { key: 'z', metaKey: true, ctrlKey: true },
      { key: 'y', metaKey: true },
      { key: 'Y', ctrlKey: true, shiftKey: true },
      { key: 'z', ctrlKey: true, altKey: true },
      { key: 'z' },
    ]) {
      expect(history(ignored, 'other'), JSON.stringify(ignored)).toBeNull();
    }
  });
});

describe('the migrated delete and deselect keys', () => {
  const keymap = resolveKeymap(COMMANDS, {}, 'other');

  it('delete from Delete or Backspace on the canvas only', () => {
    const pane = document.createElement('div');
    region('canvas', pane);
    const button = document.createElement('button');
    region('sidebar', button);

    expect(commandFor(press({ key: 'Delete' }, pane), keymap, EVERY_COMMAND)).toBe(
      'selection.delete',
    );
    expect(commandFor(press({ key: 'Backspace' }, pane), keymap, EVERY_COMMAND)).toBe(
      'selection.delete',
    );
    expect(commandFor(press({ key: 'Delete' }, button), keymap, EVERY_COMMAND)).toBeNull();
    expect(commandFor(press({ key: 'Delete' }), keymap, EVERY_COMMAND)).toBeNull();
  });

  it('deselect from Escape on the canvas or in the sidebar, never from the header', () => {
    const pane = document.createElement('div');
    region('canvas', pane);
    const button = document.createElement('button');
    region('sidebar', button);

    expect(commandFor(press({ key: 'Escape' }, pane), keymap, EVERY_COMMAND)).toBe(
      'selection.clear',
    );
    expect(commandFor(press({ key: 'Escape' }, button), keymap, EVERY_COMMAND)).toBe(
      'selection.clear',
    );
    expect(commandFor(press({ key: 'Escape' }), keymap, EVERY_COMMAND)).toBeNull();
  });
});

describe('scope precedence', () => {
  const registry = {
    'test.global': { label: 'Global', scope: 'global', keys: ['K'] },
    'test.canvas': { label: 'Canvas', scope: 'canvas', keys: ['K'] },
    'test.inner': { label: 'Inner', scope: 'sidebar', keys: ['K'] },
  } satisfies Record<string, CommandSpec>;
  const keymap = resolveKeymap(registry, {}, 'other');

  it('tries the innermost region first, then outward, then global', () => {
    const inner = document.createElement('button');
    const outer = region('canvas', region('sidebar', inner));
    const onCanvas = document.createElement('button');
    outer.append(onCanvas);

    expect(commandFor(press({ key: 'k' }, inner), keymap, EVERY_COMMAND)).toBe('test.inner');
    expect(commandFor(press({ key: 'k' }, onCanvas), keymap, EVERY_COMMAND)).toBe('test.canvas');
    expect(commandFor(press({ key: 'k' }), keymap, EVERY_COMMAND)).toBe('test.global');
  });

  it('passes over a command with no enabled handler to the next', () => {
    const inner = document.createElement('button');
    region('canvas', region('sidebar', inner));

    expect(commandFor(press({ key: 'k' }, inner), keymap, (id) => id !== 'test.inner')).toBe(
      'test.canvas',
    );
    expect(commandFor(press({ key: 'k' }, inner), keymap, (id) => id === 'test.global')).toBe(
      'test.global',
    );
    expect(commandFor(press({ key: 'k' }, inner), keymap, () => false)).toBeNull();
  });

  it('within one scope, the earlier command in the registry wins', () => {
    const tied = resolveKeymap(
      {
        'test.first': { label: 'First', scope: 'global', keys: ['K'] },
        'test.second': { label: 'Second', scope: 'global', keys: ['K'] },
      } satisfies Record<string, CommandSpec>,
      {},
      'other',
    );

    expect(commandFor(press({ key: 'k' }), tied, EVERY_COMMAND)).toBe('test.first');
  });
});

describe('fields, popovers and confirms get the key first', () => {
  const registry = {
    'test.undo': { label: 'Undo', scope: 'global', keys: ['Mod+Z'] },
    'test.escape': { label: 'Back', scope: 'global', keys: ['Escape'] },
    'test.typing': { label: 'Typing', scope: 'global', keys: ['Mod+K'], inFields: true },
  } satisfies Record<string, CommandSpec>;
  const keymap = resolveKeymap(registry, {}, 'other');
  const at = (target: Element, key: Press): string | null =>
    commandFor(press(key, target), keymap, EVERY_COMMAND);

  function element(html: string): Element {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const first = holder.querySelector('[data-at]');
    if (first === null) throw new Error(html);

    return first;
  }

  it('holds every shortcut back from a text entry', () => {
    for (const html of [
      '<input data-at>',
      '<input data-at type="number">',
      '<input data-at type="search">',
      '<textarea data-at></textarea>',
      '<div contenteditable="true"><span data-at>x</span></div>',
    ]) {
      const target = element(html);
      expect(isTextEntry(target), html).toBe(true);
      expect(at(target, { key: 'z', ctrlKey: true }), html).toBeNull();
      expect(at(target, { key: 'Escape' }), html).toBeNull();
    }
  });

  it('lets a shortcut through from a button, checkbox, select or popover', () => {
    for (const html of [
      '<button data-at></button>',
      '<input data-at type="checkbox">',
      '<select data-at></select>',
      '<div role="dialog"><button data-at></button></div>',
      '<span class="perch-reset__confirm"><button data-at></button></span>',
      '<div contenteditable="false"><span data-at>x</span></div>',
    ]) {
      expect(at(element(html), { key: 'z', ctrlKey: true }), html).toBe('test.undo');
    }
  });

  it('holds Escape back from anything that owns an Escape of its own', () => {
    for (const html of [
      '<input data-at type="checkbox">',
      '<select data-at></select>',
      '<div role="dialog"><button data-at></button></div>',
      '<span class="perch-reset__confirm"><button data-at></button></span>',
    ]) {
      expect(at(element(html), { key: 'Escape' }), html).toBeNull();
    }
    expect(at(element('<button data-at></button>'), { key: 'Escape' })).toBe('test.escape');
  });

  it('lets a command that opts in have the key in a field', () => {
    expect(at(element('<input data-at>'), { key: 'k', ctrlKey: true })).toBe('test.typing');
  });

  it('never dispatches a key already used, or typed during composition', () => {
    const keymapAll = resolveKeymap(COMMANDS, {}, 'other');
    const base = press({ key: 'z', ctrlKey: true });

    expect(commandFor({ ...base, defaultPrevented: true }, keymapAll, EVERY_COMMAND)).toBeNull();
    expect(commandFor({ ...base, isComposing: true }, keymapAll, EVERY_COMMAND)).toBeNull();
  });
});

describe('KeybindingsProvider and useCommand', () => {
  function Probe({
    id,
    onRun,
    enabled,
  }: {
    readonly id: CommandId;
    readonly onRun: () => void;
    readonly enabled?: boolean;
  }): ReactNode {
    useCommand(id, onRun, enabled === undefined ? {} : { enabled });

    return null;
  }

  function mount(
    children: ReactNode,
    {
      platform = 'other',
      overrides = {},
    }: { platform?: Platform; overrides?: KeybindingOverrides } = {},
  ) {
    return render(
      <KeybindingsProvider platform={platform} overrides={overrides}>
        {children}
      </KeybindingsProvider>,
    );
  }

  it('runs the handler and prevents the default, only when a handler ran', () => {
    const undo = vi.fn();
    mount(<Probe id="history.undo" onRun={undo} />);

    expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(false);
    expect(undo).toHaveBeenCalledTimes(1);
    // Redo has no handler: its key is left to the browser.
    expect(fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: 'q', ctrlKey: true })).toBe(true);
  });

  it('does nothing while a handler is disabled, and nothing once it unmounts', () => {
    const undo = vi.fn();
    const view = mount(<Probe id="history.undo" onRun={undo} enabled={false} />);

    expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(true);
    view.rerender(
      <KeybindingsProvider platform="other" overrides={{}}>
        <Probe id="history.undo" onRun={undo} />
      </KeybindingsProvider>,
    );
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('calls the latest handler a component rendered, not the first', () => {
    const seen: number[] = [];
    function Counter(): ReactNode {
      const [count, setCount] = useState(0);
      useCommand('history.undo', () => {
        seen.push(count);
        setCount(count + 1);
      });

      return null;
    }
    mount(<Counter />);

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(seen).toEqual([0, 1]);
  });

  it('hands the key to a scoped command inside its region, and to the global one outside', () => {
    const undo = vi.fn();
    const clear = vi.fn();
    const view = mount(
      <>
        <Probe id="history.undo" onRun={undo} />
        <Probe id="selection.clear" onRun={clear} />
        <div {...keyScope('canvas')}>
          <button type="button">on canvas</button>
        </div>
        <button type="button">in header</button>
      </>,
      { overrides: { 'selection.clear': ['Mod+Z'] } },
    );

    fireEvent.keyDown(view.getByText('on canvas'), { key: 'z', ctrlKey: true });
    expect(clear).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
    fireEvent.keyDown(view.getByText('in header'), { key: 'z', ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('leaves a key a nearer handler used alone', () => {
    const clear = vi.fn();
    const view = mount(
      <>
        <Probe id="selection.clear" onRun={clear} />
        <div {...keyScope('canvas')}>
          <button
            type="button"
            onKeyDown={(event) => {
              event.preventDefault();
            }}
          >
            local
          </button>
        </div>
      </>,
    );

    fireEvent.keyDown(view.getByText('local'), { key: 'Escape' });
    expect(clear).not.toHaveBeenCalled();
  });

  it('follows the overrides it is given', () => {
    const undo = vi.fn();
    mount(<Probe id="history.undo" onRun={undo} />, {
      overrides: { 'history.undo': ['Mod+U'] },
    });

    expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(true);
    fireEvent.keyDown(document.body, { key: 'u', ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
  });
});

describe('useKeybinding', () => {
  function Shown({ id }: { readonly id: CommandId }): ReactNode {
    const shown = useKeybinding(id);

    return (
      <button type="button" title={shown.hint} aria-keyshortcuts={shown.ariaKeyShortcuts}>
        {`${shown.label}: ${shown.keys.join(' | ')} [${shown.bindings.join(' ')}]`}
      </button>
    );
  }

  it('shows the platform`s own keys, for tooltips and aria', () => {
    const mac = render(
      <KeybindingsProvider platform="mac" overrides={{}}>
        <Shown id="history.redo" />
      </KeybindingsProvider>,
    );
    const button = mac.getByRole('button');
    expect(button).toHaveTextContent('Redo: ⇧⌘Z [Mod+Shift+Z]');
    expect(button).toHaveAttribute('title', 'Redo (⇧⌘Z)');
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Meta+Shift+Z');
    mac.unmount();

    const other = render(
      <KeybindingsProvider platform="other" overrides={{}}>
        <Shown id="history.redo" />
      </KeybindingsProvider>,
    );
    expect(other.getByRole('button')).toHaveAttribute('title', 'Redo (Ctrl+Shift+Z or Ctrl+Y)');
    expect(other.getByRole('button')).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Shift+Z Control+Y',
    );
  });

  it('shows an override, and no aria-keyshortcuts for a command left with no keys', () => {
    const view = render(
      <KeybindingsProvider platform="other" overrides={{ 'history.undo': [] }}>
        <Shown id="history.undo" />
      </KeybindingsProvider>,
    );

    expect(view.getByRole('button')).toHaveAttribute('title', 'Undo');
    expect(view.getByRole('button')).not.toHaveAttribute('aria-keyshortcuts');
  });
});
