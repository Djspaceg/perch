# `fixtures/`

Real captured payloads, used as test fixtures. Shared rather than per-package,
because both `packages/sensor-contract` (topic mapping) and `apps/agent` (value
parsing) need the same sample, and duplicating it would let the two drift.

## `lhm-data.sample.json`

A live `GET /data.json` from a LibreHardwareMonitor instance, captured
2026-09-20. 59 KB, **214 sensor nodes**.

Coverage — this is why it is worth keeping rather than hand-writing a fixture:

| Hardware prefix | Sensors | Maps to |
|---|---|---|
| `/amdcpu/0` | 102 | `cpu` |
| `/gpu-nvidia/0` | 39 | `gpu` |
| `/lpc/nct6798d/0` | 22 | `superio` |
| `/nvme/0` | 19 | `storage` |
| `/nic/%7B…%7D` × 5 | 25 | `network` |
| `/lpc/ec` | 7 | `embedded-controller` |

13 of the 21 sensor types appear: Clock, Control, Current, Data, Factor, Fan,
Level, Load, Power, SmallData, Temperature, Throughput, Voltage.

### What this sample proved, that reading LHM's source did not

1. **Every value arrives as a formatted string**, including `RawValue` —
   `"2.848 V"`, `"448 RPM"`, `"44.0 °C"`. LHM's C# type is `float?`, but the JSON
   transport stringifies it. Parsing the numeric prefix is mandatory.
2. **`RawValue` differs from `Value` for exactly one type here: `Throughput`** —
   `Value: "6.4 MB/s"` against `RawValue: "6699008.0 B/s"`. That single case is
   the entire reason to prefer `RawValue`: it holds the unit steady while
   `Value` rescales with magnitude.
3. **`Factor` has no unit at all** — `"48.500"`, bare. A parser keying on a
   trailing unit must not require one.
4. **Hardware instance ids are not always integers.** NICs are identified by a
   URL-encoded GUID (`%7B` is `{`), not an ordinal.
5. **Hardware prefixes vary in depth**, and the first segment is not sufficient
   to identify the device: `/lpc/nct6798d/0` is a SuperIO chip while `/lpc/ec`
   is an embedded controller, and `/lpc/ec` carries no instance segment.

### Privacy note

This file contains the capturing machine's hostname, its motherboard model, and
five network-adapter GUIDs. Nothing secret, but it is real machine identity in a
repository that is licensed for distribution. Scrub or synthesise those values
before publishing if that matters — the fixture's usefulness depends on the
*shapes*, not the specific hostname or GUIDs.
