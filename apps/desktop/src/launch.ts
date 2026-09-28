/**
 * One install, two runners, one process: what a launch asks for, and what a second launch hands the
 * first.
 *
 * ```text
 * electron .             the runner: relay, tray, the window resuming its document
 * electron . --editor    the runner, and the editor window over it
 * ```
 *
 * The app holds a single-instance lock per userData. A second launch with that userData does not run:
 * it passes its intent to the first through the lock (`handoffData`, Electron's `additionalData`) and
 * quits, and the first opens or focuses the editor, or shows the runner's window. So there is always
 * one relay, one tray and one settings file, and the editor window dials the relay the runner started.
 * Closing the editor never stops the runner; the runner is quit from its tray or the app menu.
 *
 * The argv is read too, as a fallback: Chromium reorders a second instance's switches and adds its
 * own, so the intent travels as data first and position in argv never matters.
 *
 * Pure, so each rule is a test row; `main.ts` does the Electron calls.
 */

export type LaunchIntent = 'runner' | 'editor';

/** The command-line switch that opens the editor. */
export const EDITOR_SWITCH = '--editor';

export function launchIntent(argv: readonly string[]): LaunchIntent {
  return argv.includes(EDITOR_SWITCH) ? 'editor' : 'runner';
}

/** What a launch starts. The runner always: the editor is a window over it, never on its own. */
export function launchPlan(intent: LaunchIntent): {
  readonly runner: true;
  readonly editor: boolean;
} {
  return { runner: true, editor: intent === 'editor' };
}

/** What a second launch sends the first, through `requestSingleInstanceLock`. */
export function handoffData(intent: LaunchIntent): { readonly perchIntent: LaunchIntent } {
  return { perchIntent: intent };
}

/** The second launch's intent, as the first reads it: from the data it sent, else from its argv. */
export function handoffIntent(data: unknown, argv: readonly string[]): LaunchIntent {
  if (typeof data === 'object' && data !== null && 'perchIntent' in data) {
    const { perchIntent } = data;
    if (perchIntent === 'editor' || perchIntent === 'runner') return perchIntent;
    return 'runner';
  }

  return launchIntent(argv);
}

export type SecondInstanceAction = 'open-editor' | 'show-runner';

export function secondInstanceAction(intent: LaunchIntent): SecondInstanceAction {
  return intent === 'editor' ? 'open-editor' : 'show-runner';
}
