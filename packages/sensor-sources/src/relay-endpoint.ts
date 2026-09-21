/**
 * Where the relay listens. Per the project spec, Mosquitto's MQTT-over-WebSockets
 * `listener` serves browser clients on 9001, so the dashboard and the relay must agree
 * on this number without either one hard-coding it.
 */

export const RELAY_WEBSOCKET_PORT = 9001;

export const RELAY_DEFAULT_HOST = 'localhost';

/** e.g. `ws://localhost:9001`. */
export function relayWebSocketUrl(
  host: string = RELAY_DEFAULT_HOST,
  port: number = RELAY_WEBSOCKET_PORT,
): string {
  return `ws://${host}:${port}`;
}
