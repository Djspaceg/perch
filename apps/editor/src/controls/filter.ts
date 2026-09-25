/**
 * The token search: every word of the query must appear in at least one of the haystacks, in any
 * case. AND over words, so "chart colour" finds the chart's colours and not every colour; and a word
 * may match any haystack, so a word from the label and a word from the description both count.
 */

/** A query as lowercase words, empties dropped. */
export function queryWords(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
}

/** Whether every word of `query` is in one of `haystacks`. An empty query matches everything. */
export function matchesQuery(
  query: string,
  ...haystacks: readonly (string | undefined)[]
): boolean {
  const words = queryWords(query);
  const texts = haystacks
    .filter((text): text is string => text !== undefined)
    .map((text) => text.toLowerCase());

  return words.every((word) => texts.some((text) => text.includes(word)));
}
