/**
 * Public surface of `@perch/ui-kit`: the widgets, plus the thing that arranges a layout of widgets.
 *
 * One *widget* so far — the numeric readout — plus the provider that feeds it, and the two
 * non-widget element kinds a layout can also paint: `TextBlock` and `MediaFrame`. The gauge and the
 * sparkline from README.md are deliberately not here yet; DECISIONS.md says why.
 *
 * At the bottom, a level up from all of that: `LayoutCanvas` and the `WIDGET_CATALOGUE` it draws
 * through. That pair is what makes the editor's canvas and the runtime's output the same pixels
 * rather than two implementations that agree for a while.
 *
 * The distinction between the three is worth keeping straight, because only one of them is a
 * *widget* in `layout-schema`'s sense: `Readout` is bound to a sensor topic and appears in the
 * injected widget registry, while `TextBlock` and `MediaFrame` render the `text` and `media`
 * element kinds, hold no topic and are not registry entries. A consumer's element dispatch has
 * three branches; its widget registry has one.
 *
 * The exports are grouped by the direction data flows through them:
 *
 * ```
 * source → SensorProvider → context → useSensor(topic) → <Readout topic=… />
 * ```
 *
 * Nothing here exposes a way to reach back up that chain. There is no installed singleton and no
 * ambient state: a provider's store belongs to that provider, so two dashboards, two tests or a
 * server render never share one. `createSensorStore` is exported for the rare case that wants a
 * store without React — a capture harness, say — not as a back door for widgets.
 */

export { assertNever } from './exhaustive.js';

export {
  DEFAULT_STALE_AFTER_MS,
  NO_HISTORY,
  createSensorStore,
  type SensorHistorySnapshot,
  type SensorSnapshot,
  type SensorStore,
  type SensorStoreOptions,
} from './sensor-store.js';

/**
 * The ring and the demand ledger, exported for their own tests and for a harness that wants history
 * without React — not because a widget should build one. A widget asks through `useSensorHistory`,
 * which is what ties a retention to a mount.
 */
export {
  HISTORY_MIN_CAPACITY,
  HISTORY_SLOT_MS,
  createTopicRing,
  createWindowDemand,
  historyCapacity,
  type TopicRing,
  type WindowDemand,
} from './sensor-history.js';

export {
  SensorProvider,
  useSensor,
  useSensorHistory,
  useSensorMeta,
  useSensorStatus,
  useSensorStore,
  type SensorProviderProps,
} from './sensor-context.js';

export {
  DEFAULT_DECIMALS,
  READOUT_DECIMALS,
  READOUT_NO_READING_TEXT,
  READOUT_STATE_KINDS,
  READOUT_WAITING_TEXT,
  readoutState,
  readoutView,
  staleNote,
  type ReadoutState,
  type ReadoutStateKind,
  type ReadoutViewInput,
  type ReadoutViewModel,
} from './readout-view.js';

export {
  READOUT_STYLES,
  READOUT_VALUE_FIELD_CHARS,
  Readout,
  type ReadoutProps,
} from './readout.js';

export { TEXT_BLOCK_STYLES, TextBlock, type TextBlockProps } from './text-block.js';

export {
  MEDIA_FRAME_FITS,
  MEDIA_FRAME_STYLES,
  MediaFrame,
  type MediaFrameFit,
  type MediaFrameProps,
} from './media-frame.js';

export { PERCH_TOKENS, PERCH_TOKEN_DEFAULTS, token, type PerchToken } from './tokens.js';

/**
 * The widget vocabulary, and the canvas that arranges a layout of them.
 *
 * These two are the reason this package has an edge to `@perch/layout-schema`. They are a level up
 * from everything above: a widget draws one reading, and `LayoutCanvas` draws a whole validated
 * `Layout` — every element at its authored rect on a fixed, once-scaled canvas.
 *
 * They live here rather than in `apps/runtime` because the runtime and the editor both render a
 * layout, `apps/` may not import `apps/`, and a second implementation of this is precisely how the
 * editor's preview stops matching what the runtime paints. `WIDGET_REGISTRY` is the same fact for the
 * validator: both apps inject this one, so neither can accept a layout the other cannot draw.
 */
export {
  WIDGET_NAMES,
  WIDGET_REGISTRY,
  widgetFor,
  type WidgetCatalogueEntry,
  type WidgetName,
} from './widget-catalogue.js';

export {
  CANVAS_TOKEN_DEFAULTS,
  LAYOUT_CANVAS_STYLES,
  LayoutCanvas,
  canvasToken,
  type CanvasToken,
  type LayoutCanvasProps,
} from './layout-canvas.js';
