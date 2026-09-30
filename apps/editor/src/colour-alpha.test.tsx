/**
 * Every colour field takes alpha: each colour token, on the layout's theme and on an element's style,
 * is the one colour control, and its picker carries the alpha slider and the opacity in percent.
 */

import {
  PERCH_KNOWN_TOKENS,
  PERCH_TOKEN_LABELS,
  knownTokenDefault,
  type KnownToken,
} from '@perch/ui-kit';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { alphaPercent } from './controls/colour.js';
import { swatchStyle } from './controls/index.js';
import { TokenPane } from './token-pane.js';

const COLOURS: readonly KnownToken[] = PERCH_KNOWN_TOKENS.filter(
  (name) => PERCH_TOKEN_LABELS[name].control === 'colour',
);

function renderPane(scope: 'layout' | 'element', tokens: Readonly<Record<string, string>> = {}) {
  const writes: [string, string][] = [];
  render(
    <TokenPane
      id="alpha"
      title="theme"
      scope={scope}
      kind={scope === 'element' ? 'widget' : undefined}
      tokens={tokens}
      onSet={(name, value) => {
        writes.push([name, value]);
      }}
      onRemove={() => undefined}
    />,
  );

  return writes;
}

describe('every colour field', () => {
  it('is more than one token, so the check below is not vacuous', () => {
    expect(COLOURS.length).toBeGreaterThan(10);
  });

  it.each(['layout', 'element'] as const)(
    'on the %s pane opens a picker with an alpha slider and an opacity',
    (scope) => {
      renderPane(scope);
      const shown = COLOURS.filter(
        (name) => scope === 'layout' || PERCH_TOKEN_LABELS[name].scope !== 'canvas',
      );

      for (const name of shown) {
        const row = screen.getByTestId(`perch-editor-token-alpha-${name}`);
        // `hidden`: the rarely tuned colours are in a folded Advanced section, still in the page.
        const hidden = { hidden: true } as const;
        fireEvent.click(
          within(row).getByRole('button', { name: /open colour picker/i, ...hidden }),
        );
        const dialog = within(row).getByRole('dialog', hidden);

        expect(
          within(dialog).getByRole('slider', { name: /alpha/i, ...hidden }),
          name,
        ).toBeDefined();
        expect(
          within(dialog).getByRole('spinbutton', { name: /opacity/i, ...hidden }),
          name,
        ).toHaveValue(String(alphaPercent(knownTokenDefault(name) ?? '')));
        fireEvent.keyDown(dialog, { key: 'Escape' });
      }
    },
  );

  it('writes a translucent reading colour as eight hex digits', () => {
    const writes = renderPane('layout');
    const row = screen.getByTestId('perch-editor-token-alpha---perch-fg');

    fireEvent.click(within(row).getByRole('button', { name: /open colour picker/i }));
    fireEvent.change(within(row).getByRole('spinbutton', { name: /opacity/i }), {
      target: { value: '50' },
    });

    expect(writes).toEqual([['--perch-fg', '#f2f4f880']]);
  });

  it('shows a set translucent colour over a checkerboard on the Developer tab too', () => {
    renderPane('layout', { '--perch-text-color': 'rgba(26, 43, 60, 0.5)' });
    fireEvent.click(screen.getByRole('tab', { name: /developer/i }));
    // jsdom's CSS parser drops a conic gradient, so the fill is read from the function that makes it.
    expect(
      within(screen.getByTestId('perch-editor-token-alpha---perch-text-color')).getByTestId(
        'perch-editor-swatch-static',
      ),
    ).toBeInTheDocument();
    expect(swatchStyle('rgba(26, 43, 60, 0.5)').background).toMatch(
      /^linear-gradient\(#1a2b3c80, #1a2b3c80\), repeating-conic-gradient/,
    );
  });
});
