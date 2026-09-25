export type Config = {
    hostname: string
    homeassistant: HAConfig
    ca_key_file: string
    ca_cert_file: string
    https_port: number
    mqtts_port: number
    mqtt_port: number
    management_port?: number
    thinq1_https_port?: number
    thinq1_port?: number
    mqtt?: boolean
    bridge?: {
        storage_path: string
    }
    log?: string[]
}

export type HAConfig = {
    mqtt_url: string
    discovery_prefix: string
    rethink_prefix: string
    mqtt_user: string
    mqtt_pass: string
    // When true, entities stay available (with retained last states) while
    // the add-on runs; the appliance's deep sleep only affects the
    // "Connected" sensor. When false (default), devices go unavailable as
    // soon as their MQTT session drops.
    cloud_style_availability?: boolean
    // When true, choosing a programme in Home Assistant is written straight to
    // the appliance with an F0 25. Off by default: the appliance then ignores
    // its own knob until it is switched off and on again, and on the RC90U2 it
    // also loses the wrap-around of the dial (measured 2026-09-25).
    push_program_to_appliance?: boolean
}

export type CA = {
    key: string
    cert: string
}
