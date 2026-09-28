/**
 * Closing the editor, and quitting, with unsaved changes: when to ask, what to ask, and what the
 * answer means. And the one app-wide rule the editor window adds: the dock icon.
 *
 * The editor page tells the main process whether its document is dirty on every change, so the
 * decision to ask needs nothing from the page at the moment of closing. Asked, the author has three
 * answers, in the platform's order: Save (the page saves; the window closes only if the save
 * succeeded), Don't Save (it closes), Cancel (nothing happens, and a quit is called off).
 *
 * Pure; `editor.ts` shows the dialog.
 */

export type CloseChoice = 'save' | 'discard' | 'cancel';

/** Whether a close must ask first: the document is dirty and this close has not been answered. */
export function mustAsk({ dirty, answered }: { dirty: boolean; answered: boolean }): boolean {
  return dirty && !answered;
}

export interface UnsavedPrompt {
  readonly type: 'warning';
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly ['Save', "Don't Save", 'Cancel'];
  readonly defaultId: 0;
  readonly cancelId: 2;
}

export function unsavedPrompt(name: string, reason: 'close' | 'quit'): UnsavedPrompt {
  return {
    type: 'warning',
    message: `Save the changes to "${name}"?`,
    detail:
      reason === 'quit'
        ? 'perch is quitting. Your changes will be lost if you do not save them.'
        : 'Your changes will be lost if you close the editor without saving them.',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
  };
}

/** The button pressed, as a choice. Anything unexpected keeps the editor open. */
export function closeChoice(response: number): CloseChoice {
  return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel';
}

/**
 * macOS: a dock icon while either window is showing, none once neither is. The runner lives in the
 * menu bar; the editor is an ordinary window and has one while it is open.
 */
export function dockVisible({
  runnerVisible,
  editorOpen,
}: {
  runnerVisible: boolean;
  editorOpen: boolean;
}): boolean {
  return runnerVisible || editorOpen;
}
