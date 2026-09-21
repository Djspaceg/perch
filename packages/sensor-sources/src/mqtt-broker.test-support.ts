/**
 * A real MQTT broker, in process, for the mqtt source's tests.
 *
 * Not a mock and not a fake client: `aedes` speaking MQTT 3.1.1 over `ws`, dialed by the same
 * `mqtt` client the browser runs. A test here exercises real CONNECT, real SUBSCRIBE, real
 * retained delivery and a real socket drop, which is the only way to produce evidence that the
 * source works rather than evidence that a stub was called.
 *
 * ## The port is always ephemeral, never 9001
 *
 * `listen(0)` asks the OS for a free port and the URL is built from whatever it assigned. That
 * is deliberate, not incidental: `relay-endpoint.ts` defaults to 9001, and a developer machine
 * frequently has a system mosquitto bound to `0.0.0.0:9001` with anonymous access. A test that
 * used the default port would connect to *that* broker, pass or fail for reasons unrelated to
 * the code, and on a machine where mosquitto happened to be running it would look green while
 * proving nothing. An ephemeral port cannot collide with it.
 *
 * Node-only, by construction — `node:http`, `ws` and `aedes`. It is a `.test-support.ts` and
 * the package tsconfig excludes that suffix, so none of it can reach `dist` or the browser
 * path. Same arrangement as `sensor-contract`'s `lhm-fixture.test-support.ts`.
 */

import { createServer, type Server } from 'node:http';
import { Aedes } from 'aedes';
import { createWebSocketStream, WebSocketServer } from 'ws';
import {
  type SensorMeta,
  type SensorMetaTopic,
  type SensorReading,
  type SensorTopic,
} from '@perch/sensor-contract';

export interface PublishOptions {
  retain?: boolean | undefined;
  qos?: 0 | 1 | 2 | undefined;
}

export interface TestBroker {
  /** `ws://127.0.0.1:<ephemeral>` — never the 9001 default. */
  readonly url: string;
  readonly port: number;
  /** How many MQTT clients are currently connected. */
  readonly clientCount: number;
  publishReading(
    topic: SensorTopic,
    reading: SensorReading,
    options?: PublishOptions,
  ): Promise<void>;
  publishMeta(topic: SensorMetaTopic, meta: SensorMeta, options?: PublishOptions): Promise<void>;
  /** Publish an arbitrary byte string, for the payloads a well-behaved publisher never sends. */
  publishRaw(topic: string, payload: string | Uint8Array, options?: PublishOptions): Promise<void>;
  /**
   * Stop listening and destroy every open socket, so a connected client observes a drop rather
   * than a graceful shutdown. That is what a rebooting sensor host looks like.
   */
  stop(): Promise<void>;
}

export interface TestBrokerOptions {
  /**
   * Bind this exact port instead of an ephemeral one.
   *
   * Used for exactly one thing: restarting a broker on the port a previous one had, which is
   * how a rebooting sensor host is reproduced. The port always comes from a previous
   * `listen(0)`, never from `RELAY_WEBSOCKET_PORT` — see the module comment.
   */
  port?: number | undefined;
}

export async function startTestBroker(options: TestBrokerOptions = {}): Promise<TestBroker> {
  const broker = await Aedes.createBroker();
  const server = createServer();
  const sockets = new Set<{ terminate(): void }>();

  const wss = new WebSocketServer({
    server,
    // `mqtt` is the subprotocol the MQTT-over-WebSockets binding requires. A browser aborts the
    // handshake if the server does not echo it back, so echo it: the test transport then
    // matches what the panel will actually negotiate.
    handleProtocols: () => 'mqtt',
  });

  wss.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    broker.handle(createWebSocketStream(socket));
  });

  const port = await listen(server, options.port ?? 0);

  const publish = (topic: string, payload: string | Uint8Array, options: PublishOptions = {}) =>
    new Promise<void>((resolve, reject) => {
      broker.publish(
        {
          cmd: 'publish',
          topic,
          payload:
            typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload),
          qos: options.qos ?? 0,
          retain: options.retain ?? false,
          dup: false,
        },
        // The parameter is annotated wider than aedes declares it (`error?: Error`) because
        // aedes actually calls back with `null` on success. Checking only `undefined` rejects
        // every successful publish — which is exactly the bug this annotation prevents, and
        // the reason the widened type is stated here rather than silenced with a disable.
        (error: Error | null | undefined) => {
          if (error === null || error === undefined) resolve();
          else reject(error);
        },
      );
    });

  return {
    url: `ws://127.0.0.1:${port}`,
    port,

    get clientCount() {
      return sockets.size;
    },

    publishReading(topic, reading, options) {
      return publish(topic, JSON.stringify(reading), options);
    },

    publishMeta(topic, meta, options) {
      // Retained by default: that is how the contract says metadata is published, and a test
      // that had to opt in would not be testing the arrangement widgets depend on.
      return publish(topic, JSON.stringify(meta), { retain: true, qos: 1, ...options });
    },

    publishRaw(topic, payload, options) {
      return publish(topic, payload, options);
    },

    async stop() {
      for (const socket of sockets) socket.terminate();
      sockets.clear();
      await new Promise<void>((resolve) => {
        wss.close(() => {
          resolve();
        });
      });
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      await new Promise<void>((resolve) => {
        broker.close(() => {
          resolve();
        });
      });
    },
  };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    // 127.0.0.1 rather than every interface: a test broker has no business being reachable
    // from the network, and binding narrowly is the same posture `infra/mosquitto` argues for.
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error(`expected a TCP address from listen(0), got ${JSON.stringify(address)}`));
        return;
      }
      resolve(address.port);
    });
  });
}
