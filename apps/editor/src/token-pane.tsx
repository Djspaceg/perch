/**
 * A token map, for two different people.
 *
 * `theme` on a layout and `style` on an element are the same thing at two levels: a map of CSS custom
 * properties, each one an **override** of a value `ui-kit` already declares. That sentence is the whole
 * design of this pane, and the previous form got it wrong in a way worth naming — it listed only the
 * keys the document happened to hold, under their raw `--perch-...` names, with a text box each and a
 * button marked `remove`. Three separate misreadings follow from that:
 *
 * 1. **A token you have not set is unreachable.** The only way to change `--perch-warn` was to know it
 *    exists and type its name into an "add" control, which means the vocabulary was discoverable only
 *    by reading `tokens.ts`.
 * 2. **`remove` looks destructive and is not.** Removing a known token drops an override; the ui-kit
 *    default takes over and the dashboard keeps painting. The word for that is *reset*.
 * 3. **`remove` is destructive, sometimes.** A layout may set any well-formed custom property, so a
 *    name outside the 36 `ui-kit` declares can exist — and for *that* there is no default underneath,
 *    so removing it really does delete the value. One word over two consequences is the defect.
 *
 * So there are two tabs, and they are two intents rather than two skill levels:
 *
 * - **Customize** is the vocabulary. Every known token for this surface, whether the document sets it
 *   or not, under the label `ui-kit` gives it, with a control that fits the token's type — a picker
 *   for a colour, a number and a unit for a size, a closed select for `text-transform`. It shows which
 *   values are the layout's own and offers a reset for exactly those. It cannot add a name and cannot
 *   delete a token: there is nothing here whose effect is unrecoverable. It also never prints a raw
 *   `--perch-...` name, in text or in a tooltip — a consumer who needs one is on the other tab.
 * - **Developer** is the document. Only the keys actually present, by raw name, each marked with
 *   whether `ui-kit` knows it, add available, and the two removals shaped for their two different
 *   consequences.
 *
 * ## Colour first, notation second
 *
 * Wherever a colour is edited the swatch leads and the hex literal follows. An author who came to
 * change a colour is looking for the colour; `#e8f1ff` is how the value is *written*, which matters
 * once they are already at the right row. Both colour rows in this file are ordered that way — a
 * Customize row and a Developer row — because two panes that disagree about which half of a colour
 * control comes first read as two products.
 *
 * ## One fact from the old disclosure, kept
 *
 * An earlier form put the token name and its default behind a per-row disclosure in Customize. The
 * name is gone from this tab entirely; the default value is not, because it answers one question the
 * value field cannot: *what do I get back if I reset this*. That question only exists on a row this
 * surface overrides — a row at its default already shows the default in its own control — so the value
 * is printed as quiet text beside the reset, on overridden rows only, and nowhere else.
 *
 * ## The removals, as icons
 *
 * Every removal in this pane is an icon button, because the words were the widest thing in a row and a
 * row is where the space was wanted. The meaning did not leave with them: each carries a full sentence
 * as both its `aria-label` and its `title`, naming the value that takes over. Two glyphs, not one — `↺`
 * where something underneath takes over, `✕` where nothing does — and the `✕` asks before it acts. See
 * `DeveloperRow` for the whole argument, including why the requested `-` was not the glyph used.
 *
 * ## Effective value in, override out
 *
 * A Customize control is bound to the *effective* value: the override if there is one, otherwise the
 * ui-kit default. A control showing an empty box for a token nobody has set would be a control that
 * makes the default invisible, and the author's first question about `--perch-stale` is what it is
 * now. Editing writes an override through the same `onSet` the raw text box uses, so a drag on a
 * picker is the same edit as a keystroke, validated by `editDraft` the same way. Nothing is written on
 * render: a token with no override stays absent from the document until somebody changes it.
 *
 * Every control also falls back to a plain text box when the document holds a value it cannot
 * represent — `clamp(1rem, 2vw, 3rem)` in a size, a colour written as `rgb()`. The rule from
 * `inspector.tsx` stands: a control that cannot show the current value hides the problem the validator
 * is reporting.
 */

import type { ElementKind } from '@perch/layout-schema';
import {
  PERCH_KNOWN_TOKENS,
  PERCH_TOKEN_LABELS,
  TOKEN_GROUPS,
  knownTokenDefault,
  tokenLabel,
  type TokenGroup,
  type TokenLabel,
} from '@perch/ui-kit';
import { useId, useState, type ReactNode } from 'react';
import { HexAlphaColorPicker, HexColorPicker } from 'react-colorful';

/** Which surface the map belongs to: a layout's `theme`, or one element's `style`. */
export type TokenScope = 'layout' | 'element';

export interface TokenPaneProps {
  /** Unique per pane on the page. Only used to build ids, so two panes' tabs stay distinct. */
  readonly id: string;
  /** What the map is called in the format: `theme`, `style`. */
  readonly title: string;
  readonly scope: TokenScope;
  /** The overrides the document actually holds. */
  readonly tokens: Readonly<Record<string, string>>;
  /**
   * The map one level up, whose values this surface falls back to before the `ui-kit` default does.
   *
   * For an element's `style` that is the layout's `theme`: `theme` is set on the canvas element and the
   * element's box is inside it, so a token the layout sets and the element does not is *inherited*. A
   * pane that called such a value "default" would name the wrong number — the author can see the
   * layout's value painting. Absent for a layout's own `theme`, which has nothing above it.
   */
  readonly inherited?: Readonly<Record<string, string>> | undefined;
  /**
   * For an element's `style`: which kind of element it is, so a token only other kinds read is left
   * out — a chart is offered no placement, a readout not the text element's. Absent offers every
   * token the scope allows.
   */
  readonly kind?: ElementKind | undefined;
  /** Set one token. Adds it if the document does not have it. */
  readonly onSet: (name: string, value: string) => void;
  /** Drop one token from the map. See the module comment on what that means for each tab. */
  readonly onRemove: (name: string) => void;
}

/** Which tab is showing. */
type Tab = 'customize' | 'developer';

const TABS: readonly { readonly tab: Tab; readonly label: string; readonly hint: string }[] =
  Object.freeze([
    { tab: 'customize', label: 'Customize', hint: 'every token, by name and type' },
    { tab: 'developer', label: 'Developer', hint: 'what this document holds' },
  ]);

/**
 * A `#rgb` or `#rrggbb` literal — the one token value shape a colour picker can drive — or, where the
 * token carries alpha, `#rgba` and `#rrggbbaa` too.
 *
 * Alpha is accepted only where it is asked for. A plain picker handed `#1a2b3c80` would drop the pair
 * on the first drag, so a non-alpha token holding one shows it as text rather than lose it.
 */
export function isHexColor(value: string, alpha = false): boolean {
  const pattern = alpha
    ? /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
    : /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  return pattern.test(value.trim());
}

/** A whole, non-negative count of layout pixels: what a pixel slider can hold. */
function isPixelCount(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

/** A number with a unit, split — `['1.25', 'rem']` — or `undefined` for anything else. */
function splitLength(value: string): readonly [string, string] | undefined {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]+)$/.exec(value.trim());

  return match === null ? undefined : [match[1] ?? '', match[2] ?? ''];
}

/**
 * The tokens a surface can usefully set: an element cannot change what the canvas reads, and is not
 * offered a token that only other kinds of element read.
 */
function tokensFor(scope: TokenScope, kind: ElementKind | undefined): readonly string[] {
  return PERCH_KNOWN_TOKENS.filter((name) => {
    if (scope === 'layout') return true;

    const entry = PERCH_TOKEN_LABELS[name];
    if (entry.scope === 'canvas') return false;

    return kind === undefined || entry.kinds === undefined || entry.kinds.includes(kind);
  });
}

/**
 * The sections in the order this surface shows them.
 *
 * An element's pane leads with its box — the background, corners, padding and placement an author
 * selected one entity to change. The layout's theme keeps colour first, as it always has, and puts the
 * box last: there it is a default for every entity at once, the least-touched thing on that pane.
 */
function groupsFor(
  scope: TokenScope,
): readonly { readonly group: TokenGroup; readonly title: string }[] {
  if (scope === 'element') return TOKEN_GROUPS;

  return [
    ...TOKEN_GROUPS.filter((entry) => entry.group !== 'box'),
    ...TOKEN_GROUPS.filter((entry) => entry.group === 'box'),
  ];
}

/** The whole pane: a title, two tabs, and one panel. */
export function TokenPane({
  id,
  title,
  scope,
  tokens,
  inherited,
  kind,
  onSet,
  onRemove,
}: TokenPaneProps): ReactNode {
  const [tab, setTab] = useState<Tab>('customize');
  const base = `perch-token-pane-${id}`;
  const known = tokensFor(scope, kind);
  const overridden = known.filter((name) => tokens[name] !== undefined).length;
  const custom = Object.keys(tokens).filter((name) => tokenLabel(name) === undefined).length;

  return (
    <section className="perch-editor-section perch-editor-token-pane">
      <h3 className="perch-editor-title">
        {title}
        <span className="perch-editor-hint">
          {`${overridden} of ${known.length} set${custom === 0 ? '' : ` · ${custom} custom`}`}
        </span>
      </h3>

      <div className="perch-editor-tabs" role="tablist" aria-label={`${title} tabs`}>
        {TABS.map((entry) => (
          <button
            key={entry.tab}
            type="button"
            role="tab"
            id={`${base}-tab-${entry.tab}`}
            className="perch-editor-tab"
            aria-selected={tab === entry.tab}
            aria-controls={`${base}-panel`}
            data-perch-selected={tab === entry.tab ? 'true' : 'false'}
            onClick={() => {
              setTab(entry.tab);
            }}
          >
            {entry.label}
            <span className="perch-editor-hint">{entry.hint}</span>
          </button>
        ))}
      </div>

      <div
        className="perch-editor-tabpanel"
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-tab-${tab}`}
        data-testid={`${base}-panel`}
      >
        {tab === 'customize' ? (
          <CustomizeTab
            pane={id}
            groups={groupsFor(scope)}
            tokens={tokens}
            inherited={inherited}
            known={known}
            onSet={onSet}
            onRemove={onRemove}
          />
        ) : (
          <DeveloperTab
            pane={id}
            title={title}
            tokens={tokens}
            inherited={inherited}
            onSet={onSet}
            onRemove={onRemove}
          />
        )}
      </div>
    </section>
  );
}

/**
 * A row's `data-testid`, scoped to the pane it is in.
 *
 * The inspector renders two of these panes at once — the layout's `theme`, and the selected element's
 * `style` — and both list `--perch-fg`. A testid that was the bare token name therefore appeared twice
 * in one document, which is a query that either throws or silently answers about the wrong pane.
 */
function rowTestId(pane: string, name: string): string {
  return `perch-editor-token-${pane}-${name}`;
}

/** The vocabulary, grouped, with a type-appropriate control per token. */
function CustomizeTab({
  pane,
  groups,
  tokens,
  inherited,
  known,
  onSet,
  onRemove,
}: {
  readonly pane: string;
  readonly groups: readonly { readonly group: TokenGroup; readonly title: string }[];
  readonly tokens: Readonly<Record<string, string>>;
  readonly inherited: Readonly<Record<string, string>> | undefined;
  readonly known: readonly string[];
  readonly onSet: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
}): ReactNode {
  return (
    <>
      {groups.map(({ group, title }) => {
        const names = inGroupOrder(known.filter((name) => labelOf(name).group === group));
        if (names.length === 0) return null;

        return (
          <div className="perch-editor-subsection" key={group}>
            <h4 className="perch-editor-subtitle">{title}</h4>
            {names.map((name) => (
              <CustomizeRow
                key={name}
                pane={pane}
                name={name}
                entry={labelOf(name)}
                override={tokens[name]}
                inherited={inherited?.[name]}
                onSet={onSet}
                onRemove={onRemove}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

/**
 * A section's rows in the order a person reads them: the box's own tokens — background, corners,
 * padding — ahead of the placement a widget reads inside it. Otherwise declaration order, unchanged.
 */
function inGroupOrder(names: readonly string[]): readonly string[] {
  return [
    ...names.filter((name) => labelOf(name).scope === 'box'),
    ...names.filter((name) => labelOf(name).scope !== 'box'),
  ];
}

/** A known token's entry. Only called for names drawn from `PERCH_KNOWN_TOKENS`. */
function labelOf(name: string): TokenLabel {
  const entry = tokenLabel(name);
  // Unreachable from this file's own call sites, and a throw rather than a fallback label: a row whose
  // label had been invented here would be exactly the failure `token-labels.ts` exists to prevent.
  if (entry === undefined) throw new Error(`no ui-kit label for ${name}`);

  return entry;
}

/**
 * One token, label first.
 *
 * `override` is `undefined` when this surface does not set the token, which is the case that decides
 * almost everything visible here: whether the row says it is overridden, whether it offers a reset, and
 * whether it prints what that reset would uncover. The control is bound to the effective value either
 * way.
 *
 * `inherited` is what the surface one level up sets, and it changes only what the row *says*: the
 * effective value under an element's own override is the layout's, not the package's, and a reset here
 * uncovers the layout's value rather than the package default. So `fallback` — not `declared` — is what
 * the row prints and what the reset's accessible name promises. Printing the package default beside a
 * reset that will not produce it is the exact defect the previous slice removed, one control along.
 *
 * The `ui-kit` default *behind* an inherited value is deliberately not shown. It is a fact about the
 * package rather than about this document, nobody can reach it from this row without first clearing the
 * layout's value too, and this tab is where the raw vocabulary does not belong.
 */
function CustomizeRow({
  pane,
  name,
  entry,
  override,
  inherited,
  onSet,
  onRemove,
}: {
  readonly pane: string;
  readonly name: string;
  readonly entry: TokenLabel;
  readonly override: string | undefined;
  readonly inherited: string | undefined;
  readonly onSet: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
}): ReactNode {
  const inputId = useId();
  const fallback = inherited ?? knownTokenDefault(name) ?? '';
  const value = override ?? fallback;
  const isOverride = override !== undefined;
  const source = inherited === undefined ? 'the ui-kit default' : 'the layout theme value';
  // "default #f2f4f8", or "layout theme #e8f1ff". Two words and a value: enough for the number to be
  // attributed, short enough to sit in a row beside a button without becoming the row's subject.
  const revertsTo = `${inherited === undefined ? 'default' : 'layout theme'} ${fallback}`;

  return (
    <div
      className="perch-editor-token-row"
      data-testid={rowTestId(pane, name)}
      data-perch-overridden={isOverride ? 'true' : 'false'}
    >
      <div className="perch-editor-token-row__head">
        <label className="perch-editor-token-row__label" htmlFor={inputId}>
          {entry.label}
        </label>
        {isOverride ? (
          <span className="perch-editor-flag" data-testid={`perch-editor-override-${pane}-${name}`}>
            set by this layout
          </span>
        ) : (
          <span className="perch-editor-hint">
            {inherited === undefined ? 'default' : 'from the layout theme'}
          </span>
        )}
        <span className="perch-editor-spacer" />
        {isOverride ? (
          <>
            {/*
              Quiet, and next to the control it belongs to rather than under the label: it is not a
              fact about the token, it is the consequence of pressing the button beside it.
            */}
            <span className="perch-editor-reverts">{revertsTo}</span>
            {/*
              The same `↺` the Developer tab uses, because it is the same edit, and icon-only for the
              same reason: the word `reset` plus this row's new quiet text would make the head wider
              than the one that prompted the complaint. What differs between the tabs is the sentence
              in the accessible name — this one says `reset` and names the token by its label, that one
              says `remove this layout's value` and names it by its raw property — and that difference
              is the two readers, not two actions. There is no `✕` here at all: this tab cannot delete.
            */}
            <IconButton
              className="perch-editor-icon perch-editor-icon--reset"
              glyph="↺"
              label={`reset ${entry.label} to ${source} ${fallback}`}
              onClick={() => {
                onRemove(name);
              }}
            />
          </>
        ) : null}
      </div>

      <p className="perch-editor-token-row__about">{entry.description}</p>

      <TokenControl
        id={inputId}
        label={entry.label}
        entry={entry}
        value={value}
        onValue={(next) => {
          onSet(name, next);
        }}
      />
    </div>
  );
}

/**
 * The control a token's type asks for, falling back to a text box for a value it cannot hold.
 *
 * The fallback is not a corner case to tidy away later: `validateTokenMap` accepts any well-formed
 * value, so `--perch-text-size: clamp(...)` is a legal document this pane has to be able to show.
 */
function TokenControl({
  id,
  label,
  entry,
  value,
  onValue,
}: {
  readonly id: string;
  readonly label: string;
  readonly entry: TokenLabel;
  readonly value: string;
  readonly onValue: (value: string) => void;
}): ReactNode {
  switch (entry.control) {
    case 'colour': {
      const alpha = entry.alpha === true;

      return isHexColor(value, alpha) ? (
        <ColourControl id={id} label={label} value={value} alpha={alpha} onValue={onValue} />
      ) : (
        <ValueInput id={id} value={value} onValue={onValue} />
      );
    }

    case 'pixels':
      return isPixelCount(value) && entry.range !== undefined ? (
        <PixelsControl
          id={id}
          label={label}
          value={value.trim()}
          min={entry.range.min}
          max={entry.range.max}
          onValue={onValue}
        />
      ) : (
        <ValueInput id={id} value={value} onValue={onValue} numeric />
      );

    case 'length': {
      const parts = splitLength(value);

      return parts === undefined ? (
        <ValueInput id={id} value={value} onValue={onValue} />
      ) : (
        <LengthControl
          id={id}
          label={label}
          amount={parts[0]}
          unit={parts[1]}
          units={entry.units ?? []}
          onValue={onValue}
        />
      );
    }

    case 'choice': {
      const options = entry.options ?? [];

      return options.includes(value) ? (
        <select
          id={id}
          className="perch-editor-input"
          value={value}
          onChange={(event) => {
            onValue(event.target.value);
          }}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {entry.optionLabels?.[option] ?? option}
            </option>
          ))}
        </select>
      ) : (
        <ValueInput id={id} value={value} onValue={onValue} />
      );
    }

    case 'number':
      return <ValueInput id={id} value={value} onValue={onValue} numeric />;

    case 'text':
      return <ValueInput id={id} value={value} onValue={onValue} />;

    default:
      // `TokenControl` is a closed union in `ui-kit`; a new member arrives here as a compile error.
      return assertNeverControl(entry.control);
  }
}

/** A widened `assertNever` for the control union, kept local so this file needs no ui-kit helper. */
function assertNeverControl(control: never): never {
  throw new Error(`unhandled token control: ${String(control)}`);
}

/**
 * A value as text, which every control ultimately is.
 *
 * `type="text"` even for a number, for the reason `inspector.tsx` gives at length: `type="number"`
 * hands back `''` for anything it dislikes, and a token value that silently became empty is one the
 * format rejects with a sentence about removing the key.
 */
function ValueInput({
  id,
  value,
  onValue,
  numeric = false,
}: {
  readonly id: string;
  readonly value: string;
  readonly onValue: (value: string) => void;
  readonly numeric?: boolean;
}): ReactNode {
  return (
    <input
      id={id}
      className={`perch-editor-input${numeric ? ' perch-editor-input--number' : ''}`}
      type="text"
      {...(numeric ? { inputMode: 'decimal' as const } : {})}
      value={value}
      onChange={(event) => {
        onValue(event.target.value);
      }}
    />
  );
}

/**
 * A hex colour: the swatch that is also the current colour and the picker behind it, then the literal.
 *
 * Colour first. The swatch is the thing an author scanning a column of rows recognises, and it is also
 * the control that does the editing they came to do; `#e8f1ff` is the notation, and notation is what
 * you read once you are already at the right row. The literal stays a real editable field and stays in
 * sync both ways — typing into it moves the picker, dragging the picker rewrites it — because the two
 * are one value and an author who knows the hex they want should not have to find it on a wheel.
 */
function ColourControl({
  id,
  label,
  value,
  alpha,
  onValue,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /** Whether the token carries an alpha pair, which decides the picker and the swatch backdrop. */
  readonly alpha: boolean;
  readonly onValue: (value: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const Picker = alpha ? HexAlphaColorPicker : HexColorPicker;

  return (
    <div className="perch-editor-token-group">
      <div className="perch-editor-token">
        <button
          type="button"
          className={`perch-editor-swatch${alpha ? ' perch-editor-swatch--alpha' : ''}`}
          data-testid="perch-editor-swatch"
          aria-label={`${open ? 'hide' : 'show'} colour picker for ${label}`}
          aria-expanded={open}
          style={swatchStyle(value, alpha)}
          onClick={() => {
            setOpen((shown) => !shown);
          }}
        />
        <ValueInput id={id} value={value} onValue={onValue} />
      </div>
      {open ? (
        <Picker className="perch-editor-colour" color={value.trim()} onChange={onValue} />
      ) : null}
    </div>
  );
}

/**
 * A swatch's fill. For an alpha colour, the colour is laid over a checkerboard, because a translucent
 * swatch over the pane's own dark grey is indistinguishable from an opaque darker colour — and the
 * alpha is exactly what the author is looking at the swatch to judge.
 */
function swatchStyle(value: string, alpha: boolean): { background: string } {
  const colour = value.trim();

  return {
    background: alpha
      ? `linear-gradient(${colour}, ${colour}), repeating-conic-gradient(#6b7889 0 25%, #262c36 0 50%) 0 0 / 8px 8px`
      : colour,
  };
}

/**
 * A whole number of layout pixels: a bounded slider and a number field, bound to one value.
 *
 * The slider is for feel, the field for an exact value, and both write the same unitless string — the
 * spelling `ui-kit` multiplies into `px` on the scaled canvas, so `12` is twelve *layout* pixels and
 * scales with the panel like the rects do. The field accepts a value past the slider's end, because
 * the bound is a sensible range, not a rule the format makes; the slider then sits at its end.
 *
 * A native `<input type="range">`, so the arrow keys, Page Up/Down and Home/End work with no code
 * here, and the field is `type="text"` for the reason `ValueInput` gives.
 */
function PixelsControl({
  id,
  label,
  value,
  min,
  max,
  onValue,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly min: number;
  readonly max: number;
  readonly onValue: (value: string) => void;
}): ReactNode {
  return (
    <div className="perch-editor-token perch-editor-token--pixels">
      <input
        className="perch-editor-slider"
        type="range"
        aria-label={`${label} slider`}
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => {
          onValue(event.target.value);
        }}
      />
      <input
        id={id}
        className="perch-editor-input perch-editor-input--number perch-editor-input--pixels"
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(event) => {
          onValue(event.target.value.trim());
        }}
      />
      <span className="perch-editor-hint">layout px</span>
    </div>
  );
}

/**
 * A size: the number, and its unit as a select.
 *
 * The two halves are written back as one value, so the document only ever holds `1.25rem` and never an
 * intermediate `1.25`. The unit select carries the current unit even when it is not one of the offered
 * ones, for the same reason every other control here does.
 */
function LengthControl({
  id,
  label,
  amount,
  unit,
  units,
  onValue,
}: {
  readonly id: string;
  readonly label: string;
  readonly amount: string;
  readonly unit: string;
  readonly units: readonly string[];
  readonly onValue: (value: string) => void;
}): ReactNode {
  const offered = units.includes(unit) ? units : [unit, ...units];

  return (
    <div className="perch-editor-token">
      <input
        id={id}
        className="perch-editor-input perch-editor-input--number"
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(event) => {
          onValue(`${event.target.value.trim()}${unit}`);
        }}
      />
      <select
        className="perch-editor-input perch-editor-input--unit"
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
    </div>
  );
}

/** The document's own keys, by raw name, with add and remove. */
function DeveloperTab({
  pane,
  title,
  tokens,
  inherited,
  onSet,
  onRemove,
}: {
  readonly pane: string;
  readonly title: string;
  readonly tokens: Readonly<Record<string, string>>;
  readonly inherited: Readonly<Record<string, string>> | undefined;
  readonly onSet: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
}): ReactNode {
  const entries = Object.entries(tokens);

  return (
    <>
      {entries.length === 0 ? (
        <p className="perch-editor-empty" data-testid={`perch-editor-token-empty-${pane}`}>
          {`nothing here sets a ${title} token, so every token falls back to ${
            inherited === undefined
              ? 'the ui-kit default'
              : 'the layout theme, then the ui-kit default'
          }. add one below, or use Customize.`}
        </p>
      ) : (
        entries.map(([name, value]) => (
          <DeveloperRow
            key={name}
            pane={pane}
            name={name}
            value={value}
            inherited={inherited?.[name]}
            onSet={onSet}
            onRemove={onRemove}
          />
        ))
      )}
      <AddToken onAdd={onSet} />
    </>
  );
}

/**
 * One key as the document spells it.
 *
 * ## The removal, as an icon, still carrying two meanings
 *
 * The words are out of the row — `remove override` was the widest thing in a list of monospace names,
 * and a raw-document list is where space is scarcest. What did *not* come out is the distinction the
 * words existed to draw, because the two removals still have two different consequences:
 *
 * - For a name `ui-kit` declares, the value underneath takes over — the layout's value above it if this
 *   is an element's map, the package's default otherwise — and the dashboard keeps painting. `↺`, the
 *   revert glyph, deliberately not the `-` that was asked for: a minus reads as *take this away*, which
 *   is the implication that is wrong here. Nothing is taken away; one layer is.
 * - For a name it does not declare there is no layer underneath, so the value is gone. `✕`, in the red
 *   the row's left border already uses, **and** a confirm: with the word `delete` replaced by a glyph,
 *   a second deliberate click is what is left to carry the deliberateness the word carried, and this
 *   editor has no undo (see `app.tsx`) so a misaimed click is unrecoverable until a reload.
 *
 * A different glyph, a different colour, a different accessible name and a different number of clicks.
 * Colour alone would not do it — it is the one difference a reader may not be able to see.
 *
 * ## An accessible name and a tooltip, not a tooltip alone
 *
 * Each button's whole sentence is its `aria-label`, and the same string is its `title`. A `title` alone
 * is invisible to a keyboard and to a touch screen, which for an icon-only control means the meaning is
 * reachable only by a mouse-user who happens to hover. The glyph itself is `aria-hidden`, so a screen
 * reader reads the sentence rather than the character.
 */
function DeveloperRow({
  pane,
  name,
  value,
  inherited,
  onSet,
  onRemove,
}: {
  readonly pane: string;
  readonly name: string;
  readonly value: string;
  readonly inherited: string | undefined;
  readonly onSet: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
}): ReactNode {
  const inputId = useId();
  const [confirming, setConfirming] = useState(false);
  const entry = tokenLabel(name);
  // What actually takes over, which on an element's map is the layout's value before the package's. The
  // Customize tab says the same thing in the same words; a name is not a different fact in a raw list.
  const takesOver =
    inherited === undefined
      ? `the ui-kit default ${knownTokenDefault(name) ?? ''}`
      : `the layout theme value ${inherited}`;

  return (
    <div
      className="perch-editor-token-row"
      data-testid={rowTestId(pane, name)}
      data-perch-known={entry === undefined ? 'false' : 'true'}
    >
      <div className="perch-editor-token-row__head">
        <label className="perch-editor-token-row__name" htmlFor={inputId}>
          <code>{name}</code>
        </label>
        {entry === undefined ? (
          <span className="perch-editor-flag perch-editor-flag--custom">
            no label · ui-kit does not declare this token
          </span>
        ) : (
          <span className="perch-editor-hint">{entry.label}</span>
        )}
        <span className="perch-editor-spacer" />
        {entry === undefined ? (
          <DeleteControl
            name={name}
            confirming={confirming}
            onAsk={() => {
              setConfirming(true);
            }}
            onCancel={() => {
              setConfirming(false);
            }}
            onConfirm={() => {
              setConfirming(false);
              onRemove(name);
            }}
          />
        ) : (
          <IconButton
            className="perch-editor-icon"
            glyph="↺"
            label={`remove this layout's value for ${name}, back to ${takesOver}`}
            onClick={() => {
              onRemove(name);
            }}
          />
        )}
      </div>

      <div className="perch-editor-token">
        {isHexColor(value, entry?.alpha === true) ? (
          <span
            className="perch-editor-swatch perch-editor-swatch--static"
            data-testid="perch-editor-swatch-static"
            style={swatchStyle(value, entry?.alpha === true)}
          />
        ) : null}
        <ValueInput
          id={inputId}
          value={value}
          onValue={(next) => {
            onSet(name, next);
          }}
        />
      </div>
    </div>
  );
}

/**
 * An icon-only button whose meaning lives in its accessible name.
 *
 * One component rather than an `aria-label` written at each call site, because the rule that makes an
 * icon button legitimate — the sentence is the `aria-label` *and* the `title`, and the glyph is hidden
 * from assistive technology — is a rule that holds for all of them and gets forgotten at the second.
 */
function IconButton({
  className,
  glyph,
  label,
  onClick,
}: {
  readonly className: string;
  readonly glyph: string;
  readonly label: string;
  readonly onClick: () => void;
}): ReactNode {
  return (
    <button type="button" className={className} aria-label={label} title={label} onClick={onClick}>
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

/**
 * The destructive removal, which asks first.
 *
 * The confirm is inline and made of ordinary buttons rather than `window.confirm`: a native dialog
 * cannot be styled to say which token it is about, blocks the whole page, and is not reachable by the
 * tests that are supposed to prove this control behaves. Both states say the token's name, because a
 * confirm that asks "are you sure?" about an unnamed thing is a confirm nobody reads.
 */
function DeleteControl({
  name,
  confirming,
  onAsk,
  onCancel,
  onConfirm,
}: {
  readonly name: string;
  readonly confirming: boolean;
  readonly onAsk: () => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): ReactNode {
  const gone = `ui-kit declares no default for it, so nothing takes over: the value is gone.`;

  if (!confirming) {
    return (
      <IconButton
        className="perch-editor-icon perch-editor-icon--delete"
        glyph="✕"
        label={`delete ${name}. ${gone}`}
        onClick={onAsk}
      />
    );
  }

  return (
    <span className="perch-editor-confirm" role="group" aria-label={`delete ${name}?`}>
      <span className="perch-editor-hint">delete? nothing takes over.</span>
      <button
        type="button"
        className="perch-editor-icon perch-editor-icon--delete"
        aria-label={`confirm: delete ${name}. ${gone}`}
        title={`confirm: delete ${name}. ${gone}`}
        onClick={onConfirm}
      >
        delete
      </button>
      <button
        type="button"
        className="perch-editor-icon"
        aria-label={`keep ${name}`}
        title={`keep ${name}`}
        onClick={onCancel}
      >
        keep
      </button>
    </span>
  );
}

/**
 * The add-a-token control.
 *
 * Local state, and it needs it: a name and a value are meaningless apart, and writing the name into the
 * document as it is typed would create `--p`, then `--pe`, then `--per`, each one a validation error
 * the author did not make. So the pair is held here until both are present.
 */
function AddToken({ onAdd }: { readonly onAdd: (name: string, value: string) => void }): ReactNode {
  const nameId = useId();
  const valueId = useId();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const ready = name.trim() !== '' && value.trim() !== '';

  return (
    <div className="perch-editor-token perch-editor-token--add">
      <label className="perch-editor-field" htmlFor={nameId}>
        <span className="perch-editor-label">new token</span>
        <input
          id={nameId}
          className="perch-editor-input"
          type="text"
          placeholder="--perch-fg"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>
      <label className="perch-editor-field" htmlFor={valueId}>
        <span className="perch-editor-label">new value</span>
        <input
          id={valueId}
          className="perch-editor-input"
          type="text"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
      </label>
      <button
        type="button"
        className="perch-editor-add"
        disabled={!ready}
        onClick={() => {
          if (!ready) return;
          onAdd(name.trim(), value.trim());
          setName('');
          setValue('');
        }}
      >
        add
      </button>
    </div>
  );
}

/**
 * This pane's own styles.
 *
 * The shared form primitives — `.perch-editor-input`, `.perch-editor-field`, `.perch-editor-label` —
 * stay in `INSPECTOR_STYLES`, because the whole inspector is one visual form and two copies of an
 * input rule is how two halves of one pane start looking different. What moved here with the controls
 * is everything only a token row uses.
 */
export const TOKEN_PANE_STYLES = `
.perch-editor-token-pane { gap: 8px; }
.perch-editor-token-group { display: flex; flex-direction: column; gap: 6px; }
.perch-editor-token { display: flex; align-items: flex-end; gap: 6px; }
.perch-editor-swatch {
  flex: none;
  align-self: flex-end;
  width: 26px;
  height: 26px;
  border: 1px solid #262c36;
  border-radius: 3px;
  padding: 0;
  cursor: pointer;
}
.perch-editor-swatch:focus-visible { outline: 2px solid #8fb7e8; outline-offset: 0; }
/* Fit react-colorful into the column. Two class selectors, to beat its own .react-colorful rule. */
.perch-editor-token-group .perch-editor-colour { width: 100%; height: 150px; }
.perch-editor-add {
  flex: none;
  border: 1px solid #262c36;
  border-radius: 3px;
  background: #171b22;
  color: #9aa4b2;
  font: inherit;
  font-size: 0.6875rem;
  padding: 3px 8px;
  cursor: pointer;
}
.perch-editor-add:disabled { color: #4c586b; cursor: not-allowed; }
.perch-editor-tabs { display: flex; gap: 4px; }
.perch-editor-tab {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  border: 1px solid #262c36;
  border-radius: 3px;
  background: #0d1016;
  color: #9aa4b2;
  font: inherit;
  font-size: 0.75rem;
  text-align: left;
  padding: 3px 8px;
  cursor: pointer;
}
.perch-editor-tab[data-perch-selected='true'] {
  border-color: #8fb7e8;
  background: #101a26;
  color: #e8f1ff;
}
.perch-editor-tab:focus-visible { outline: 2px solid #8fb7e8; outline-offset: 0; }
.perch-editor-tabpanel { display: flex; flex-direction: column; gap: 8px; }
.perch-editor-token-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-left: 2px solid transparent;
  padding-left: 6px;
}
.perch-editor-token-row[data-perch-overridden='true'] { border-left-color: #8fb7e8; }
.perch-editor-token-row[data-perch-known='false'] { border-left-color: #c8a06b; }
.perch-editor-token-row__head { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.perch-editor-token-row__label { font-size: 0.8125rem; color: #e8f1ff; }
.perch-editor-token-row__name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
  color: #e8f1ff;
  overflow-wrap: anywhere;
}
.perch-editor-token-row__about { margin: 0; font-size: 0.6875rem; color: #6b7889; }
.perch-editor-token-row__detail {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1px 8px;
  margin: 0;
  font-size: 0.6875rem;
  color: #9aa4b2;
}
.perch-editor-token-row__detail dt { color: #4c586b; }
.perch-editor-token-row__detail dd { margin: 0; overflow-wrap: anywhere; }
.perch-editor-token-row__detail code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  user-select: all;
}
.perch-editor-flag {
  border-radius: 999px;
  border: 1px solid #2e4665;
  background: #101a26;
  color: #8fb7e8;
  font-size: 0.625rem;
  padding: 0 6px;
  white-space: nowrap;
}
.perch-editor-flag--custom { border-color: #5e4a23; background: #261e10; color: #e8c98f; }
.perch-editor-icon {
  flex: none;
  border: 1px solid #262c36;
  border-radius: 3px;
  background: #171b22;
  color: #9aa4b2;
  font: inherit;
  font-size: 0.625rem;
  padding: 1px 6px;
  cursor: pointer;
}
.perch-editor-icon--reset { border-color: #2e4665; color: #8fb7e8; }
.perch-editor-icon:focus-visible { outline: 2px solid #8fb7e8; outline-offset: 0; }
/*
  An icon button is square and tall enough to hit. 20px is under the 24px a touch target wants, and
  said so on purpose: this is a dense desktop inspector and the row it sits in is 22px, so the honest
  claim is that it is a pointer-and-keyboard control, which is what this editor is.
*/
.perch-editor-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  font-size: 0.8125rem;
  line-height: 1;
}
.perch-editor-icon--delete { border-color: #5e2323; background: #241010; color: #e8a08f; }
/* The confirm's two buttons carry words, so they are not square. */
.perch-editor-confirm { display: inline-flex; align-items: center; gap: 4px; }
.perch-editor-confirm .perch-editor-icon { width: auto; padding: 1px 6px; font-size: 0.625rem; }
/*
  What a reset uncovers. Quiet: it is the consequence of the button beside it, not a fact competing
  with the row's own value.
*/
.perch-editor-reverts {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.625rem;
  color: #6b7889;
  white-space: nowrap;
}
.perch-editor-input--unit { flex: none; width: 4.5em; }
.perch-editor-token--pixels { align-items: center; }
.perch-editor-slider { flex: 1 1 auto; min-width: 0; accent-color: #8fb7e8; }
.perch-editor-slider:focus-visible { outline: 2px solid #8fb7e8; outline-offset: 2px; }
.perch-editor-input--pixels { flex: none; width: 4em; }
.perch-editor-swatch--static { cursor: default; }
.perch-editor-token--add { align-items: flex-end; margin-top: 4px; }
`;
