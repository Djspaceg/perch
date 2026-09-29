/**
 * The desktop app's Settings window: the header's connection control, moved. The same control, the
 * same connection model and the same relay control path, so everything `connection-control.test.tsx`
 * pins holds here; these tests pin what is particular to the window.
 */

import type { SensorSource, SensorSourceStatus } from '@perch/sensor-contract';
import type { RelayLhmRequest, RelayLhmStatus } from '@perch/sensor-sources';
import { act, fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RelayLink } from './connection-control.js';
import { SETTINGS_BRIDGE_GLOBAL, findSettingsBridge } from './settings-host.js';
import { SettingsPage } from './settings-page.js';

function fakeRelay(): RelayLink & {
  requests: RelayLhmRequest[];
  set(next: {
    link?: 'opening' | 'up' | 'down';
    status?: RelayLhmStatus;
    source?: SensorSourceStatus;
  }): void;
} {
  const listeners = new Set<() => void>();
  const requests: RelayLhmRequest[] = [];
  let link: 'opening' | 'up' | 'down' = 'opening';
  let status: RelayLhmStatus | undefined;
  let sourceStatus: SensorSourceStatus = 'connecting';
  const source: SensorSource = {
    subscribe: () => () => undefined,
    meta: () => undefined,
    get status() {
      return sourceStatus;
    },
  };

  return {
    url: 'ws://127.0.0.1:53123',
    source,
    requests,
    control: {
      get link() {
        return link;
      },
      get status() {
        return status;
      },
      request: (target) => {
        requests.push(target);
      },
      onChange: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    set(next) {
      if (next.link !== undefined) link = next.link;
      if (next.status !== undefined) status = next.status;
      if (next.source !== undefined) sourceStatus = next.source;
      act(() => {
        for (const listener of listeners) listener();
      });
    },
  };
}

function renderSettings(
  relay: RelayLink,
  target = { host: 'localhost', port: 8085, defaultPort: 8085 },
) {
  const result = render(<SettingsPage relay={relay} target={target} />);
  const control = within(result.getByTestId('perch-editor-connection'));

  return {
    result,
    localhost: control.getByRole('radio', { name: 'localhost' }),
    remote: control.getByRole('radio', { name: 'host' }),
    field: control.getByRole('textbox', { name: 'sensor host' }),
    connect: control.getByRole('button', { name: 'connect' }),
    status: () => result.getByTestId('perch-editor-connection-status'),
  };
}

describe('the Settings window', () => {
  it("holds the header's connection control: both radios, the host field, Connect and the status", () => {
    const view = renderSettings(fakeRelay());

    expect(view.result.getByRole('heading', { name: 'Sensor host' })).toBeDefined();
    expect(view.localhost).toBeChecked();
    expect(view.field).toBeDisabled();
    expect(view.connect).toBeDisabled();
    expect(view.status().getAttribute('data-perch-connection')).toBe('connecting');
  });

  it('starts on the host the relay already polls, so opening it moves nothing', () => {
    const relay = fakeRelay();
    const view = renderSettings(relay, { host: '192.168.1.3', port: 8085, defaultPort: 8085 });

    expect(view.remote).toBeChecked();
    expect(view.field).toHaveValue('192.168.1.3:8085');
    expect(relay.requests).toEqual([{ host: '192.168.1.3', port: 8085 }]);
  });

  it('asks the relay for a typed host on Connect, and shows the reason when it fails', () => {
    const relay = fakeRelay();
    const view = renderSettings(relay);

    fireEvent.click(view.remote);
    fireEvent.change(view.field, { target: { value: '192.168.1.3' } });
    fireEvent.click(view.connect);

    expect(relay.requests.at(-1)).toEqual({ host: '192.168.1.3', port: 8085 });
    relay.set({
      link: 'up',
      status: { host: '192.168.1.3', port: 8085, state: 'failed', reason: 'EHOSTUNREACH' },
    });
    expect(view.status().getAttribute('data-perch-connection')).toBe('disconnected');
    expect(view.status().textContent).toContain('EHOSTUNREACH');
    expect(view.connect).toBeEnabled();
  });

  it('connects to localhost the moment it is picked, and says connected once readings arrive', () => {
    const relay = fakeRelay();
    const view = renderSettings(relay, { host: '192.168.1.3', port: 8085, defaultPort: 8085 });

    fireEvent.click(view.localhost);
    expect(relay.requests.at(-1)).toEqual({ host: 'localhost' });

    relay.set({
      link: 'up',
      status: { host: 'localhost', port: 8085, state: 'ok' },
      source: 'live',
    });
    expect(view.status().getAttribute('data-perch-connection')).toBe('connected');
  });

  it("keeps nothing in the page's storage: the runner's settings remember the host", () => {
    const before = window.localStorage.length;
    const view = renderSettings(fakeRelay());

    fireEvent.click(view.remote);
    fireEvent.change(view.field, { target: { value: 'pc:9000' } });
    fireEvent.click(view.connect);

    expect(window.localStorage.length).toBe(before);
  });
});

describe('findSettingsBridge', () => {
  it("finds the Settings window's bridge by its own global, and nobody else's", () => {
    const bridge = { load: () => Promise.resolve(null) };

    expect(SETTINGS_BRIDGE_GLOBAL).toBe('perchSettingsHost');
    expect(findSettingsBridge({ [SETTINGS_BRIDGE_GLOBAL]: bridge })).toBe(bridge);
    expect(findSettingsBridge({ perchEditorHost: bridge })).toBeNull();
    expect(findSettingsBridge({ [SETTINGS_BRIDGE_GLOBAL]: { load: 1 } })).toBeNull();
  });
});
