import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/RC90U2_WW'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device, buf, hex } from '@/tests/helpers/mocks'

const DEVICE_ID = 'test-id'
const MODEL_ID = 'RC90U2_WW'
const META: Metadata = { modelId: MODEL_ID, modelName: MODEL_ID, swVersion: '2.9.61' }

// Every frame below was captured from the real dryer (add-on log, 2026-09-18..21).
const SAMPLE_PROFILE_LIST = buf(
    'aa3730310201534141333939333530303900007fd200008000000000000253414133393933343931320000a36700004000000000000fbb',
)
// Idle, right after a completed cycle: everything zeroed except the retained
// cycle energy (rec[19]:rec[20] = 0x04f1 = 1265 Wh).
const SAMPLE_IDLE = buf('aa2130eb0019000000000000000000000000000000040004f1040000006b0032bb')
// Paused inside a Misti cycle: 43 min left of a 1:20 programme, 964 Wh so far.
const SAMPLE_PAUSED = buf('aa2130eb001903002b011406000403040000000000040003c4020000006b00debb')
// 0xEC delta frame, the moment the same cycle starts: previous record then current.
const SAMPLE_STATUS_DELTA = buf(
    'aa3c30ec001902011401140600040302000000000005500000010000006b00001902011401140600040302000000000005000000010000006b0089bb',
)

// Panel calibration, 2026-09-21: Antipiega on (rec[16] bit1) and, 37 s later,
// Avvio a distanza on (rec[17] bit0). Both confirmed against the display icons.
const SAMPLE_ANTICREASE_ON = buf(
    'aa3c30ec001901021e00000700030102000000000004000000000000006b00001901021e00000700030102000000000204000000000000006b0025bb',
)
const SAMPLE_REMOTE_START_ON = buf(
    'aa3c30ec001901021e00000700030102000000000005200000000000006b00001901021e00000700030102000000000005000000000000006b00c5bb',
)

// I quattordici programmi della manopola, per controllare che la tendina non
// contenga voci che poi il comando F0 26 non saprebbe codificare.
const CYCLE_CODES = [
    'Personalizzato',
    'Asciugamani',
    'Piumini',
    'Sintetici',
    'Misti',
    'Cotone',
    'Speciale Sport',
    'Rapido 30',
    'Lingerie',
    'Trattamento Delicato',
    'Con cestello',
    'Aria fredda',
    'Aria calda',
    'Allergy Care',
]

// I due record veri del 25/09/2026, prima e dopo aver scaricato "Carico Pieno"
// dall'app LG: cambiano solo rec[22] e rec[25] (00 -> 74), il livello (00 -> 04)
// e il tempo (2h30 -> 2h40, i 160 minuti che l'app ha mandato).
const SAMPLE_IDLE_NO_DOWNLOAD = buf('aa2130eb001901021e0300070000030200000000000500000003000000000062bb')
const SAMPLE_IDLE_DOWNLOADED = buf('aa2130eb00190102280300070004030200000000000500000003740000740078bb')

const WRITE_POLL_STATUS = 'AA0EF0ED1121010000001800B5BB'
const WRITE_POWER_ON = 'AA08F02A010098BB'
const WRITE_POWER_OFF = 'AA09F0240101009CBB'
const WRITE_PAUSE = 'AA09F02404010099BB'
// F0 25 SmartCourse select used as the idle-lockout wake, with this unit's
// SmartCourse 0x6b. Byte for byte the frame that woke the real dryer on
// 2026-09-22 after ten hours idle.
const WRITE_WAKE = 'AA1DF025031500032700000000000000006B000000000000000000DCBB'

function makeDevice() {
    const ha = new MockHAConnection()
    const thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    return { ha, thinq, dev }
}

describe(MODEL_ID, () => {
    test('config exposes controls and visible status components', () => {
        const { ha } = makeDevice()
        const cfg = ha.devices[DEVICE_ID].config
        assert.ok(cfg, 'config published')
        const components = cfg!.components as Record<string, Record<string, unknown>>

        for (const c of [
            'power_on',
            'power_off',
            'pause',
            'poll_status',
            'reset',
            'connected',
            'status',
            'summary',
            'program',
            'temperature',
            'dry_level',
            'selected_time',
            'remaining_time',
            'eta',
            'elapsed_time',
            'running',
            'power',
            'delay_hours',
            'delay_armed',
            'delay_remaining',
            'ecohybrid',
            'anticrease',
            'remote_start',
            'stage',
            'energy',
            'rssi',
            'profile_1',
            'profile_2',
            'state_code',
            'course_code',
            'program_code',
            'level_code',
            'option_codes',
            'option_flags',
            'feature_flags',
            'stage2_code',
            'counter_code',
            'status_record',
            'packet_count',
        ]) {
            assert.ok(components[c], `component ${c} present`)
        }

        // F0240501 is acked with a beep and ignored by this model, so there is no
        // separate start button - the Start/Pause toggle is the only real control.
        assert.equal(components['start'], undefined)

        // The energy sensor has to stay a total_increasing counter in Wh: it
        // restarts from 0 at every cycle and HA reads a drop as a counter reset.
        assert.equal(components['energy'].state_class, 'total_increasing')
        assert.equal(components['energy'].device_class, 'energy')
        assert.equal(components['energy'].unit_of_measurement, 'Wh')
    })

    test('appena accesa senza programma le mandiamo quello scelto', async () => {
        const { ha, thinq, dev } = makeDevice()
        ;(ha as unknown as { config: Record<string, boolean> }).config = { push_program_to_appliance: true }
        dev.start()
        thinq.resetRecorder()

        // accesa, in attesa, nessun programma
        thinq.emit('data', buf('aa2130eb001901000000000000000000000000000005000000000000006b0021bb'))
        await new Promise((resolve) => setTimeout(resolve, 1600))
        assert.ok(hex(thinq.outbox[0]!).startsWith('AA1DF025'), 'parte il programma di default')

        // e non lo rimanda a ogni frame
        thinq.resetRecorder()
        thinq.emit('data', buf('aa2130eb001901000000000000000000000000000005000000000000006b0021bb'))
        await new Promise((resolve) => setTimeout(resolve, 1600))
        assert.equal(thinq.outbox.length, 0, 'una volta sola per accensione')
    })

    test("senza l'opzione accesa il programma non viene scritto sulla macchina", () => {
        const { thinq, dev } = makeDevice()
        thinq.emit('data', buf('aa2130eb001901000000000000000000000000000005000000000000006b0021bb'))
        thinq.resetRecorder()
        dev.setProperty('sel_program', 'Rapido 30')
        assert.equal(thinq.outbox.length, 0, 'di default non si tocca la manopola della macchina')
    })

    test('cambiare programma in HA lo scrive subito sulla macchina', async () => {
        const { ha, thinq, dev } = makeDevice()
        // l'opzione dell'add-on, spenta di default
        ;(ha as unknown as { config: Record<string, boolean> }).config = { push_program_to_appliance: true }

        // a macchina spenta la scelta resta solo un desiderio
        thinq.emit('data', SAMPLE_IDLE)
        thinq.resetRecorder()
        dev.setProperty('sel_program', 'Rapido 30')
        assert.equal(thinq.outbox.length, 0, 'da spenta non si manda niente')

        // accesa e in attesa: parte un F0 25 col corso e la sua durata
        thinq.emit('data', buf('aa2130eb001901000000000000000000000000000005000000000000006b0021bb'))
        thinq.resetRecorder()
        dev.setProperty('sel_program', 'Rapido 30')
        // Nella forma dell'app LG: [2] costante 0x03, [5] l'EcoHybrid scelto
        // (qui Eco = 01), [6] = 30 minuti, [14] = 0x09, [19] il livello scelto.
        assert.equal(hex(thinq.outbox.pop()!), 'AA1DF025031500011E0000000000000009000000000300000000004ABB')

        // livello ed EcoHybrid vanno mandati col programma che la macchina ha
        // gia' addosso, non con quello scelto nella tendina
        thinq.emit('data', buf('aa2130eb001901021e00000700030102000000000005000000000000006b00c8bb'))
        thinq.resetRecorder()
        dev.setProperty('sel_eco', 'Turbo')
        dev.setProperty('sel_dry_level', 'Extra')
        assert.equal(
            hex(thinq.outbox.pop()!),
            'AA1DF0250315000396000000000000000700000000040000000000CDBB',
            'corso 0x07 della macchina, Turbo ed Extra',
        )

        // Regressione della 0.2.56: con Eco il byte [2] deve restare 0x03 e solo
        // [5] cambiare. Il caso Turbo qui sopra non se ne accorgerebbe, perche'
        // Turbo vale 3 come la costante - ed e' esattamente per questo che il
        // difetto e' rimasto nascosto cosi' a lungo.
        thinq.resetRecorder()
        dev.setProperty('sel_eco', 'Eco')
        const conEco = thinq.outbox.pop()!
        assert.equal(conEco[4], 0x03, '[2] e una costante, non l EcoHybrid')
        assert.equal(conEco[7], 0x01, '[5] porta Eco')

        // a ciclo in corso non si tocca niente
        thinq.emit('data', SAMPLE_STATUS_DELTA)
        thinq.resetRecorder()
        dev.setProperty('sel_program', 'Cotone')
        assert.equal(thinq.outbox.length, 0, 'in funzione non si scrive')
    })

    test('un comando rifiutato riporta le tendine sui valori veri', () => {
        const { ha, thinq, dev } = makeDevice()
        dev.start()
        // la macchina e' su Cotone, Pronto armadio, Eco
        thinq.emit('data', buf('aa2130eb001901021e00000700030102000000000005000000000000006b00c8bb'))
        assert.equal(ha.devices[DEVICE_ID].properties.sel_eco, 'Eco')

        // il livello torna sui valori veri quando la macchina rifiuta
        dev.setProperty('sel_dry_level', 'Extra')
        assert.equal(ha.devices[DEVICE_ID].properties.sel_dry_level, 'Extra')
        thinq.emit('data', buf('aa2130eb001901021e00000700030102000000000005100000000000006b00f8bb'))
        assert.equal(ha.devices[DEVICE_ID].properties.sel_dry_level, 'Pronto armadio', 'il livello non resta a mentire')

        // l'EcoHybrid invece resta come l'ha scelto l'utente: e' una richiesta
        // per il prossimo avvio, non una cosa che la macchina applica subito
        dev.setProperty('sel_eco', 'Turbo')
        thinq.emit('data', buf('aa2130eb001901021e00000700030102000000000005100000000000006b00f8bb'))
        assert.equal(ha.devices[DEVICE_ID].properties.sel_eco, 'Turbo', 'la scelta vale per l avvio')
    })

    test('fine prevista: orario solo a ciclo in corso', () => {
        const { ha, thinq } = makeDevice()

        // a macchina spenta non c'e' nessuna previsione
        thinq.emit('data', SAMPLE_IDLE)
        assert.equal(ha.devices[DEVICE_ID].properties.eta, 'None')

        // il campione in pausa ha 43 minuti di residuo
        const prima = Date.now()
        thinq.emit('data', SAMPLE_PAUSED)
        const eta = Date.parse(ha.devices[DEVICE_ID].properties.eta as string)
        const minuti = Math.round((eta - prima) / 60_000)
        assert.equal(minuti, 43, 'adesso piu' + String.fromCharCode(39) + ' il tempo residuo')
    })

    test('the programme dropdown follows the dial, not the wire ids', () => {
        const { ha } = makeDevice()
        const components = ha.devices[DEVICE_ID].config!.components as Record<string, Record<string, unknown>>
        const options = components['sel_program'].options as string[]

        assert.equal(options[0], 'Cotone', 'la prima tacca in alto a sinistra')
        assert.equal(options[7], 'Personalizzato', 'dopo Rapido 30 viene Personalizzato, come sulla manopola')
        assert.equal(options[options.length - 1], 'Speciale Sport', "l'ultima prima di tornare a Cotone")
        assert.equal(options.length, 14, 'quattordici tacche, quattordici voci')
        // ogni voce deve restare un programma che sappiamo tradurre in codice
        for (const o of options) assert.ok(CYCLE_CODES.includes(o), `${o} ha un codice`)
    })

    test('profile-list packet publishes useful fields', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_PROFILE_LIST)
        const props = ha.devices[DEVICE_ID].properties

        assert.equal(props.connected, 'ON')
        assert.equal(props.frame_type, 'profile_list')
        assert.equal(props.profile_1, 'SAA39935009')
        assert.equal(props.profile_2, 'SAA39934912')
        assert.equal(props.raw_flags_1, '7fd20000800000000000')
        assert.equal(props.raw_flags_2, 'a3670000400000000000')
        assert.equal(props.last_payload_length, 55)
        assert.equal(props.packet_count, 1)
    })

    test('idle 30eb frame reports the appliance off and keeps the last cycle energy', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_IDLE)
        const props = ha.devices[DEVICE_ID].properties

        assert.equal(props.frame_type, 'status')
        assert.equal(props.status, 'Spenta')
        assert.equal(props.summary, 'Spenta')
        assert.equal(props.power, 'OFF')
        assert.equal(props.running, 'OFF')
        assert.equal(props.program, 'Nessuno')
        assert.equal(props.temperature, 'Nessuno') // ecoHybrid mode, not a temperature
        assert.equal(props.error, 'Nessuno')
        assert.equal(props.problem, 'OFF')
        assert.equal(props.dry_level, 'Nessuno')
        assert.equal(props.selected_time, '0')
        assert.equal(props.remaining_time, '0')
        assert.equal(props.elapsed_time, 0)
        assert.equal(props.stage, 'Ferma')
        assert.equal(props.energy, 1265)
        assert.equal(props.delay_hours, 0)
        assert.equal(props.delay_armed, 'OFF')
        assert.equal(props.delay_remaining, '0')
        assert.equal(props.ecohybrid, 'OFF')
        // rec[1] is a constant record marker, never a state
        assert.equal(props.state_code, '0x19')
        assert.equal(props.counter_code, 0x6b)
        assert.equal(props.status_record, '0019000000000000000000000000000000040004f1040000006b00')
    })

    test('paused mid-cycle frame decodes programme, times, stage and energy', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_PAUSED)
        const props = ha.devices[DEVICE_ID].properties

        assert.equal(props.status, 'In pausa')
        assert.equal(props.summary, 'In pausa - Misti - residuo 43')
        assert.equal(props.power, 'ON')
        assert.equal(props.running, 'OFF')
        assert.equal(props.program, 'Misti')
        assert.equal(props.temperature, 'Turbo') // rec[10] = 3 = ecoHybrid Turbo
        assert.equal(props.dry_level, 'Extra')
        assert.equal(props.selected_time, '1:20')
        assert.equal(props.remaining_time, '43')
        assert.equal(props.elapsed_time, 37)
        assert.equal(props.stage, 'Pronto armadio') // rec[11] = 4 = terza tacca
        assert.equal(props.energy, 964)
        assert.equal(props.course_code, '0x04') // raw stage code, rec[11]
        assert.equal(props.program_code, '0x06')
        assert.equal(props.level_code, '0x00') // event byte, rec[18], quiet here
        assert.equal(props.stage2_code, '0x02')
    })

    test('30ec status delta reads the second record as current state', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_STATUS_DELTA)
        const props = ha.devices[DEVICE_ID].properties

        assert.equal(props.frame_type, 'status_delta')
        assert.equal(props.status, 'In funzione')
        assert.equal(props.running, 'ON')
        assert.equal(props.stage, 'Asciugatura') // rec[11] = 2 = prima tacca
        // a fresh cycle: the energy counter restarts from zero
        assert.equal(props.energy, 0)
        assert.equal(props.option_flags, '0x05')
        assert.equal(props.status_record, '001902011401140600040302000000000005000000010000006b00')
    })

    test('panel options: anti-crease and remote start are separate bits', () => {
        const a = makeDevice()
        a.thinq.emit('data', SAMPLE_ANTICREASE_ON)
        assert.equal(a.ha.devices[DEVICE_ID].properties.anticrease, 'ON')
        assert.equal(a.ha.devices[DEVICE_ID].properties.remote_start, 'OFF')

        const b = makeDevice()
        b.thinq.emit('data', SAMPLE_REMOTE_START_ON)
        assert.equal(b.ha.devices[DEVICE_ID].properties.anticrease, 'OFF')
        assert.equal(b.ha.devices[DEVICE_ID].properties.remote_start, 'ON')
    })

    test('idle frames report both options off', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_IDLE)
        assert.equal(ha.devices[DEVICE_ID].properties.anticrease, 'OFF')
        assert.equal(ha.devices[DEVICE_ID].properties.remote_start, 'OFF')
    })

    test('a programme chosen on the panel is mirrored into the selects', () => {
        const { ha, thinq, dev } = makeDevice()
        dev.start()
        assert.equal(ha.devices[DEVICE_ID].properties.sel_program, 'Cotone', 'default di partenza')

        // the paused sample is a Misti cycle, Extra, Turbo
        thinq.emit('data', SAMPLE_PAUSED)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.sel_program, 'Misti')
        assert.equal(props.sel_dry_level, 'Extra')
        assert.equal(props.sel_eco, 'Turbo')

        // a choice made in HA survives further frames that say the same thing
        dev.setProperty('sel_program', 'Rapido 30')
        thinq.emit('data', SAMPLE_PAUSED)
        assert.equal(props.sel_program, 'Rapido 30', 'la scelta fatta in HA non viene sovrascritta')
    })

    test('the modem radio telemetry becomes the WiFi signal sensor', () => {
        const { ha, thinq, dev } = makeDevice()
        dev.start()
        thinq.emit('link', { rssi: -42 })
        assert.equal(ha.devices[DEVICE_ID].properties.rssi, -42)
    })

    test('accensione: prima liscia, la sveglia solo se serve', async () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()

        dev.setProperty('power_on', '')
        assert.equal(hex(thinq.outbox[0]!), WRITE_POWER_ON, 'si parte con il comando liscio')
        assert.equal(thinq.outbox.length, 1, 'nessuna sveglia per ora')

        // la macchina si accende: la sveglia non deve partire
        thinq.emit('data', buf('aa2130eb001901000000000000000000000000000005000000000000006b0021bb'))
        await new Promise((resolve) => setTimeout(resolve, 5000))
        assert.equal(thinq.outbox.length, 1, 'accesa da sola, manopola risparmiata')
    })

    test('accensione: se resta muta la sveglia arriva col margine largo', async () => {
        const { thinq, dev } = makeDevice()
        thinq.emit('data', SAMPLE_IDLE) // spenta
        thinq.resetRecorder()

        dev.setProperty('power_on', '')
        // Prima si chiede lo stato invece di aspettare e basta.
        await new Promise((resolve) => setTimeout(resolve, 1600))
        assert.equal(hex(thinq.outbox[1]!), WRITE_POLL_STATUS, 'a 1,2 s parte la domanda')

        // Nessuna risposta: si torna al margine dei 4 secondi.
        await new Promise((resolve) => setTimeout(resolve, 1000))
        assert.equal(thinq.outbox.length, 2, 'senza risposta fresca non si anticipa')

        await new Promise((resolve) => setTimeout(resolve, 2400))
        assert.equal(hex(thinq.outbox[2]!), WRITE_WAKE, 'la sveglia arriva dopo il tentativo liscio')

        await new Promise((resolve) => setTimeout(resolve, 800))
        assert.equal(hex(thinq.outbox[3]!), WRITE_POWER_ON, 'e poi di nuovo il power on')
    })

    test('accensione: se la macchina risponde "ancora spenta" la sveglia non aspetta', async () => {
        const { thinq, dev } = makeDevice()
        thinq.emit('data', SAMPLE_IDLE) // spenta
        thinq.resetRecorder()

        dev.setProperty('power_on', '')
        await new Promise((resolve) => setTimeout(resolve, 1500))
        // la risposta al poll: ancora spenta
        thinq.emit('data', SAMPLE_IDLE)

        await new Promise((resolve) => setTimeout(resolve, 1200))
        assert.equal(hex(thinq.outbox[2]!), WRITE_WAKE, 'sveglia gia a 2,2 s, non a 4')
    })

    test('ciclo scaricato: compare nella tendina e sparisce quando la macchina lo perde', () => {
        const { ha, thinq, dev } = makeDevice()
        ;(ha as unknown as { config: Record<string, boolean> }).config = { push_program_to_appliance: true }
        dev.start()

        const opzioni = () =>
            (ha.devices[DEVICE_ID].config!.components as Record<string, Record<string, unknown>>).sel_program
                .options as string[]

        thinq.emit('data', SAMPLE_IDLE_NO_DOWNLOAD)
        assert.equal(opzioni().includes('Carico Pieno'), false, 'senza download niente voce in piu')

        thinq.emit('data', SAMPLE_IDLE_DOWNLOADED)
        assert.deepEqual(opzioni().slice(-1), ['Carico Pieno'], 'il ciclo scaricato si aggiunge in fondo')
        // la macchina lo sta applicando (rec[22]), quindi la tendina lo segue
        assert.equal(ha.devices[DEVICE_ID].properties.sel_program, 'Carico Pieno')

        // sceglierlo rimanda lo stesso F0 25 dell'app: [12]=01, [14] corso di
        // base, [15] id del ciclo, piu' il profilo che la macchina ha riportato
        thinq.resetRecorder()
        dev.setProperty('sel_program', 'Carico Pieno')
        const inviato = thinq.outbox.pop()!
        assert.equal(inviato[3], 0x25)
        assert.equal(inviato[4], 0x03) // EcoHybrid Turbo, quello del ciclo
        assert.equal(inviato[8], 160) // durata riportata dalla macchina
        assert.equal(inviato[14], 0x01) // il byte che mancava
        assert.equal(inviato[16], 0x07) // corso di base: Cotone
        assert.equal(inviato[17], 0x74) // id del ciclo scaricato
        assert.equal(inviato[21], 0x04) // livello Extra

        // avviarlo usa il corso di base, non l'id dello SmartCourse
        thinq.resetRecorder()
        dev.setProperty('start_cycle', '')
        const avvio = thinq.outbox.pop()!
        assert.equal(avvio[3], 0x26)
        assert.equal(avvio[4], 0x07)

        // la macchina lo perde: la voce sparisce e la tendina torna al corso base
        thinq.emit('data', SAMPLE_IDLE_NO_DOWNLOAD)
        assert.equal(opzioni().includes('Carico Pieno'), false)
        assert.equal(ha.devices[DEVICE_ID].properties.sel_program, 'Cotone')
    })

    test('interruttore del ponte: accende, spegne, e torna indietro se non riesce', () => {
        const { ha, dev } = makeDevice()
        const chiamate: boolean[] = []
        let attivo = true
        let registrato = true
        ;(ha as unknown as { bridgeControl: unknown }).bridgeControl = {
            isRegistered: () => registrato,
            isActive: () => attivo,
            setActive: (_id: string, on: boolean) => {
                chiamate.push(on)
                // il ponte vero rifiuta di accendersi se non e' mai stato registrato
                if (on && !registrato) return false
                attivo = on
                return true
            },
        }
        dev.start()
        assert.equal(ha.devices[DEVICE_ID].properties.bridge_active, 'ON')

        dev.setProperty('bridge_active', 'OFF')
        assert.deepEqual(chiamate, [false])
        assert.equal(ha.devices[DEVICE_ID].properties.bridge_active, 'OFF')

        dev.setProperty('bridge_active', 'ON')
        assert.equal(ha.devices[DEVICE_ID].properties.bridge_active, 'ON')

        // mai registrato al cloud: l'interruttore deve tornare da solo su spento
        attivo = false
        registrato = false
        dev.setProperty('bridge_active', 'ON')
        assert.equal(ha.devices[DEVICE_ID].properties.bridge_active, 'OFF', 'niente interruttore acceso per finta')
    })

    test('senza ponte configurato l interruttore non esiste', () => {
        const { ha } = makeDevice()
        const comp = (ha.devices[DEVICE_ID].config!.components as Record<string, Record<string, unknown>>).bridge_active
        assert.deepEqual(comp, { platform: 'switch' }, 'solo lo stub che cancella l entita')
    })

    test('partenza ritardata: le ore finiscono nel byte [8] del comando di avvio', () => {
        const { ha, thinq, dev } = makeDevice()
        dev.start()

        dev.setProperty('sel_program', 'Asciugamani')
        dev.setProperty('sel_dry_level', 'Nessuno')
        dev.setProperty('sel_eco', 'Turbo')
        dev.setProperty('sel_delay', '3')

        thinq.resetRecorder()
        dev.setProperty('start_cycle', '')
        // Lo stesso comando che l'app ufficiale ha mandato il 25/09/2026 alle
        // 12:29:26 per "termina fra 3 ore" su Asciugamani, salvo il byte
        // operazione: l'app usa 0x03, su questa macchina parte anche con 0x01.
        const inviato = thinq.outbox.pop()!
        assert.equal(inviato[4], 0x02) // programma Asciugamani
        assert.equal(inviato[6], 0x03) // EcoHybrid Turbo
        assert.equal(inviato[10], 0x03) // ritardo: 3 ore

        // sotto il minimo si sale a 3, e 0 spegne il ritardo
        dev.setProperty('sel_delay', '1')
        thinq.resetRecorder()
        dev.setProperty('start_cycle', '')
        assert.equal(thinq.outbox.pop()![10], 0x03)

        dev.setProperty('sel_delay', '0')
        thinq.resetRecorder()
        dev.setProperty('start_cycle', '')
        assert.equal(thinq.outbox.pop()![10], 0x00)

        // Il ritardo non resta appiccicato: dopo un avvio torna a zero, altrimenti
        // il ciclo successivo partirebbe ritardato senza che nessuno l'abbia chiesto.
        dev.setProperty('sel_delay', '5')
        dev.setProperty('start_cycle', '')
        assert.equal(ha.devices[DEVICE_ID].properties.sel_delay, '0', 'azzerato dopo l avvio')
        thinq.resetRecorder()
        dev.setProperty('start_cycle', '')
        assert.equal(thinq.outbox.pop()![10], 0x00, 'il secondo avvio non e ritardato')
    })

    test('remote programme selection builds an F0 26 command', () => {
        const { ha, thinq, dev } = makeDevice()
        dev.start()

        // defaults are published so the HA selects are never "unknown"
        assert.equal(ha.devices[DEVICE_ID].properties.sel_program, 'Cotone')
        assert.equal(ha.devices[DEVICE_ID].properties.sel_dry_level, 'Pronto armadio')
        assert.equal(ha.devices[DEVICE_ID].properties.sel_eco, 'Eco')
        assert.equal(ha.devices[DEVICE_ID].properties.sel_anticrease, 'OFF')

        dev.setProperty('sel_program', 'Rapido 30')
        dev.setProperty('sel_dry_level', 'Extra')
        dev.setProperty('sel_eco', 'Turbo')
        dev.setProperty('sel_anticrease', 'ON')
        assert.equal(ha.devices[DEVICE_ID].properties.sel_program, 'Rapido 30')

        thinq.resetRecorder()
        dev.setProperty('start_cycle', '')
        // F0 26, cycle 0x09 (Rapido 30), dry 0x04 (Extra), eco 0x03 (Turbo),
        // [11] 0x02 anti-crease, [12] 0x01 = the operation byte that really
        // starts this unit (verified live 2026-09-22)
        assert.equal(hex(thinq.outbox.pop()!), 'AA14F0260904030000000000000201000000B2BB')

        dev.setProperty('apply_program', '')
        // the hidden 0x03 variant, same frame with a different operation byte
        assert.equal(hex(thinq.outbox.pop()!), 'AA14F0260904030000000000000203000000BCBB')

        // an unknown programme must not put anything on the wire
        dev.setProperty('sel_program', 'Non esiste')
        assert.equal(ha.devices[DEVICE_ID].properties.sel_program, 'Rapido 30', 'selezione invariata')
    })

    test('mid-cycle the programme command is preceded by a pause', async () => {
        const { thinq, dev } = makeDevice()
        // a running status frame: the handler has to notice the cycle is going
        thinq.emit('data', SAMPLE_STATUS_DELTA)
        dev.setProperty('sel_program', 'Rapido 30')
        thinq.resetRecorder()

        dev.setProperty('start_cycle', '')
        assert.equal(hex(thinq.outbox[0]!), WRITE_PAUSE, 'prima la pausa')
        assert.equal(thinq.outbox.length, 1, 'il programma non parte subito')

        await new Promise((resolve) => setTimeout(resolve, 1500))
        assert.ok(hex(thinq.outbox[1]!).startsWith('AA14F02609'), 'poi il programma scelto')
    })

    test('annulla programma: a macchina ferma manda il corso vuoto', () => {
        const { thinq, dev } = makeDevice()
        thinq.emit('data', SAMPLE_IDLE)
        thinq.resetRecorder()

        dev.setProperty('reset', '')
        // F0 25 con corso 0 e durata 0
        assert.equal(hex(thinq.outbox.pop()!), 'AA1DF0250315000300000000000000000000000000000000000000A2BB')
    })

    test('annulla programma: a ciclo avviato mette prima la pausa', async () => {
        const { thinq, dev } = makeDevice()
        thinq.emit('data', SAMPLE_STATUS_DELTA) // ciclo in funzione
        thinq.resetRecorder()

        dev.setProperty('reset', '')
        assert.equal(hex(thinq.outbox[0]!), WRITE_PAUSE, 'prima la pausa')

        await new Promise((resolve) => setTimeout(resolve, 1500))
        assert.ok(hex(thinq.outbox[1]!).startsWith('AA1DF025'), 'poi il corso vuoto')
    })

    test('buttons emit expected experimental packets', () => {
        const { thinq, dev } = makeDevice()

        thinq.resetRecorder()
        dev.start()
        assert.equal(hex(thinq.outbox.pop()!), WRITE_POLL_STATUS)

        dev.setProperty('poll_status', '')
        assert.equal(hex(thinq.outbox.pop()!), WRITE_POLL_STATUS)

        dev.setProperty('power_off', '')
        assert.equal(hex(thinq.outbox.pop()!), WRITE_POWER_OFF)

        dev.setProperty('pause', '')
        assert.equal(hex(thinq.outbox.pop()!), WRITE_PAUSE)
    })
})
