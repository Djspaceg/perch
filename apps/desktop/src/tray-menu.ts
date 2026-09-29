/**
 * The tray menu, as data: what it lists and what each item does.
 *
 * Built from the runner's state every time that state changes, rather than mutated, so the menu can
 * never show a checkmark on a document that is no longer open. Pure — `electron` is imported for
 * its types only — so the menu's contents are tested without the binary.
 */

import type { MenuItemConstructorOptions } from 'electron';
import type { LayoutDocument } from './layouts-folder.js';

export interface TrayState {
  readonly documents: readonly LayoutDocument[];
  /** The open document's path, or `null`. */
  readonly current: string | null;
  /** A sentence to show at the top, such as why this is not the last document. */
  readonly notice: string | null;
  readonly windowVisible: boolean;
  readonly startAtLogin: boolean;
}

export interface TrayActions {
  open(document: LayoutDocument): void;
  openFolder(): void;
  openEditor(): void;
  /** Show and focus the runner's window, the preview, or hide it. */
  toggleWindow(): void;
  openSettings(): void;
  setStartAtLogin(enabled: boolean): void;
  quit(): void;
}

export function trayMenuTemplate(
  state: TrayState,
  actions: TrayActions,
): MenuItemConstructorOptions[] {
  const documents: MenuItemConstructorOptions[] =
    state.documents.length === 0
      ? [{ label: 'No layout documents', enabled: false }]
      : state.documents.map((document) => ({
          label: document.name,
          type: 'checkbox',
          checked: document.path === state.current,
          click: () => {
            actions.open(document);
          },
        }));

  return [
    ...(state.notice === null
      ? []
      : [{ label: state.notice, enabled: false }, { type: 'separator' as const }]),
    { label: 'Layouts', enabled: false },
    ...documents,
    { type: 'separator' },
    {
      label: 'Open layouts folder',
      click: () => {
        actions.openFolder();
      },
    },
    {
      label: 'Open editor',
      click: () => {
        actions.openEditor();
      },
    },
    {
      label: state.windowVisible ? 'Hide preview' : 'Show preview',
      click: () => {
        actions.toggleWindow();
      },
    },
    {
      label: 'Settings...',
      click: () => {
        actions.openSettings();
      },
    },
    {
      label: 'Start at login',
      type: 'checkbox',
      checked: state.startAtLogin,
      click: (item) => {
        actions.setStartAtLogin(item.checked);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit perch',
      click: () => {
        actions.quit();
      },
    },
  ];
}
