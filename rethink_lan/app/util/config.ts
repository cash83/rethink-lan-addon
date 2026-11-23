export type Config = {
    hostname: string
    homeassistant: HAConfig
    ca_key_file: string
    ca_cert_file: string
    /** Una root da dare ai dispositivi al posto di quella della nostra CA, vedi config.json. */
    custom_root_cert_file?: string
    /**
     * Nomi in piu' da mettere nel certificato TLS predefinito, oltre a `hostname`. Il modem
     * LG si collega al nome del cloud che ha in cache (es. common.iot.eic.lgthinq.com) e
     * controlla il certificato contro quello: se non manda l'SNI, serve qui.
     */
    extra_server_names?: string[]
    https_port: number
    mqtts_port: number
    mqtt_port: number
    management_port?: number
    thinq1_https_port?: number
    thinq1_port?: number
    mqtt?: boolean
    bridge?: {
        storage_path: string
        /** Risolutori per le connessioni in uscita del ponte, vedi bridge/resolver.ts. */
        dns?: string[]
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
