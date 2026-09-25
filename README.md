# LG LAN — Home Assistant add-on

***English** · [Italiano](README.it.md)*

Runs LG ThinQ appliances **entirely on your local network**, with no cloud in the middle:
the machine talks to Home Assistant and nothing else. Includes full support for the
**LG RC90U2** heat-pump dryer (`RC90U2_WW`), written and verified against a real appliance.

## Installation

In Home Assistant: **Settings → Add-ons → Store → ⋮ → Repositories**, and paste

```text
https://github.com/cash83/rethink-lan-addon
```

Then install **LG LAN** from the list. The full guide, including the DNS rewrite needed to
point `*.lgthinq.com` at your box, is in [`rethink_lan/DOCS.md`](rethink_lan/DOCS.md)
(Italian).

## The RC90U2 dryer

**What it reads** — programme, cycle stage, dry level, EcoHybrid, anti-crease, remote
start, delayed start, times (elapsed, remaining, expected finish), errors, WiFi signal, and
the **cycle energy** in Wh.

**What it controls** — power on and off, programme, dry level, EcoHybrid, anti-crease,
delayed start, start, pause, and cancelling a programme started by mistake. Cycles
downloaded from the LG app appear in the programme dropdown by themselves, under their
official name, and disappear once the appliance no longer holds them.

Three things LG's own app **cannot** do, and this add-on can:

- **switch the dryer on when it is off** — LG does not allow it remotely;
- **cancel a programme** — the app only offers "Resume", and LG's intended way to cancel is
  to leave the machine paused until the cycle times out;
- **read the cycle energy** — the appliance has the figure, the app never shows it.

### Protocol notes, for anyone digging in

All of it was derived by reading the appliance and comparing it against the real commands
LG's app sends, and every line below was verified on the machine.

- **cycle energy**: `rec[19]:rec[20]`, 16-bit big-endian, in Wh. It only advances while the
  drum turns, stays retained in the idle frames (so it doubles as "what the last cycle
  cost") and resets when the panel is switched on. Checked against a real run: 3h38 and
  1754 Wh, against the 212 minutes and 1.66 kWh LG declares for that programme;
- in the `F0 25` settings command, byte `[2]` is **not** the EcoHybrid: it is `0x03` in
  every command the app sends, including the one that sets Eco. The EcoHybrid value lives
  only in `[5]`. Writing the selected value into `[2]` as well makes the appliance discard
  the whole packet with no error at all;
- in the `F0 26` start command, `[8]` is the delayed start in hours — counted from the
  **end** of the cycle, not the start — and `[5]` is a duration that overrides the
  programme's own;
- `rec[25]` is the **stored** downloaded cycle, `rec[22]` the **applied** one: two different
  things, and the appliance holds exactly one at a time;
- the `30 2B 01 00` packet is not a refusal: it arrives in a burst for as long as a command
  session lasts. The real acknowledgement is `30 00 <command> <status>`, with `00` accepted
  and `FF` refused;
- once the board has gone to sleep, a plain `F0 2A` power-on is acknowledged and ignored: an
  `F0 25` half a second earlier is what unlocks it.

## LG cloud bridge

If you want to keep the official app as well, the bridge to LG's cloud can be switched on.
A switch in Home Assistant suspends and resumes it **without discarding the registration**,
unlike the button in the web panel, which deletes the certificate and forces the whole
procedure to be repeated. The state is kept on disk and survives restarts.

## Licence

**GNU General Public License v2** — full text in [`LICENSE`](LICENSE).

The engine in [`rethink_lan/app/`](rethink_lan/app/) derives from
[`anszom/rethink`](https://github.com/anszom/rethink) by Andrzej Szombierski, taken at
commit `3ce7385`, and stays under the same licence. Thanks to him for the work this add-on
is built on.

Relative to that base, the files below are new or modified; everything else is unchanged:

| file | | what it does |
| --- | --- | --- |
| `cloud/devices/RC90U2_WW.ts` | new | the dryer handler |
| `tests/cloud/devices/RC90U2_WW.test.ts` | new | its tests |
| `tests/bridge/state.test.ts` | new | tests for the suspended bridge |
| `bridge/index.ts` | modified | `suspend` / `resume` without losing the certificate |
| `bridge/state.ts` | modified | the `suspended.json` file |
| `cloud/homeassistant.ts` | modified | `BridgeControl`, the wire between appliance and bridge |
| `cloud/ha_bridge.ts` | modified | handler registration, matching on `modelId`/`modelName` |
| `cloud/thinq2/device.ts` | modified | `link` event, to expose the WiFi signal |
| `cloud/thinq1/device.ts` | modified | same event, to keep the type union callable |
| `cloud/mqtt-broker.ts` | modified | idle timeout from 5 minutes to an hour: the LG modem goes quiet for long stretches while the appliance is off, and kicking it out forces a very slow reconnect |
| `rethink-cloud.ts` | modified | TLS ticket keys persisted to disk: the QCA4010 modem tries to resume the session and, if the server was restarted, goes silent for minutes |
| `rethink-setup.ts` | modified | configurable timeouts and unindented PEM keys, which recent CLIP firmwares reject |
| `util/config.ts` | modified | `cloud_style_availability` and `push_program_to_appliance` options |

The add-on packaging — `config.yaml`, `Dockerfile`, `run.sh`, documentation — and all the
RC90U2 work belong to this repository.

Not affiliated with LG. "LG" and "ThinQ" belong to their respective owners.
