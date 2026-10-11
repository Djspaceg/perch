import { describe, expect, it } from 'vitest';
import { applyOrder, mergeOrder, moveKey, panelDropTarget } from './panel-order.js';

describe('a group’s panel order', () => {
  it('is the default until one is remembered', () => {
    expect(applyOrder(['a', 'b', 'c'], undefined)).toEqual(['a', 'b', 'c']);
    expect(applyOrder(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
  });

  it('applies a remembered order to what is shown, a panel it never named after its default predecessor', () => {
    expect(applyOrder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
    expect(applyOrder(['a', 'c'], ['c', 'b', 'a'])).toEqual(['c', 'a']);
    expect(applyOrder(['a', 'b', 'n', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b', 'n']);
    expect(applyOrder(['n', 'a', 'b'], ['b', 'a'])).toEqual(['n', 'b', 'a']);
  });

  it('merges a move among the shown back, keeping where the hidden ones were', () => {
    // A media element shows content, transform, appearance; placement and colour are hidden.
    const stored = ['content', 'transform', 'appearance', 'placement', 'colour'];
    expect(mergeOrder(stored, ['transform', 'content', 'appearance'])).toEqual([
      'transform',
      'content',
      'appearance',
      'placement',
      'colour',
    ]);
    expect(mergeOrder(undefined, ['b', 'a'])).toEqual(['b', 'a']);
  });

  it('moves one key, and drops nowhere either side of itself', () => {
    expect(moveKey(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(panelDropTarget(1, 1, 3)).toBeNull();
    expect(panelDropTarget(1, 2, 3)).toBeNull();
    expect(panelDropTarget(1, 0, 3)).toBe(0);
    expect(panelDropTarget(0, 3, 3)).toBe(2);
    expect(panelDropTarget(0, 4, 3)).toBeNull();
  });
});
