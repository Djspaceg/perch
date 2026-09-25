/**
 * Entry point for `@perch/editor`.
 *
 * An app rather than a library: the thing that runs is `index.html` plus `src/main.tsx`, and nothing
 * imports this package. What is re-exported here is the editor's *seams* — the pieces a test or a
 * future harness mounts — so the shape of the app is readable in one file.
 *
 * `main.tsx` is deliberately not exported. It constructs a source, reads `window.location` and calls
 * `createRoot`, so importing it is mounting it.
 *
 * Nothing here renders a layout element. That is `LayoutCanvas` in `@perch/ui-kit`, which both this
 * editor's preview and the runtime's output go through — see `app.tsx` and `preview.tsx`.
 */

export { EDITOR_STYLES, Editor, openLayoutByName, type EditorProps } from './app.js';

export { canSave, draftSaved, editDraft, isDirty, openDraft, type DraftState } from './draft.js';

export {
  addElement,
  numberFromInput,
  numberToInput,
  removeElement,
  removeElementStyleToken,
  removeThemeToken,
  setElementFit,
  setElementGap,
  setElementRangeBound,
  setElementRect,
  setElementRectField,
  setElementSrc,
  setElementStyleToken,
  setElementText,
  setElementTopic,
  setElementWidget,
  setElementWindowMs,
  setTargetField,
  setThemeToken,
  type LayoutUpdate,
  type RangeBound,
  type RectField,
  type TargetField,
} from './layout-edits.js';

export {
  LAYOUT_LIBRARY,
  createLayoutLibrary,
  type LayoutLibrary,
  type LayoutLibraryEntry,
} from './layout-library.js';

export { INSPECTOR_STYLES, Inspector, describeElement, type InspectorProps } from './inspector.js';

export {
  CANVAS_HANDLES_STYLES,
  CanvasHandles,
  rectFromDrag,
  rectFromResize,
  type CanvasHandlesProps,
} from './canvas-handles.js';

export {
  ADDABLE_KINDS,
  defaultRange,
  newElement,
  newRect,
  type AddableEntry,
  type AddableKind,
} from './new-element.js';

export {
  AddMenu,
  SENSOR_PICKER_STYLES,
  SensorCatalogueProvider,
  SensorList,
  TopicField,
} from './sensor-picker.js';

export {
  catalogueTopics,
  filterCatalogue,
  typedTopic,
  type CatalogueFilter,
  type FilteredCatalogue,
  type TopicEntry,
  type TopicGroup,
  type TypedTopic,
} from './topic-catalogue.js';

export { LAYOUT_PROBLEMS_STYLES, LayoutProblems, type LayoutProblemsProps } from './problems.js';

export {
  LayoutPreview,
  PREVIEW_STYLES,
  describePreviewFit,
  previewFit,
  type LayoutPreviewProps,
  type PreviewFit,
} from './preview.js';

export {
  HEADER_HEIGHT,
  INSPECTOR_WIDTH,
  PREVIEW_PADDING,
  previewViewport,
  usePreviewViewport,
  type PreviewViewport,
} from './preview-viewport.js';

export {
  SAVE_ENDPOINT_PREFIX,
  browserSaveTransport,
  saveDraft,
  saveEndpoint,
  serializeLayout,
  type SaveOutcome,
  type SaveTransport,
} from './save.js';

export {
  LAYOUTS_DIRECTORY,
  LAYOUT_FILE_EXTENSION,
  resolveSaveTarget,
  type SaveTarget,
} from './save-target.js';
