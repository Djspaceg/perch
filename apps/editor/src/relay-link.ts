/**
 * The relay link a page dials: its URL, its readings as a sensor source, and its control path. Made
 * here for both pages that have one, the editor (`main.tsx`) and the desktop app's Settings window
 * (`settings-main.tsx`), so the two dial the relay the same way.
 */

import { createMqttSource, createRelayControl, isRelayBrokerUrl } from '@perch/sensor-sources';
import type { RelayLink } from './connection-control.js';

/** The relay at `url`, or `undefined` for none. A malformed URL is a thrown error, not the mock. */
export function buildRelay(
  url: string | undefined,
  origin: 'env' | 'config' = 'env',
): RelayLink | undefined {
  const trimmed = url?.trim() ?? '';
  if (trimmed === '') return undefined;
  if (!isRelayBrokerUrl(trimmed)) {
    throw new TypeError(
      `${origin === 'env' ? 'PERCH_RELAY_URL' : 'the desktop relay URL'} is not a ws:// or wss:// URL: ${JSON.stringify(trimmed)}`,
    );
  }

  return {
    url: trimmed,
    source: createMqttSource({ url: trimmed, origin }),
    control: createRelayControl({ url: trimmed }),
  };
}
