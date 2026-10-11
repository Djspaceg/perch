/**
 * usePresence's bookkeeping: which row left, which arrived, and that every other row keeps its key.
 * And useKeyedPresence's, for entries that carry their own keys.
 */

import { describe, expect, it } from 'vitest';
import { reconcile, reconcileKeyed, type KeyedRow, type PresentRow } from './presence.js';

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

describe('reconcileKeyed', () => {
  const key = (item: string): string => item;
  const rowsOf = (items: readonly string[]): readonly KeyedRow<string>[] =>
    items.map((item) => ({ key: item, item, present: true, arrived: false }));
  const keyed = (rows: readonly KeyedRow<string>[]): string[] =>
    rows.map((row) => `${row.key}${row.present ? '' : '-'}${row.arrived ? '+' : ''}`);

  it('keeps every shared entry, leaves the gone one where it was, and grows the new one in', () => {
    const next = reconcileKeyed(
      rowsOf(['content', 'transform', 'appearance', 'placement']),
      ['content', 'appearance', 'colour'],
      key,
    );

    expect(keyed(next)).toEqual(['content', 'transform-', 'appearance', 'placement-', 'colour+']);
  });

  it('brings back an entry that was on its way out, under its own key', () => {
    const leaving = reconcileKeyed(rowsOf(['content', 'transform']), ['content'], key);
    const back = reconcileKeyed(leaving, ['content', 'transform'], key);

    expect(keyed(back)).toEqual(['content', 'transform']);
  });

  it('keeps entries through a reorder, losing none', () => {
    const next = reconcileKeyed(rowsOf(['a', 'b', 'c']), ['c', 'a'], key);

    expect(keyed(next).sort()).toEqual(['a', 'b-', 'c']);
  });

  it('changes nothing for the same keys', () => {
    expect(keyed(reconcileKeyed(rowsOf(['a', 'b']), ['a', 'b'], key))).toEqual(['a', 'b']);
  });
});
