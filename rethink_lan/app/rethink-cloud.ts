import express from 'express'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as https from 'node:https'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { Broker } from './cloud/mqtt-broker'
import * as tls from 'node:tls'
import * as net from 'node:net'
import { X509Certificate, randomBytes } from 'node:crypto'
import { routes as thinq1Routes } from './cloud/thinq1/http'
import { routes as thinq2Routes } from './cloud/thinq2/provisioning'
import { DeviceAcceptor as T1Acceptor } from './cloud/thinq1/device'
import { DeviceAcceptor as T2Acceptor } from './cloud/thinq2/device'
import { Connection as HA_connection } from './cloud/homeassistant'
import HA_bridge from './cloud/ha_bridge'
import { Config, CA } from './util/config'
import * as Management from './management'

import log, { setFilter as setLogFilter } from './util/logging'
import { DeviceManager } from './cloud/devmgr'
import { Bridge } from './bridge'
import { JSONStorage } from './bridge/state'

const configPath = resolve(process.argv[2] ?? './config.json')
const configDir = dirname(configPath)
const config = JSON.parse(readFileSync(configPath).toString('utf-8')) as Config

config.ca_key_file = resolve(configDir, config.ca_key_file)
config.ca_cert_file = resolve(configDir, config.ca_cert_file)
if (config.bridge) config.bridge.storage_path = resolve(configDir, config.bridge.storage_path)

if (!config.log) config.log = ['status', 'incoming', 'HTTPS']

const enabled = Object.fromEntries(config.log.map((key) => [key, true]))
setLogFilter((topic) => {
    return enabled[topic] || enabled['all']
})

// if you add spaces here, you will have to fix quoting in the code below
// the CA is also the server
function loadOrCreateCert(): CA {
    let keypem: string, certpem: string
    try {
        keypem = readFileSync(config.ca_key_file).toString('utf-8')
        certpem = readFileSync(config.ca_cert_file).toString('utf-8')

        if (!new X509Certificate(certpem).checkHost(config.hostname))
            throw new Error('invalid subject, creating new certificate')
    } catch (err) {
        log('status', 'Creating a new key/certificate for the CA')
        spawnSync('openssl', [
            'req',
            '-x509',
            '-newkey',
            'rsa:4096',
            '-keyout',
            config.ca_key_file,
            '-out',
            config.ca_cert_file,
            '-sha256',
            '-days',
            '3650',
            '-nodes',
            '-subj',
            '/CN=' + config.hostname,
        ])
        keypem = readFileSync(config.ca_key_file).toString('utf-8')
        certpem = readFileSync(config.ca_cert_file).toString('utf-8')
    }

    return { key: keypem, cert: certpem }
}

const ca = loadOrCreateCert()

// The LG QCA4010 modem caches TLS session tickets and tries to resume them on
// reconnect. If the server was restarted its ticket keys are gone and the
// firmware handles the failed resumption poorly (it goes silent for many
// minutes instead of retrying a full handshake). Persisting the ticket keys
// keeps old tickets valid across restarts, so the modem reconnects instantly.
function loadOrCreateTicketKeys(): Buffer {
    const path = resolve(configDir, 'ticket.keys')
    try {
        const keys = readFileSync(path)
        if (keys.length === 48) return keys
    } catch (err) {
        /* fall through and create new keys */
    }
    log('status', 'Creating new persistent TLS session ticket keys')
    const keys = randomBytes(48)
    writeFileSync(path, keys)
    return keys
}

const ticketKeys = loadOrCreateTicketKeys()
const tlsOptions = { ...ca, ticketKeys }

// Thinq1
function t1setup(manager: DeviceManager) {
    // Thinq1 HTTPS server
    const app = express()
    app.use(function (req, res, next) {
        log('HTTPS', req.hostname, req.url)
        next()
    })

    app.use(thinq1Routes(config))

    // fallback
    app.use((req, res) => {
        res.json({})
    })

    https.createServer(tlsOptions, app).listen(config.thinq1_https_port ?? 46030)
    const acceptor = new T1Acceptor()
    tls.createServer(tlsOptions, acceptor.accept.bind(acceptor)).listen(config.thinq1_port ?? 47878)
    acceptor.on('newDevice', manager.accept.bind(manager))
}

// Thinq2
function t2setup(manager: DeviceManager) {
    // Thinq2 HTTPS server
    const app = express()
    app.use(express.json())

    app.use(function (req, res, next) {
        log('HTTPS', req.hostname, req.url)
        next()
    })

    app.use(thinq2Routes(config, ca))

    // fallback
    app.use((req, res) => {
        res.header('content-type', 'text/xml;charset=utf-8')
        res.end('')
    })

    const httpsServer = https.createServer(tlsOptions, app)
    httpsServer.on('tlsClientError', (err, sock) =>
        log('status', `HTTPS TLS handshake error from ${sock?.remoteAddress ?? '?'}: ${err.message}`),
    )
    httpsServer.listen(config.https_port)

    // internal MQTT broker
    const broker = new Broker()

    if (config.mqtt !== false) {
        const mqttsServer = tls.createServer(tlsOptions, broker.accept.bind(broker))
        mqttsServer.on('secureConnection', (sock) => log('status', `MQTTS TLS connection from ${sock.remoteAddress}`))
        mqttsServer.on('tlsClientError', (err, sock) =>
            log('status', `MQTTS TLS handshake error from ${sock?.remoteAddress ?? '?'}: ${err.message}`),
        )
        mqttsServer.listen(config.mqtts_port)
        net.createServer({}, broker.accept.bind(broker)).listen(config.mqtt_port)
    }

    const acceptor = new T2Acceptor(broker)
    acceptor.on('newDevice', manager.accept.bind(manager))
}

// HA connector
const ha = new HA_bridge(new HA_connection(config.homeassistant))
const manager = new DeviceManager()
manager.on('newDevice', (dev) => ha.newDevice(dev))

t1setup(manager)
t2setup(manager)

let bridge: Bridge | undefined
if (config.bridge) {
    mkdirSync(config.bridge.storage_path, { recursive: true })
    const storage = new JSONStorage(config.bridge.storage_path)
    bridge = new Bridge(storage, manager)

    const theBridge = bridge
    ha.HA.bridgeControl = {
        isRegistered: (id) => theBridge.isRegistered(id),
        isActive: (id) => theBridge.status(id) === true,
        setActive: (id, active) => {
            if (!active) {
                theBridge.suspend(id)
                return true
            }
            if (!theBridge.isRegistered(id)) {
                console.warn(`bridge: ${id} non e' registrato al cloud, accendilo dal pannello`)
                return false
            }
            return theBridge.resume(id)
        },
    }
}

if (config.management_port) Management.app(ha, manager, bridge).listen(config.management_port!)

console.log('Rethink cloud ready')
