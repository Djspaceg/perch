/**
 * The token search: every word must appear somewhere, in any case.
 *
 * "chart colour" should find the chart's colours and nothing else, which is AND over words, not a
 * substring of the whole query and not OR.
 */

import { describe, expect, it } from 'vitest';
import { matchesQuery, queryWords } from './filter.js';

describe('queryWords', () => {
  it('splits on whitespace, lowercases, and drops empties', () => {
    expect(queryWords('  Chart   Colour ')).toEqual(['chart', 'colour']);
    expect(queryWords('')).toEqual([]);
    expect(queryWords('   ')).toEqual([]);
  });
});

describe('matchesQuery', () => {
  it('matches everything when the query is empty', () => {
    expect(matchesQuery('', 'Reading colour')).toBe(true);
  });

  it('needs every word, each in any of the haystacks', () => {
    expect(matchesQuery('chart colour', 'Chart line colour')).toBe(true);
    expect(matchesQuery('chart colour', 'Chart reading size')).toBe(false);
    expect(matchesQuery('line wash', 'Chart line colour', 'The plotted line and the wash')).toBe(
      true,
    );
  });

  it('ignores case, and ignores haystacks that are absent', () => {
    expect(matchesQuery('READING', undefined, 'Reading colour')).toBe(true);
    expect(matchesQuery('reading', undefined)).toBe(false);
  });
});
