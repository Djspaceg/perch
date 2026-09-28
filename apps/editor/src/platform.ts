/**
 * Which platform the editor runs on. How a shortcut is matched and written there is `keybindings/`.
 *
 * ## Two platforms
 *
 * `mac` (macOS, and iPhone and iPad with a keyboard) uses Command where every other platform uses
 * Control. That is the only split shortcuts need, so it is the only one made: `other` is Windows,
 * Linux and ChromeOS alike. A binding's `Mod` is Meta on the first and Control on the second.
 *
 * Detected once per page (`currentPlatform`), from `navigator.userAgentData.platform` where the
 * browser has it, else `navigator.platform`, else the user agent. The editor takes the platform as a
 * prop defaulting to that, so a test runs either.
 */

export type Platform = 'mac' | 'other';

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
