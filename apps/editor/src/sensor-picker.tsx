/**
 * Choosing data: one sensor picker, behind both the Add menu and the Content section's topic field.
 *
 * One way to choose data, not two. The list is what the connected source has published
 * (`topic-catalogue.ts`), searchable because a relay publishes several hundred, grouped by device and
 * metric, each entry showing the name its meta gives, its unit and its topic. The search box doubles
 * as a way to type a topic in full, for a sensor that is not publishing right now: a canonical topic
 * is offered as "use …", anything else that starts like a topic says why it is not one.
 *
 * Built from the redesign's primitives — `usePopover` for the anchored, dismissable box and
 * `FilterBar` for the search and the device chips — so it dismisses, places and searches exactly as
 * the colour picker and the token panes do.
 *
 * The topic field keeps its text input. The picker writes into it; typing into it still works, and the
 * validator still judges what was typed, because a control that could only hold listed topics could
 * not show a document's topic that no source is publishing.
 */

import type { LayoutElement, LayoutTarget } from '@perch/layout-schema';
import type { SensorDevice, SensorMeta, SensorTopic } from '@perch/sensor-contract';
import { useSensorStore, useSensorTopics } from '@perch/ui-kit';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { FilterBar, usePopover } from './controls/index.js';
import { ADDABLE_KINDS, newElement, type AddableEntry } from './new-element.js';
import {
  catalogueTopics,
  filterCatalogue,
  typedTopic,
  type TopicEntry,
} from './topic-catalogue.js';

/** What the picker lists from: the topics known, and how to name one. */
interface SensorSourceView {
  readonly topics: readonly string[];
  readonly meta: (topic: SensorTopic) => SensorMeta | undefined;
}

const SensorSourceContext = createContext<SensorSourceView>({
  topics: [],
  meta: () => undefined,
});

/**
 * Makes the connected source's topics available to every picker below. `declared` are topics the
 * caller knows exist without having heard them yet — the mock's own list — merged with what has
 * actually arrived.
 */
export function SensorCatalogueProvider({
  declared,
  children,
}: {
  readonly declared: readonly string[];
  readonly children: ReactNode;
}): ReactNode {
  const seen = useSensorTopics();
  const store = useSensorStore();
  const value = useMemo<SensorSourceView>(
    () => ({
      topics: [...seen, ...declared],
      meta: (topic) => store.meta(topic),
    }),
    [seen, declared, store],
  );

  return <SensorSourceContext.Provider value={value}>{children}</SensorSourceContext.Provider>;
}

/** The chip that shows every device. */
const ALL_DEVICES = 'all';

/**
 * The list itself: search, device chips, groups, the typed-topic row, the hidden toggle.
 *
 * Mounted only while its popover is open, so the catalogue — and every label in it — is read fresh
 * each time the picker opens: a meta that arrived after the first reading is in the next opening.
 */
export function SensorList({
  current,
  onChoose,
}: {
  /** The topic the element holds now, marked in the list. */
  readonly current?: string | undefined;
  readonly onChoose: (topic: SensorTopic) => void;
}): ReactNode {
  const source = useContext(SensorSourceContext);
  const [query, setQuery] = useState('');
  const [device, setDevice] = useState<SensorDevice | typeof ALL_DEVICES>(ALL_DEVICES);
  const [showHidden, setShowHidden] = useState(false);
  const entries = useMemo(
    () => catalogueTopics(source.topics, source.meta),
    [source.topics, source.meta],
  );
  const { groups, count, hiddenCount, devices } = filterCatalogue(entries, {
    query,
    device,
    showHidden,
  });
  const typed = typedTopic(query);
  const typedListed =
    typed.kind === 'valid' && entries.some((entry) => entry.topic === typed.topic);
  const first = groups[0]?.metrics[0]?.entries[0];

  return (
    <div className="perch-sensors">
      <div className="perch-sensors__search">
        <FilterBar
          label="search sensors"
          query={query}
          onQuery={setQuery}
          chips={[
            { id: ALL_DEVICES, label: 'All' },
            ...devices.map((name) => ({ id: name, label: name })),
          ]}
          chip={device}
          chipsLabel="filter by device"
          onChip={(chip) => {
            setDevice(devices.find((name) => name === chip) ?? ALL_DEVICES);
          }}
          onSubmit={() => {
            if (typed.kind === 'valid') onChoose(typed.topic);
            else if (first !== undefined) onChoose(first.topic);
          }}
        />
      </div>

      {typed.kind === 'valid' && !typedListed ? (
        <button
          type="button"
          className="perch-sensors__use"
          onClick={() => {
            onChoose(typed.topic);
          }}
        >
          <span className="perch-sensors__use-topic">{`use ${typed.topic}`}</span>
          <span className="perch-sensors__use-note">not publishing now</span>
        </button>
      ) : null}
      {typed.kind === 'invalid' ? <p className="perch-sensors__note">{typed.reason}</p> : null}

      <div className="perch-sensors__list">
        {groups.map((group) => (
          <section key={group.key} className="perch-sensors__group" aria-label={group.title}>
            <h4 className="perch-sensors__device">{group.title}</h4>
            {group.metrics.map((metric) => (
              <div key={metric.metric} className="perch-sensors__metric">
                <div className="perch-sensors__metric-name" aria-hidden="true">
                  {metric.unit === '' ? metric.metric : `${metric.metric} · ${metric.unit}`}
                </div>
                {metric.entries.map((entry) => (
                  <SensorEntry
                    key={entry.topic}
                    entry={entry}
                    current={entry.topic === current}
                    onChoose={onChoose}
                  />
                ))}
              </div>
            ))}
          </section>
        ))}
        {count === 0 ? (
          <p className="perch-sensors__note">
            {entries.length === 0
              ? 'the source has published nothing yet. type a topic in full to use one anyway.'
              : 'no sensor matches. type a topic in full to use one that is not publishing.'}
          </p>
        ) : null}
      </div>

      <div className="perch-sensors__foot">
        <span>{`${count} of ${entries.length} from the connected source`}</span>
        {hiddenCount > 0 || showHidden ? (
          <button
            type="button"
            className="perch-sensors__toggle"
            aria-pressed={showHidden}
            onClick={() => {
              setShowHidden(!showHidden);
            }}
          >
            {showHidden ? 'hide noisy sensors' : `show ${hiddenCount} hidden`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SensorEntry({
  entry,
  current,
  onChoose,
}: {
  readonly entry: TopicEntry;
  readonly current: boolean;
  readonly onChoose: (topic: SensorTopic) => void;
}): ReactNode {
  return (
    <button
      type="button"
      className="perch-sensors__entry"
      aria-current={current ? 'true' : undefined}
      title={entry.topic}
      onClick={() => {
        onChoose(entry.topic);
      }}
    >
      <span className="perch-sensors__name">{entry.label ?? entry.topic}</span>
      {entry.unit === '' ? null : <span className="perch-sensors__unit">{entry.unit}</span>}
      <span className="perch-sensors__topic">{entry.topic}</span>
    </button>
  );
}

/**
 * The topic row's control: the topic as text, and a button that opens the sensor picker over it.
 * `children` is the text input, stamped by `property-view.tsx` like every other text field.
 */
export function TopicField({
  label,
  value,
  onValue,
  children,
}: {
  readonly label: string;
  readonly value: string;
  readonly onValue: (value: string) => void;
  readonly children: ReactNode;
}): ReactNode {
  const anchor = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const popover = usePopover(anchor, box);
  const name = `choose a sensor for ${label}`;

  return (
    <span className="perch-topic">
      {children}
      <button
        ref={anchor}
        type="button"
        className="perch-topic__choose"
        aria-label={name}
        title={name}
        aria-expanded={popover.open}
        aria-haspopup="dialog"
        {...(popover.open ? { 'aria-controls': popover.id } : {})}
        onClick={() => {
          popover.setOpen(!popover.open);
        }}
      >
        <span aria-hidden="true">▾</span>
      </button>
      {popover.open ? (
        <div
          ref={box}
          id={popover.id}
          className="perch-popover perch-popover--sensors"
          role="dialog"
          aria-label="choose a sensor"
          style={popover.style}
        >
          <SensorList
            current={value}
            onChoose={(topic) => {
              onValue(topic);
              popover.close(true);
            }}
          />
        </div>
      ) : null}
    </span>
  );
}

/**
 * "+ Add": the kinds that exist, and for a reading or a chart, the sensor it reads. The element is
 * built by `newElement` and handed to `onAdd`, which runs it through the same validated edit path as
 * every other edit.
 */
export function AddMenu({
  target,
  onAdd,
}: {
  /** The canvas the new element is placed on. */
  readonly target: LayoutTarget;
  readonly onAdd: (element: LayoutElement) => void;
}): ReactNode {
  const anchor = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const popover = usePopover(anchor, box);
  const [kind, setKind] = useState<AddableEntry | null>(null);

  // The step changed inside an open popover, so the hook's focus-on-open does not run: the button
  // that was pressed has gone, and focus follows the author into the search box.
  useEffect(() => {
    if (kind !== null) box.current?.querySelector<HTMLElement>('input')?.focus();
  }, [kind]);

  const finish = (element: LayoutElement): void => {
    setKind(null);
    popover.close(false);
    onAdd(element);
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="perch-add"
        aria-label="add an element"
        title="add an element"
        aria-expanded={popover.open}
        aria-haspopup="dialog"
        {...(popover.open ? { 'aria-controls': popover.id } : {})}
        onClick={() => {
          setKind(null);
          popover.setOpen(!popover.open);
        }}
      >
        <span className="perch-add__plus" aria-hidden="true">
          +
        </span>
        Add
      </button>
      {popover.open ? (
        <div
          ref={box}
          id={popover.id}
          className={`perch-popover${kind === null ? ' perch-popover--menu' : ' perch-popover--sensors'}`}
          role="dialog"
          aria-label={
            kind === null ? 'add an element' : `choose a sensor for the new ${kind.label}`
          }
          style={popover.style}
        >
          {kind === null ? (
            <div className="perch-add__kinds">
              {ADDABLE_KINDS.map((entry) => (
                <button
                  key={entry.kind}
                  type="button"
                  className="perch-add__kind"
                  onClick={() => {
                    if (entry.needsTopic) setKind(entry);
                    else finish(newElement(entry.kind, target, undefined));
                  }}
                >
                  <span className="perch-add__kind-label">{entry.label}</span>
                  <span className="perch-add__kind-hint">{entry.hint}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="perch-add__step">
                <button
                  type="button"
                  className="perch-add__back"
                  onClick={() => {
                    setKind(null);
                  }}
                >
                  <span aria-hidden="true">‹</span> kinds
                </button>
                <span className="perch-add__step-title">{`new ${kind.label.toLowerCase()}: choose its sensor`}</span>
              </div>
              <SensorList
                onChoose={(topic) => {
                  finish(newElement(kind.kind, target, topic));
                }}
              />
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

export const SENSOR_PICKER_STYLES = `
.perch-topic { flex: 1 1 auto; display: flex; align-items: center; gap: var(--ed-gap); min-width: 0; }
.perch-topic__choose,
.perch-add {
  flex: none;
  height: var(--ed-field-h);
  box-sizing: border-box;
  border: 1px solid var(--ed-field-edge);
  border-radius: var(--ed-radius);
  background: var(--ed-bar);
  color: var(--ed-label);
  font: inherit;
  font-size: var(--ed-font-small);
  cursor: pointer;
}
.perch-topic__choose { width: 20px; padding: 0; font-size: 0.75rem; line-height: 1; }
.perch-topic__choose:hover, .perch-add:hover { color: var(--ed-text); border-color: var(--ed-field-edge-hover); }
.perch-topic__choose[aria-expanded='true'], .perch-add[aria-expanded='true'] { border-color: var(--ed-accent); color: var(--ed-text); }
.perch-topic__choose:focus-visible, .perch-add:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 0; }
.perch-add { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; padding: 0 8px 0 6px; color: var(--ed-text-2); }
.perch-add__plus { color: #7ee2a8; font-size: 0.875rem; font-weight: 700; line-height: 1; }
.perch-popover--menu { width: 200px; gap: 2px; padding: 4px; }
.perch-popover--sensors { width: 320px; max-height: calc(100vh - 8px); box-sizing: border-box; gap: 4px; padding: 6px 0 4px; }
.perch-add__kinds { display: flex; flex-direction: column; gap: 2px; }
.perch-add__kind {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  border: 0;
  border-radius: var(--ed-radius);
  background: none;
  color: var(--ed-text);
  font: inherit;
  text-align: left;
  padding: 4px 8px;
  cursor: pointer;
}
.perch-add__kind:hover, .perch-add__kind:focus-visible { background: var(--ed-accent-fill); outline: none; }
.perch-add__kind-label { font-size: var(--ed-font); font-weight: 600; }
.perch-add__kind-hint { font-size: var(--ed-font-small); color: var(--ed-quiet); }
.perch-add__step { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 0 8px; }
.perch-add__back {
  flex: none;
  border: 1px solid var(--ed-field-edge);
  border-radius: var(--ed-radius);
  background: var(--ed-bar);
  color: var(--ed-label);
  font: inherit;
  font-size: var(--ed-font-small);
  height: 18px;
  padding: 0 6px;
  cursor: pointer;
}
.perch-add__back:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 0; }
.perch-add__step-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ed-font-small); color: var(--ed-text-2); }
.perch-sensors { display: flex; flex-direction: column; gap: 4px; min-height: 0; flex: 1 1 auto; }
.perch-sensors__search { padding: 0 8px; }
.perch-sensors__search .perch-filter__search { max-width: none; }
.perch-sensors__search .perch-filter__chips { padding: 5px 0 0; }
.perch-sensors__list { flex: 1 1 auto; min-height: 0; max-height: 300px; overflow-y: auto; overflow-x: hidden; padding: 0 4px; }
.perch-sensors__group + .perch-sensors__group { margin-top: 4px; }
.perch-sensors__device {
  position: sticky;
  top: 0;
  margin: 0;
  padding: 3px 4px;
  background: #151920;
  font-size: var(--ed-font-small);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ed-text-2);
}
.perch-sensors__metric-name { padding: 2px 4px 1px 10px; font-size: var(--ed-font-small); color: var(--ed-accent); }
.perch-sensors__entry {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 6px;
  width: 100%;
  border: 0;
  border-radius: 2px;
  background: none;
  color: var(--ed-text);
  font: inherit;
  text-align: left;
  padding: 2px 6px 2px 16px;
  cursor: pointer;
}
.perch-sensors__entry:hover, .perch-sensors__entry:focus-visible { background: var(--ed-hover); outline: none; }
.perch-sensors__entry:focus-visible { box-shadow: inset 0 0 0 1px var(--ed-accent); }
.perch-sensors__entry[aria-current='true'] { background: var(--ed-accent-fill); }
.perch-sensors__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ed-font); }
.perch-sensors__unit { font-size: var(--ed-font-small); color: var(--ed-quiet); }
.perch-sensors__topic {
  grid-column: 1 / 3;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--ed-mono);
  font-size: var(--ed-font-small);
  color: var(--ed-quiet);
}
.perch-sensors__use {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin: 0 8px;
  border: 1px solid #23503a;
  border-radius: var(--ed-radius);
  background: #10241a;
  color: #7ee2a8;
  font: inherit;
  text-align: left;
  padding: 3px 8px;
  cursor: pointer;
}
.perch-sensors__use:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 0; }
.perch-sensors__use-topic { font-family: var(--ed-mono); font-size: var(--ed-font-small); overflow-wrap: anywhere; }
.perch-sensors__use-note { font-size: var(--ed-font-small); color: var(--ed-quiet); }
.perch-sensors__note { margin: 0; padding: 2px 8px; font-size: var(--ed-font-small); color: var(--ed-danger); }
.perch-sensors__list .perch-sensors__note { color: var(--ed-quiet); }
.perch-sensors__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 3px 8px 0;
  border-top: 1px solid var(--ed-bar-edge);
  font-size: var(--ed-font-small);
  color: var(--ed-faint);
}
.perch-sensors__toggle {
  border: 0;
  background: none;
  color: var(--ed-accent);
  font: inherit;
  font-size: var(--ed-font-small);
  padding: 0;
  cursor: pointer;
}
.perch-sensors__toggle:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 0; }
`;
