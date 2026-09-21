/**
 * The widget registry: the one place this leaf package accepts knowledge from outside.
 *
 * SPEC hard rule 5 says this package must not know `ui-kit` exists, and the format keeps
 * `widget` a plain string for exactly that reason. Left there, the cost is typo-safety: a
 * layout naming `guage` would validate, resolve to nothing, and paint an empty rectangle on a
 * wall panel — discovered days later.
 *
 * So the knowledge is **injected instead of imported**. The consumer that *does* know the
 * widgets — the runtime, the editor, a test — builds a registry and hands it to the validator.
 * The dependency edge points inward from the caller, never outward from here, so the leaf stays
 * a leaf and an unknown widget name still fails loudly.
 *
 * The registry carries the minimum the *validator* needs, not everything a renderer knows: a
 * widget's name and whether it draws a scale. `drawsScale` is load-bearing rather than
 * informational — it is what makes "`range` is required for any widget that draws a scale"
 * checkable without this package holding a list of gauges.
 */

/**
 * Widget name spelling: lower-case alphanumeric groups joined by single hyphens.
 *
 * Declared here rather than deferred to the registry because it is a rule about a *field of
 * this format*, not about anybody's widget vocabulary. It buys one canonical spelling, so
 * `Gauge`, `gauge ` and `gauge` cannot become three names for one widget across a set of
 * layout files, and it lets a malformed name be reported as malformed rather than as merely
 * unregistered.
 */
const WIDGET_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WIDGET_NAME_MAX_LENGTH = 64;

/** Whether `name` is spelled like a widget name, irrespective of any registry. */
export function isWidgetName(name: string): boolean {
  return name.length > 0 && name.length <= WIDGET_NAME_MAX_LENGTH && WIDGET_NAME.test(name);
}

/** What the validator needs to know about one widget. */
export interface WidgetSpec {
  /**
   * Whether this widget draws a scale, and therefore requires an authored `range`.
   *
   * A gauge, a bar and a sparkline draw one; a numeric readout does not. Authored, never
   * measured: a sensor source reports observed running extremes — LibreHardwareMonitor's
   * `Min`/`Max` are resettable at runtime — so a scale derived from them silently rescales as
   * the day's peak moves. See `packages/sensor-contract/SPEC.md`, which excludes range from
   * sensor metadata for this reason.
   */
  readonly drawsScale: boolean;
}

/**
 * The injection point. A lookup, not a list, so a consumer with a large or lazily-built widget
 * table is not forced to materialise one.
 */
export interface WidgetRegistry {
  /** Whether a widget by this name can be resolved. */
  has(name: string): boolean;
  /** The widget's spec, or `undefined` if it is not registered. */
  get(name: string): WidgetSpec | undefined;
  /**
   * Every registered name, for error messages.
   *
   * Required rather than optional: "unknown widget `guage`" is a dead end, and "unknown widget
   * `guage`; registered: gauge, readout, sparkline" is a fix. A registry that cannot enumerate
   * itself cannot produce the second message.
   */
  readonly names: readonly string[];
}

/**
 * Build a registry from a plain table of specs.
 *
 * Throws `TypeError` on a malformed table rather than returning a registry that would reject
 * every layout using the affected widget. A registry is programmer input, not authored content:
 * its mistakes belong to whoever wrote the call, are the same on every run, and must not be
 * reported as though a layout file were at fault.
 *
 * The result is frozen and its `names` sorted, so two registries built from the same table
 * produce byte-identical error messages.
 */
export function createWidgetRegistry(specs: Readonly<Record<string, WidgetSpec>>): WidgetRegistry {
  const table = new Map<string, WidgetSpec>();

  for (const name of Object.keys(specs)) {
    if (!isWidgetName(name)) {
      throw new TypeError(
        `widget registry name must be lower-case alphanumeric groups joined by single hyphens, at most ${WIDGET_NAME_MAX_LENGTH} characters, got ${JSON.stringify(name)}`,
      );
    }

    const spec = specs[name];
    if (spec === undefined || typeof spec.drawsScale !== 'boolean') {
      throw new TypeError(
        `widget registry entry ${JSON.stringify(name)} must declare a boolean drawsScale`,
      );
    }

    table.set(name, Object.freeze({ drawsScale: spec.drawsScale }));
  }

  const names = Object.freeze([...table.keys()].sort());

  return Object.freeze({
    has: (name: string) => table.has(name),
    get: (name: string) => table.get(name),
    names,
  });
}

/**
 * A registry that knows nothing, for the callers that legitimately have no widgets.
 *
 * Exported so that "I have no widget table yet" is written explicitly at the call site rather
 * than by omitting a required option. Every widget element fails against it, naming the empty
 * registry — which is the honest outcome, not a silent pass.
 */
export const EMPTY_WIDGET_REGISTRY: WidgetRegistry = createWidgetRegistry({});
