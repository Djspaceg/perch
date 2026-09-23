/**
 * The two tabs, and the one thing they must never do: lie about what a value is.
 *
 * A token map in a layout is a map of *overrides*. Every token already has a value — `ui-kit` declares
 * one for each of the 31 it knows — so a row in this pane is never "empty" and "remove" never deletes
 * a design token. The tests below are written against that reading, because it is the whole shape of
 * the pane:
 *
 * - **Customize** shows every known token, overridden or not, under a readable label, with a control
 *   that matches the token's type. Nothing here can add a name or delete a token; the only removal it
 *   offers is "reset to default", offered exactly where an override exists.
 * - **Developer** shows what the document actually holds, by raw name, and says of each name whether
 *   `ui-kit` knows it. For a known token, removing drops an override and the default takes over. For a
 *   custom name there is no default to take over, so removing is a deletion — and the two buttons say
 *   different things, because the same word over two different consequences is the defect.
 */

import { PERCH_TOKEN_LABELS } from '@perch/ui-kit';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TokenPane } from './token-pane.js';

/** The labels the pane is expected to print, read from the table rather than typed twice. */
const FG = PERCH_TOKEN_LABELS['--perch-fg'].label;
const CANVAS_BG = PERCH_TOKEN_LABELS['--perch-canvas-bg'].label;
const TEXT_SIZE = PERCH_TOKEN_LABELS['--perch-text-size'].label;
const TRANSFORM = PERCH_TOKEN_LABELS['--perch-text-transform'].label;

interface Edits {
  readonly set: [string, string][];
  readonly removed: string[];
}

/** The pane with recording callbacks, so "what edit did that produce" is assertable. */
function renderPane(
  tokens: Readonly<Record<string, string>>,
  scope: 'layout' | 'element' = 'layout',
  inherited?: Readonly<Record<string, string>>,
): Edits {
  const edits: Edits = { set: [], removed: [] };

  render(
    <TokenPane
      id="test"
      title="theme"
      scope={scope}
      inherited={inherited}
      tokens={tokens}
      onSet={(name, value) => {
        edits.set.push([name, value]);
      }}
      onRemove={(name) => {
        edits.removed.push(name);
      }}
    />,
  );

  return edits;
}

/** One token's row, by token name. */
function row(name: string): HTMLElement {
  return screen.getByTestId(`perch-editor-token-${name}`);
}

function openDeveloper(): void {
  fireEvent.click(screen.getByRole('tab', { name: /developer/i }));
}

describe('the Customize tab', () => {
  it('opens first, and shows every known token whether the layout sets it or not', () => {
    renderPane({ '--perch-fg': '#ff0000' });

    expect(screen.getByRole('tab', { name: /customize/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Overridden and not-overridden both present: a pane that listed only the overrides would be a
    // pane where the only way to reach a token is to already have set it.
    expect(row('--perch-fg')).toBeInTheDocument();
    expect(row('--perch-dim')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^perch-editor-token---perch-/)).toHaveLength(31);
  });

  it('makes the label the primary text and keeps the token name out of the way', () => {
    renderPane({});

    expect(screen.getByText(FG)).toBeInTheDocument();
    // Not hidden with CSS — absent. The name arrives when it is asked for, below.
    expect(screen.queryByText('--perch-fg')).toBeNull();
  });

  it('reveals the token name and its default behind a control a keyboard can reach', () => {
    renderPane({});
    const disclosure = within(row('--perch-fg')).getByRole('button', {
      name: new RegExp(`token name.*${FG}`, 'i'),
    });

    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(disclosure);

    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(within(row('--perch-fg')).getByText('--perch-fg')).toBeInTheDocument();
    expect(within(row('--perch-fg')).getByText(/#f2f4f8/)).toBeInTheDocument();
  });

  it('says which values are the layout’s own', () => {
    renderPane({ '--perch-fg': '#ff0000' });

    expect(row('--perch-fg')).toHaveAttribute('data-perch-overridden', 'true');
    expect(row('--perch-dim')).toHaveAttribute('data-perch-overridden', 'false');
  });

  it('offers a reset only where there is an override, and resetting drops the key', () => {
    const edits = renderPane({ '--perch-fg': '#ff0000' });
    const reset = within(row('--perch-fg')).getByRole('button', { name: /reset .* default/i });

    expect(within(row('--perch-dim')).queryByRole('button', { name: /reset/i })).toBeNull();

    fireEvent.click(reset);
    expect(edits.removed).toEqual(['--perch-fg']);
    expect(edits.set).toEqual([]);
  });

  it('adds and deletes nothing: those are the other tab’s', () => {
    renderPane({ '--perch-fg': '#ff0000' });
    const panel = screen.getByRole('tabpanel');

    expect(within(panel).queryByRole('button', { name: /^add/i })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /^(remove|delete)/i })).toBeNull();
    expect(within(panel).queryByLabelText(/new token/i)).toBeNull();
  });

  it('shows the effective value in the control, default included', () => {
    renderPane({ '--perch-fg': '#ff0000' });

    expect(screen.getByLabelText(FG)).toHaveValue('#ff0000');
    // The default, shown as the value it is, so the control is never blank for a token nobody set.
    expect(screen.getByLabelText(PERCH_TOKEN_LABELS['--perch-dim'].label)).toHaveValue('#9aa4b2');
  });

  it('writes an override when a token that had none is edited', () => {
    const edits = renderPane({});

    fireEvent.change(screen.getByLabelText(FG), { target: { value: '#123456' } });
    expect(edits.set).toEqual([['--perch-fg', '#123456']]);
  });

  it('gives a size its number and its unit, and writes them back as one value', () => {
    const edits = renderPane({ '--perch-text-size': '1.25rem' }, 'element');
    const size = row('--perch-text-size');

    expect(within(size).getByLabelText(TEXT_SIZE)).toHaveValue('1.25');
    expect(within(size).getByLabelText(new RegExp(`${TEXT_SIZE} unit`, 'i'))).toHaveValue('rem');

    fireEvent.change(within(size).getByLabelText(TEXT_SIZE), { target: { value: '2' } });
    expect(edits.set).toEqual([['--perch-text-size', '2rem']]);

    fireEvent.change(within(size).getByLabelText(new RegExp(`${TEXT_SIZE} unit`, 'i')), {
      target: { value: 'px' },
    });
    expect(edits.set.at(-1)).toEqual(['--perch-text-size', '1.25px']);
  });

  it('gives an enumerated token a closed select over the vocabulary ui-kit declares', () => {
    const edits = renderPane({}, 'element');
    const select = within(row('--perch-text-transform')).getByLabelText(TRANSFORM);

    expect([...(select as HTMLSelectElement).options].map((option) => option.value)).toEqual([
      ...(PERCH_TOKEN_LABELS['--perch-text-transform'].options ?? []),
    ]);

    fireEvent.change(select, { target: { value: 'uppercase' } });
    expect(edits.set).toEqual([['--perch-text-transform', 'uppercase']]);
  });

  it('keeps a value the control cannot represent showing anyway', () => {
    // `validateTokenMap` accepts this and the document holds it, so the pane shows it. A control that
    // silently displayed `1rem` instead would be hiding the value the author has to fix.
    renderPane({ '--perch-text-size': 'clamp(1rem, 2vw, 3rem)' }, 'element');

    expect(within(row('--perch-text-size')).getByLabelText(TEXT_SIZE)).toHaveValue(
      'clamp(1rem, 2vw, 3rem)',
    );
  });

  it('leaves out what the surface cannot change', () => {
    renderPane({}, 'element');

    // A canvas token on an element box is read by nobody: the canvas reads it one level up. Offering
    // it here would be a control whose whole effect is to do nothing.
    expect(screen.queryByTestId('perch-editor-token---perch-canvas-bg')).toBeNull();
    expect(screen.queryByText(CANVAS_BG)).toBeNull();
    expect(screen.getByTestId('perch-editor-token---perch-fg')).toBeInTheDocument();
  });

  it('includes the canvas’ own tokens on the layout surface', () => {
    renderPane({}, 'layout');

    expect(screen.getByText(CANVAS_BG)).toBeInTheDocument();
  });
});

describe('the Developer tab', () => {
  it('shows what the document holds, by raw name, and nothing it does not', () => {
    renderPane({ '--perch-fg': '#ff0000', '--brand-hue': '210' });
    openDeveloper();
    const panel = screen.getByRole('tabpanel');

    expect(within(panel).getByText('--perch-fg')).toBeInTheDocument();
    expect(within(panel).getByText('--brand-hue')).toBeInTheDocument();
    // Not every known token: this tab is the document, not the vocabulary.
    expect(within(panel).queryByText('--perch-dim')).toBeNull();
    expect(within(panel).getByLabelText('--perch-fg')).toHaveValue('#ff0000');
  });

  it('is honest about which names ui-kit knows', () => {
    renderPane({ '--perch-fg': '#ff0000', '--brand-hue': '210' });
    openDeveloper();

    expect(row('--perch-fg')).toHaveAttribute('data-perch-known', 'true');
    expect(within(row('--perch-fg')).getByText(FG)).toBeInTheDocument();

    expect(row('--brand-hue')).toHaveAttribute('data-perch-known', 'false');
    expect(within(row('--brand-hue')).getByText(/no label/i)).toBeInTheDocument();
  });

  it('distinguishes dropping an override from deleting a token that has no default', () => {
    const edits = renderPane({ '--perch-fg': '#ff0000', '--brand-hue': '210' });
    openDeveloper();

    const known = within(row('--perch-fg')).getByRole('button', { name: /override/i });
    const custom = within(row('--brand-hue')).getByRole('button', { name: /delete/i });

    // The consequence is in the accessible name of each, because the two buttons sit in the same
    // column of the same list and the word on them is the only thing telling them apart.
    expect(known).toHaveAccessibleName(/falls back|default/i);
    expect(custom).toHaveAccessibleName(/nothing|no default|gone/i);

    fireEvent.click(known);
    fireEvent.click(custom);
    expect(edits.removed).toEqual(['--perch-fg', '--brand-hue']);
  });

  it('adds a token by name and value', () => {
    const edits = renderPane({});
    openDeveloper();

    fireEvent.change(screen.getByLabelText(/new token/i), { target: { value: '--brand-hue' } });
    fireEvent.change(screen.getByLabelText(/new value/i), { target: { value: '210' } });
    fireEvent.click(screen.getByRole('button', { name: /^add/i }));

    expect(edits.set).toEqual([['--brand-hue', '210']]);
  });

  it('edits a value as text, exactly as the document spells it', () => {
    const edits = renderPane({ '--perch-font': "ui-serif, Georgia, 'Times New Roman', serif" });
    openDeveloper();

    const input = screen.getByLabelText('--perch-font');
    expect(input).toHaveValue("ui-serif, Georgia, 'Times New Roman', serif");

    fireEvent.change(input, { target: { value: 'ui-monospace, monospace' } });
    expect(edits.set).toEqual([['--perch-font', 'ui-monospace, monospace']]);
  });

  it('says so when the document holds no tokens at all', () => {
    renderPane({});
    openDeveloper();

    expect(screen.getByTestId('perch-editor-token-empty')).toBeInTheDocument();
  });
});

/**
 * An element's style map sits under the layout's theme, and the pane has to say so.
 *
 * `theme` is set on the canvas element and an element's box is inside it, so a token the layout sets
 * and the element does not is *inherited*, not defaulted: the element paints the layout's value. A pane
 * that answered "default, #f2f4f8" for a row the author can see rendering `#e8f1ff` would be telling
 * them the ui-kit default is what they are looking at, which is the one thing the brief for this pane
 * says it must not do — hide which values are the layout's own.
 */
describe('an element style map under a layout theme', () => {
  const THEME = Object.freeze({ '--perch-fg': '#e8f1ff' });

  it('shows the value the element actually paints, not the ui-kit default', () => {
    renderPane({}, 'element', THEME);

    expect(within(row('--perch-fg')).getByLabelText(FG)).toHaveValue('#e8f1ff');
  });

  it('attributes an inherited value to the layout rather than calling it a default', () => {
    renderPane({}, 'element', THEME);

    expect(within(row('--perch-fg')).getByText('from the layout theme')).toBeInTheDocument();
    expect(within(row('--perch-fg')).queryByText('default')).toBeNull();
    // A token the layout does not set either is still a plain default, and still says so.
    expect(within(row('--perch-dim')).getByText('default')).toBeInTheDocument();
  });

  it('reveals both the layout value and the ui-kit default behind the disclosure', () => {
    renderPane({}, 'element', THEME);
    const fg = row('--perch-fg');

    fireEvent.click(within(fg).getByRole('button', { name: new RegExp('token name', 'i') }));

    expect(within(fg).getByText('#e8f1ff')).toBeInTheDocument();
    expect(within(fg).getByText('#f2f4f8')).toBeInTheDocument();
  });

  it('offers no reset on a row the element does not itself override', () => {
    renderPane({}, 'element', THEME);

    expect(row('--perch-fg')).toHaveAttribute('data-perch-overridden', 'false');
    expect(within(row('--perch-fg')).queryByRole('button', { name: /^reset/i })).toBeNull();
  });

  it('says the layout value takes over when the element resets its own override', () => {
    renderPane({ '--perch-fg': '#ff0000' }, 'element', THEME);
    const reset = within(row('--perch-fg')).getByRole('button', { name: /^reset/i });

    expect(reset).toHaveAccessibleName(expect.stringContaining('layout theme'));
    expect(reset).toHaveAccessibleName(expect.stringContaining('#e8f1ff'));
  });

  it('says the same thing on the Developer tab, where the same removal happens by raw name', () => {
    renderPane({ '--perch-fg': '#ff0000' }, 'element', THEME);
    openDeveloper();

    const remove = within(row('--perch-fg')).getByRole('button', { name: /^remove the override/i });
    expect(remove).toHaveAccessibleName(expect.stringContaining('layout theme value #e8f1ff'));
  });
});
