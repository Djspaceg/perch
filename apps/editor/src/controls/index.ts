/**
 * The inspector's control primitives, written once and stamped out by the panes.
 *
 * Every property the inspector shows is data (`../descriptors.ts`) drawn through these ten
 * components, so a row's height, a field's behaviour and a reset's wording are each decided in one
 * place and tested in one place (the `*.test.tsx` beside each). Editor-only: `ui-kit` is the panel's
 * renderer, shared with the runtime, and nothing here belongs on a dashboard.
 */

import { ALIGN_GRID_STYLES } from './align-grid.js';
import { CHROME_STYLES } from './chrome.js';
import { COLOR_FIELD_STYLES } from './color-field.js';
import { FILTER_BAR_STYLES } from './filter-bar.js';
import { NUMBER_FIELD_STYLES } from './number-field.js';
import { PROPERTY_ROW_STYLES } from './property-row.js';
import { RESET_BUTTON_STYLES } from './reset-button.js';
import { SECTION_STYLES } from './section.js';
import { SEGMENTED_CONTROL_STYLES } from './segmented-control.js';
import { TAB_STRIP_STYLES } from './tab-strip.js';
import { VECTOR_FIELD_STYLES } from './vector-field.js';

export { AlignGrid, type AlignAxis } from './align-grid.js';
export { ColorField, swatchStyle } from './color-field.js';
export { FilterBar, type FilterChip } from './filter-bar.js';
export {
  NumberField,
  ScrubLabel,
  type NumberFieldProps,
  type ScrubTarget,
} from './number-field.js';
export { PropertyRow, type RowIds, type ValueSource } from './property-row.js';
export { ResetButton, type ResetButtonProps, type ReturnsTo } from './reset-button.js';
export { AdvancedSection, Section } from './section.js';
export { SegmentedControl, type SegmentOption } from './segmented-control.js';
export { TabStrip, type TabSpec } from './tab-strip.js';
export { VectorField, type VectorComponent } from './vector-field.js';
export { matchesQuery, queryWords } from './filter.js';
export { usePopover, type Popover } from './popover.js';
export { stepFor } from './scrub.js';

/** Every primitive's stylesheet, chrome variables first. One `<style>` in `app.tsx` mounts it. */
export const CONTROLS_STYLES = [
  CHROME_STYLES,
  SECTION_STYLES,
  PROPERTY_ROW_STYLES,
  NUMBER_FIELD_STYLES,
  VECTOR_FIELD_STYLES,
  COLOR_FIELD_STYLES,
  SEGMENTED_CONTROL_STYLES,
  ALIGN_GRID_STYLES,
  RESET_BUTTON_STYLES,
  TAB_STRIP_STYLES,
  FILTER_BAR_STYLES,
].join('\n');
