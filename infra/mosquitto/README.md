# Mosquitto — the MQTT broker perch talks to

Perch is **not** a message broker (`ARCHITECTURE.md`, "What perch is not"). MQTT is
transport perch speaks; Mosquitto is the thing that implements it. So everything here is
configuration, not code, and this directory sits at the top level rather than under
`packages/` or `apps/` — those two are npm workspaces (`packages/*`, `apps/*`), and a
config directory in either would be picked up as a package by every root `npm` command.

## Two listeners, and which consumer uses which

| Port | Protocol | Who connects | Why that protocol |
|---|---|---|---|
| `1883` | native MQTT | the relay / `apps/agent` — Node processes reading LibreHardwareMonitor and publishing readings | Server to server. Wrapping it in WebSockets buys nothing and costs a framing layer per message. |
| `9001` | MQTT over WebSockets | the browser, via `packages/sensor-sources` | A browser cannot open a raw TCP socket, so MQTT-inside-a-WebSocket is its *only* route to a broker. Not a preference — a platform constraint. |

A single WebSockets-only listener would work for both, which is exactly why the second one
is worth stating: it would make the relay pay for a limitation only the browser has.

`9001` is not an arbitrary number. `packages/sensor-sources/src/relay-endpoint.ts` exports
`RELAY_WEBSOCKET_PORT = 9001` and `RELAY_DEFAULT_HOST = 'localhost'`, so
`relayWebSocketUrl()` returns `ws://localhost:9001` — this listener, with no ambiguity.
**Those two numbers must stay in agreement.** If you change the port here, change it
there; there is no discovery mechanism that would catch the mismatch for you, and the
symptom in a browser looks like a network fault rather than a misconfiguration.

## Starting it

Deliberately, in the foreground, from the repo root — not as a background service:

```sh
mosquitto -c infra/mosquitto/mosquitto.conf
```

Stop it with `Ctrl-C`. Running it in the foreground is the recommendation, not an
accident: this broker is development scaffolding, its log is the primary diagnostic when a
dashboard shows no data, and a broker you forgot was running is a broker whose stale
retained values will confuse you an hour later. Add `-v` for verbose logging while
debugging a connection.

If you would rather background it for a session, `mosquitto -c infra/mosquitto/mosquitto.conf -d`
daemonises; find it again with `lsof -nP -iTCP:1883 -sTCP:LISTEN` and stop it with `kill`.

> **A broker may already be running.** Homebrew installs its own config at
> `/opt/homebrew/etc/mosquitto/mosquitto.conf`, and if it has been started as a service it
> will already hold 1883 and 9001, and `mosquitto -c` with this config will fail to bind.
> Check with `lsof -nP -iTCP:1883 -iTCP:9001 -sTCP:LISTEN` first. That config is not this
> one, and it binds to every interface rather than loopback — see LAN exposure below.

Containers are the obvious alternative route (`eclipse-mosquitto` with this file mounted at
`/mosquitto/config/mosquitto.conf`). **That path is unverified** — Docker is not available
on this machine, so nothing here has been run that way.

## Verifying it

With the broker running, from another terminal:

```sh
# 1. Both listeners bound?  The startup log names each port; confirm the sockets too:
lsof -nP -iTCP:1883 -iTCP:9001 -sTCP:LISTEN

# 2. Native MQTT round trip on 1883. Subscribe in one terminal:
mosquitto_sub -h localhost -p 1883 -v -t 'sensors/#'

# 3. ...and publish in another. A realistic topic, per packages/sensor-contract/SPEC.md:
#    sensors/<device>/<deviceIndex>/<metric>/<sensorIndex>
mosquitto_pub -h localhost -p 1883 -t 'sensors/cpu/0/temperature/3' \
  -m '{"value":47.5,"at":1789943864122}'

# 4. Retained metadata, which is how a late-connecting dashboard learns labels:
mosquitto_pub -h localhost -p 1883 -t 'sensors/cpu/0/temperature/3/meta' -r \
  -m '{"label":"CPU Core #3","vendor":"intel"}'
```

The subscriber should print each topic and payload back. `mosquitto --test-config -c
infra/mosquitto/mosquitto.conf` checks the file without binding anything.

**The 9001 WebSockets listener cannot be fully verified with the Mosquitto CLI tools.**
`mosquitto_sub` and `mosquitto_pub` do not speak WebSockets, and an end-to-end MQTT-over-WS
round trip needs an MQTT client library in a browser or Node — a dependency this repo does
not yet have. What you *can* confirm without one is that the listener is bound and
genuinely speaking WebSockets, by driving the handshake by hand:

```sh
printf 'GET /mqtt HTTP/1.1\r\nHost: localhost:9001\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: mqtt\r\n\r\n' \
  | nc -w 2 localhost 9001
```

`HTTP/1.1 101 Switching Protocols` with `Sec-WebSocket-Protocol: mqtt` means the listener
is a WebSockets listener and accepted an MQTT subprotocol. The MQTT conversation inside
that socket is verified by the task that adds the browser MQTT source.

## Which address is the broker, when machines differ

`localhost` is the right broker address only when the browser, the publisher and the broker
are all on one machine. They are not, in the real setup: the LibreHardwareMonitor host is
currently `192.168.1.3`, while development happens elsewhere. `ARCHITECTURE.md` already
anticipates this — the broker URL comes from a runtime config file beside the bundle rather
than baked in at build time, precisely so one dashboard bundle can run against several
machines.

Two placements, and they are not equivalent:

- **Broker on the sensor host (`192.168.1.3`).** The publisher connects over loopback;
  every dashboard points at `ws://192.168.1.3:9001`. This is the right shape for a
  permanent setup: the sensor host is the machine that has to be on for there to be any
  data at all, so no extra machine becomes a dependency.
- **Broker on the dev machine.** The publisher on `192.168.1.3` reaches across the network
  and the dashboard uses `ws://localhost:9001`. Convenient while iterating locally, but the
  telemetry stops when your laptop sleeps.

Either way, the address the *browser* uses is
`relayWebSocketUrl(host)` from `packages/sensor-sources` with the host supplied by config —
never a hard-coded string in a widget or a layout.

And note what the current config implies: both listeners bind `127.0.0.1`, so **neither of
those cross-machine arrangements works as shipped.** That is deliberate. Widening the bind
address is the same moment the authentication question below stops being hypothetical, and
the two changes should be made together, not one and then the other.

## Authentication — a decision left to a human, on purpose

Right now: `allow_anonymous true`, no password file, both listeners on `127.0.0.1`. That is
coherent for single-machine development — the trust boundary is the machine, and anything
able to reach a loopback socket can read the same sensor values by other means. Mosquitto
2.x refuses anonymous clients by default, which is why the line is explicit rather than
absent.

It stops being coherent the instant a listener is bound to a LAN-reachable address, and
perch's own rationale says that will happen. The spec's argument for MQTT over a plain
WebSocket rests on the home-automation overlap: Shelly relays, ESP32 panels and Home
Assistant sharing one broker. A shared home-automation broker is a LAN service by
definition, and an anonymous LAN broker means any device or guest on the network can both
read your telemetry and publish to `sensors/#` — which, since a dashboard renders whatever
arrives, makes spoofing a reading trivial.

**No credentials have been configured here, because that is not a default to assume on
someone else's machine.** When the broker needs to leave loopback, the human decides
between roughly:

1. **Password file.** `mosquitto_passwd -c <file> perch`, then `password_file` plus
   `allow_anonymous false`. Simplest thing that works; credentials sit in a file that must
   not be committed, and every publisher and the dashboard config need them.
2. **Password file plus an ACL.** As above, with an `acl_file` restricting publishers to
   write `sensors/#` and dashboards to read it. Worth it once other home-automation
   devices share the broker, because it stops a compromised device anywhere on the LAN from
   forging sensor topics.
3. **TLS on top of either.** Needed if the traffic crosses anything less trusted than a
   home LAN. On a home LAN it mostly buys protection against other devices on that LAN
   sniffing credentials.
4. **Stay on loopback and tunnel.** `ssh -L 9001:localhost:9001 user@192.168.1.3` gives a
   remote dashboard access with no broker change and no credentials at all. Genuinely the
   least work for one developer on one remote host, and it does not scale to an ESP32.

Per-listener settings are worth knowing about when that time comes: with
`per_listener_settings true`, 1883 and 9001 can carry different auth — for instance
requiring credentials on the LAN-facing listener while loopback stays open.
