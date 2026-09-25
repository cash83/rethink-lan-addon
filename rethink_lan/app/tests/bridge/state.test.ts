import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JSONStorage } from '@/bridge/state'

describe('JSONStorage: ponte sospeso', () => {
    function store() {
        const dir = mkdtempSync(join(tmpdir(), 'rethink-state-'))
        return { dir, s: new JSONStorage(dir) }
    }

    test('senza file nessuno e sospeso', () => {
        const { dir, s } = store()
        assert.equal(s.isSuspended('abc'), false)
        rmSync(dir, { recursive: true, force: true })
    })

    test('sospendere e riprendere, una riga per apparecchio', () => {
        const { dir, s } = store()

        s.setSuspended('abc', true)
        assert.equal(s.isSuspended('abc'), true)
        assert.equal(s.isSuspended('def'), false, 'non tocca gli altri')

        s.setSuspended('def', true)
        assert.equal(s.isSuspended('abc'), true)
        assert.equal(s.isSuspended('def'), true)

        // sospendere due volte non deve lasciare doppioni
        s.setSuspended('abc', true)
        s.setSuspended('abc', false)
        assert.equal(s.isSuspended('abc'), false, 'un solo giro per toglierlo')
        assert.equal(s.isSuspended('def'), true)

        // il file sopravvive: una lettura nuova vede lo stesso stato
        assert.equal(new JSONStorage(dir).isSuspended('def'), true)

        rmSync(dir, { recursive: true, force: true })
    })

    test('file rovinato: si riparte da zero invece di piantarsi', () => {
        const { dir, s } = store()
        writeFileSync(join(dir, 'suspended.json'), 'non e json')
        assert.equal(s.isSuspended('abc'), false)
        s.setSuspended('abc', true)
        assert.equal(s.isSuspended('abc'), true)
        rmSync(dir, { recursive: true, force: true })
    })

    test('un file che contiene altro non viene scambiato per una lista', () => {
        const { dir, s } = store()
        writeFileSync(join(dir, 'suspended.json'), '{"abc":true}')
        assert.equal(s.isSuspended('abc'), false, 'solo un array e una lista di sospesi')
        rmSync(dir, { recursive: true, force: true })
    })
})
