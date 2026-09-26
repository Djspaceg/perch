/**
 * usePresence: a list's rows with stable keys, and the ones just removed kept in place until they
 * have collapsed away.
 *
 * `Collapse` animates one region in and out; a list needs to know *which* row left and which arrived.
 * Keyed by index, deleting row 2 of 5 would re-label rows 2 and 3 in place and collapse row 4 — the
 * wrong row, with everything under the deletion jumping first. So each row gets a key that follows
 * its item, and a removed row stays in the list, marked not present, at the place it held, until its
 * `Collapse` calls `exited`.
 *
 * Items carry no ids, so which is which is read from the change itself:
 *
 * - **Same length**: an edit. Keys stay by position, whatever the items now are.
 * - **Different length**: an add or a delete. Items keep their identity through both (`addElement`
 *   and `removeElement` copy the array, not the elements), so rows are matched by identity in order;
 *   an unmatched old row left, an unmatched new item arrived.
 * - **Different length and nothing in common**: the list was replaced wholesale. Positions are kept
 *   for what the two share, and only the surplus leaves or arrives.
 */

import { useCallback, useState } from 'react';

/** One rendered row. */
export interface PresentRow<T> {
  readonly key: number;
  readonly item: T;
  /** Where the item is in the list now; for a row that has left, where it was. */
  readonly index: number;
  /** False while a removed row collapses away. */
  readonly present: boolean;
  /** Arrived after the list first rendered, so it grows in. */
  readonly arrived: boolean;
}

interface PresenceState<T> {
  readonly items: readonly T[];
  readonly rows: readonly PresentRow<T>[];
  readonly nextKey: number;
}

/** Every row to render, including leaving ones, and the call a leaving row makes once it has gone. */
export function usePresence<T>(items: readonly T[]): {
  readonly rows: readonly PresentRow<T>[];
  readonly exited: (key: number) => void;
} {
  const [record, setRecord] = useState<PresenceState<T>>(() => ({
    items,
    rows: items.map((item, index) => ({ key: index, item, index, present: true, arrived: false })),
    nextKey: items.length,
  }));

  // Adjusting state to a new prop during render, the way React documents: no effect, no extra paint.
  let current = record;
  if (record.items !== items) {
    current = reconcile(record, items);
    setRecord(current);
  }

  const exited = useCallback((key: number) => {
    setRecord((was) => ({
      ...was,
      rows: was.rows.filter((row) => row.present || row.key !== key),
    }));
  }, []);

  return { rows: current.rows, exited };
}

/** The rows for `items`, given the rows there were. Exported for its tests. */
export function reconcile<T>(record: PresenceState<T>, items: readonly T[]): PresenceState<T> {
  let nextKey = record.nextKey;
  const arrive = (item: T, index: number): PresentRow<T> => ({
    key: nextKey++,
    item,
    index,
    present: true,
    arrived: true,
  });
  const live = record.rows.filter((row) => row.present);
  // What each live row becomes, and what arrives before it; `tail` arrives after all of them.
  const becomes = new Map<number, PresentRow<T>>();
  const before = new Map<number, PresentRow<T>[]>();
  const tail: PresentRow<T>[] = [];
  const leave = (row: PresentRow<T>): void => {
    becomes.set(row.key, { ...row, present: false });
  };
  const keep = (row: PresentRow<T>, item: T, index: number): void => {
    becomes.set(row.key, { ...row, item, index });
  };

  const shared = live.some((row) => items.includes(row.item));
  if (live.length === items.length || !shared) {
    items.forEach((item, index) => {
      const row = live[index];
      if (row === undefined) tail.push(arrive(item, index));
      else keep(row, item, index);
    });
    live.slice(items.length).forEach(leave);
  } else {
    let at = 0;
    items.forEach((item, index) => {
      // Rows before the next match left; an item matching no remaining row arrived.
      const match = live.findIndex((row, from) => from >= at && row.item === item);
      if (match === -1) {
        const row = live[at];
        if (row === undefined) tail.push(arrive(item, index));
        else before.set(row.key, [...(before.get(row.key) ?? []), arrive(item, index)]);
        return;
      }
      live.slice(at, match).forEach(leave);
      const row = live[match];
      if (row !== undefined) keep(row, item, index);
      at = match + 1;
    });
    live.slice(at).forEach(leave);
  }

  const rows = record.rows.flatMap((row) => [
    ...(before.get(row.key) ?? []),
    becomes.get(row.key) ?? row,
  ]);

  return { items, rows: [...rows, ...tail], nextKey };
}
