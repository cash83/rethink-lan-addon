# LG LAN

Home Assistant OS add-on that runs LG ThinQ appliances entirely on the local network,
with no cloud in the middle, plus full support for the LG RC90U2 heat-pump dryer.

Full documentation: [`DOCS.en.md`](DOCS.en.md) · [`DOCS.md`](DOCS.md) (Italiano)

## Install

Add this repository in **Settings → Add-ons → Store → ⋮ → Repositories**:

```text
https://github.com/cash83/rethink-lan-addon
```

Then install **LG LAN** from the list.

To install it by hand instead, copy this folder to Home Assistant as
`/addons/rethink_lan/` and run **Check for updates** in the add-on store.

## Getting the appliance to talk to it

The appliance has to look for this add-on instead of LG's cloud. Add a DNS rewrite on your
home DNS server (AdGuard Home, Pi-hole, the router):

```text
common.lgthinq.com -> HOME_ASSISTANT_ADDRESS
```

then power-cycle the appliance. Port `443` is the default, so no redirect is needed unless
you change `https_port`.

Pairing a brand-new appliance is done with LG's own app, or with `rethink-setup` from a PC
while the appliance is in Wi-Fi access-point mode. There is no automatic pairing: it was
removed in July 2026 because probing the provisioning port on every start stunned the LG
modem for a quarter of an hour. [`DOCS.en.md`](DOCS.en.md) has the measurements.

## What is inside

`app/` holds the server sources. The `Dockerfile` copies them, installs the npm
dependencies, compiles TypeScript and runs `/opt/rethink/dist/rethink-cloud.js` — there is
no `git clone` during installation, so Home Assistant only needs internet access to fetch
Alpine and npm packages while building the image.

Licence: GPL-2.0, see [`app/COPYING`](app/COPYING). The engine derives from
[`anszom/rethink`](https://github.com/anszom/rethink) by Andrzej Szombierski; the list of
new and modified files is in the repository README.
