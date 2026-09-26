/**
 * The connection control as an author meets it: a localhost radio, a host radio with its field, a
 * Connect button, a status label, and a preview that says when its numbers are sample data.
 *
 * The relay is a controllable fake — its link, its retained status and the live source's status are
 * set by the test — so each state the brief names is entered on purpose and asserted from the DOM.
 */

import { LAYOUT_SCHEMA_VERSION, type Layout } from '@perch/layout-schema';
import type {
  SensorReadingHandler,
  SensorSource,
  SensorSourceStatus,
  SensorTopic,
} from '@perch/sensor-contract';
import { createMockSource, type RelayLhmRequest, type RelayLhmStatus } from '@perch/sensor-sources';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from './app.js';
import { CONNECTION_STORAGE_KEY, type ConnectionStorage } from './connection.js';
import type { RelayLink } from './connection-control.js';
import { createLayoutLibrary } from './layout-library.js';

const TOPIC = 'sensors/cpu/0/temperature/0' as SensorTopic;

function library(): ReturnType<typeof createLayoutLibrary> {
  const layout: Layout = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    target: { width: 640, height: 200, frameRate: 30 },
    theme: {},
    elements: [
      { kind: 'widget', widget: 'readout', topic: TOPIC, rect: { x: 10, y: 10, w: 180, h: 100 } },
    ],
  };
  return createLayoutLibrary({ layouts: { desk: JSON.stringify(layout) } });
}

/** A relay the test drives by hand. */
function fakeRelay(): RelayLink & {
  requests: RelayLhmRequest[];
  set(next: {
    link?: 'opening' | 'up' | 'down';
    status?: RelayLhmStatus | undefined;
    source?: SensorSourceStatus;
  }): void;
  emit(value: number): void;
} {
  const listeners = new Set<() => void>();
  const handlers = new Set<SensorReadingHandler>();
  const requests: RelayLhmRequest[] = [];
  let link: 'opening' | 'up' | 'down' = 'opening';
  let status: RelayLhmStatus | undefined;
  let sourceStatus: SensorSourceStatus = 'connecting';

  const source: SensorSource = {
    subscribe(_pattern, onReading) {
      handlers.add(onReading);
      return () => handlers.delete(onReading);
    },
    meta: () => undefined,
    get status() {
      return sourceStatus;
    },
  };

  return {
    url: 'ws://localhost:53123',
    source,
    requests,
    control: {
      get link() {
        return link;
      },
      get status() {
        return status;
      },
      request(target) {
        requests.push(target);
      },
      onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    set(next) {
      if (next.link !== undefined) link = next.link;
      if ('status' in next) status = next.status;
      if (next.source !== undefined) sourceStatus = next.source;
      for (const listener of listeners) listener();
    },
    emit(value) {
      for (const handler of handlers) handler(TOPIC, { value, at: Date.now() });
    },
  };
}

function memoryStorage(initial: Record<string, string> = {}): ConnectionStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

function renderEditor(relay: RelayLink | undefined, storage = memoryStorage()) {
  const mock = createMockSource({ autoStart: false, seed: 1 });
  const result = render(
    <Editor
      library={library()}
      source={mock}
      topics={mock.topics}
      transport={() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') })}
      relay={relay}
      storage={storage}
    />,
  );
  const control = within(result.getByTestId('perch-editor-connection'));

  return {
    result,
    storage,
    localhost: control.getByRole('radio', { name: 'localhost' }),
    remote: control.getByRole('radio', { name: 'host' }),
    field: control.getByRole('textbox', { name: 'sensor host' }),
    connect: control.getByRole('button', { name: 'connect' }),
    status: () => result.getByTestId('perch-editor-connection-status'),
    source: () => result.getByTestId('perch-editor-source'),
  };
}

function type(field: HTMLElement, text: string): void {
  fireEvent.change(field, { target: { value: text } });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the connection control', () => {
  it('opens on localhost, with the host field and Connect disabled, and asks for localhost at once', () => {
    const relay = fakeRelay();
    const ui = renderEditor(relay);

    expect(ui.localhost).toBeChecked();
    expect(ui.remote).not.toBeChecked();
    expect(ui.field).toBeDisabled();
    expect(ui.connect).toBeDisabled();
    expect(relay.requests).toEqual([{ host: 'localhost' }]);
    expect(ui.status()).toHaveAttribute('data-perch-connection', 'connecting');
  });

  it('enables the field on the host radio, and Connect once a valid host is typed', () => {
    const ui = renderEditor(fakeRelay());

    fireEvent.click(ui.remote);
    expect(ui.field).toBeEnabled();
    expect(ui.connect).toBeDisabled();

    type(ui.field, '   ');
    expect(ui.connect).toBeDisabled();

    type(ui.field, 'a b');
    expect(ui.connect).toBeDisabled();
    expect(ui.field).toHaveAttribute('aria-invalid', 'true');

    type(ui.field, '192.168.1.3');
    expect(ui.connect).toBeEnabled();
    expect(ui.field).toHaveAttribute('aria-invalid', 'false');
  });

  it('asks the relay for the typed host on Connect, then disables Connect once connected', () => {
    const relay = fakeRelay();
    const ui = renderEditor(relay);
    act(() => {
      relay.set({ link: 'up' });
    });

    fireEvent.click(ui.remote);
    type(ui.field, '192.168.1.3');
    fireEvent.click(ui.connect);

    expect(relay.requests.at(-1)).toEqual({ host: '192.168.1.3', port: 8085 });
    expect(ui.connect).toBeDisabled();

    act(() => {
      relay.set({ status: { host: '192.168.1.3', port: 8085, state: 'ok' }, source: 'live' });
    });

    expect(ui.status()).toHaveAttribute('data-perch-connection', 'connected');
    expect(ui.status()).toHaveTextContent('connected');
    expect(ui.status()).toHaveTextContent('192.168.1.3:8085');
    expect(ui.connect).toBeDisabled();
  });

  it('re-enables Connect when the connection is lost, and shows the relay’s reason', () => {
    const relay = fakeRelay();
    const ui = renderEditor(relay);
    fireEvent.click(ui.remote);
    type(ui.field, '192.168.1.3');
    fireEvent.click(ui.connect);
    act(() => {
      relay.set({
        link: 'up',
        status: { host: '192.168.1.3', port: 8085, state: 'ok' },
        source: 'live',
      });
    });
    expect(ui.connect).toBeDisabled();

    act(() => {
      relay.set({
        status: { host: '192.168.1.3', port: 8085, state: 'failed', reason: 'EHOSTUNREACH' },
        source: 'stale',
      });
    });

    expect(ui.status()).toHaveAttribute('data-perch-connection', 'disconnected');
    expect(ui.status()).toHaveTextContent('EHOSTUNREACH');
    expect(ui.connect).toBeEnabled();
  });

  it('goes back to localhost the moment its radio is picked, with no button', () => {
    const relay = fakeRelay();
    const ui = renderEditor(relay);
    fireEvent.click(ui.remote);
    type(ui.field, '192.168.1.3:9000');
    fireEvent.click(ui.connect);

    fireEvent.click(ui.localhost);

    expect(relay.requests.at(-1)).toEqual({ host: 'localhost' });
    expect(ui.field).toBeDisabled();
    expect(ui.connect).toBeDisabled();
  });

  it('remembers the choice and the typed host, and reconnects to it on the next load', () => {
    const storage = memoryStorage();
    const first = renderEditor(fakeRelay(), storage);
    fireEvent.click(first.remote);
    type(first.field, '192.168.1.3');
    fireEvent.click(first.connect);
    first.result.unmount();

    const relay = fakeRelay();
    const second = renderEditor(relay, storage);

    expect(storage.data[CONNECTION_STORAGE_KEY]).toBeDefined();
    expect(second.remote).toBeChecked();
    expect(second.field).toHaveValue('192.168.1.3');
    expect(relay.requests).toEqual([{ host: '192.168.1.3', port: 8085 }]);
  });

  it('shows a sample-data badge and mock values while not connected', () => {
    const ui = renderEditor(fakeRelay());

    expect(ui.source()).toHaveAttribute('data-perch-source-kind', 'mock');
    expect(ui.source()).toHaveTextContent('sample data');
  });

  it('paints the relay’s readings, not the mock’s, once connected', () => {
    const relay = fakeRelay();
    const ui = renderEditor(relay);

    act(() => {
      relay.set({
        link: 'up',
        status: { host: 'localhost', port: 28085, state: 'ok' },
        source: 'live',
      });
    });
    act(() => {
      relay.emit(71.25);
    });

    expect(ui.source()).toHaveAttribute('data-perch-source-kind', 'mqtt');
    expect(ui.source()).not.toHaveTextContent('sample data');
    expect(screen.getByTestId('perch-editor-preview')).toHaveTextContent('71.3');
  });

  it('lists the relay’s topics in the sensor picker once connected, not the mock’s', () => {
    const relay = fakeRelay();
    const ui = renderEditor(relay);
    const openPicker = () => {
      fireEvent.click(ui.result.getByRole('button', { name: /^add an element/i }));
      fireEvent.click(
        within(ui.result.getByRole('dialog')).getByRole('button', { name: /^live reading/i }),
      );
      return ui.result.getByRole('dialog', { name: /choose a sensor/i });
    };

    const sample = openPicker();
    expect(within(sample).getByRole('heading', { name: 'gpu 0' })).toBeInTheDocument();
    fireEvent.keyDown(sample, { key: 'Escape' });

    act(() => {
      relay.set({
        link: 'up',
        status: { host: 'localhost', port: 28085, state: 'ok' },
        source: 'live',
      });
    });
    act(() => {
      relay.emit(40);
    });

    const live = openPicker();
    expect(within(live).getByRole('heading', { name: 'cpu 0' })).toBeInTheDocument();
    expect(within(live).queryByRole('heading', { name: 'gpu 0' })).toBeNull();
  });

  it('says there is no relay, and stays on sample data, when the stack did not start one', () => {
    const ui = renderEditor(undefined);

    expect(ui.status()).toHaveAttribute('data-perch-connection', 'disconnected');
    expect(ui.status()).toHaveTextContent('no relay');
    expect(ui.source()).toHaveTextContent('sample data');
  });
});
