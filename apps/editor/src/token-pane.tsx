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
import { Fragment, useState, type ReactNode } from 'react';
import {
  AdvancedSection,
  AlignGrid,
  Collapse,
  CollapseEach,
  FilterBar,
  PanelStack,
  PropertyRow,
  ResetButton,
  Section,
  TabStrip,
  matchesQuery,
  swatchStyle,
  type CollapseEntry,
  type ReturnsTo,
  type TabSpec,
  type ValueSource,
} from './controls/index.js';
import { optionLabel, tokenSpec } from './descriptors.js';
import { parseColour } from './controls/colour.js';
import { SpecControl, TextControl, isGroupSpec, scrubFor } from './property-view.js';
import { useEditorStore, type TokenTab } from './store.js';

/** A row at the top of one section that is a field of the element rather than a token. */
export interface LeadRow {
  readonly group: TokenGroup;
  readonly label: string;
  readonly description: string;
  /** Whether the document sets it here, for the section's "N set" count. */
  readonly set: boolean;
  readonly row: ReactNode;
}

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
  /**
   * Sections that are not tokens, first on the Customize tab: Target and Clock, or Content then
   * Transform. Each is keyed, and is a Section whose `panel` is its key, so it is dragged among the
   * token sections like one of them.
   */
  readonly leading?: readonly CollapseEntry[];
  /** The group the panels' dragged order is remembered under (`global`, `entity`); `id` if unset. */
  readonly panels?: string;
  /**
   * Rows that are not tokens but belong at the top of a token section: an element's own opacity, first
   * in its Appearance. Searched by label and description like a token row, and counted when `set`.
   */
  readonly lead?: readonly LeadRow[];
  /**
   * Put before each token section's title: the layout's are `Global Colour`, so a folded column of
   * them says whose they are next to the selected entity's own `Colour`.
   */
  readonly titlePrefix?: string;
  /** Which token sections start open: all (`true`, the default), none, or the ones named. */
  readonly sectionsOpen?: boolean | readonly TokenGroup[];
  /**
   * What the sections' open state and the tab are remembered under in the editor store.
   * Defaults to `id`. Every element's `style` pane shares `style`, so the tab picked on one readout is
   * the tab the next one opens on, as a fold is.
   */
  readonly disclosureKey?: string;
  /**
   * Whether the surface carries tokens at all. A media element and the layout's background have none
   * in the format: their pane is only its `leading` sections and `lead` rows, with the tabs and the
   * search folded away. The same pane either way, so what two selections share stays mounted.
   */
  readonly styled?: boolean;
  /**
   * The search is cleared when this changes: the selection, so one entity's search is not carried
   * into the next. The tab and the folds are remembered under `disclosureKey` and do carry over.
   */
  readonly searchFor?: string;
  /**
   * Token sections drawn somewhere else, left out here: an element's Placement, whose grid is in its
   * Transform (`transform-block.tsx`). The Developer tab still lists their keys.
   */
  readonly omitGroups?: readonly TokenGroup[];
}

const TABS: readonly TabSpec<TokenTab>[] = Object.freeze([
  {
    id: 'customize',
    label: 'Customize',
    title: 'Every token this surface can set, by name and type',
  },
  { id: 'developer', label: 'Developer', title: 'What this document holds, by raw token name' },
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
export interface TokenState {
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
  leading = [],
  panels,
  lead = [],
  titlePrefix = '',
  sectionsOpen = true,
  disclosureKey,
  styled = true,
  searchFor,
  omitGroups = NO_GROUPS,
}: TokenPaneProps): ReactNode {
  const key = disclosureKey ?? id;
  const rememberedTab = useEditorStore((state) => state.settings.tabs[key]) ?? 'customize';
  // Nothing to show on Developer without tokens; the remembered tab is kept for the next that has some.
  const tab = styled ? rememberedTab : 'customize';
  const setPaneTab = useEditorStore((state) => state.setTab);
  const [query, setQuery] = useState('');
  // Adjusted during render, the way React documents for state that follows a prop.
  const [searchedFor, setSearchedFor] = useState(searchFor);
  if (searchedFor !== searchFor) {
    setSearchedFor(searchFor);
    setQuery('');
  }
  const base = `perch-token-pane-${id}`;
  const known = styled ? tokensFor(scope, kind) : [];

  return (
    <div className="perch-token-pane">
      <Collapse open={styled}>
        <TabStrip
          label={`${title} tabs`}
          idBase={base}
          tabs={TABS}
          selected={tab}
          onSelect={(next) => {
            setPaneTab(key, next);
          }}
          trailing={<FilterBar label={`search ${title} tokens`} query={query} onQuery={setQuery} />}
        />
      </Collapse>
      <div
        className="perch-token-pane__panel"
        {...(styled ? { role: 'tabpanel', 'aria-labelledby': `${base}-tab-${tab}` } : {})}
        id={`${base}-panel`}
        data-testid={`${base}-panel`}
      >
        {tab === 'customize' ? (
          <>
            <CustomizeSections
              pane={id}
              scope={scope}
              leading={leading}
              panels={panels ?? id}
              omitGroups={omitGroups}
              known={known}
              lead={lead}
              tokens={tokens}
              inherited={inherited}
              query={query}
              titlePrefix={titlePrefix}
              sectionsOpen={sectionsOpen}
              disclosureKey={key}
              styled={styled}
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

const NO_GROUPS: readonly TokenGroup[] = Object.freeze([]);

/** Both halves of the content placement an element kind reads, as a Customize grid shows them. */
export interface ContentPlacement {
  readonly across: TokenState;
  readonly down: TokenState;
}

/**
 * The content placement pair `kind` reads — a text's or a readout's — with each half's value,
 * source and reset; `undefined` for a kind with none (media, a chart).
 */
export function contentPlacement(
  kind: ElementKind,
  tokens: Readonly<Record<string, string>>,
  inherited: Readonly<Record<string, string>> | undefined,
): ContentPlacement | undefined {
  const across = tokensFor('element', kind).find((name) => {
    const entry = PERCH_TOKEN_LABELS[name];
    return entry.group === 'placement' && entry.placement?.axis === 'across';
  });
  const pair = across === undefined ? undefined : PERCH_TOKEN_LABELS[across].placement?.pair;
  if (across === undefined || pair === undefined) return undefined;
  const acrossState = stateOf(across, 'element', tokens, inherited);
  const downState = stateOf(pair, 'element', tokens, inherited);
  // A value the grid cannot show (a hand-written flex-start on a readout) is left to the Developer
  // tab and the token's own rows, as the Customize grid does.
  if (
    !(acrossState.entry.options ?? []).includes(acrossState.value) ||
    !(downState.entry.options ?? []).includes(downState.value)
  ) {
    return undefined;
  }

  return { across: acrossState, down: downState };
}

/** Whether a token's section starts open. */
function opensByDefault(group: TokenGroup, sectionsOpen: boolean | readonly TokenGroup[]): boolean {
  return typeof sectionsOpen === 'boolean' ? sectionsOpen : sectionsOpen.includes(group);
}

/**
 * The vocabulary, one folding section per `ui-kit` group, filtered by the search. Every section is
 * always listed: its disclosure is what hides it, so there is no second, category filter on top.
 */
function CustomizeSections({
  pane,
  scope,
  leading,
  panels,
  omitGroups,
  known,
  lead,
  tokens,
  inherited,
  query,
  titlePrefix,
  sectionsOpen,
  disclosureKey,
  styled,
  onSet,
  onRemove,
}: {
  readonly pane: string;
  readonly scope: TokenScope;
  readonly leading: readonly CollapseEntry[];
  readonly panels: string;
  readonly omitGroups: readonly TokenGroup[];
  readonly known: readonly KnownToken[];
  readonly styled: boolean;
  readonly lead: readonly LeadRow[];
  readonly tokens: Readonly<Record<string, string>>;
  readonly inherited: Readonly<Record<string, string>> | undefined;
  readonly query: string;
  readonly titlePrefix: string;
  readonly sectionsOpen: boolean | readonly TokenGroup[];
  readonly disclosureKey: string;
  readonly onSet: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
}): ReactNode {
  const searching = query.trim() !== '';
  const sections = TOKEN_GROUPS.flatMap(({ group, title }) => {
    if (omitGroups.includes(group)) return [];
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
    const leads = lead.filter((row) => row.group === group);
    const leadShown = leads.filter((row) => matchesQuery(query, row.label, row.description, title));
    if (leadShown.length + main.length + advancedShown.length === 0) return [];

    const setCount =
      names.filter((name) => tokens[name] !== undefined).length +
      leads.filter((row) => row.set).length;
    const advancedSet = advanced.filter((name) => tokens[name] !== undefined).length;

    return [
      {
        key: group,
        node: (
          <Section
            id={`${disclosureKey}/${group}`}
            title={`${titlePrefix}${title}`}
            panel={group}
            defaultOpen={opensByDefault(group, sectionsOpen)}
            forceOpen={searching}
            summary={
              setCount === 0 ? undefined : (
                <span
                  data-testid={`perch-editor-section-count-${pane}-${group}`}
                >{`${setCount} set`}</span>
              )
            }
            summaryActive={setCount > 0}
            testId={scope === 'element' ? `perch-editor-${group}` : undefined}
          >
            {leadShown.map((row) => (
              <Fragment key={row.label}>{row.row}</Fragment>
            ))}
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
          </Section>
        ),
      },
    ];
  });

  // Keyed by group, so a section two selections share stays mounted, and one that stops applying (or
  // stops matching the search) collapses away rather than vanishing. One stack with the leading
  // sections, in the order the author dragged them into.
  return (
    <>
      <PanelStack group={panels} entries={[...leading, ...sections]} />
      {sections.length === 0 && searching ? (
        <p className="perch-token-empty">{`no token matches “${query.trim()}”`}</p>
      ) : null}
      <Collapse open={styled}>
        <p className="perch-token-legend">
          <span className="perch-token-legend__own">set here</span>
          {scope === 'element' ? (
            <span className="perch-token-legend__inherited">set by the layout theme</span>
          ) : null}
          <span>
            <span aria-hidden="true">↺ </span>resets to what is underneath
          </span>
        </p>
      </Collapse>
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
  const rows: CollapseEntry[] = [];
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
      rows.push({
        key: name,
        node: (
          <PlacementRow pane={pane} across={across} down={down} onSet={onSet} onRemove={onRemove} />
        ),
      });
      continue;
    }

    drawn.add(name);
    rows.push({
      key: name,
      node: <TokenRow pane={pane} state={state} onSet={onSet} onRemove={onRemove} />,
    });
  }

  // Kept by name: a row two selections share stays mounted, and one only the other kind reads, or
  // that stops matching the search, collapses away.
  return <CollapseEach entries={rows} />;
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
      // A box diagram is taller than a row: the label stays level with its top, and the row keeps
      // some room from its neighbours so the diagram does not butt against them.
      className={spec.kind === 'box' ? 'perch-row--tall perch-row--box' : undefined}
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
          {parseColour(value) === undefined ? null : (
            <span
              className="perch-token-swatch"
              data-testid="perch-editor-swatch-static"
              style={swatchStyle(value)}
            />
          )}
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
.perch-row--placement { align-items: start; padding-top: 3px; padding-bottom: 3px; }
/* A padding or radius diagram: room above and below. On the row, not the diagram, so the label
   stays level with the diagram's top. The chrome has no vertical spacing variable (--ed-gap is the
   gap between fields), so it is 1ex of the row's own font. */
.perch-row--box { margin-block: 1ex; }
.perch-row--placement .perch-row__label { padding-top: 3px; }
.perch-axes { display: flex; flex-direction: column; gap: 2px; min-width: var(--ed-control); flex: 1 1 auto; container-type: inline-size; }
/* Too narrow for words (a 300px sidebar under a coarse pointer): the grid beside it shows the value,
   the reset keeps its name, and the words step aside rather than push the reset out of the row. */
@container (max-width: 64px) {
  .perch-axis { gap: 0; justify-content: flex-end; }
  .perch-axis__word, .perch-axis__value { display: none; }
}
.perch-axis {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 20px;
  font-size: var(--ed-font-small);
  white-space: nowrap;
}
.perch-axis__word { flex: 0 1 38px; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--ed-quiet); }
.perch-axis__value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--ed-text-2); }
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
  border: 1px solid var(--ed-swatch-edge);
  border-radius: 2px;
}
.perch-token-help, .perch-token-empty, .perch-token-legend {
  margin: 0;
  padding: 5px var(--ed-pad-x);
  font-size: var(--ed-font-small);
  line-height: 1.45;
  color: var(--ed-quiet);
}
.perch-token-legend { display: flex; gap: 12px; min-width: 0; white-space: nowrap; border-top: 1px solid var(--ed-bar-edge); }
.perch-token-legend > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
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
