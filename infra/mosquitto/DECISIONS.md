# DECISIONS — Mosquitto broker configuration

Scope: the addition of `infra/mosquitto/`. Nothing outside that directory was changed.

1. **Two listeners, not one: native MQTT on 1883 and MQTT-over-WebSockets on 9001.**
   The browser cannot open a raw TCP socket, so WebSockets is its only route to a broker;
   the relay is a Node process with no such constraint. A single WS-only listener would
   have worked for both consumers and would have made every server-to-server message pay a
   framing layer for a limitation only the browser has. Both are configured and the README
   states which consumer uses which.

2. **9001 was taken from the code, not chosen.** `packages/sensor-sources/src/relay-endpoint.ts`
   exports `RELAY_WEBSOCKET_PORT = 9001` and `RELAY_DEFAULT_HOST = 'localhost'`, so
   `relayWebSocketUrl()` yields `ws://localhost:9001`. The config matches that exactly; no
   change was needed on either side, and neither file was edited. The README records that
   the two numbers must move together, because nothing enforces it mechanically.

3. **`infra/mosquitto/` at the top level, not under `packages/` or `apps/`.** Both of those
   are npm workspace globs (`packages/*`, `apps/*`); a config directory in either becomes a
   package to every root `npm` command. Verified rather than assumed: `npm query .workspace`
   after the change lists the same 8 workspaces and no `infra` entry (see the build/test
   log), and root `npm run build` and `npm test` both exit 0.

4. **Both listeners bind `127.0.0.1`, and anonymous access is allowed.** These two choices
   are one decision: anonymous is defensible only while the trust boundary is the machine.
   Mosquitto 2.x refuses anonymous clients unless told otherwise, so the line is explicit.
   The consequence is stated plainly in the README — as shipped, the config does **not**
   support the cross-machine setup, and widening the bind address is the same moment the
   auth question becomes real.

5. **No credentials configured; the LAN-exposure decision is written up for the human
   instead.** Setting up a password file was not asked for and is not a default to assume
   on someone else's machine. The README enumerates four routes (password file; password
   file plus ACL; TLS over either; stay on loopback and SSH-tunnel) with the trade-off of
   each, and notes `per_listener_settings` as the mechanism for requiring auth on a
   LAN-facing listener while loopback stays open. The spec's home-automation argument for
   MQTT (a shared broker with Shelly relays, ESP32 panels, Home Assistant) is what makes
   this a "when", not an "if".

6. **`persistence false`.** Persistence needs a writable directory, which is machine-local
   state that does not belong in a config file in the repo. The cost is real and is
   documented in both files: the retained `…/meta` topics that carry human-readable sensor
   labels do not survive a broker restart. The durable fix is the publisher republishing
   its metadata on connect, which is the publisher's job either way.

7. **`log_dest stdout` and foreground operation as the documented default.** Same reason —
   a log file path is machine-specific. Foreground running also makes the broker's log the
   first thing you see when a dashboard shows no data, and makes it hard to leave a broker
   running with stale retained values in it.

8. **Verified on shifted ports (11883/19001) because 1883 and 9001 were already occupied.**
   A pre-existing broker (PID 1030, started 2026-09-16, from Homebrew's own
   `/opt/homebrew/etc/mosquitto/mosquitto.conf`) holds both. It is not this task's process,
   so it was left running rather than stopped. The config that was run is byte-identical to
   the committed one except those two port numbers, and the diff is printed at the top of
   the verification log so the substitution is auditable rather than asserted.

9. **WebSockets verified to the handshake, not to an MQTT round trip.** `mosquitto_sub`
   does not speak WebSockets and a real MQTT-over-WS round trip needs a client library,
   which is a dependency addition reserved for the human. What was proven without one: the
   listener is bound, and a hand-written WebSocket upgrade carrying
   `Sec-WebSocket-Protocol: mqtt` returns `HTTP/1.1 101 Switching Protocols` — so it is a
   WebSockets listener that accepted the MQTT subprotocol, not a native MQTT listener on the
   wrong port. The MQTT conversation inside that socket is deferred to the task that adds
   the browser MQTT source. No round trip was simulated or claimed.

10. **Containers documented as an unverified alternative only.** Docker is not available on
    this machine, so the `eclipse-mosquitto` route is mentioned with that caveat stated
    rather than presented as the primary path.

## Call sites

The diff touches no shared component — `infra/mosquitto/` contains only `mosquitto.conf`,
`README.md` and this file, and nothing in the repo imports or reads any of them. The one
coupling that exists is a value agreement rather than a call: port `9001` in `mosquitto.conf`
must equal `RELAY_WEBSOCKET_PORT` in `packages/sensor-sources/src/relay-endpoint.ts`. That
file was read and left unmodified; it already agrees. Its own consumers
(`relayWebSocketUrl`) are unaffected by this change.
