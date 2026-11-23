import { Router } from 'express'
import { Config } from '@/util/config'
import { CA } from '@/util/ca'
import log from '@/util/logging'
import { ClipDeployMessage } from './clip'

/**
 * `rootCertificate` e' quello che diciamo ai dispositivi di fidarsi: la nostra CA, a meno
 * che davanti a noi ci sia un proxy TLS che presenta un certificato di un'altra catena e
 * ne sia stata configurata la radice. Il resto non cambia: i certificati dei dispositivi
 * li firmiamo sempre con la nostra CA.
 */
export function routes(config: Config, ca: CA, rootCertificate = ca.cert) {
    const router = Router()
    router.get('/route', (req, res) => {
        res.json({
            resultCode: '0000',
            result: {
                apiServer: 'https://' + config.hostname + ':' + config.https_port,
                mqttServer: 'ssl://' + config.hostname + ':' + config.mqtts_port,
            },
        })
    })

    router.get('/route/certificate', (req, res) => {
        if (req.query.name) {
            res.json({ resultCode: '0000', result: { certificatePem: rootCertificate } })
        } else {
            res.json({ resultCode: '0000', result: ['common-server', 'aws-iot'] })
        }
    })

    router.post('/device/:deviceId/certificate', (req, res) => {
        // 0x64 e' quello che openssl faceva del `-set_serial 0100` che gli passavamo
        // (legge i valori senza prefisso come decimali). Ogni dispositivo prende lo
        // stesso seriale, come prima.
        ca.signCertificateRequest(String(req.body.csr), '64').then(
            (certificatePem) => {
                // Warning: we don't supply MQTT topics at this point. Maybe we should?
                // OTOH, the firmware seems to ignore it outright...
                res.json({ resultCode: '0000', result: { certificatePem } })
            },
            (err) => {
                log('status', `Failed to sign a certificate for ${req.params.deviceId}: ${err}`)
                res.status(500).json({ resultCode: '9999', result: {} })
            },
        )
    })
    return router
}

export function generateDeployResponse(payload: ClipDeployMessage) {
    return {
        did: payload.did,
        mid: Date.now(),
        cmd: 'completeProvisioning',
        type: 0,
        data: {
            result: 0,
            host: 'message',
            appInfo: {
                host: 'message',
                publication: {
                    // this path is arbitrary
                    message: 'clip/message/devices/' + payload.did,

                    // This path is not-so-arbitrary, because the device will cache it
                    // and try to reuse it on a next provisioning attempt. We pick the
                    // default path that is used by the firmware, so that we can be sure
                    // that it will keep working if you revert to the official cloud.

                    // The paths ARE sent by the API server during certificate generation
                    // but the firmware I've worked with seems to ignore them.
                    provisioning: 'clip/provisioning/devices/' + payload.did,
                },
            },
            provisioningType: payload.cmd,
            deployInterval: 600,
        },
    }
}
