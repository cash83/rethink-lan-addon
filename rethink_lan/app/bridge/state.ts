import { Environment, Thinq1DeviceState, Thinq2DeviceState } from './thinqApi'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'

export type Credentials = {
    refreshToken: string
    env: Environment
}

export type BridgeState = {
    getCredentials(): Credentials | undefined
    setCredentials(credentials: Credentials | undefined): void
    getDeviceState(id: string): Thinq1DeviceState | Thinq2DeviceState | undefined
    setDeviceState(id: string, state: Thinq1DeviceState | Thinq2DeviceState | undefined): void
    // Un ponte sospeso resta registrato: si stacca soltanto dal cloud. Il
    // flag e' su disco perche' deve sopravvivere ai riavvii dell'addon.
    isSuspended(id: string): boolean
    setSuspended(id: string, suspended: boolean): void
}

export class JSONStorage implements BridgeState {
    constructor(readonly basePath: string) {}

    oauth2Path() {
        return `${this.basePath}/oauth2.json`
    }

    devicePath(id: string) {
        return `${this.basePath}/device_${id}.json`
    }

    getCredentials() {
        try {
            return JSON.parse(readFileSync(this.oauth2Path()).toString('utf-8')) as Credentials
        } catch (err) {
            return undefined
        }
    }

    setCredentials(credentials: Credentials | undefined) {
        if (credentials) writeFileSync(this.oauth2Path(), JSON.stringify(credentials))
        else unlinkSync(this.oauth2Path())
    }

    getDeviceState(id: string) {
        try {
            return JSON.parse(readFileSync(this.devicePath(id)).toString('utf-8')) as
                | Thinq1DeviceState
                | Thinq2DeviceState
        } catch (err) {
            return undefined
        }
    }

    setDeviceState(id: string, state: Thinq1DeviceState | Thinq2DeviceState | undefined) {
        if (state) writeFileSync(this.devicePath(id), JSON.stringify(state))
        else unlinkSync(this.devicePath(id))
    }

    suspendedPath() {
        return `${this.basePath}/suspended.json`
    }

    readSuspended(): string[] {
        try {
            const list = JSON.parse(readFileSync(this.suspendedPath()).toString('utf-8'))
            return Array.isArray(list) ? list : []
        } catch (err) {
            return []
        }
    }

    isSuspended(id: string) {
        return this.readSuspended().includes(id)
    }

    setSuspended(id: string, suspended: boolean) {
        const list = this.readSuspended().filter((x) => x !== id)
        if (suspended) list.push(id)
        writeFileSync(this.suspendedPath(), JSON.stringify(list))
    }
}
