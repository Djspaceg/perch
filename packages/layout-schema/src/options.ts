/**
 * What a caller must supply to validate a layout, and why each piece is injected rather than
 * known here.
 */

import { hasControlCharacter } from './checks.js';
import type { WidgetRegistry } from './registry.js';

/**
 * Whether a string is an acceptable sensor binding.
 *
 * Injected for the same reason the widget registry is, and with more force: `sensor-contract`'s
 * SPEC rule 5 says *no consumer may declare its own topic string, metric name, or unit*. A copy
 * of the device and metric vocabularies here would be a second source of truth for names, and
 * the failure mode of two lists is a subscription that silently never fires.
 *
 * So the consumer passes `isSensorTopic` — or `(t) => normalizeSensorTopic(t) !== null` if it
 * accepts the authored shorthand — and this package never learns a single metric name.
 */
export type TopicValidator = (topic: string) => boolean;

/**
 * Topic checking with no vocabulary: the rules that make a topic a single unambiguous key.
 *
 * Applied when no `isTopic` is injected. It declares no names, which is what keeps it inside
 * `sensor-contract`'s rule 5 — it only rejects strings that could not identify one sensor
 * whatever the vocabulary turns out to be:
 *
 * - **Non-empty, and no empty segments.** `a//b` and a leading or trailing `/` are two
 *   spellings of a shorter topic, and a topic is an identity key.
 * - **No `+` or `#`.** Those are MQTT wildcards. A binding containing one would match many
 *   sensors, so a widget bound to it has no defined value — it is a subscription, not a binding.
 * - **No whitespace or control characters.** One canonical spelling; a trailing space is the
 *   kind of typo that produces a permanently empty widget.
 *
 * This is deliberately weaker than the real check. A layout whose topics pass only this is not
 * known to name existing sensors — which is why every consumer that has `sensor-contract`
 * available should inject it, and why the SPEC's "a layout must declare what it needs" is
 * satisfied by the injected validator rather than by this fallback.
 */
export function isTopicShaped(topic: string): boolean {
  if (topic.length === 0) return false;
  if (/[+#\s]/.test(topic) || hasControlCharacter(topic)) return false;

  return topic.split('/').every((segment) => segment.length > 0);
}

/** Everything `validateLayout` needs beyond the document itself. */
export interface ValidateLayoutOptions {
  /**
   * The widget vocabulary to validate `widget` names against, and the source of each widget's
   * `drawsScale`.
   *
   * **Required, with no default.** An optional registry would mean a caller that forgot it got
   * a layout that validated and then rendered nothing — precisely the failure the registry
   * exists to prevent, now reachable by omission. Callers with genuinely no widget table pass
   * `EMPTY_WIDGET_REGISTRY` and say so at the call site.
   */
  readonly widgets: WidgetRegistry;
  /**
   * The sensor-topic check. Defaults to `isTopicShaped`, which is structure-only.
   *
   * Optional where `widgets` is required because there *is* a meaningful vocabulary-free check
   * for a topic and there is none for a widget name: an unchecked widget name is an unbounded
   * hole, while an unchecked-against-vocabulary topic still has to be a single unambiguous key.
   */
  readonly isTopic?: TopicValidator;
  /**
   * The `schemaVersion` these validators implement. Defaults to `LAYOUT_SCHEMA_VERSION`.
   *
   * It exists because the migration machinery has to be testable while only one version exists.
   * Every interesting case — a layout one version behind being carried forward, a chain of two
   * steps, a version too old to reach — needs a target above 1, and a target that could not be
   * moved would leave the first real migration to run for the first time on a user's file.
   *
   * Overriding it changes only which version number is demanded of the document; it does not
   * change which fields are checked, because the field checks are this build's. Production code
   * leaves it alone.
   */
  readonly targetVersion?: number;
}

/** The same options with defaults applied, threaded through the validators. */
export interface LayoutValidationContext {
  readonly widgets: WidgetRegistry;
  readonly isTopic: TopicValidator;
  /**
   * The canvas an element's rect must be able to paint on, or `null` when `target` itself
   * failed to validate and there is no canvas to check against.
   */
  readonly canvas: { readonly width: number; readonly height: number } | null;
}
