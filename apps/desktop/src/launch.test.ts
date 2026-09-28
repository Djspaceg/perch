import { describe, expect, it } from 'vitest';
import {
  EDITOR_SWITCH,
  handoffData,
  handoffIntent,
  launchIntent,
  launchPlan,
  secondInstanceAction,
} from './launch.js';

describe('launchIntent', () => {
  it('is the runner unless the editor switch is on the command line', () => {
    expect(EDITOR_SWITCH).toBe('--editor');
    expect(launchIntent(['/path/electron', '.'])).toBe('runner');
    expect(launchIntent(['/path/electron', '.', '--editor'])).toBe('editor');
    // Chromium moves switches ahead of positional arguments; position must not matter.
    expect(launchIntent(['/path/electron', '--editor', '.'])).toBe('editor');
  });

  it('does not read a look-alike as the switch', () => {
    expect(launchIntent(['electron', '.', '--editor-foo'])).toBe('runner');
    expect(launchIntent(['electron', '.', 'editor'])).toBe('runner');
  });
});

describe('launchPlan', () => {
  it('always starts the runner, and opens the editor only when asked', () => {
    expect(launchPlan('runner')).toEqual({ runner: true, editor: false });
    expect(launchPlan('editor')).toEqual({ runner: true, editor: true });
  });
});

describe('the single-instance handoff', () => {
  it('sends the intent with the lock request, and the first instance reads it back', () => {
    expect(handoffIntent(handoffData('editor'), ['electron', '.'])).toBe('editor');
    expect(handoffIntent(handoffData('runner'), ['electron', '.', '--editor'])).toBe('runner');
  });

  it('falls back to the second instance argv when the data is missing or malformed', () => {
    expect(handoffIntent(undefined, ['electron', '.', '--editor'])).toBe('editor');
    expect(handoffIntent({ perchIntent: 'rm -rf' }, ['electron', '.'])).toBe('runner');
    expect(handoffIntent(null, ['electron', '.'])).toBe('runner');
  });

  it('opens or focuses the editor for an editor launch, and shows the runner otherwise', () => {
    expect(secondInstanceAction('editor')).toBe('open-editor');
    expect(secondInstanceAction('runner')).toBe('show-runner');
  });
});
