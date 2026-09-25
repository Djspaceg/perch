/**
 * The stamp: a `ControlSpec` becomes a primitive, and a descriptor becomes a `PropertyRow`.
 *
 * This is the only place a spec is turned into markup, for tokens and for everything else alike, so a
 * token row and a rect row cannot drift into two looks. The panes hand it data and callbacks.
 */

import type { ReactNode } from 'react';
import {
  ColorField,
  NumberField,
  PropertyRow,
  SegmentedControl,
  VectorField,
  type RowIds,
  type ScrubTarget,
} from './controls/index.js';
import { lengthStep, splitLength, type ControlSpec, type Property } from './descriptors.js';
import type { LayoutUpdate } from './layout-edits.js';

/** What scrubbing the row's label should drive for this spec, if anything. */
export function scrubFor(
  spec: ControlSpec,
  value: string,
  onValue: (text: string) => void,
): ScrubTarget | undefined {
  if (spec.kind === 'number') {
    return { value, onChange: onValue, step: spec.step, min: spec.min, max: spec.max };
  }
  if (spec.kind === 'length') {
    const parts = splitLength(value);
    if (parts === undefined) return undefined;
    const [amount, unit] = parts;

    return {
      value: amount,
      onChange: (text) => {
        onValue(`${text.trim()}${unit}`);
      },
      step: lengthStep(unit),
    };
  }

  return undefined;
}

/** Whether the spec's control is a group labelled by id rather than a labelable element. */
export function isGroupSpec(spec: ControlSpec): boolean {
  return spec.kind === 'segmented';
}

/** A spec, as the primitive it names. */
export function SpecControl({
  spec,
  ids,
  label,
  value,
  onValue,
}: {
  readonly spec: ControlSpec;
  readonly ids: RowIds;
  readonly label: string;
  readonly value: string;
  readonly onValue: (value: string) => void;
}): ReactNode {
  switch (spec.kind) {
    case 'number':
      return (
        <NumberField
          id={ids.controlId}
          label={label}
          labelHidden
          value={value}
          onChange={onValue}
          step={spec.step}
          min={spec.min}
          max={spec.max}
          unit={spec.unit}
          unitText={spec.unitText}
          bar={spec.bar}
          describedBy={ids.describedBy}
        />
      );

    case 'length': {
      const parts = splitLength(value);
      if (parts === undefined) return <TextControl ids={ids} value={value} onValue={onValue} />;
      const [amount, unit] = parts;
      // The unit select carries the current unit even when it is not one of the offered ones.
      const offered = spec.units.includes(unit) ? spec.units : [unit, ...spec.units];

      return (
        <>
          <NumberField
            id={ids.controlId}
            label={label}
            labelHidden
            value={amount}
            step={lengthStep(unit)}
            describedBy={ids.describedBy}
            onChange={(text) => {
              onValue(`${text.trim()}${unit}`);
            }}
          />
          <select
            className="perch-input perch-input--unit"
            aria-label={`${label} unit`}
            value={unit}
            onChange={(event) => {
              onValue(`${amount}${event.target.value}`);
            }}
          >
            {offered.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </>
      );
    }

    case 'colour':
      return (
        <ColorField
          id={ids.controlId}
          label={label}
          value={value}
          alpha={spec.alpha}
          onValue={onValue}
          describedBy={ids.describedBy}
        />
      );

    case 'segmented':
      return (
        <>
          <SegmentedControl
            labelledBy={ids.labelId}
            value={value}
            options={spec.options}
            onValue={onValue}
            describedBy={ids.describedBy}
          />
          {value === '' && spec.unsetText !== undefined ? (
            <span className="perch-unset">{spec.unsetText}</span>
          ) : null}
        </>
      );

    case 'select':
      return (
        <select
          id={ids.controlId}
          className="perch-input"
          value={value}
          {...(ids.describedBy === undefined ? {} : { 'aria-describedby': ids.describedBy })}
          onChange={(event) => {
            onValue(event.target.value);
          }}
        >
          {spec.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );

    case 'text':
      return (
        <TextControl
          ids={ids}
          value={value}
          onValue={onValue}
          numeric={spec.numeric === true}
          list={spec.list}
        />
      );

    default:
      return assertNeverSpec(spec);
  }
}

function assertNeverSpec(spec: never): never {
  throw new Error(`unhandled control spec: ${JSON.stringify(spec)}`);
}

/**
 * A value as text, which every control ultimately is. `type="text"` even for a number, for the reason
 * `inspector.tsx` gives: `type="number"` hands back `''` for anything it dislikes.
 */
export function TextControl({
  ids,
  value,
  onValue,
  numeric = false,
  list,
  mono = false,
}: {
  readonly ids: RowIds;
  readonly value: string;
  readonly onValue: (value: string) => void;
  readonly numeric?: boolean;
  readonly list?: string | undefined;
  readonly mono?: boolean;
}): ReactNode {
  return (
    <input
      id={ids.controlId}
      className={`perch-input${mono ? ' perch-input--mono' : ''}`}
      type="text"
      spellCheck={false}
      autoComplete="off"
      value={value}
      {...(numeric ? { inputMode: 'decimal' as const } : {})}
      // Spread-or-nothing: under `exactOptionalPropertyTypes` a `list={undefined}` is a different
      // prop set from no `list` at all, and React would render the attribute as empty.
      {...(list === undefined ? {} : { list })}
      {...(ids.describedBy === undefined ? {} : { 'aria-describedby': ids.describedBy })}
      onChange={(event) => {
        onValue(event.target.value);
      }}
    />
  );
}

/**
 * A non-token descriptor, as a row. `subject` is the element or the target; `index` is handed to
 * `write` so an element descriptor can address its element.
 */
export function PropertyView<Subject>({
  property,
  subject,
  index,
  onEdit,
}: {
  readonly property: Property<Subject>;
  readonly subject: Subject;
  readonly index: number;
  readonly onEdit: (update: LayoutUpdate) => void;
}): ReactNode {
  if (property.kind === 'vector') {
    return (
      <PropertyRow
        label={property.label}
        description={property.description}
        labelAs="group"
        testId={`perch-editor-prop-${property.id}`}
      >
        {(ids) => (
          <div role="group" aria-labelledby={ids.labelId} className="perch-vector-group">
            <VectorField
              unit={property.unit}
              step={1}
              describedBy={ids.describedBy}
              fields={property.fields.map((field) => ({
                key: field.key,
                label: field.label,
                ariaLabel: field.ariaLabel,
                axis: field.axis,
                min: field.min,
                value: field.get(subject),
                onChange: (text) => {
                  onEdit(field.write(text, index));
                },
              }))}
            />
          </div>
        )}
      </PropertyRow>
    );
  }

  const value = property.get(subject);
  const onValue = (text: string): void => {
    onEdit(property.write(text, index));
  };

  return (
    <PropertyRow
      label={property.label}
      description={property.description}
      labelAs={isGroupSpec(property.spec) ? 'group' : 'label'}
      scrub={scrubFor(property.spec, value, onValue)}
      testId={`perch-editor-prop-${property.id}`}
    >
      {(ids) => (
        <SpecControl
          spec={property.spec}
          ids={ids}
          label={property.label}
          value={value}
          onValue={onValue}
        />
      )}
    </PropertyRow>
  );
}

export const PROPERTY_VIEW_STYLES = `
.perch-vector-group { flex: 1 1 auto; display: flex; min-width: 0; }
.perch-input--unit { flex: 0 0 52px; }
.perch-unset { flex: none; font-size: var(--ed-font-small); color: var(--ed-quiet); white-space: nowrap; }
`;
