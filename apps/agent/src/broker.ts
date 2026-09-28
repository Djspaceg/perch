/**
 * The MQTT broker, running **inside this process**.
 *
 * ## Why in-process and not Mosquitto
 *
 * The standing rule is that perch must not add a user-facing installation prerequisite. An
 * external broker is one: "install Mosquitto, write a config file with a `listener 9001`
 * block, enable `protocol websockets`, run it as a service" is four steps before a single
 * number appears on the dashboard, on a machine whose owner wanted a temperature readout.
 * `aedes` is a broker as a library, so the relay executable is the whole install story beyond
 * LibreHardwareMonitor itself — which is the point ARCHITECTURE.md's "not a message broker"
 * line is *not* in tension with: perch still does not implement MQTT, it embeds an
 * implementation.
 *
 * ## Two listeners, because a browser cannot open a TCP socket
 *
 * - **TCP** carries native MQTT, for `mosquitto_sub`, another relay, or any ordinary client.
 * - **WebSockets** is the only transport a page can use, and the dashboard is a page. It is
 *   the listener that matters for the product; the TCP one is what makes the thing
 *   inspectable from a shell, which is how this module is verified at all.
 *
 * Both are served by the same `aedes` instance, so a reading published once is visible on
 * both and retained state is shared. Two brokers would have been two sources of truth.
 *
 * ## No authentication
 *
 * Deliberate, and the human's answer was "unrestricted for now": `aedes`'s defaults accept any
 * client and authorise every publish and subscribe. That is a LAN-only posture and it is
 * recorded in DECISIONS.md and in the README rather than left to be discovered. The bind
 * interface is configurable precisely so a narrower posture is a flag away.
 */

import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { Aedes, type PublishPacket } from 'aedes';
import { WebSocketServer, createWebSocketStream, type WebSocket } from 'ws';
import {
  DASHBOARD_BROKER_URL_ENV_VAR,
  RELAY_CLI_FLAGS,
  RELAY_ENV_VARS,
  type BrokerAddress,
  type RelaySetting,
} from './config.js';

/** What a publisher needs from the broker. Narrower than `EmbeddedBroker` so the poll loop can be tested against a recording stub. */
export interface BrokerPublisher {
  /** Publish one message. Resolves when the broker has accepted it. */
  publish(topic: string, payload: string, options: PublishOptions): Promise<void>;
}

export interface PublishOptions {
  /**
   * Whether the broker keeps the message for future subscribers.
   *
   * `true` for metadata, which a dashboard connecting later still needs; `false` for readings,
   * because a retained reading is a stale reading that arrives looking fresh, and `at` is the
   * only thing telling a subscriber otherwise.
   */
  readonly retain: boolean;
}

export interface EmbeddedBroker extends BrokerPublisher {
  /** The port the TCP listener actually bound. Differs from the request when it asked for 0. */
  readonly mqttPort: number;
  /** The port the WebSocket listener actually bound. */
  readonly wsPort: number;
  /** How many clients are connected right now. Reported in the poll summary. */
  readonly clientCount: number;
  /**
   * Receive every message published on `topic` by any client, as text, in process.
   *
   * The relay's one inbound path: the control request in `lhm-control.ts`. Resolves once the
   * subscription is in place; the returned function removes it.
   */
  subscribe(topic: string, onMessage: (payload: string) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export interface EmbeddedBrokerOptions {
  /**
   * Bind a free port, chosen by the OS, for a listener whose configured port is already in use.
   *
   * Off by default, and off for the CLI: a relay run from a shell is dialled at a port a human
   * typed, so moving silently would be the "reading someone else's empty broker" failure in a new
   * shape. A host that hands the bound port to its own page, as the desktop app does, has no such
   * reader, and for it a held 9001 is just a port to step around. Only `EADDRINUSE` falls back.
   */
  readonly freePortWhenHeld?: boolean | undefined;
}

/**
 * Start the broker and bind both listeners.
 *
 * Rejects if either port is unavailable, after closing whatever it had already opened — a
 * half-started broker listening on MQTT but not WebSockets would serve `mosquitto_sub`
 * perfectly while the dashboard, the actual product, could not connect, and the relay would
 * look healthy in every log.
 */
export async function startEmbeddedBroker(
  address: BrokerAddress,
  options: EmbeddedBrokerOptions = {},
): Promise<EmbeddedBroker> {
  const { freePortWhenHeld = false } = options;
  const aedes = await Aedes.createBroker();

  // A broker on a LAN gets malformed packets and half-open sockets. Both events are
  // per-client and non-fatal; without listeners `aedes` emits them on an EventEmitter with
  // no handler, which in Node is an uncaught exception that would take the relay down.
  aedes.on('clientError', (client, error) => {
    process.stderr.write(`[broker] client ${client.id} error: ${error.message}\n`);
  });
  aedes.on('connectionError', (_client, error) => {
    process.stderr.write(`[broker] connection error: ${error.message}\n`);
  });

  // Every live TCP socket, so shutdown can end them. `net.Server.close()` stops *accepting* and
  // then waits for existing connections to end on their own; an MQTT client holds its socket
  // open indefinitely by design, so without this the close callback never fires and the relay
  // hangs on Ctrl-C for as long as a dashboard tab is open. `http.Server` has
  // `closeAllConnections()` for exactly this; `net.Server` has no equivalent.
  const tcpSockets = new Set<Socket>();

  const tcpServer = createTcpServer((socket: Socket) => {
    // Same argument as above, one layer down: a client that vanishes mid-packet gives the
    // socket an ECONNRESET, and an unhandled 'error' on a socket is fatal to the process.
    socket.on('error', (error: Error) => {
      process.stderr.write(`[broker] mqtt socket error: ${error.message}\n`);
    });
    tcpSockets.add(socket);
    socket.on('close', () => tcpSockets.delete(socket));
    aedes.handle(socket);
  });
  tcpServer.on('error', (error: Error) => {
    process.stderr.write(`[broker] mqtt listener error: ${error.message}\n`);
  });

  const httpServer = createHttpServer();
  httpServer.on('error', (error: Error) => {
    process.stderr.write(`[broker] websocket listener error: ${error.message}\n`);
  });
  const wsServer = new WebSocketServer({ server: httpServer });
  // `ws` re-emits the HTTP server's 'error' on the WebSocketServer as well, so a failed
  // `listen` arrives *twice*: once where `listen()` below is waiting for it, and once here,
  // where an unhandled 'error' would be an uncaught exception — the listen rejection would
  // never be delivered and the caller would hang rather than being told the port was taken.
  wsServer.on('error', (error: Error) => {
    process.stderr.write(`[broker] websocket server error: ${error.message}\n`);
  });
  wsServer.on('connection', (socket: WebSocket) => {
    // `createWebSocketStream` adapts a WebSocket to the Duplex `aedes.handle` wants. The
    // error handler is mandatory for the same reason as the TCP one, and it has to be on the
    // stream: an error on the underlying socket surfaces here once it is wrapped.
    const stream = createWebSocketStream(socket);
    stream.on('error', (error: Error) => {
      process.stderr.write(`[broker] websocket stream error: ${error.message}\n`);
    });
    aedes.handle(stream);
  });

  const parts: BrokerParts = { aedes, wsServer, httpServer, tcpServer, tcpSockets };

  try {
    const mqttPort = await listen(
      tcpServer,
      address.bindHost,
      address.mqttPort,
      'mqttPort',
      freePortWhenHeld,
    );
    const wsPort = await listen(
      httpServer,
      address.bindHost,
      address.wsPort,
      'wsPort',
      freePortWhenHeld,
    );

    return {
      mqttPort,
      wsPort,
      get clientCount(): number {
        return aedes.connectedClients;
      },
      publish: async (topic, payload, options) => {
        await publishThrough(aedes, topic, payload, options);
      },
      subscribe: async (topic, onMessage) => {
        // `aedes.subscribe` delivers through the same matching a client subscription gets. The
        // callback must be called for aedes to move on to the next subscriber.
        const deliver = (packet: { payload: Buffer | string }, done: () => void): void => {
          onMessage(
            typeof packet.payload === 'string' ? packet.payload : packet.payload.toString('utf8'),
          );
          done();
        };
        await new Promise<void>((resolve) => {
          aedes.subscribe(topic, deliver, resolve);
        });
        return () =>
          new Promise<void>((resolve) => {
            aedes.unsubscribe(topic, deliver, resolve);
          });
      },
      close: async () => {
        await closeAll(parts);
      },
    };
  } catch (error) {
    await closeAll(parts);
    throw error;
  }
}

/** Which of the two listeners is being bound, named as the setting that configures it. */
type BrokerListenerSetting = Extract<RelaySetting, 'mqttPort' | 'wsPort'>;

/**
 * The port to suggest moving to, or `0` when there is no sensible number to name.
 *
 * `+10000` keeps the digits of the port it replaces — 1883 becomes 11883, 9001 becomes 19001 —
 * so the suggested command line still reads as "the MQTT one" and "the WebSocket one" at a
 * glance, and lands well clear of both the registered-service range and, on this platform, the
 * ephemeral range the OS hands out. Above 55535 there is no such port, and the honest answer is
 * then `0`: printing an out-of-range number would be advice that fails when followed.
 */
export function suggestedListenPort(port: number): number {
  const suggestion = port + 10_000;

  return suggestion > 65_535 ? 0 : suggestion;
}

/**
 * What to do about a port that is already in use.
 *
 * Exported and pure because it is the part worth asserting: the diagnosis ("EADDRINUSE") is the
 * OS's, but the way out is the product's, and on any machine with Mosquitto installed this is
 * the first message perch ever shows. Naming only the port leaves the reader to discover that it
 * is configurable, what the setting is called, and — for the WebSocket listener — that the page
 * dials that port too and has to be moved with it.
 */
export function portInUseGuidance(setting: BrokerListenerSetting, port: number): string {
  const flag = `--${RELAY_CLI_FLAGS[setting]}`;
  const variable = RELAY_ENV_VARS[setting];
  const suggestion = suggestedListenPort(port);

  const moves =
    suggestion === 0
      ? [`${flag} 0 (or ${variable}=0) to let the OS pick a free one; it is reported at startup`]
      : [
          `${flag} ${suggestion} (or ${variable}=${suggestion})`,
          `${flag} 0 to let the OS pick a free one; it is reported at startup`,
        ];

  // The defaults are not the thing to change: 1883 is the registered MQTT port and 9001 is the
  // number `sensor-sources`' relay endpoint already contracts for the browser. Saying so stops
  // the next reader from "fixing" the collision in `RELAY_DEFAULTS`.
  const why =
    setting === 'mqttPort'
      ? 'the default stays 1883, the registered MQTT port, so an ordinary MQTT client can find this broker without being told where to look'
      : 'the default stays 9001, which is the port the dashboard is built to dial';

  const alsoMoveThePage =
    setting === 'wsPort'
      ? ` The dashboard dials this port, so move it too: ${DASHBOARD_BROKER_URL_ENV_VAR}=ws://localhost:${
          suggestion === 0 ? '<the port reported at startup>' : suggestion
        }.`
      : '';

  return (
    `port ${port} is already in use -- on a machine with Mosquitto installed, that is usually Mosquitto, ` +
    `which holds it on every interface. Move this relay instead: ${moves.join(', or ')}. ` +
    `Changing the default was not the fix: ${why}.${alsoMoveThePage}`
  );
}

/**
 * Bind one server and resolve the port it actually got.
 *
 * With `freePortWhenHeld`, a port in use is retried once as port 0 on the same server, which Node
 * allows after a failed `listen`. The caller learns of the move by comparing the port it asked for
 * with the one returned.
 */
async function listen(
  server: TcpServer | HttpServer,
  host: string,
  port: number,
  setting: BrokerListenerSetting,
  freePortWhenHeld = false,
): Promise<number> {
  try {
    return await listenOnce(server, host, port, setting);
  } catch (error) {
    const held =
      error instanceof Error && error.cause instanceof Error && isAddressInUse(error.cause);
    if (!freePortWhenHeld || !held || port === 0) throw error;

    return listenOnce(server, host, 0, setting);
  }
}

async function listenOnce(
  server: TcpServer | HttpServer,
  host: string,
  port: number,
  setting: BrokerListenerSetting,
): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    // A listen failure (EADDRINUSE, EACCES) arrives as an 'error' event rather than a throw,
    // and `once` is what keeps it from also reaching the long-lived handler installed above.
    const onError = (error: Error): void => {
      // Guidance only for a collision. EACCES on a privileged port or EADDRNOTAVAIL on an
      // interface this host does not have are different problems, and "try another port" would
      // be confidently wrong advice about both.
      const guidance = isAddressInUse(error) ? `\n  ${portInUseGuidance(setting, port)}` : '';
      reject(
        new Error(`cannot listen on ${host}:${port}: ${error.message}${guidance}`, {
          cause: error,
        }),
      );
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error(`listener on ${host}:${port} reported no numeric address`);
  }

  return address.port;
}

/**
 * Whether a listen failure was a port collision.
 *
 * `code` is not declared on `Error`, and Node's `SystemError` type is not exported anywhere that
 * can import it, so `in` does the narrowing — TypeScript widens the operand to carry the tested
 * key, which is a check at runtime rather than a cast asserting something unproven. Matching on
 * the message text instead would break the moment a Node version reworded it.
 */
function isAddressInUse(error: Error): boolean {
  return 'code' in error && error.code === 'EADDRINUSE';
}

/**
 * Publish one message through the broker's own machinery.
 *
 * `aedes.publish` injects the packet exactly as a connected client's publish would — same
 * retained-message store, same subscription matching — so the relay needs no loopback client
 * and there is no second code path for its own messages. QoS 0 because a reading is superseded
 * by the next poll a second later: at-least-once delivery of a value that is about to be
 * replaced buys nothing and costs an ack round trip per sensor per tick, 213 of them here.
 */
async function publishThrough(
  aedes: Aedes,
  topic: string,
  payload: string,
  options: PublishOptions,
): Promise<void> {
  const packet: PublishPacket = {
    cmd: 'publish',
    topic,
    payload,
    qos: 0,
    retain: options.retain,
    dup: false,
  };

  return new Promise<void>((resolve, reject) => {
    // Widened to include `null`: the published type says `Error | undefined`, but `aedes` is
    // JavaScript and its internal callbacks pass an explicit `null` on some success paths. A
    // narrower parameter here would make that null a truthy-looking rejection.
    aedes.publish(packet, (error?: Error | null) => {
      if (error === undefined || error === null) resolve();
      else reject(error);
    });
  });
}

/** Everything one `startEmbeddedBroker` opened, so shutdown can close it whether or not the start finished. */
interface BrokerParts {
  readonly aedes: Aedes;
  readonly wsServer: WebSocketServer;
  readonly httpServer: HttpServer;
  readonly tcpServer: TcpServer;
  readonly tcpSockets: ReadonlySet<Socket>;
}

/**
 * Shut everything down, in the order that lets it finish.
 *
 * Connections first, so no new packet arrives while the broker is tearing down its persistence
 * and so neither listener is left waiting on a socket that will never end itself; then the two
 * listeners; then `aedes`. Every step is best-effort — a shutdown path that can throw is a
 * process that does not exit on Ctrl-C.
 */
async function closeAll(parts: BrokerParts): Promise<void> {
  for (const client of parts.wsServer.clients) client.terminate();
  // A plain HTTP request to the WebSocket port leaves a keep-alive connection that is not a
  // WebSocket and so is not in `wsServer.clients`; `close()` waits for it, which is a relay
  // that does not exit on Ctrl-C until a curl times out.
  parts.httpServer.closeAllConnections();
  // And the same for native MQTT, which has no built-in equivalent. A connected client would
  // otherwise keep `tcpServer.close()`'s callback from ever being called.
  for (const socket of parts.tcpSockets) socket.destroy();

  await closeServer(parts.wsServer);
  await closeServer(parts.httpServer);
  await closeServer(parts.tcpServer);
  await new Promise<void>((resolve) => {
    parts.aedes.close(resolve);
  });
}

/**
 * Close one server, resolving even on error.
 *
 * `close()` errors when the server was never listening, which is the normal case on the
 * failure path in `startEmbeddedBroker` — the second listener failed, so the first may or may
 * not be up, and either way the right answer is to carry on closing the rest.
 */
async function closeServer(server: TcpServer | HttpServer | WebSocketServer): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}
