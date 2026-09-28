/**
 * Where one undo step ends. The keys that undo and redo are commands in `keybindings/`.
 *
 * ## The gesture an edit belongs to
 *
 * The controls write the draft as they go — a keystroke, a pixel of scrub, a move of the colour
 * picker's thumb — because the preview has to follow. An undo per write would be useless, so the store
 * folds edits sharing a gesture key into one step (`history.ts`). The key is read here, from what the
 * page is doing at the moment of the edit, rather than passed down by every control:
 *
 * - **While a pointer is pressed**, the key is that press. A scrub, a colour drag, a thumb dragged
 *   along a slider: one step, ended by letting go. Listened to on `window` in the capture phase, so
 *   the press is known before any control's own handler runs.
 * - **Otherwise, while focus is in a text field**, the key is that stay in the field. Focusing starts
 *   one; Enter and the native `change` (the browser's own commit: blur, Enter, a picker closed) start
 *   the next. So typing and arrow-nudging a field is one step per commit. A click elsewhere that
 *   leaves focus in the field (a button that does not take focus) is not the field's doing, and
 *   falls to the next rule.
 * - **Otherwise, the event being handled.** A click on the placement grid writes two tokens and a
 *   linked box side writes up to four, each its own edit; they are one step because they come from
 *   one click. The event is noted as it starts down the tree and counts until its dispatch is over
 *   (`eventPhase` back to `NONE`), so no control has to pass it down. A canvas drag writes once, on
 *   release, after the press has ended, so it is one step this way too.
 * - **Outside any event** (a timer, a resolved promise) there is none, and the edit is its own step.
 */

import { useCallback, useEffect, useRef } from 'react';
import { isTextEntry } from './keybindings/local-keys.js';

/** The events a discrete edit arrives in, one step each, however many edits one of them makes. */
const DISCRETE_EVENTS = ['click', 'input', 'change', 'keydown', 'keyup', 'mousedown', 'mouseup'];

/** Read the gesture key for an edit being made now. Listens for as long as the component is mounted. */
export function useEditGesture(): () => string | undefined {
  const counter = useRef(0);
  const pressed = useRef<number | null>(null);
  const stay = useRef(0);
  const handling = useRef<Event | null>(null);
  const ids = useRef(new WeakMap<Event, number>());

  useEffect(() => {
    const next = (): number => {
      counter.current += 1;

      return counter.current;
    };
    const listeners: readonly (readonly [string, (event: Event) => void])[] = [
      [
        'pointerdown',
        () => {
          pressed.current = next();
        },
      ],
      [
        'pointerup',
        () => {
          pressed.current = null;
        },
      ],
      [
        'pointercancel',
        () => {
          pressed.current = null;
        },
      ],
      // A release the page never saw (let go over another window, a context menu) must not leave every
      // later edit folded into one press: a move with no button down, or the window losing focus,
      // ends it.
      [
        'pointermove',
        (event) => {
          if (event instanceof PointerEvent && event.buttons === 0) pressed.current = null;
        },
      ],
      [
        'blur',
        (event) => {
          if (event.target === window) pressed.current = null;
        },
      ],
      [
        'focusin',
        () => {
          stay.current = next();
        },
      ],
      [
        'change',
        () => {
          stay.current = next();
        },
      ],
      [
        'keydown',
        (event) => {
          if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing) {
            stay.current = next();
          }
        },
      ],
      ...DISCRETE_EVENTS.map(
        (type) =>
          [
            type,
            (event: Event) => {
              handling.current = event;
              ids.current.set(event, next());
            },
          ] as const,
      ),
    ];
    for (const [type, listener] of listeners) window.addEventListener(type, listener, true);

    return () => {
      for (const [type, listener] of listeners) window.removeEventListener(type, listener, true);
    };
  }, []);

  return useCallback(() => {
    if (pressed.current !== null) return `pointer:${pressed.current}`;
    // Still being dispatched: the edit is that event's doing.
    const current =
      handling.current !== null && handling.current.eventPhase !== Event.NONE
        ? handling.current
        : null;
    const active = document.activeElement;
    // A field's own typing, but not a click on a control that did not take focus from it.
    if (isTextEntry(active) && (current === null || current.target === active)) {
      return `field:${stay.current}`;
    }

    return current === null ? undefined : `event:${ids.current.get(current) ?? 0}`;
  }, []);
}
