import { describe, expect, it } from 'vitest';
import { singleWindow, type SingleWindowTarget } from './single-window.js';

/** A window as far as `singleWindow` touches one, recording what was done to it. */
function fakeWindow(minimized = false): SingleWindowTarget & {
  calls: string[];
  close(): void;
} {
  const calls: string[] = [];
  let onClosed: (() => void) | undefined;
  let isMinimized = minimized;

  return {
    calls,
    isMinimized: () => isMinimized,
    restore: () => {
      isMinimized = false;
      calls.push('restore');
    },
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
    once: (_event, listener) => {
      onClosed = listener;
    },
    close: () => onClosed?.(),
  };
}

describe('singleWindow', () => {
  it('makes the window on the first open, and only brings it forward after that', () => {
    const made: ReturnType<typeof fakeWindow>[] = [];
    const settings = singleWindow(() => {
      const window = fakeWindow();
      made.push(window);
      return window;
    });

    expect(settings.current()).toBeNull();
    settings.open();
    settings.open();
    settings.open();

    expect(made).toHaveLength(1);
    expect(settings.current()).toBe(made[0]);
    expect(made[0]?.calls).toEqual(['show', 'focus', 'show', 'focus']);
  });

  it('restores a minimised window before focusing it', () => {
    const window = fakeWindow(true);
    const settings = singleWindow(() => window);

    settings.open();
    settings.open();

    expect(window.calls).toEqual(['restore', 'show', 'focus']);
  });

  it('makes a new one once the first has closed, and says so', () => {
    const made: ReturnType<typeof fakeWindow>[] = [];
    const changes: boolean[] = [];
    const settings = singleWindow(
      () => {
        const window = fakeWindow();
        made.push(window);
        return window;
      },
      (open) => changes.push(open),
    );

    settings.open();
    made[0]?.close();
    expect(settings.current()).toBeNull();
    settings.open();

    expect(made).toHaveLength(2);
    expect(settings.current()).toBe(made[1]);
    expect(changes).toEqual([true, false, true]);
  });
});
