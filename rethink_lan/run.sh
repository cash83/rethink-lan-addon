#!/usr/bin/with-contenv bashio
set -euo pipefail

APP_NAME="rethink-lan"
OPTIONS_FILE="/data/options.json"
CONFIG_FILE="/data/config.json"

log() {
  printf '[%s] %s\n' "${APP_NAME}" "$*"
}

to_bool() {
  case "${1,,}" in
    true|yes|on|1)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# Read options straight from /data/options.json with jq. Do NOT rely on
# bashio::config here: newer base images ship a bashio that needs the
# Supervisor API (which this add-on does not request), so it silently
# returns nothing and every option falls back to its default (this is how
# hostname once degraded to rethink.lan and broke the TLS certificate).
option() {
  local key="$1"
  local fallback="$2"
  local value=""

  if [ -f "${OPTIONS_FILE}" ]; then
    value="$(jq -r --arg k "${key}" 'if has($k) and .[$k] != null then .[$k] | tostring else "" end' "${OPTIONS_FILE}" 2>/dev/null || true)"
  fi
  if [ -z "${value}" ] || [ "${value}" = "null" ]; then
    value="$(bashio::config "${key}" 2>/dev/null || true)"
  fi
  if [ -z "${value}" ] || [ "${value}" = "null" ]; then
    printf '%s\n' "${fallback}"
  else
    printf '%s\n' "${value}"
  fi
}

normalize_mqtt_url() {
  local value="$1"

  if [ -z "${value}" ]; then
    printf '%s\n' "${value}"
    return
  fi

  case "${value}" in
    *://*)
      printf '%s\n' "${value}"
      ;;
    *:*)
      printf 'mqtt://%s\n' "${value}"
      ;;
    *)
      printf 'mqtt://%s:1883\n' "${value}"
      ;;
  esac
}

RETHINK_HOSTNAME="$(option hostname rethink.lan)"
MQTT_URL="$(option mqtt_url '')"
MQTT_USER="$(option mqtt_user '')"
MQTT_PASS="$(option mqtt_pass '')"

if [ -z "${MQTT_URL}" ]; then
  if bashio::services.available "mqtt"; then
    MQTT_SERVICE_HOST="$(bashio::services mqtt host)"
    MQTT_SERVICE_PORT="$(bashio::services mqtt port)"
    MQTT_SERVICE_USER="$(bashio::services mqtt username)"
    MQTT_SERVICE_PASSWORD="$(bashio::services mqtt password)"

    MQTT_URL="mqtt://${MQTT_SERVICE_HOST}:${MQTT_SERVICE_PORT}"
    if [ -z "${MQTT_USER}" ]; then
      MQTT_USER="${MQTT_SERVICE_USER}"
    fi
    if [ -z "${MQTT_PASS}" ]; then
      MQTT_PASS="${MQTT_SERVICE_PASSWORD}"
    fi
    log "Using Home Assistant MQTT service at ${MQTT_URL}"
  else
    MQTT_URL="mqtt://core-mosquitto:1883"
    log "MQTT URL is empty and no MQTT service was detected; using ${MQTT_URL}"
  fi
else
  log "Using configured MQTT URL ${MQTT_URL}"
fi

MQTT_URL="$(normalize_mqtt_url "${MQTT_URL}")"
log "Normalized MQTT URL ${MQTT_URL}"

export RETHINK_HOSTNAME
export MQTT_URL
export MQTT_USER
export MQTT_PASS
export CONFIG_FILE
export OPTIONS_FILE

mkdir -p /data

# The LG modem connects to its cached cloud hostnames (e.g.
# common.iot.eic.lgthinq.com for MQTT) and validates the server
# certificate against that hostname. The app only generates a
# CN=<hostname> certificate, so we pre-generate one here with SANs
# covering every *.lgthinq.com name the firmware may use.
CA_KEY="/data/ca.key"
CA_CERT="/data/ca.cert"
SAN_LIST="DNS:${RETHINK_HOSTNAME},DNS:*.lgthinq.com,DNS:*.eic.lgthinq.com,DNS:*.iot.eic.lgthinq.com,DNS:common.iot.eic.lgthinq.com"

if [ ! -f "${CA_CERT}" ] || ! openssl x509 -in "${CA_CERT}" -noout -text 2>/dev/null | grep -q 'DNS:\*.iot.eic.lgthinq.com'; then
  log "Generating CA certificate with LG ThinQ SANs (${SAN_LIST})"
  openssl req -x509 -newkey rsa:4096 -keyout "${CA_KEY}" -out "${CA_CERT}" -sha256 -days 3650 -nodes \
    -subj "/CN=${RETHINK_HOSTNAME}" -addext "subjectAltName=${SAN_LIST}"
fi

node --input-type=module <<'NODE'
import fs from "node:fs";
import net from "node:net";

const options = JSON.parse(fs.readFileSync(process.env.OPTIONS_FILE, "utf8"));

const numberOption = (key, fallback) => {
  const value = Number(options[key] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${key} must be a valid TCP port`);
  }
  return value;
};

const stringOption = (key, fallback) => {
  const value = options[key];
  return value === undefined || value === null || value === "" ? fallback : String(value);
};

const logFilter = stringOption("log_filter", "status,incoming,HTTPS,publish,MGMT")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const config = {
  hostname: process.env.RETHINK_HOSTNAME,
  homeassistant: {
    mqtt_url: process.env.MQTT_URL,
    discovery_prefix: stringOption("discovery_prefix", "homeassistant"),
    rethink_prefix: stringOption("rethink_prefix", "rethink"),
    mqtt_user: process.env.MQTT_USER || "",
    mqtt_pass: process.env.MQTT_PASS || "",
    cloud_style_availability: options.cloud_style_availability === true,
    push_program_to_appliance: options.push_program_to_appliance === true
  },
  ca_key_file: "/data/ca.key",
  ca_cert_file: "/data/ca.cert",
  https_port: numberOption("https_port", 4433),
  mqtts_port: numberOption("mqtts_port", 8884),
  mqtt_port: numberOption("mqtt_port", 1884),
  thinq1_https_port: numberOption("thinq1_https_port", 46030),
  thinq1_port: numberOption("thinq1_port", 47878),
  management_port: numberOption("management_port", 44401),
  log: logFilter.length ? logFilter : ["status", "incoming", "HTTPS", "publish", "MGMT"]
};

const ports = [
  ["https_port", config.https_port, "ThinQ HTTPS"],
  ["mqtts_port", config.mqtts_port, "ThinQ private MQTT over TLS"],
  ["mqtt_port", config.mqtt_port, "ThinQ private MQTT plain TCP"],
  ["thinq1_https_port", config.thinq1_https_port, "ThinQ v1 HTTPS"],
  ["thinq1_port", config.thinq1_port, "ThinQ v1 TCP"],
  ["management_port", config.management_port, "management UI"]
];

const seen = new Map();
for (const [key, port, label] of ports) {
  if (seen.has(port)) {
    throw new Error(`${key} (${label}) duplicates ${seen.get(port)} on TCP port ${port}`);
  }
  seen.set(port, key);
}

async function assertPortAvailable(key, port, label) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE") {
        reject(new Error(
          `TCP port ${port} is already in use on Home Assistant OS (${label}). ` +
          `Stop the other add-on/service using it, or change '${key}' in this add-on configuration.`
        ));
        return;
      }
      reject(error);
    });
    server.once("listening", () => {
      server.close(resolve);
    });
    server.listen(port, "::");
  });
}

for (const [key, port, label] of ports) {
  await assertPortAvailable(key, port, label);
}

if (options.enable_lg_cloud_bridge === true) {
  const bridgeStoragePath = stringOption("bridge_storage_path", "/data/state");
  fs.mkdirSync(bridgeStoragePath, { recursive: true });
  config.bridge = {
    storage_path: bridgeStoragePath
  };
}

fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify(config, null, 2));
NODE

log "Starting local LAN server for hostname ${RETHINK_HOSTNAME}"
log "Management UI: http://<home-assistant-ip>:$(option management_port 44401)"
log "LG cloud bridge mode: $(option enable_lg_cloud_bridge false)"

# Auto-setup REMOVED (2026-07-22): with auto_setup_enabled=true every add-on
# start poked the appliance's provisioning port 5500 via rethink-setup, which
# stunned the LG modem for 15+ minutes (measured: reconnection 17 min with the
# feature on vs 76 s with it off). Pairing must be done manually with the
# companion app or rethink-setup from a PC.

exec node /opt/rethink/dist/rethink-cloud.js "${CONFIG_FILE}"
