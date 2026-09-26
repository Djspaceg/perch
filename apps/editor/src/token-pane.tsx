/**
 * A token map, for two different people, stamped from `ui-kit`'s labels.
 *
 * `theme` on a layout and `style` on an element are the same thing at two levels: a map of CSS custom
 * properties, each an **override** of a value `ui-kit` already declares. So there are two tabs, and
 * they are two intents rather than two skill levels:
 *
 * - **Customize** is the vocabulary: every known token for this surface, whether the document sets it
 *   or not, under its `ui-kit` label, with the control its label asks for, grouped into the sections
 *   `ui-kit` declares (`TOKEN_GROUPS`) and with the rarely tuned ones behind an Advanced foldout in
 *   their own section. It shows which values are set here and offers a reset for exactly those. It
 *   cannot add or delete a name, and it never prints a raw `--perch-...` name.
 * - **Developer** is the document: only the keys actually present, by raw name, add available, and
 *   the two removals shaped for their two consequences (`controls/reset-button.tsx`).
 *
 * ## Stamped, not written
 *
 * No row here is written by hand. Every token goes `TokenLabel` -> `tokenSpec` -> `SpecControl`
 * inside a `PropertyRow`, and a placement pair goes through one `AlignGrid`; so a new token in
 * `token-labels.ts` arrives in the right section with the right control and no markup. What this file
 * decides is only what is specific to a token map: the value a row shows (the override, else the
 * inherited layout value, else the default), where that value comes from, and what a reset returns to.
 *
 * ## Effective value in, override out
 *
 * A Customize control is bound to the *effective* value — a control showing an empty box for a token
 * nobody set would make the default invisible. Editing writes an override through `onSet`; nothing is
 * written on render.
 *
 * ## The inherited value is the one a reset names
 *
 * An element's `style` sits under the layout's `theme`, so a token the layout sets and the element
 * does not is *inherited*: the element paints the layout's value, and a reset of the element's own
 * override uncovers the layout's value, not the package default. So `fallback` — the layout theme's
 * value first, else the ui-kit default — is what a row is bound to and what its reset names. The pane
 * once named `#f2f4f8` while `#e8f1ff` was painting; `fallback` is the fix for that, kept here.
 */

import type { ElementKind } from '@perch/layout-schema';
import {
  PERCH_KNOWN_TOKENS,
  PERCH_TOKEN_LABELS,
  TOKEN_GROUPS,
  knownTokenDefault,
  tokenLabel,
  type KnownToken,
  type TokenGroup,
  type TokenLabel,
} from '@perch/ui-kit';
import { useState, type ReactNode } from 'react';
import {
  AdvancedSection,
  AlignGrid,
  FilterBar,
  PropertyRow,
  ResetButton,
  Section,
  TabStrip,
  matchesQuery,
  swatchStyle,
  type ReturnsTo,
  type TabSpec,
  type ValueSource,
} from './controls/index.js';
import { isHexColor, optionLabel, tokenSpec } from './descriptors.js';
import { SpecControl, TextControl, isGroupSpec, scrubFor } from './property-view.js';

export { isHexColor } from './descriptors.js';

/** Which surface the map belongs to: a layout's `theme`, or one element's `style`. */
export type TokenScope = 'layout' | 'element';

export interface TokenPaneProps {
  /** Unique per pane on the page. Only used to build ids and testids. */
  readonly id: string;
  /** What the map is called in the format: `theme`, `style`. */
  readonly title: string;
  readonly scope: TokenScope;
  /** The overrides the document actually holds. */
  readonly tokens: Readonly<Record<string, string>>;
  /** The map one level up — the layout's `theme`, for an element's `style`. */
  readonly inherited?: Readonly<Record<string, string>> | undefined;
  /** For an element's `style`: its kind, so a token only other kinds read is left out. */
  readonly kind?: ElementKind | undefined;
  readonly onSet: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
  /** Sections that are not tokens, shown first on the Customize tab: Target, or Content then Transform. */
  readonly leading?: ReactNode;
  /** Category chips under the tabs, one per `TOKEN_GROUPS` entry. */
  readonly chips?: boolean;
  /** Which token sections start open: all (`true`, the default), none, or the ones named. */
  readonly sectionsOpen?: boolean | readonly TokenGroup[];
  /** What the sections' open state is remembered under. Defaults to `id`. */
  readonly disclosureKey?: string;
}

type Tab = 'customize' | 'developer';

const TABS: readonly TabSpec<Tab>[] = Object.freeze([
  {
    id: 'customize',
    label: 'Customize',
    title: 'Every token this surface can set, by name and type',
  },
  { id: 'developer', label: 'Developer', title: 'What this document holds, by raw token name' },
]);

/** The chips: All, then one per section, in the sections' order. */
const CHIPS = Object.freeze([
  { id: 'all', label: 'All' },
  ...TOKEN_GROUPS.map((entry) => ({ id: entry.group, label: entry.title })),
]);

/**
 * The tokens a surface can usefully set: an element cannot change what the canvas reads, and is not
 * offered a token only other kinds of element read.
 */
function tokensFor(scope: TokenScope, kind: ElementKind | undefined): readonly KnownToken[] {
  return PERCH_KNOWN_TOKENS.filter((name) => {
    if (scope === 'layout') return true;
    const entry = PERCH_TOKEN_LABELS[name];
    if (entry.scope === 'canvas') return false;

    return kind === undefined || entry.kinds === undefined || entry.kinds.includes(kind);
  });
}

/**
 * A row's `data-testid`, scoped to the pane it is in: the inspector can hold two panes that both list
 * `--perch-fg`, and a bare-name testid would be ambiguous.
 */
function rowTestId(pane: string, name: string): string {
  return `perch-editor-token-${pane}-${name}`;
}

/** Everything a row needs to know about one token on one surface. */
interface TokenState {
  readonly name: KnownToken;
  readonly entry: TokenLabel;
  readonly override: string | undefined;
  readonly value: string;
  readonly source: ValueSource;
  readonly sourceText: string;
  readonly returnsTo: ReturnsTo;
}

function stateOf(
  name: KnownToken,
  scope: TokenScope,
  tokens: Readonly<Record<string, string>>,
  inherited: Readonly<Record<string, string>> | undefined,
): TokenState {
  const entry = PERCH_TOKEN_LABELS[name];
  const override = tokens[name];
  const above = inherited?.[name];
  const fallback = above ?? knownTokenDefault(name) ?? '';
  const source: ValueSource =
    override !== undefined ? 'own' : above !== undefined ? 'inherited' : 'default';
  const sourceText =
    source === 'own'
      ? scope === 'element'
        ? 'set by this entity'
        : 'set by this layout'
      : source === 'inherited'
        ? 'from the layout theme'
        : 'default';

  return {
    name,
    entry,
    override,
    value: override ?? fallback,
    source,
    sourceText,
    returnsTo: {
      source: above === undefined ? 'default' : 'layout',
      value: entry.control === 'choice' ? optionLabel(entry, fallback) : fallback,
    },
  };
}

/** The whole pane: tabs, a search, and the panel. */
export function TokenPane({
  id,
  title,
  scope,
  tokens,
  inherited,
  kind,
  onSet,
  onRemove,
  leading,
  chips = false,
  sectionsOpen = true,
  disclosureKey,
}: TokenPaneProps): ReactNode {
  const [tab, setTab] = useState<Tab>('customize');
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<string>('all');
  const base = `perch-token-pane-${id}`;
  const known = tokensFor(scope, kind);

  return (
    <div className="perch-token-pane">
      <TabStrip
        label={`${title} tabs`}
        idBase={base}
        tabs={TABS}
        selected={tab}
        onSelect={setTab}
        trailing={<FilterBar label={`search ${title} tokens`} query={query} onQuery={setQuery} />}
      />
      <div
        className="perch-token-pane__panel"
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-tab-${tab}`}
        data-testid={`${base}-panel`}
      >
        {tab === 'customize' ? (
          <>
            {chips ? <FilterBar chips={CHIPS} chip={chip} onChip={setChip} /> : null}
            {leading}
            <CustomizeSections
              pane={id}
              scope={scope}
              known={known}
              tokens={tokens}
              inherited={inherited}
              query={query}
              chip={chip}
              sectionsOpen={sectionsOpen}
              disclosureKey={disclosureKey ?? id}
              onSet={onSet}
              onRemove={onRemove}
            />
          </>
        ) : (
          <DeveloperTab
            pane={id}
            title={title}
            tokens={tokens}
            inherited={inherited}
            query={query}
            onSet={onSet}
            onRemove={onRemove}
          />
        )}
      </div>
    </div>
  );
}

/** Whether a token's section starts open. */
function opensByDefault(group: TokenGroup, sectionsOpen: boolean | readonly TokenGroup[]): boolean {
  return typeof sectionsOpen === 'boolean' ? sectionsOpen : sectionsOpen.includes(group);
}

/** The vocabulary, one folding section per `ui-kit` group, filtered by the search and the chip. */
function CustomizeSections({
  pane,
  scope,
  known,
  tokens,
  inherited,
  query,
  chip,
  sectionsOpen,
  disclosureKey,
  onSet,
  onRemove,
}: {
  readonly pane: string;
  readonly scope: TokenScope;
  readonly known: readonly KnownToken[];
  readonly tokens: Readonly<Record<string, string>>;
  readonly inherited: Readonly<Record<string, string>> | undefined;
  readonly query: string;
  readonly chip: string;
  readonly sectionsOpen: boolean | readonly TokenGroup[];
  readonly disclosureKey: string;
  readonly onSet: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
}): ReactNode {
  const searching = query.trim() !== '';
  const sections = TOKEN_GROUPS.flatMap(({ group, title }) => {
    if (chip !== 'all' && chip !== group) return [];
    const names = known.filter((name) => PERCH_TOKEN_LABELS[name].group === group);
    // Search by label, description and section title — never the raw name, which this tab never
    // shows. A placement pair is one grid, so one half matching keeps both.
    const hit = (name: KnownToken): boolean => {
      const entry = PERCH_TOKEN_LABELS[name];
      const pair = entry.placement?.pair;
      const pairEntry = pair === undefined ? undefined : PERCH_TOKEN_LABELS[pair];

      return (
        matchesQuery(query, entry.label, entry.description, title) ||
        (pairEntry !== undefined &&
          matchesQuery(query, pairEntry.label, pairEntry.description, title))
      );
    };
    const main = names.filter((name) => PERCH_TOKEN_LABELS[name].advanced !== true && hit(name));
    const advanced = names.filter((name) => PERCH_TOKEN_LABELS[name].advanced === true);
    const advancedShown = advanced.filter(hit);
    if (main.length + advancedShown.length === 0) return [];

    const setCount = names.filter((name) => tokens[name] !== undefined).length;
    const advancedSet = advanced.filter((name) => tokens[name] !== undefined).length;

    return [
      <Section
        key={group}
        id={`${disclosureKey}/${group}`}
        title={title}
        defaultOpen={opensByDefault(group, sectionsOpen)}
        forceOpen={searching || chip === group}
        summary={
          setCount === 0 ? undefined : (
            <span
              data-testid={`perch-editor-section-count-${pane}-${group}`}
            >{`${setCount} set`}</span>
          )
        }
        summaryActive={setCount > 0}
      >
        <TokenRows
          pane={pane}
          scope={scope}
          names={main}
          tokens={tokens}
          inherited={inherited}
          onSet={onSet}
          onRemove={onRemove}
        />
        {advancedShown.length === 0 ? null : (
          <AdvancedSection
            id={`${disclosureKey}/${group}/advanced`}
            setCount={advancedSet}
            forceOpen={searching}
          >
            <TokenRows
              pane={pane}
              scope={scope}
              names={advancedShown}
              tokens={tokens}
              inherited={inherited}
              onSet={onSet}
              onRemove={onRemove}
            />
          </AdvancedSection>
        )}
      </Section>,
    ];
  });

  return (
    <>
      {sections.length === 0 ? (
        <p className="perch-token-empty">{`no token matches “${query.trim()}”`}</p>
      ) : (
        sections
      )}
      <p className="perch-token-legend">
        <span className="perch-token-legend__own">set here</span>
        {scope === 'element' ? (
          <span className="perch-token-legend__inherited">set by the layout theme</span>
        ) : null}
        <span>
          <span aria-hidden="true">↺ </span>resets to what is underneath
        </span>
      </p>
    </>
  );
}

/** Rows for `names`, with each placement pair folded into one grid row. */
function TokenRows({
  pane,
  scope,
  names,
  tokens,
  inherited,
  onSet,
  onRemove,
}: {
  readonly pane: string;
  readonly scope: TokenScope;
  readonly names: readonly KnownToken[];
  readonly tokens: Readonly<Record<string, string>>;
  readonly inherited: Readonly<Record<string, string>> | undefined;
  readonly onSet: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
}): ReactNode {
  const rows: ReactNode[] = [];
  const drawn = new Set<string>();

  for (const name of names) {
    if (drawn.has(name)) continue;
    const state = stateOf(name, scope, tokens, inherited);
    const pair = state.entry.placement?.pair;

    if (pair !== undefined && names.includes(pair)) {
      const other = stateOf(pair, scope, tokens, inherited);
      const [across, down] =
        state.entry.placement?.axis === 'across' ? [state, other] : [other, state];
      drawn.add(name);
      drawn.add(pair);
      rows.push(
        <PlacementRow
          key={name}
          pane={pane}
          across={across}
          down={down}
          onSet={onSet}
          onRemove={onRemove}
        />,
      );
      continue;
    }

    drawn.add(name);
    rows.push(<TokenRow key={name} pane={pane} state={state} onSet={onSet} onRemove={onRemove} />);
  }

  return rows;
}

/** One token: the stamp, plus the reset its state asks for. */
function TokenRow({
  pane,
  state,
  onSet,
  onRemove,
}: {
  readonly pane: string;
  readonly state: TokenState;
  readonly onSet: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
}): ReactNode {
  const { name, entry, value } = state;
  const spec = tokenSpec(entry, value);
  const onValue = (next: string): void => {
    onSet(name, next);
  };

  return (
    <PropertyRow
      label={entry.label}
      description={entry.description}
      source={state.source}
      sourceText={state.sourceText}
      labelAs={isGroupSpec(spec) ? 'group' : 'label'}
      scrub={scrubFor(spec, value, onValue)}
      testId={rowTestId(pane, name)}
      // A box diagram is taller than a row: the label stays level with its top.
      className={spec.kind === 'box' ? 'perch-row--tall' : undefined}
      attributes={{ 'data-perch-overridden': state.source === 'own' ? 'true' : 'false' }}
      end={
        state.source === 'own' ? (
          <ResetButton
            action="reset"
            subject={entry.label}
            returnsTo={state.returnsTo}
            onReset={() => {
              onRemove(name);
            }}
          />
        ) : null
      }
    >
      {(ids) => (
        <SpecControl spec={spec} ids={ids} label={entry.label} value={value} onValue={onValue} />
      )}
    </PropertyRow>
  );
}

/**
 * A placement pair as one grid, with each half's state on its own line beside it: the half's value
 * in words, and — only where that half is set here — its reset, last on the line, so nothing can wrap
 * it onto a line of its own.
 *
 * A value the grid cannot show (a hand-written `flex-start` on a readout) falls back to two ordinary
 * rows, for the same reason every control here falls back to text.
 */
function PlacementRow({
  pane,
  across,
  down,
  onSet,
  onRemove,
}: {
  readonly pane: string;
  readonly across: TokenState;
  readonly down: TokenState;
  readonly onSet: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
}): ReactNode {
  const acrossOptions = across.entry.options ?? [];
  const downOptions = down.entry.options ?? [];
  if (!acrossOptions.includes(across.value) || !downOptions.includes(down.value)) {
    return (
      <>
        <TokenRow pane={pane} state={across} onSet={onSet} onRemove={onRemove} />
        <TokenRow pane={pane} state={down} onSet={onSet} onRemove={onRemove} />
      </>
    );
  }

  const label = across.entry.label.replace(/, across$/, '');
  const source: ValueSource =
    across.source === 'own' || down.source === 'own'
      ? 'own'
      : across.source === 'inherited' || down.source === 'inherited'
        ? 'inherited'
        : 'default';

  return (
    <PropertyRow
      label={label}
      description={`${across.entry.description} ${down.entry.description}`}
      source={source}
      labelAs="group"
      className="perch-row--placement"
      testId={`perch-editor-placement-${pane}-${across.name}`}
    >
      {(ids) => (
        <>
          <AlignGrid
            labelledBy={ids.labelId}
            across={{
              options: acrossOptions.map((value) => ({
                value,
                label: optionLabel(across.entry, value),
              })),
              value: across.value,
            }}
            down={{
              options: downOptions.map((value) => ({
                value,
                label: optionLabel(down.entry, value),
              })),
              value: down.value,
            }}
            onPick={(x, y) => {
              // Only the half that changed is written: centring across on a readout already at the
              // top must not also pin "top" as an override.
              if (x !== across.value) onSet(across.name, x);
              if (y !== down.value) onSet(down.name, y);
            }}
          />
          <div className="perch-axes">
            <AxisLine pane={pane} word="across" state={across} onRemove={onRemove} />
            <AxisLine pane={pane} word="down" state={down} onRemove={onRemove} />
          </div>
        </>
      )}
    </PropertyRow>
  );
}

/** One half of a placement: its value in words, its source, and its reset where it is set here. */
function AxisLine({
  pane,
  word,
  state,
  onRemove,
}: {
  readonly pane: string;
  readonly word: string;
  readonly state: TokenState;
  readonly onRemove: (name: string) => void;
}): ReactNode {
  return (
    <div
      className="perch-axis"
      data-testid={rowTestId(pane, state.name)}
      data-perch-overridden={state.source === 'own' ? 'true' : 'false'}
      data-perch-source={state.source}
    >
      <span className="perch-axis__word">{word}</span>
      <span className="perch-axis__value">{optionLabel(state.entry, state.value)}</span>
      <span className="perch-sr-only">{state.sourceText}</span>
      {state.source === 'own' ? (
        <ResetButton
          action="reset"
          subject={state.entry.label}
          returnsTo={state.returnsTo}
          onReset={() => {
            onRemove(state.name);
          }}
        />
      ) : null}
    </div>
  );
}

/** The document's own keys, by raw name, with add and remove. */
function DeveloperTab({
  pane,
  title,
  tokens,
  inherited,
  query,
  onSet,
  onRemove,
}: {
  readonly pane: string;
  readonly title: string;
  readonly tokens: Readonly<Record<string, string>>;
  readonly inherited: Readonly<Record<string, string>> | undefined;
  readonly query: string;
  readonly onSet: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
}): ReactNode {
  const entries = Object.entries(tokens);
  const shown = entries.filter(([name, value]) =>
    matchesQuery(query, name, value, tokenLabel(name)?.label),
  );

  return (
    <>
      <p className="perch-token-help">
        What this document holds, by raw name. <span aria-hidden="true">↺</span> drops a value so
        the one underneath shows; <span aria-hidden="true">✕</span> deletes a name ui-kit does not
        declare.
      </p>
      {entries.length === 0 ? (
        <p className="perch-token-empty" data-testid={`perch-editor-token-empty-${pane}`}>
          {`nothing here sets a ${title} token, so every token falls back to ${
            inherited === undefined
              ? 'the ui-kit default'
              : 'the layout theme, then the ui-kit default'
          }. add one below, or use Customize.`}
        </p>
      ) : shown.length === 0 ? (
        <p className="perch-token-empty">{`no token matches “${query.trim()}”`}</p>
      ) : (
        shown.map(([name, value]) => (
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

/** One key as the document spells it: the same `PropertyRow`, with a raw name for its label. */
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
  const entry = tokenLabel(name);
  const alpha = entry?.alpha === true;

  return (
    <PropertyRow
      label={name}
      description={entry?.description}
      sourceText={entry?.label}
      className="perch-row--developer"
      testId={rowTestId(pane, name)}
      attributes={{ 'data-perch-known': entry === undefined ? 'false' : 'true' }}
      note={entry === undefined ? 'no label · ui-kit does not declare this token' : undefined}
      end={
        entry === undefined ? (
          <ResetButton
            action="delete"
            subject={name}
            onReset={() => {
              onRemove(name);
            }}
          />
        ) : (
          <ResetButton
            action="remove"
            subject={name}
            returnsTo={
              inherited === undefined
                ? { source: 'default', value: knownTokenDefault(name) ?? '' }
                : { source: 'layout', value: inherited }
            }
            onReset={() => {
              onRemove(name);
            }}
          />
        )
      }
    >
      {(ids) => (
        <>
          {isHexColor(value, alpha) ? (
            <span
              className="perch-token-swatch"
              data-testid="perch-editor-swatch-static"
              style={swatchStyle(value, alpha)}
            />
          ) : null}
          <TextControl
            ids={ids}
            value={value}
            mono
            onValue={(next) => {
              onSet(name, next);
            }}
          />
        </>
      )}
    </PropertyRow>
  );
}

/**
 * The add-a-token control. Local state: a name and a value are meaningless apart, and writing the name
 * as it is typed would create `--p`, then `--pe`, each a validation error the author did not make.
 */
function AddToken({ onAdd }: { readonly onAdd: (name: string, value: string) => void }): ReactNode {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const ready = name.trim() !== '' && value.trim() !== '';

  return (
    <div className="perch-token-add">
      <label className="perch-token-add__field">
        <span className="perch-sr-only">new token</span>
        <input
          className="perch-input perch-input--mono"
          type="text"
          placeholder="--perch-fg"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>
      <label className="perch-token-add__field">
        <span className="perch-sr-only">new value</span>
        <input
          className="perch-input perch-input--mono"
          type="text"
          placeholder="value"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
      </label>
      <button
        type="button"
        className="perch-token-add__button"
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

/** What only a token map uses. The shared primitives' styles are `CONTROLS_STYLES`. */
export const TOKEN_PANE_STYLES = `
.perch-token-pane { display: flex; flex-direction: column; }
.perch-token-pane__panel { display: flex; flex-direction: column; background: var(--ed-bg); }
.perch-token-pane .perch-filter__chips { border-bottom: 1px solid var(--ed-bar-shadow); }
.perch-row--placement { align-items: start; padding-top: 3px; padding-bottom: 3px; }
.perch-row--placement .perch-row__label { padding-top: 3px; }
.perch-axes { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.perch-axis {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
  font-size: var(--ed-font-small);
  white-space: nowrap;
}
.perch-axis__word { flex: 0 0 38px; color: var(--ed-quiet); }
.perch-axis__value { flex: 1 1 auto; color: var(--ed-text-2); }
.perch-axis[data-perch-source='own'] .perch-axis__value { color: var(--ed-own-text); }
.perch-axis[data-perch-source='inherited'] .perch-axis__value { color: var(--ed-inherited-text); }
.perch-row--developer { --ed-label-col: 50%; }
.perch-row--developer .perch-row__label { justify-content: flex-start; padding-left: 0; }
.perch-row--developer .perch-row__label-text { font-family: var(--ed-mono); font-size: var(--ed-font-small); color: var(--ed-text-2); }
.perch-row--developer[data-perch-known='false'] .perch-row__label-text { color: var(--ed-inherited-text); }
.perch-token-swatch {
  flex: none;
  width: 14px;
  height: 14px;
  border: 1px solid #2a303b;
  border-radius: 2px;
}
.perch-token-help, .perch-token-empty, .perch-token-legend {
  margin: 0;
  padding: 5px var(--ed-pad-x);
  font-size: var(--ed-font-small);
  line-height: 1.45;
  color: var(--ed-quiet);
}
.perch-token-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; border-top: 1px solid var(--ed-bar-edge); }
.perch-token-legend__own::before, .perch-token-legend__inherited::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 5px;
  border-radius: 50%;
  box-sizing: border-box;
  vertical-align: 1px;
}
.perch-token-legend__own::before { background: var(--ed-own); }
.perch-token-legend__inherited::before { border: 1.5px solid var(--ed-inherited); }
.perch-token-add { display: flex; gap: var(--ed-gap); padding: 4px 4px 6px var(--ed-pad-x); }
.perch-token-add__field { flex: 1 1 0; display: flex; min-width: 0; }
.perch-token-add__button {
  flex: none;
  height: var(--ed-field-h);
  border: 1px solid var(--ed-field-edge);
  border-radius: var(--ed-radius);
  background: var(--ed-bar);
  color: var(--ed-text-2);
  font: inherit;
  font-size: var(--ed-font-small);
  padding: 0 10px;
  cursor: pointer;
}
.perch-token-add__button:disabled { color: var(--ed-faint); cursor: not-allowed; }
`;
