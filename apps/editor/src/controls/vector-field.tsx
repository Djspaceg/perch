/**
 * VectorField: several numbers under one row label, in one line — a rect's `x y`, then its `w h`.
 *
 * Each component is a full `NumberField` (type, nudge, scrub) with its short label inside it as its
 * drag handle and a thin coloured left edge naming the axis, so four numbers read as two pairs at a
 * glance rather than four unrelated boxes.
 */

import type { ReactNode } from 'react';
import { NumberField } from './number-field.js';

export interface VectorComponent {
  readonly key: string;
  readonly label: string;
  readonly ariaLabel?: string | undefined;
  readonly axis?: 'x' | 'y' | 'w' | 'h' | undefined;
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
}

export function VectorField({
  fields,
  unit,
  step,
  describedBy,
}: {
  readonly fields: readonly VectorComponent[];
  readonly unit?: string | undefined;
  readonly step?: number | undefined;
  readonly describedBy?: string | undefined;
}): ReactNode {
  return (
    <span className="perch-vector">
      {fields.map((field) => (
        <NumberField
          key={field.key}
          label={field.label}
          ariaLabel={field.ariaLabel}
          axis={field.axis}
          value={field.value}
          onChange={field.onChange}
          min={field.min}
          max={field.max}
          step={step}
          unit={unit}
          describedBy={describedBy}
        />
      ))}
    </span>
  );
}

export const VECTOR_FIELD_STYLES = `
.perch-vector { flex: 1 1 auto; display: flex; gap: var(--ed-gap); min-width: 0; }
`;
