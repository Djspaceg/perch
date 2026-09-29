/**
 * A window there is only ever one of: the first open makes it, every later open brings that one
 * forward, and once it has closed the next open makes a new one. The Settings window is one.
 *
 * Pure: the factory makes the window, so the rule is tested with a fake and `settings-window.ts`
 * hands it a real `BrowserWindow`.
 */

/** The part of a `BrowserWindow` this touches. */
export interface SingleWindowTarget {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  once(event: 'closed', listener: () => void): unknown;
}

export interface SingleWindow<W extends SingleWindowTarget> {
  /** Make the window, or bring the one there is forward. */
  open(): void;
  /** The window, while it is open. */
  current(): W | null;
}

export function singleWindow<W extends SingleWindowTarget>(
  make: () => W,
  /** Told `true` when the window is made and `false` once it has closed. */
  onChange: (open: boolean) => void = () => undefined,
): SingleWindow<W> {
  let window: W | null = null;

  return {
    open: () => {
      if (window !== null) {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        return;
      }
      const made = make();
      window = made;
      made.once('closed', () => {
        if (window === made) window = null;
        onChange(false);
      });
      onChange(true);
    },
    current: () => window,
  };
}
