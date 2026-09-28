import type { MenuItem, MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';
import { trayMenuTemplate, type TrayActions, type TrayState } from './tray-menu.js';

const desk = { name: 'desk', path: '/l/desk.json' };
const tower = { name: 'tower', path: '/l/tower.json' };

const state: TrayState = {
  documents: [desk, tower],
  current: tower.path,
  notice: null,
  windowVisible: true,
  startAtLogin: false,
};

function recording(): { actions: TrayActions; calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    actions: {
      open: (document) => calls.push(['open', document.name]),
      openFolder: () => calls.push(['openFolder']),
      openEditor: () => calls.push(['openEditor']),
      toggleWindow: () => calls.push(['toggleWindow']),
      setStartAtLogin: (enabled) => calls.push(['setStartAtLogin', enabled]),
      quit: () => calls.push(['quit']),
    },
  };
}

function item(template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions {
  const found = template.find((entry) => entry.label === label);
  if (found === undefined) throw new Error(`no item ${label}`);
  return found;
}

function click(entry: MenuItemConstructorOptions, checked = false): void {
  // Electron passes the item, its window and the event; only `checked` is read here.
  (entry.click as (item: Pick<MenuItem, 'checked'>) => void)({ checked });
}

describe('trayMenuTemplate', () => {
  it('lists every document, checking only the open one', () => {
    const template = trayMenuTemplate(state, recording().actions);

    expect(item(template, 'desk')).toMatchObject({ type: 'checkbox', checked: false });
    expect(item(template, 'tower')).toMatchObject({ type: 'checkbox', checked: true });
  });

  it('has the folder, window, login and quit items, in that order, login off by default', () => {
    const labels = trayMenuTemplate(state, recording().actions)
      .map((entry) => entry.label)
      .filter((label) => label !== undefined);

    expect(labels).toEqual([
      'Layouts',
      'desk',
      'tower',
      'Open layouts folder',
      'Open editor',
      'Hide window',
      'Start at login',
      'Quit perch',
    ]);
    expect(item(trayMenuTemplate(state, recording().actions), 'Start at login').checked).toBe(
      false,
    );
  });

  it('offers Show window while the window is hidden', () => {
    const template = trayMenuTemplate({ ...state, windowVisible: false }, recording().actions);

    expect(template.some((entry) => entry.label === 'Show window')).toBe(true);
  });

  it('puts a notice first, and says when there is nothing to list', () => {
    const template = trayMenuTemplate(
      { ...state, documents: [], current: null, notice: 'x.json is gone' },
      recording().actions,
    );

    expect(template[0]).toMatchObject({ label: 'x.json is gone', enabled: false });
    expect(item(template, 'No layout documents').enabled).toBe(false);
  });

  it('routes each click to its action', () => {
    const { actions, calls } = recording();
    const template = trayMenuTemplate(state, actions);

    click(item(template, 'desk'));
    click(item(template, 'Open layouts folder'));
    click(item(template, 'Open editor'));
    click(item(template, 'Hide window'));
    click(item(template, 'Start at login'), true);
    click(item(template, 'Quit perch'));

    expect(calls).toEqual([
      ['open', 'desk'],
      ['openFolder'],
      ['openEditor'],
      ['toggleWindow'],
      ['setStartAtLogin', true],
      ['quit'],
    ]);
  });
});
