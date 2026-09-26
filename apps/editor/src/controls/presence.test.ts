/**
 * usePresence's bookkeeping: which row left, which arrived, and that every other row keeps its key.
 */

import { describe, expect, it } from 'vitest';
import { reconcile, type PresentRow } from './presence.js';

function start<T>(items: readonly T[]): Parameters<typeof reconcile<T>>[0] {
  return {
    items,
    rows: items.map((item, index) => ({ key: index, item, index, present: true, arrived: false })),
    nextKey: items.length,
  };
}

function shape<T>(rows: readonly PresentRow<T>[]): string[] {
  return rows.map(
    (row) =>
      `${String(row.key)}:${String(row.item)}${row.present ? '' : '-'}${row.arrived ? '+' : ''}`,
  );
}

describe('reconcile', () => {
  const [a, b, c, d] = ['a', 'b', 'c', 'd'];

  it('keeps the removed row in its place, not present, and every other key with its item', () => {
    const next = reconcile(start([a, b, c, d]), [a, c, d]);

    expect(shape(next.rows)).toEqual(['0:a', '1:b-', '2:c', '3:d']);
    // The rows under the gap now have the indices they will be selected by.
    expect(next.rows.map((row) => row.index)).toEqual([0, 1, 1, 2]);
  });

  it('adds a new key at the end for an appended item, marked as arriving', () => {
    expect(shape(reconcile(start([a, b]), [a, b, c]).rows)).toEqual(['0:a', '1:b', '2:c+']);
  });

  it('treats a same-length change as an edit: keys stay by position', () => {
    expect(shape(reconcile(start([a, b]), ['A', b]).rows)).toEqual(['0:A', '1:b']);
  });

  it('keeps an earlier leaver in place while a second change lands', () => {
    const once = reconcile(start([a, b, c]), [a, c]);
    const twice = reconcile(once, [c]);

    expect(shape(twice.rows)).toEqual(['0:a-', '1:b-', '2:c']);
  });

  it('matches by position when the list was replaced wholesale, and only the surplus leaves', () => {
    expect(shape(reconcile(start([a, b, c]), ['x', 'y']).rows)).toEqual(['0:x', '1:y', '2:c-']);
  });
});
