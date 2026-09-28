/**
 * Which platform the editor runs on, and how a keyboard shortcut is matched and written there.
 *
 * ## Two platforms
 *
 * `mac` (macOS, and iPhone and iPad with a keyboard) uses Command where every other platform uses
 * Control. That is the only split shortcuts need, so it is the only one made: `other` is Windows,
 * Linux and ChromeOS alike. Each platform accepts only its own combinations, so Ctrl-Z on a Mac and
 * Win-Z on Windows reach the browser untouched, and each shows only its own.
 *
 * Detected once per page (`currentPlatform`), from `navigator.userAgentData.platform` where the
 * browser has it, else `navigator.platform`, else the user agent. The editor takes the platform as a
 * prop defaulting to that, so a test runs either.
 *
 * ## Writing a shortcut
 *
 * One `KeyCombo` is written three ways: `formatKeys` for people (the Mac's glyphs in its menus' order,
 * `⌃⌥⇧⌘Z`; `Ctrl+Alt+Shift+Z` elsewhere), `ariaKeys` for `aria-keyshortcuts` (`Control+Shift+Z`,
 * the same on every platform, as that attribute names keys rather than symbols), and `shortcutHint`
 * for a tooltip: the action, its first combination, and any others as alternatives.
 */

export type Platform = 'mac' | 'other';

/** One key with the modifiers that must be held, and no others. */
export interface KeyCombo {
  /** `KeyboardEvent.key` of the unshifted key: `z`, `Backspace`. Letters match either case. */
  readonly key: string;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
  readonly meta?: boolean;
}

/** The parts of `navigator` detection reads. `userAgentData` is not yet in every browser or type. */
export interface NavigatorLike {
  readonly userAgentData?: { readonly platform?: string } | undefined;
  readonly platform?: string | undefined;
  readonly userAgent?: string | undefined;
}

const APPLE = /mac|iphone|ipad|ipod|ios/i;

/** The platform `nav` describes. The first of its three sources that says anything decides. */
export function detectPlatform(nav: NavigatorLike | undefined): Platform {
  const said = [nav?.userAgentData?.platform, nav?.platform, nav?.userAgent].find(
    (text) => text !== undefined && text !== '',
  );

  return said !== undefined && APPLE.test(said) ? 'mac' : 'other';
}

let detected: Platform | undefined;

/** This page's platform, detected on first use. */
export function currentPlatform(): Platform {
  detected ??= detectPlatform(typeof navigator === 'undefined' ? undefined : navigator);

  return detected;
}

/** Whether `event` is exactly `combo`: its key, and its modifiers with none extra. */
export function matchesKeys(
  event: {
    readonly key: string;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly shiftKey: boolean;
    readonly metaKey: boolean;
  },
  combo: KeyCombo,
): boolean {
  return (
    event.key.toLowerCase() === combo.key.toLowerCase() &&
    event.ctrlKey === (combo.ctrl ?? false) &&
    event.altKey === (combo.alt ?? false) &&
    event.shiftKey === (combo.shift ?? false) &&
    event.metaKey === (combo.meta ?? false)
  );
}

/** Keys with a symbol of their own on a Mac. Only those a hint shows so far. */
const MAC_KEYS: Readonly<Record<string, string>> = { Backspace: '⌫' };

function keyName(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

/** `combo` as a person reads it on `platform`. */
export function formatKeys(combo: KeyCombo, platform: Platform): string {
  const key = keyName(combo.key);
  if (platform === 'mac') {
    return [
      combo.ctrl === true ? '⌃' : '',
      combo.alt === true ? '⌥' : '',
      combo.shift === true ? '⇧' : '',
      combo.meta === true ? '⌘' : '',
      MAC_KEYS[key] ?? key,
    ].join('');
  }

  return [
    ...(combo.ctrl === true ? ['Ctrl'] : []),
    ...(combo.alt === true ? ['Alt'] : []),
    ...(combo.shift === true ? ['Shift'] : []),
    ...(combo.meta === true ? ['Meta'] : []),
    key,
  ].join('+');
}

/** `combos` as `aria-keyshortcuts` spells them. */
export function ariaKeys(combos: readonly KeyCombo[]): string {
  return combos
    .map((combo) =>
      [
        // The platform's own modifier first, as the ARIA examples write it: `Meta+Shift+Z`.
        ...(combo.ctrl === true ? ['Control'] : []),
        ...(combo.meta === true ? ['Meta'] : []),
        ...(combo.alt === true ? ['Alt'] : []),
        ...(combo.shift === true ? ['Shift'] : []),
        keyName(combo.key),
      ].join('+'),
    )
    .join(' ');
}

/** A tooltip: `Redo (Ctrl+Shift+Z or Ctrl+Y)`. */
export function shortcutHint(
  action: string,
  combos: readonly KeyCombo[],
  platform: Platform,
): string {
  if (combos.length === 0) return action;

  return `${action} (${combos.map((combo) => formatKeys(combo, platform)).join(' or ')})`;
}
