/**
 * Matching a topic against a subscription pattern.
 *
 * This lives in `sensor-sources`, not in the contract, because wildcard syntax is
 * transport vocabulary: `+` and `#` are MQTT's, and SPEC rule 3 keeps transport knowledge
 * out of `sensor-contract`. A broker does this matching for the mqtt source; the mock and
 * any future poll-based source have no broker, so they do it here.
 *
 * MQTT's rules, as implemented:
 * - `+` matches exactly one level, never zero and never two.
 * - `#` matches the remaining levels including none, and is only legal as the last level.
 * - Anything else matches itself, level for level, with no length mismatch allowed.
 */

const SINGLE_LEVEL = '+';
const MULTI_LEVEL = '#';

/** Whether `topic` is delivered to a subscription on `pattern`. */
export function topicMatchesPattern(topic: string, pattern: string): boolean {
  const topicLevels = topic.split('/');
  const patternLevels = pattern.split('/');

  // A `#` anywhere but last is not a valid pattern. Reject rather than guess, so a typo
  // fails visibly instead of silently subscribing to more or less than intended.
  const multiAt = patternLevels.indexOf(MULTI_LEVEL);
  if (multiAt !== -1 && multiAt !== patternLevels.length - 1) return false;

  for (let i = 0; i < patternLevels.length; i += 1) {
    const level = patternLevels[i];

    if (level === MULTI_LEVEL) return true; // including zero remaining levels
    if (i >= topicLevels.length) return false;
    if (level === SINGLE_LEVEL) continue;
    if (level !== topicLevels[i]) return false;
  }

  return topicLevels.length === patternLevels.length;
}
