# LG LAN - Documentation

***English** · [Italiano](DOCS.md)*

## Why is it still called rethink-cloud?

The local server is called `rethink-cloud.js`, but it is not a remote cloud service: it is
the server that emulates the LG ThinQ cloud side inside your own network.

This add-on runs it in LAN mode. The bridge to the real LG cloud
(`enable_lg_cloud_bridge`) is off by default.

## Where the code lives

The source is bundled in:

```text
/addons/rethink_lan/app
```

The `Dockerfile` copies `app/`, installs the npm dependencies, compiles TypeScript and then
runs:

```text
/opt/rethink/dist/rethink-cloud.js
```

There is no `git clone` during installation.

## Options

### `hostname`

The DNS name used in the certificate and by the LG appliances. Do not use an IP address.

Default:

```text
common.lgthinq.com
```

That is the same name LG appliances try to reach, so leaving it as is means you only have
to point that name at your box — see [Getting the appliance to come here](#getting-the-appliance-to-come-here).

### `mqtt_url`

URL of the Home Assistant MQTT broker.

Leave it empty and the add-on first tries the Home Assistant OS MQTT service; if there is
none it falls back to `mqtt://core-mosquitto:1883`.

You can also give just a host, or a host and port: the add-on normalizes it. These are all
valid:

```text
192.168.1.10
192.168.1.10:1883
mqtt://192.168.1.10:1883
```

### `mqtt_user`, `mqtt_pass`

MQTT broker credentials. Leave them empty and, if the Home Assistant OS MQTT service is
available, the add-on uses its own.

### `discovery_prefix`

Home Assistant MQTT discovery prefix. Default `homeassistant`; change it only if you
changed it in Home Assistant too.

### `rethink_prefix`

Prefix for the MQTT topics this add-on publishes. Default `rethink`.

### `https_port`

HTTPS port of the local ThinQ server. Default `443`.

LG appliances look for `common.lgthinq.com:443`, so the choice is between:

- `https_port: 443`, if port 443 is free on Home Assistant (the default, and the simplest
  route);
- a different port plus a `443 -> port` redirect on the router.

### `mqtts_port`

TLS MQTT port used by the LG appliances. Default `8883`.

If the log shows:

```text
EADDRINUSE: address already in use :::8883
```

another service already holds that port. Either stop the other add-on or move `mqtts_port`
to a free one.

Note: if an appliance is already paired against the old port, changing it may require
re-provisioning.

### `mqtt_port`

Plain MQTT port, for debugging and internal use. Default `1886`. Change it if it is taken.

### `management_port`

Port of the management page. Default `44401`:

```text
http://HOME_ASSISTANT_ADDRESS:44401
```

It shows the connected appliances and their packets live, and it is where the bridge to
the LG cloud is set up.

### `enable_lg_cloud_bridge`

Default `false`.

Leave it `false` for local-only use. Set it to `true` if you want the appliance to stay
reachable **from LG's own app as well**: the add-on then relays between the machine and
the real cloud.

Two things worth knowing:

- registration with the cloud is done once from the management page, and the credentials
  are kept on disk across restarts;
- the phone running the LG app must be **outside** the DNS rewrite, otherwise it looks for
  the cloud and finds your box. Mobile data works.

Once registered, the **LG cloud bridge** switch in Home Assistant suspends and resumes it
**without discarding the registration**. The button in the management page does something
different: it deletes the certificate and forces the whole procedure to be repeated.

### `cloud_style_availability`

Default `false`.

With `false`, entities go unavailable as soon as the appliance drops its MQTT session. With
`true` they stay available with their last known state while the add-on runs, and the
appliance's deep sleep only shows up in the "Connected" sensor — the way LG's cloud behaves.

### `push_program_to_appliance`

Default `false`.

With `true`, choosing a programme in Home Assistant writes it to the appliance **straight
away**, with the drum stopped, instead of waiting for the start command.

### `log_filter`

Comma-separated list of log topics. Default:

```text
status,incoming,HTTPS,publish,MGMT
```

Add `bridge` to also see the traffic to and from the LG cloud.

## Getting the appliance to come here

The appliance has to be convinced to look for this add-on instead of LG's cloud. That is a
DNS rewrite on your home DNS server (AdGuard Home, Pi-hole, the router):

```text
common.lgthinq.com -> HOME_ASSISTANT_ADDRESS
```

Then power-cycle the appliance. If you are not using `https_port: 443`, add a
`443 -> chosen port` redirect as well.

If the appliance has never been paired, pairing is done with LG's own app, or with
`rethink-setup` from a PC while the appliance is in Wi-Fi access-point mode.

### Why there is no automatic pairing

There was, and it was removed on 22 July 2026. With automatic pairing enabled, **every**
add-on start knocked on the appliance's provisioning port `5500`, and that stunned the LG
modem: measured, 17 minutes to get back on the network against the 76 seconds it takes
without. Not worth it for something you do once.

This is not a Home Assistant limitation: the LG module exposes no ordinary local API from
which an appliance already registered with the cloud could be imported.

## If the add-on does not show up in the store

Check that the path is exactly:

```text
/addons/rethink_lan/config.yaml
```

Then: **Settings → Add-ons → Store**, the menu at the top right, **Check for updates**, and
a hard refresh of the browser.

If it still does not appear, open the Supervisor log: there is usually a line naming the
`config.yaml` field that failed validation.
