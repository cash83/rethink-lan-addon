# LG LAN

Home Assistant OS app/add-on wrapper for `anszom/rethink` in local LAN mode.

The upstream executable is still called `rethink-cloud`, but it runs locally on your LAN and replaces the LG ThinQ cloud endpoint for supported devices.

The source code is bundled in `app/`. Home Assistant does not need to clone the GitHub repository during install; it only needs internet access to download Alpine/npm packages while building the Docker image.

## Installazione locale

Copy this whole folder to Home Assistant:

```text
/addons/rethink_lan/
  app/
  config.yaml
  Dockerfile
  run.sh
  README.md
  DOCS.md
  CHANGELOG.md
```

Then open Home Assistant:

1. Settings
2. Apps / Add-ons
3. App store
4. Three-dot menu
5. Check for updates

You should see **LG LAN** under local apps/add-ons.

## LAN mode

`enable_lg_cloud_bridge` is `false` by default. In this mode the add-on does not start the optional bridge to the real LG cloud.

The management UI is available at:

```text
http://HOME_ASSISTANT_IP:44401
```

## Automatic onboarding

The add-on includes optional automatic onboarding through the upstream `rethink-setup` tool. Enable it only while pairing:

```yaml
auto_setup_enabled: true
auto_setup_device_host: "192.168.120.254"
auto_setup_wifi_ssid: "NOME_WIFI"
auto_setup_wifi_password: "PASSWORD_WIFI"
auto_setup_timeout: 20
```

If the appliance is already on your LAN, you can try its LAN IP as `auto_setup_device_host`. Some LG modules close the setup port after registration; in that case the add-on cannot import it directly and you must redirect the LG cloud hostname to Home Assistant or put the appliance back into Wi-Fi setup mode.

## DNS and provisioning

Set `hostname` to a DNS name that resolves to Home Assistant, for example:

```text
rethink.lan -> HOME_ASSISTANT_IP
```

For initial pairing, the appliance must reach the rethink HTTPS endpoint instead of the real ThinQ cloud. If you use the default `https_port: 4433`, add a router/NAT redirect from `443` to `4433`. If port `443` is free on Home Assistant, you can set `https_port: 443`.
