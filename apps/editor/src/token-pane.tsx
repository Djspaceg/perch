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
 *    name outside the 31 `ui-kit` declares can exist — and for *that* there is no default underneath,
 *    so removing it really does delete the value. One word over two consequences is the defect.
 *
 * So there are two tabs, and they are two intents rather than two skill levels:
 *
 * - **Customize** is the vocabulary. Every known token for this surface, whether the document sets it
 *   or not, under the label `ui-kit` gives it, with a control that fits the token's type — a picker
 *   for a colour, a number and a unit for a size, a closed select for `text-transform`. It shows which
 *   values are the layout's own and offers a reset for exactly those. It cannot add a name and cannot
 *   delete a token: there is nothing here whose effect is unrecoverable.
 * - **Developer** is the document. Only the keys actually present, by raw name, each marked with
 *   whether `ui-kit` knows it, add and remove available, and the two removals worded for their two
 *   different consequences.
 *
 * ## A disclosure, not a tooltip
 *
 * The raw token name is behind a per-row disclosure button rather than a `title` tooltip. A `title` is
 * invisible to a keyboard and to a touch screen, it cannot be copied, and it can hold one string —
 * whereas what is worth revealing is two facts, the token name *and* the value it defaults to. A
 * button with `aria-expanded` is reachable by Tab, works on a phone, and the revealed name is real
 * selectable text an author can paste into a layout file.
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

import {
  PERCH_KNOWN_TOKENS,
  PERCH_TOKEN_LABELS,
  TOKEN_GROUPS,
  knownTokenDefault,
  tokenLabel,
  type TokenLabel,
} from '@perch/ui-kit';
import { useId, useState, type ReactNode } from 'react';
import { HexColorPicker } from 'react-colorful';

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

/** A `#rgb` or `#rrggbb` literal — the one token value shape a colour picker can drive. */
export function isHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

/** A number with a unit, split — `['1.25', 'rem']` — or `undefined` for anything else. */
function splitLength(value: string): readonly [string, string] | undefined {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]+)$/.exec(value.trim());

  return match === null ? undefined : [match[1] ?? '', match[2] ?? ''];
}

/** The tokens a surface can usefully set: an element cannot change what the canvas reads. */
function tokensFor(scope: TokenScope): readonly string[] {
  return PERCH_KNOWN_TOKENS.filter(
    (name) => scope === 'layout' || PERCH_TOKEN_LABELS[name].scope === 'widget',
  );
}

/** The whole pane: a title, two tabs, and one panel. */
export function TokenPane({
  id,
  title,
  scope,
  tokens,
  inherited,
  onSet,
  onRemove,
}: TokenPaneProps): ReactNode {
  const [tab, setTab] = useState<Tab>('customize');
  const base = `perch-token-pane-${id}`;
  const known = tokensFor(scope);
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
            tokens={tokens}
            inherited={inherited}
            known={known}
            onSet={onSet}
            onRemove={onRemove}
          />
        ) : (
          <DeveloperTab
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

/** The vocabulary, grouped, with a type-appropriate control per token. */
function CustomizeTab({
  tokens,
  inherited,
  known,
  onSet,
  onRemove,
}: {
  readonly tokens: Readonly<Record<string, string>>;
  readonly inherited: Readonly<Record<string, string>> | undefined;
  readonly known: readonly string[];
  readonly onSet: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
}): ReactNode {
  return (
    <>
      {TOKEN_GROUPS.map(({ group, title }) => {
        const names = known.filter((name) => labelOf(name).group === group);
        if (names.length === 0) return null;

        return (
          <div className="perch-editor-subsection" key={group}>
            <h4 className="perch-editor-subtitle">{title}</h4>
            {names.map((name) => (
              <CustomizeRow
                key={name}
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
 * almost everything visible here: whether the row says it is overridden, and whether it offers a
 * reset. The control is bound to the effective value either way.
 *
 * `inherited` is what the surface one level up sets, and it changes only what the row *says*: the
 * effective value under an element's own override is the layout's, not the package's, and a reset here
 * uncovers the layout's value rather than the default. Both numbers stay reachable — the disclosure
 * prints the layout's value and the `ui-kit` default side by side, since "what does this fall back to"
 * and "what does the package think this should be" are two different questions an author asks.
 */
function CustomizeRow({
  name,
  entry,
  override,
  inherited,
  onSet,
  onRemove,
}: {
  readonly name: string;
  readonly entry: TokenLabel;
  readonly override: string | undefined;
  readonly inherited: string | undefined;
  readonly onSet: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
}): ReactNode {
  const [shown, setShown] = useState(false);
  const inputId = useId();
  const detailId = useId();
  const declared = knownTokenDefault(name) ?? '';
  const fallback = inherited ?? declared;
  const value = override ?? fallback;
  const isOverride = override !== undefined;
  const source = inherited === undefined ? 'the ui-kit default' : 'the layout theme value';

  return (
    <div
      className="perch-editor-token-row"
      data-testid={`perch-editor-token-${name}`}
      data-perch-overridden={isOverride ? 'true' : 'false'}
    >
      <div className="perch-editor-token-row__head">
        <label className="perch-editor-token-row__label" htmlFor={inputId}>
          {entry.label}
        </label>
        {isOverride ? (
          <span className="perch-editor-flag" data-testid={`perch-editor-override-${name}`}>
            set by this layout
          </span>
        ) : (
          <span className="perch-editor-hint">
            {inherited === undefined ? 'default' : 'from the layout theme'}
          </span>
        )}
        <span className="perch-editor-spacer" />
        <button
          type="button"
          className="perch-editor-disclose"
          aria-expanded={shown}
          aria-controls={detailId}
          aria-label={`${shown ? 'hide' : 'show'} the token name for ${entry.label}`}
          onClick={() => {
            setShown((open) => !open);
          }}
        >
          {shown ? 'hide name' : 'name'}
        </button>
        {isOverride ? (
          <button
            type="button"
            className="perch-editor-reset"
            aria-label={`reset ${entry.label} to ${source} ${fallback}`}
            onClick={() => {
              onRemove(name);
            }}
          >
            reset
          </button>
        ) : null}
      </div>

      <p className="perch-editor-token-row__about">{entry.description}</p>

      {shown ? (
        <dl className="perch-editor-token-row__detail" id={detailId}>
          <dt>token</dt>
          <dd>
            <code>{name}</code>
          </dd>
          {inherited === undefined ? null : (
            <>
              <dt>layout theme</dt>
              <dd>
                <code>{inherited}</code>
              </dd>
            </>
          )}
          <dt>default</dt>
          <dd>
            <code>{declared}</code>
          </dd>
        </dl>
      ) : null}

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
    case 'colour':
      return isHexColor(value) ? (
        <ColourControl id={id} label={label} value={value} onValue={onValue} />
      ) : (
        <ValueInput id={id} value={value} onValue={onValue} />
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
              {option}
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

/** A hex colour: the literal, a swatch that is also the current colour, and a picker behind it. */
function ColourControl({
  id,
  label,
  value,
  onValue,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onValue: (value: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);

  return (
    <div className="perch-editor-token-group">
      <div className="perch-editor-token">
        <ValueInput id={id} value={value} onValue={onValue} />
        <button
          type="button"
          className="perch-editor-swatch"
          data-testid="perch-editor-swatch"
          aria-label={`${open ? 'hide' : 'show'} colour picker for ${label}`}
          aria-expanded={open}
          style={{ background: value.trim() }}
          onClick={() => {
            setOpen((shown) => !shown);
          }}
        />
      </div>
      {open ? (
        <HexColorPicker className="perch-editor-colour" color={value.trim()} onChange={onValue} />
      ) : null}
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
  title,
  tokens,
  inherited,
  onSet,
  onRemove,
}: {
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
        <p className="perch-editor-empty" data-testid="perch-editor-token-empty">
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
 * The removal is the one control in this pane whose meaning depends on the token, so the button says
 * which it is: `remove override` for a name `ui-kit` declares, because the default underneath takes
 * over and the dashboard keeps painting; `delete` for a name it does not, because there is nothing
 * underneath and the value is gone. They are also different colours, since the two sit in one column.
 */
function DeveloperRow({
  name,
  value,
  inherited,
  onSet,
  onRemove,
}: {
  readonly name: string;
  readonly value: string;
  readonly inherited: string | undefined;
  readonly onSet: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
}): ReactNode {
  const inputId = useId();
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
      data-testid={`perch-editor-token-${name}`}
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
          <button
            type="button"
            className="perch-editor-remove perch-editor-remove--delete"
            aria-label={`delete ${name}. ui-kit declares no default for it, so nothing takes over: the value is gone.`}
            onClick={() => {
              onRemove(name);
            }}
          >
            delete
          </button>
        ) : (
          <button
            type="button"
            className="perch-editor-remove"
            aria-label={`remove the override for ${name}. ${takesOver} takes over.`}
            onClick={() => {
              onRemove(name);
            }}
          >
            remove override
          </button>
        )}
      </div>

      <div className="perch-editor-token">
        <ValueInput
          id={inputId}
          value={value}
          onValue={(next) => {
            onSet(name, next);
          }}
        />
        {isHexColor(value) ? (
          <span
            className="perch-editor-swatch perch-editor-swatch--static"
            data-testid="perch-editor-swatch-static"
            style={{ background: value.trim() }}
          />
        ) : null}
      </div>
    </div>
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
.perch-editor-remove, .perch-editor-add {
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
.perch-editor-disclose, .perch-editor-reset {
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
.perch-editor-reset { border-color: #2e4665; color: #8fb7e8; }
.perch-editor-disclose:focus-visible, .perch-editor-reset:focus-visible {
  outline: 2px solid #8fb7e8;
  outline-offset: 0;
}
.perch-editor-remove--delete { border-color: #5e2323; background: #241010; color: #e8a08f; }
.perch-editor-input--unit { flex: none; width: 4.5em; }
.perch-editor-swatch--static { cursor: default; }
.perch-editor-token--add { align-items: flex-end; margin-top: 4px; }
`;
