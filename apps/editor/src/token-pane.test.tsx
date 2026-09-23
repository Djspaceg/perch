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
 *   offers is "reset to default", offered exactly where an override exists. It never prints the raw
 *   `--perch-...` name — not as text, not in a tooltip, not in an accessible name.
 * - **Developer** shows what the document actually holds, by raw name, and says of each name whether
 *   `ui-kit` knows it. For a known token, removing drops an override and the default takes over. For a
 *   custom name there is no default to take over, so removing is a deletion — and the two controls are
 *   a different glyph, a different accessible name and a different number of clicks, because one
 *   affordance over two different consequences is the defect.
 *
 * ## Icons that still say what they do
 *
 * Every removal is an icon button. That makes the accessible name load-bearing rather than decorative,
 * so it is asserted in full — naming the token *and* the value that takes over — and asserted to be an
 * `aria-label` matched by a `title`, because a tooltip alone is invisible to a keyboard. The glyph is
 * asserted `aria-hidden`, so what gets read is the sentence rather than the character.
 *
 * ## Colour first
 *
 * Wherever a colour is edited, the colour itself leads and the hex literal follows. The swatch is what
 * an author is looking for when they came to change a colour; `#e8f1ff` is the notation, which matters
 * once they are already there. Both places a colour row is rendered — a Customize row and a Developer
 * row — are asserted, because the two diverging is how one pane starts reading as a different product.
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

/**
 * One token's row, by token name, within one pane.
 *
 * The pane id is part of the testid because the inspector renders two of these panes at once — a
 * layout's `theme` and the selected element's `style` — and a testid that was the bare token name made
 * `--perch-fg` ambiguous in the document the moment an element was selected.
 */
function row(name: string, pane = 'test'): HTMLElement {
  return screen.getByTestId(`perch-editor-token-${pane}-${name}`);
}

function openDeveloper(): void {
  fireEvent.click(screen.getByRole('tab', { name: /developer/i }));
}

/** Whether `first` comes before `second` in document order. */
function precedes(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** Every `title` and `aria-label` string inside `scope`, for asserting what a row never says. */
function annotations(scope: HTMLElement): string[] {
  return [...scope.querySelectorAll('[title], [aria-label]')].flatMap((el) => [
    el.getAttribute('title') ?? '',
    el.getAttribute('aria-label') ?? '',
  ]);
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
    expect(screen.getAllByTestId(/^perch-editor-token-test---perch-/)).toHaveLength(31);
  });

  it('makes the label the primary text and keeps the token name out of the way', () => {
    renderPane({});

    expect(screen.getByText(FG)).toBeInTheDocument();
    // Not hidden with CSS — absent. The raw name lives on the Developer tab and only there.
    expect(screen.queryByText('--perch-fg')).toBeNull();
  });

  it('never prints the raw token name: not as text, not in a tooltip, not in a label', () => {
    // The name disclosure is gone from this tab. It was two facts behind one button, and only one of
    // them belongs to a consumer: the raw `--perch-...` name is what the Developer tab is *for*.
    renderPane({ '--perch-fg': '#ff0000' });
    const panel = screen.getByRole('tabpanel');

    expect(within(panel).queryByRole('button', { name: /token name/i })).toBeNull();
    expect(within(panel).queryByText('--perch-fg')).toBeNull();
    // Not relocated into a `title` or an `aria-label`, which is the easy way to "remove" a string
    // while leaving it in the product.
    expect(annotations(panel).filter((text) => text.includes('--perch-'))).toEqual([]);
  });

  it('keeps the one fact the disclosure carried: what an overridden row reverts to', () => {
    // The default value answers "what do I get back if I reset this", which is a question only an
    // overridden row raises. A row already at its default has the answer in its own value field.
    renderPane({ '--perch-fg': '#ff0000' });

    expect(within(row('--perch-fg')).getByText('default #f2f4f8')).toBeInTheDocument();
    expect(within(row('--perch-dim')).queryByText(/^default #/)).toBeNull();
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

  it('makes the reset an icon, and keeps the whole sentence in its name and its tooltip', () => {
    // The same `↺` the Developer tab uses for the same edit. It is icon-only because this row now
    // carries the value it reverts to as visible text, and a word as well would make the head wider
    // than the one the space complaint was about.
    renderPane({ '--perch-fg': '#ff0000' });
    const reset = within(row('--perch-fg')).getByRole('button', { name: /^reset/i });

    expect(within(reset).getByText('↺')).toHaveAttribute('aria-hidden', 'true');
    expect(reset).toHaveAccessibleName('reset Reading colour to the ui-kit default #f2f4f8');
    expect(reset).toHaveAttribute('title', reset.getAttribute('aria-label'));
    // And no `✕` anywhere on this tab: Customize cannot delete a token, so it must never show the
    // glyph that means one is about to go.
    expect(within(screen.getByRole('tabpanel')).queryByText('✕')).toBeNull();
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

  it('leads a colour row with the colour and follows it with the hex literal', () => {
    renderPane({ '--perch-fg': '#ff0000' });
    const fg = row('--perch-fg');
    const swatch = within(fg).getByRole('button', {
      name: new RegExp(`colour picker.*${FG}`, 'i'),
    });

    expect(precedes(swatch, within(fg).getByLabelText(FG))).toBe(true);
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
    expect(screen.queryByTestId('perch-editor-token-test---perch-canvas-bg')).toBeNull();
    expect(screen.queryByText(CANVAS_BG)).toBeNull();
    expect(screen.getByTestId('perch-editor-token-test---perch-fg')).toBeInTheDocument();
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

  it('drops an override from an icon button that names the value it goes back to', () => {
    // The words came out of the row, so the accessible name is the only thing left carrying the
    // meaning — and it has to carry the *whole* meaning, including which number takes over. It is an
    // `aria-label` and a `title`, not a `title` alone: a tooltip is invisible to a keyboard.
    const edits = renderPane({ '--perch-fg': '#ff0000' });
    openDeveloper();
    const revert = within(row('--perch-fg')).getByRole('button', { name: /^remove this layout/i });

    expect(revert.tagName).toBe('BUTTON');
    expect(revert).toHaveAccessibleName(expect.stringContaining('--perch-fg'));
    expect(revert).toHaveAccessibleName(expect.stringContaining('ui-kit default #f2f4f8'));
    expect(revert).toHaveAttribute('title', revert.getAttribute('aria-label'));
    // The glyph is decoration; the name comes from the label, so a screen reader reads a sentence
    // rather than the character.
    expect(within(revert).getByText('↺')).toHaveAttribute('aria-hidden', 'true');
    // Nothing in the row says the bare word "remove", which was the wording asked for and refused:
    // this layout's value goes, the token does not.
    expect(revert).not.toHaveAccessibleName('remove');

    fireEvent.click(revert);
    expect(edits.removed).toEqual(['--perch-fg']);
  });

  it('makes deleting a custom token look and behave different from reverting a known one', () => {
    renderPane({ '--perch-fg': '#ff0000', '--brand-hue': '210' });
    openDeveloper();
    const revert = within(row('--perch-fg')).getByRole('button', { name: /^remove this layout/i });
    const destroy = within(row('--brand-hue')).getByRole('button', {
      name: /^delete --brand-hue/i,
    });

    // A different glyph, not the same glyph in a different colour: colour alone is the one difference
    // a reader may not be able to see.
    expect(within(destroy).getByText('✕')).toBeInTheDocument();
    expect(within(revert).queryByText('✕')).toBeNull();
    expect(destroy).toHaveAccessibleName(/nothing|no default|gone/i);
    expect(destroy).toHaveAttribute('title', destroy.getAttribute('aria-label'));
  });

  it('asks once before deleting a token nothing takes over from', () => {
    const edits = renderPane({ '--brand-hue': '210' });
    openDeveloper();
    const hue = row('--brand-hue');

    fireEvent.click(within(hue).getByRole('button', { name: /^delete --brand-hue/i }));
    // Nothing yet: the glyph replaced the word `delete`, so the deliberateness the word carried has
    // to come from somewhere, and a second click is cheaper than an unrecoverable first one.
    expect(edits.removed).toEqual([]);

    const keep = within(hue).getByRole('button', { name: /^keep --brand-hue/i });
    fireEvent.click(keep);
    expect(edits.removed).toEqual([]);

    fireEvent.click(within(hue).getByRole('button', { name: /^delete --brand-hue/i }));
    fireEvent.click(within(hue).getByRole('button', { name: /^confirm: delete --brand-hue/i }));
    expect(edits.removed).toEqual(['--brand-hue']);
  });

  it('does not ask before dropping an override, because nothing is lost by it', () => {
    const edits = renderPane({ '--perch-fg': '#ff0000' });
    openDeveloper();

    fireEvent.click(
      within(row('--perch-fg')).getByRole('button', { name: /^remove this layout/i }),
    );
    expect(edits.removed).toEqual(['--perch-fg']);
  });

  it('leads a colour row with the colour here too', () => {
    renderPane({ '--perch-fg': '#ff0000' });
    openDeveloper();
    const fg = row('--perch-fg');

    expect(
      precedes(
        within(fg).getByTestId('perch-editor-swatch-static'),
        within(fg).getByLabelText('--perch-fg'),
      ),
    ).toBe(true);
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

    expect(screen.getByTestId('perch-editor-token-empty-test')).toBeInTheDocument();
  });
});

/**
 * Two panes on one page, which is what the inspector actually renders.
 *
 * Selecting an element puts a `style` pane below the layout's `theme` pane, and both list
 * `--perch-fg`. A row testid that was the bare token name therefore appeared twice in one document —
 * harmless to a person, and exactly the kind of thing that makes a `getByTestId` throw or, worse,
 * silently assert against whichever pane happened to render first.
 */
describe('two panes on one page', () => {
  it('scopes a row testid to its own pane', () => {
    const ignore = (): void => undefined;

    render(
      <>
        <TokenPane
          id="theme"
          title="theme"
          scope="layout"
          tokens={{ '--perch-fg': '#ff0000' }}
          onSet={ignore}
          onRemove={ignore}
        />
        <TokenPane
          id="style-0"
          title="style"
          scope="element"
          tokens={{}}
          inherited={{ '--perch-fg': '#ff0000' }}
          onSet={ignore}
          onRemove={ignore}
        />
      </>,
    );

    expect(row('--perch-fg', 'theme')).toHaveAttribute('data-perch-overridden', 'true');
    expect(row('--perch-fg', 'style-0')).toHaveAttribute('data-perch-overridden', 'false');
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

  it('names the layout value, not the package default, as what a reset uncovers', () => {
    // The regression this guards is the one the previous slice fixed and this one could easily undo:
    // the quiet text beside the reset answers "what do I get back", and on an element sitting under a
    // layout theme the answer is the layout's `#e8f1ff`, never the package's `#f2f4f8`.
    renderPane({ '--perch-fg': '#ff0000' }, 'element', THEME);
    const fg = row('--perch-fg');

    expect(within(fg).getByText('layout theme #e8f1ff')).toBeInTheDocument();
    expect(within(fg).queryByText(/#f2f4f8/)).toBeNull();
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

    const remove = within(row('--perch-fg')).getByRole('button', { name: /^remove this layout/i });
    expect(remove).toHaveAccessibleName(expect.stringContaining('layout theme value #e8f1ff'));
  });
});
