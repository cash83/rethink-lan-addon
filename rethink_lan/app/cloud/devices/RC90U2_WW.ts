import HADevice from './base'
import { Device as Thinq2Device } from '../thinq2/device'
import { type Connection, type ComponentInfo } from '../homeassistant'
import { allowExtendedType } from '@/util/casting'
import { Metadata } from '../thinq'
import AABBDevice from './aabb_device'

const POLL_STATUS = 'F0ED1121010000001800'
const POWER_ON = 'F02A0100'
const POWER_OFF = 'F024010100'
const PAUSE = 'F024040100'
const START = 'F024050100'
const KEEPALIVE_INTERVAL_MS = 60_000
// Wake sequence, lifted from the RH90V9_WW handler in the alexw23/rethink fork
// (a very close EU heat-pump sibling of this dryer). The firmware has an idle
// safety lockout: a few minutes after the appliance is switched off it stops
// honouring F0 2A (power on) and just acks it. An F0 25 "SmartCourse select"
// counts as user interaction and clears that lockout, so sending it half a
// second before the power-on makes remote switch-on work again.
// Verified live on this unit 2026-09-22 at 03:41, after ten hours idle: wake +
// power on brought it up in 2 s, where power on alone had been ignored twice.
const WAKE_SMART_COURSE = 0x6b // Deodorization — the SmartCourse this unit reports in rec[25]
// [2] dell'F0 25 vale 0x03 in TUTTI i comandi veri dell'app LG, anche in quello
// che metteva l'EcoHybrid su Eco (25/09/2026 12:58, [2]=03 e [5]=01). Non e'
// l'EcoHybrid: quello sta in [5]. Mettendo il valore scelto anche in [2], come
// faceva questo add-on fino alla 0.2.55, la macchina scartava il pacchetto in
// silenzio - ed e' la ragione per cui "Eco da HA non funziona mai".
const F025_CONST = 3
const WAKE_DEFAULT_ECO = 3
const WAKE_DEFAULT_TIME = 39
const WAKE_DELAY_MS = 500
// Quanto aspettare la risposta all'accensione liscia prima di usare la sveglia.
// La macchina, quando ubbidisce, si accende in 2 secondi (misurato piu' volte).
// Aspettare 4 secondi buoni prima di decidere che non ha ubbidito portava
// l'accensione a scheda addormentata a 9 secondi tondi (misurato 25/09/2026:
// clic alle 11:20:17.3, accesa alle 11:20:26.5), e in quei 9 secondi chi guarda
// ripreme il tasto pensando che non abbia funzionato. Ora invece di aspettare
// si chiede: un poll a 1,2 s e, se la risposta dice ancora spenta, la sveglia
// parte subito senza aspettare il resto.
const POWER_ON_POLL_MS = 1200
const POWER_ON_EARLY_MS = 2200
const POWER_ON_RETRY_MS = 4000
const STATUS_RECORD_LEN = 27
// Phase byte rec[2], fully mapped live on the real dryer (2026-07-22):
// power-on/off, run, pause/resume and cycle end all observed directly.
const PHASES: Record<number, string> = {
    0x00: 'Spenta',
    0x01: 'In attesa',
    0x02: 'In funzione',
    0x03: 'In pausa',
    0x04: 'Fine ciclo',
}

// Calibrated live on the real RC90U2_WW dial (2026-07-22): full clockwise
// sweep recorded twice, anchored on Speciale Sport (0x08) and Cotone (0x07).
const CYCLES: Record<number, string> = {
    0x01: 'Personalizzato',
    0x02: 'Asciugamani',
    0x04: 'Piumini',
    0x05: 'Sintetici',
    0x06: 'Misti',
    0x07: 'Cotone',
    0x08: 'Speciale Sport',
    0x09: 'Rapido 30',
    0x0a: 'Lingerie',
    0x0b: 'Trattamento Delicato',
    0x0c: 'Con cestello',
    0x0d: 'Aria fredda',
    0x0e: 'Aria calda',
    0x10: 'Allergy Care',
}

// rec[10] is the ecoHybrid mode, NOT a temperature. The panel has no
// temperature button at all, which is why the old "Temperatura" labels never
// quite made sense: what the button really does is switch this byte between
// Eco and Turbo. Names come from the official modelJSON of the sibling model
// RH90V9_WW (Bd[8] in the alexw23/rethink fork), and they match every value
// this unit has ever reported (0 off, 1 with EcoHybrid lit, 3 without).
const ECO_MODES: Record<number, string> = {
    0x00: 'Nessuno',
    0x01: 'Eco',
    0x02: 'Normale',
    0x03: 'Turbo',
}

// rec[8], never non-zero on this unit so far. Same source: the sibling's
// modelJSON error.valueMapping.
const ERRORS: Record<number, string> = {
    0x00: 'Nessuno',
    0x01: 'TE1 sonda temperatura',
    0x02: 'TE2 sonda temperatura',
    0x04: 'TE4 sonda temperatura',
    0x07: 'CE1 comunicazione',
    0x0d: 'OE pompa di scarico',
    0x0e: 'Serbatoio acqua pieno',
    0x0f: 'dE porta aperta',
    0x11: 'Filtro mancante',
    0x13: 'F1',
    0x14: 'LE2 motore',
    0x15: 'AE',
    0x1e: 'LE1 motore',
    0x25: 'DE4 porta',
    0x2a: 'DE2 blocco porta',
}

// Calibrated live (2026-07-23): the level button cycles three values whose
// names are printed on the display itself.
const DRY_LEVELS: Record<number, string> = {
    0x00: 'Nessuno',
    0x01: 'Pronto stiro',
    0x02: 'Meno asciutto',
    0x03: 'Pronto armadio',
    0x04: 'Extra',
    0x05: 'Molto asciutto',
}

// rec[11] is the drying progress, not a generic "phase": 0x02/0x03/0x04 are the
// modelJSON's DRY_LV1/LV2/LV3, i.e. the dryness milestones the panel lights up
// left to right along the top of the display. Confirmed on the 2026-09-23 cycle
// (Misti, level Extra): 0x02 held for 1h50 while the load was still damp, 0x03
// from 22:59, 0x04 from 23:59, 0x05 for the last two minutes and 0x07 on the
// closing frame. 0x01 and 0x06 come from the modelJSON and have not been seen
// on this unit yet.
const STAGES: Record<number, string> = {
    0x00: 'Ferma',
    0x01: 'Vapore',
    0x02: 'Asciugatura',
    0x03: 'Pronto stiro',
    0x04: 'Pronto armadio',
    0x05: 'Raffreddamento',
    0x06: 'Antipiega',
    0x07: 'Fine ciclo',
}

// Default duration of each programme, in minutes, as the appliance itself
// reports it the moment the knob lands on that position. Needed because F0 25
// carries the time: send the wrong number and the panel shows the wrong number
// (verified live 2026-09-25 - Cotone with 30 gave 0:30, with 0 gave 0:00).
// Read off two full dial sweeps in the log (2026-09-25 06:42 and 07:00): all
// fourteen positions are covered. A programme without a known time is simply
// not pushed to the appliance, rather than pushed with a made-up number.
const CYCLE_MINUTES: Record<number, number> = {
    0x01: 39, // Personalizzato
    0x02: 140, // Asciugamani
    0x04: 175, // Piumini
    0x05: 70, // Sintetici
    0x06: 70, // Misti
    0x07: 150, // Cotone
    0x08: 50, // Speciale Sport
    0x09: 30, // Rapido 30
    0x0a: 48, // Lingerie
    0x0b: 29, // Trattamento Delicato
    0x0c: 180, // Con cestello
    0x0d: 60, // Aria fredda
    0x0e: 60, // Aria calda
    0x10: 180, // Allergy Care
}

// Reverse lookups for the remote programme selection (F0 26).
const CYCLE_IDS: Record<string, number> = Object.fromEntries(Object.entries(CYCLES).map(([k, v]) => [v, Number(k)]))
const DRY_LEVEL_IDS: Record<string, number> = Object.fromEntries(
    Object.entries(DRY_LEVELS).map(([k, v]) => [v, Number(k)]),
)
const ECO_MODE_IDS: Record<string, number> = Object.fromEntries(
    Object.entries(ECO_MODES).map(([k, v]) => [v, Number(k)]),
)

// F0 26 operation byte (inner[12]). The fork documents 0x01 as
// "resume/update" and 0x03 as "start", but on THIS unit 0x01 started the drum
// straight away: tested live 2026-09-22 at 03:55 with the machine merely
// powered on and waiting, the programme was written AND the cycle began within
// two seconds. So 0x01 is what the working button sends, and 0x03 is kept as a
// hidden variant to try if a firmware update ever changes this.
// A running cycle ignores F0 26: the machine just beeps (event byte 0x10 in
// rec[18]) and keeps its old settings. Paused or waiting, it takes them and
// carries on. Both observed live 2026-09-22 between 04:02 and 04:03. So when a
// cycle is running we pause it first and let the F0 26 resume it.
const PAUSE_BEFORE_PROGRAM_MS = 1200

const OP_START = 0x01
const OP_START_ALT = 0x03

// The order the knob actually walks, measured in the log on a full sweep
// (2026-09-25 06:42): down the left column to Rapido 30, then Personalizzato,
// then back up the right column - Aria calda, Aria fredda, Con cestello,
// Lingerie, Trattamento Delicato, Speciale Sport - and round to Cotone again.
// Reading the panel's two columns top to bottom, as a first attempt did, gives
// a different sequence that the knob never follows. No code appears between Con
// cestello and Lingerie: "Asciugatura a tempo" printed there is the heading of
// the three manual-timer programmes, not a position of its own.
const SELECTABLE_CYCLES = [
    'Cotone',
    'Misti',
    'Sintetici',
    'Piumini',
    'Asciugamani',
    'Allergy Care',
    'Rapido 30',
    'Personalizzato',
    // i tre a tempo manuale, sotto la scritta "Asciugatura a tempo"
    'Aria calda',
    'Aria fredda',
    'Con cestello',
    'Lingerie',
    'Trattamento Delicato',
    'Speciale Sport',
]
const SELECTABLE_DRY_LEVELS = ['Pronto stiro', 'Pronto armadio', 'Extra']
// Il tasto EcoHybrid di questo pannello fa solo Eco <-> Turbo: in tutti i giri
// di manopola registrati la macchina ha riportato 0, 1 e 3, mai il 2 "Normale"
// che pure esiste nel modelJSON del modello gemello.
const SELECTABLE_ECO_MODES = ['Eco', 'Turbo']

// Limiti della partenza ritardata, letti dall'app ufficiale ("Tempo impostato
// disponibile: 3o - 19o") e verificati dal vivo il 25/09/2026: il ritardo
// viaggia nel byte [8] del comando di avvio F0 26 e la macchina lo ripete in
// rec[12], alzando il bit 0 di rec[16].
// I cicli scaricabili dall'app, coi nomi italiani ufficiali di LG. Presi il
// 25/09/2026 dal cloud attraverso il ponte: modelJSON del modello + language
// pack italiano (dashboard -> modelJsonUri, langPackProductTypeUri).
//
// L'id NON e' scritto da nessuna parte nel file di LG: e' quello del protocollo
// binario, e lo si ricava associando il profilo che la macchina riporta dopo un
// download (programma base, livello, EcoHybrid, durata) al ciclo che ha quei
// valori di fabbrica. Tre id verificati cosi', su quattro campi ciascuno:
//   0x65 Asciugamani/-/Turbo/130   -> BABYWEAR
//   0x70 Cotone/Pronto armadio/Eco/150 -> ECONOMICDRY
//   0x74 Cotone/Extra/Turbo/160    -> FULLSIZELOAD (nome confermato dall'utente)
// I primi due danno id = 100 + posizione nella lista, e su quell'intervallo
// sono due punti fissi alle estremita': da 0x64 a 0x70 i nomi qui sotto sono
// interpolati fra due misure, non indovinati. 0x74 invece cade una posizione
// piu' in la' di dove la regola lo metterebbe, segno che il firmware numera un
// ciclo che questo modello non offre. Percio' 0x71..0x73 restano fuori: usciranno
// col numero finche' non se ne scarica uno e si legge il nome nell'app.
//
// `rec[25]` porta il ciclo memorizzato nella macchina (0 = nessuno), `rec[22]`
// quello applicato al programma corrente. La macchina ne tiene uno solo: se se
// ne scarica un altro, il precedente sparisce.
const SMART_COURSES: Record<number, string> = {
    0x64: 'Scarpe / Bambole di Pezza',
    0x65: 'Abbigliamento bambini',
    0x66: 'Coperta',
    0x67: 'Refresh Coperte',
    0x68: 'Capo singolo',
    0x69: 'Biancheria Intima',
    0x6a: 'Tute',
    0x6b: 'Indumenti bagnati dalla pioggia',
    0x6c: 'Deodorizzazione',
    0x6d: 'Indumenti per bambini',
    0x6e: 'Stiratura Semplice',
    0x6f: 'Asciutto Super',
    0x70: 'Asciutto Economico',
    0x74: 'Carico Pieno',
}

function smartCourseLabel(id: number) {
    return SMART_COURSES[id] ?? `Ciclo scaricato ${hexByte(id)}`
}

const DELAY_MIN_HOURS = 3
const DELAY_MAX_HOURS = 19

// 0 spegne il ritardo; sotto il minimo si sale al minimo invece di mandare un
// valore che la macchina rifiuterebbe in silenzio.
function clampDelay(value: string) {
    const n = Math.round(Number(value))
    if (!Number.isFinite(n) || n <= 0) return 0
    if (n < DELAY_MIN_HOURS) return DELAY_MIN_HOURS
    return Math.min(n, DELAY_MAX_HOURS)
}

function asciiField(buf: Buffer, start: number, length: number) {
    return buf
        .subarray(start, start + length)
        .toString('ascii')
        .replace(/\0+$/g, '')
}

function hexField(buf: Buffer, start: number, length: number) {
    return buf.subarray(start, start + length).toString('hex')
}

function hexByte(v: number | undefined) {
    return `0x${(v ?? 0).toString(16).padStart(2, '0')}`
}

// Same formatting as the dryer panel: "2:30" above one hour, "50" below.
function formatPanelTime(minutes: number) {
    return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}` : `${minutes}`
}

function numberedLabel(label: string, value: number, empty = 'Nessuno') {
    return value === 0 ? empty : `${label} ${value}`
}

function mappedLabel(map: Record<number, string>, value: number, label: string) {
    return map[value] ?? numberedLabel(label, value)
}

export default class Device extends AABBDevice {
    packetCount = 0
    private smartCourseId = WAKE_SMART_COURSE
    private cycleRunning = false
    private lastRemaining = -1
    private phase = 0
    private machineCycle = 0
    private machineEco = 0
    private programmaGiaMandato = false
    private selProgram = 'Cotone'
    private selDryLevel = 'Pronto armadio'
    private selEco = 'Eco'
    private selAntiCrease = false
    // Ore di ritardo che finiranno nel comando di avvio. 0 = nessun ritardo.
    // L'app ufficiale accetta solo 3..19 ore, e le conta dalla FINE del ciclo:
    // "termina fra 3 ore" su un programma da 2h20 lo fa partire fra ~40 minuti.
    private selDelayHours = 0
    // Il ciclo scaricato che la macchina ha in pancia, con il profilo che lei
    // stessa ha riportato quando l'ha caricato: programma di base, livello,
    // EcoHybrid e durata. Riapplicarlo da HA vuol dire rimandare esattamente
    // quello, invece di inventarsi una combinazione che la macchina rifiuterebbe.
    private downloadedId = 0
    private downloadedBase = 0
    private downloadedLevel = 0
    private downloadedEco = 0
    private downloadedMinutes = 0
    private clearedByUs = false
    // What the appliance itself last reported, so a change made on the panel
    // can be mirrored into the selects without fighting a choice made in HA:
    // the mirroring is edge-triggered, it only fires when the machine's own
    // value actually changes.
    private seenProgram = ''
    private seenDryLevel = ''
    private seenEco = ''
    private seenAntiCrease = ''

    private keepaliveTimer: ReturnType<typeof setInterval> | undefined
    // Quando e' arrivato l'ultimo stato, per distinguere "e' ancora spenta" da
    // "non ha ancora risposto": la sveglia anticipata parte solo sulla prima.
    private lastRecordAt = 0

    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq)
        this.setConfig(
            allowExtendedType({
                ...HADevice.config(meta, { name: 'LG Dryer' }),
                components: {
                    power_on: {
                        platform: 'button',
                        unique_id: '$deviceid-power-on',
                        command_topic: '$this/power_on/set',
                        payload_press: '',
                        name: 'Power on',
                        icon: 'mdi:power',
                    },
                    power_off: {
                        platform: 'button',
                        unique_id: '$deviceid-power-off',
                        command_topic: '$this/power_off/set',
                        payload_press: '',
                        name: 'Power off',
                        icon: 'mdi:power-off',
                    },
                    // On the RC90U2 the physical Start/Pause is one toggle
                    // button and remotely only command F0240401 acts on it
                    // (F0240501 is acked with a beep but ignored) — verified
                    // live 2026-07-22. So expose a single Avvia/Pausa button.
                    pause: {
                        platform: 'button',
                        unique_id: '$deviceid-pause',
                        command_topic: '$this/pause/set',
                        payload_press: '',
                        name: 'Avvia / Pausa',
                        icon: 'mdi:play-pause',
                    },
                    // Remote programme selection. The three selects and the switch
                    // are just a wish list held by the add-on; nothing reaches the
                    // dryer until one of the two buttons sends an F0 26, and BOTH
                    // of them start the cycle (see OP_START).
                    sel_program: {
                        platform: 'select',
                        unique_id: '$deviceid-sel-program',
                        command_topic: '$this/sel_program/set',
                        state_topic: '$this/sel_program',
                        options: SELECTABLE_CYCLES,
                        name: 'Programma da remoto',
                        icon: 'mdi:tumble-dryer',
                    },
                    sel_dry_level: {
                        platform: 'select',
                        unique_id: '$deviceid-sel-dry-level',
                        command_topic: '$this/sel_dry_level/set',
                        state_topic: '$this/sel_dry_level',
                        options: SELECTABLE_DRY_LEVELS,
                        name: 'Livello da remoto',
                        icon: 'mdi:tune-variant',
                    },
                    sel_eco: {
                        platform: 'select',
                        unique_id: '$deviceid-sel-eco',
                        command_topic: '$this/sel_eco/set',
                        state_topic: '$this/sel_eco',
                        options: SELECTABLE_ECO_MODES,
                        name: 'EcoHybrid da remoto',
                        icon: 'mdi:leaf',
                    },
                    // Interruttore del ponte al cloud LG. Spegnendolo la
                    // connessione a LG cade ma il certificato resta: si
                    // riaccende senza rifare la registrazione. Se il ponte non
                    // e' configurato si pubblica lo stub che cancella l'entita'.
                    bridge_active: this.HA.bridgeControl
                        ? {
                              platform: 'switch',
                              unique_id: '$deviceid-bridge-active',
                              command_topic: '$this/bridge_active/set',
                              state_topic: '$this/bridge_active',
                              name: 'Ponte al cloud LG',
                              icon: 'mdi:bridge',
                              entity_category: 'config',
                          }
                        : ({ platform: 'switch' } as unknown as ComponentInfo),
                    sel_delay: {
                        platform: 'number',
                        unique_id: '$deviceid-sel-delay',
                        command_topic: '$this/sel_delay/set',
                        state_topic: '$this/sel_delay',
                        min: 0,
                        max: DELAY_MAX_HOURS,
                        step: 1,
                        mode: 'box',
                        unit_of_measurement: 'h',
                        name: 'Termina fra (ore)',
                        icon: 'mdi:timer-play-outline',
                    },
                    sel_anticrease: {
                        platform: 'switch',
                        unique_id: '$deviceid-sel-anticrease',
                        command_topic: '$this/sel_anticrease/set',
                        state_topic: '$this/sel_anticrease',
                        name: 'Antipiega (al prossimo avvio)',
                        icon: 'mdi:iron',
                    },
                    // Removal stub. Home Assistant deletes a component from a
                    // device discovery when its config carries nothing but the
                    // platform, so this makes the duplicate "Avvia ciclo" button
                    // from 0.2.29/0.2.30 disappear for good instead of lingering
                    // as a hidden entity. The 0x03 variant itself is still
                    // reachable by publishing to $this/apply_program/set.
                    apply_program: { platform: 'button' } as unknown as ComponentInfo,
                    start_cycle: {
                        platform: 'button',
                        unique_id: '$deviceid-start-cycle',
                        command_topic: '$this/start_cycle/set',
                        payload_press: '',
                        name: 'Avvia ciclo scelto',
                        icon: 'mdi:play-box-outline',
                    },
                    // Cancella il programma senza spegnere: un F0 25 col corso a
                    // zero e la durata a zero riporta la macchina in attesa e
                    // vuota (provato il 25/09). A ciclo avviato mettiamo prima la
                    // pausa, perche' in moto la macchina scarta i comandi.
                    reset: {
                        platform: 'button',
                        unique_id: '$deviceid-reset',
                        command_topic: '$this/reset/set',
                        payload_press: '',
                        name: 'Annulla programma',
                        icon: 'mdi:backup-restore',
                    },
                    poll_status: {
                        platform: 'button',
                        unique_id: '$deviceid-poll-status',
                        command_topic: '$this/poll_status/set',
                        payload_press: '',
                        name: 'Poll status',
                        icon: 'mdi:refresh',
                    },
                    connected: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-connected',
                        state_topic: '$this/connected',
                        name: 'Connected',
                        device_class: 'connectivity',
                    },
                    status: {
                        platform: 'sensor',
                        unique_id: '$deviceid-status',
                        state_topic: '$this/status',
                        name: 'Stato',
                        icon: 'mdi:tumble-dryer',
                    },
                    summary: {
                        platform: 'sensor',
                        unique_id: '$deviceid-summary',
                        state_topic: '$this/summary',
                        name: 'Riepilogo',
                        icon: 'mdi:format-list-checks',
                    },
                    program: {
                        platform: 'sensor',
                        unique_id: '$deviceid-program',
                        state_topic: '$this/program',
                        name: 'Programma',
                        icon: 'mdi:tumble-dryer',
                    },
                    // Topic kept as 'temperature' so the existing entity survives;
                    // what it carries is the ecoHybrid mode (see ECO_MODES).
                    temperature: {
                        platform: 'sensor',
                        unique_id: '$deviceid-temperature',
                        state_topic: '$this/temperature',
                        name: 'EcoHybrid modo',
                        icon: 'mdi:leaf-circle-outline',
                    },
                    error: {
                        platform: 'sensor',
                        unique_id: '$deviceid-error',
                        state_topic: '$this/error',
                        name: 'Errore',
                        icon: 'mdi:alert-circle-outline',
                    },
                    // Tolto: diceva in modo approssimativo quello che
                    // 'remote_start' dice esatto. Il pannello e' bloccato quando
                    // la macchina e' in avvio a distanza, e quel bit lo sappiamo
                    // leggere dalla macchina invece di dedurlo dai comandi che
                    // mandiamo noi. Stub di rimozione: HA cancella un componente
                    // quando la sua configurazione porta solo la piattaforma.
                    knob_locked: { platform: 'binary_sensor' } as unknown as ComponentInfo,
                    problem: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-problem',
                        state_topic: '$this/problem',
                        name: 'Guasto',
                        device_class: 'problem',
                    },
                    dry_level: {
                        platform: 'sensor',
                        unique_id: '$deviceid-dry-level',
                        state_topic: '$this/dry_level',
                        name: 'Livello asciugatura',
                        icon: 'mdi:tune-variant',
                    },
                    selected_time: {
                        platform: 'sensor',
                        unique_id: '$deviceid-selected-time',
                        state_topic: '$this/selected_time',
                        name: 'Tempo',
                        icon: 'mdi:timer-outline',
                    },
                    // Ora dell'orologio a cui il ciclo finira'. La macchina rivede
                    // spesso il residuo (il manuale lo documenta per i carichi
                    // misti), quindi questo valore si sposta insieme a lei: e'
                    // una previsione, non una promessa.
                    eta: {
                        platform: 'sensor',
                        unique_id: '$deviceid-eta',
                        state_topic: '$this/eta',
                        name: 'Fine prevista',
                        icon: 'mdi:clock-end',
                        device_class: 'timestamp',
                    },
                    remaining_time: {
                        platform: 'sensor',
                        unique_id: '$deviceid-remaining-time',
                        state_topic: '$this/remaining_time',
                        name: 'Tempo residuo',
                        icon: 'mdi:timer-sand',
                    },
                    elapsed_time: {
                        platform: 'sensor',
                        unique_id: '$deviceid-elapsed-time',
                        state_topic: '$this/elapsed_time',
                        name: 'Tempo trascorso',
                        icon: 'mdi:progress-clock',
                        unit_of_measurement: 'min',
                    },
                    running: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-running',
                        state_topic: '$this/running',
                        name: 'Running',
                        device_class: 'running',
                    },
                    power: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-power',
                        state_topic: '$this/power',
                        name: 'Accesa',
                        device_class: 'power',
                    },
                    delay_hours: {
                        platform: 'sensor',
                        unique_id: '$deviceid-delay-hours',
                        state_topic: '$this/delay_hours',
                        name: 'Partenza ritardata',
                        icon: 'mdi:timer-play-outline',
                        unit_of_measurement: 'h',
                    },
                    // rec[13] is the minutes half of the delayed start, counting
                    // down alongside the hours in rec[12] (Bd[10]/Bd[11] in the
                    // alexw23/rethink fork, which decodes both). Shown panel-style,
                    // "3:45" or "45".
                    delay_remaining: {
                        platform: 'sensor',
                        unique_id: '$deviceid-delay-remaining',
                        state_topic: '$this/delay_remaining',
                        name: 'Ritardo residuo',
                        icon: 'mdi:timer-sand-complete',
                    },
                    delay_armed: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-delay-armed',
                        state_topic: '$this/delay_armed',
                        name: 'Partenza ritardata attiva',
                        icon: 'mdi:timer-lock-outline',
                    },
                    ecohybrid: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-ecohybrid',
                        state_topic: '$this/ecohybrid',
                        name: 'EcoHybrid',
                        icon: 'mdi:leaf',
                    },
                    // Calibrated live on the panel (2026-09-21, three passes):
                    // pressing "EcoHybrid * Antipiega" sets and clears rec[16]
                    // bit1, confirmed by the ironing icon lighting up on the
                    // display. rec[16] is a flags byte: bit0 = delayed start
                    // armed, bit1 = anti-crease, bit3 = panel awake.
                    anticrease: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-anticrease',
                        state_topic: '$this/anticrease',
                        name: 'Antipiega',
                        icon: 'mdi:iron',
                    },
                    // "Segnale * Avvio a distanza" (held 3 s) sets and clears
                    // rec[17] bit0, confirmed by the play/pause icon on the
                    // display. NOTE: the same bit also reads 1 while a cycle is
                    // actually running (and drops to 0 in pause), so the machine
                    // uses it as "remote commands accepted right now" rather than
                    // strictly "remote start armed".
                    remote_start: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-remote-start',
                        state_topic: '$this/remote_start',
                        name: 'Avvio a distanza',
                        icon: 'mdi:play-circle-outline',
                    },
                    stage: {
                        platform: 'sensor',
                        unique_id: '$deviceid-stage',
                        state_topic: '$this/stage',
                        name: 'Fase ciclo',
                        icon: 'mdi:progress-clock',
                        device_class: 'enum',
                        options: [
                            'Ferma',
                            'Vapore',
                            'Asciugatura',
                            'Pronto stiro',
                            'Pronto armadio',
                            'Raffreddamento',
                            'Antipiega',
                            'Fine ciclo',
                        ],
                    },
                    // Energy of the running cycle. state_class total_increasing is
                    // the right one even though it resets to 0 at every start: HA
                    // treats a drop as a counter reset and keeps summing, so this
                    // feeds the Energy dashboard directly.
                    energy: {
                        platform: 'sensor',
                        unique_id: '$deviceid-energy',
                        state_topic: '$this/energy',
                        name: 'Energia ciclo',
                        icon: 'mdi:lightning-bolt',
                        unit_of_measurement: 'Wh',
                        device_class: 'energy',
                        state_class: 'total_increasing',
                    },
                    rssi: {
                        platform: 'sensor',
                        unique_id: '$deviceid-rssi',
                        state_topic: '$this/rssi',
                        name: 'Segnale WiFi',
                        unit_of_measurement: 'dBm',
                        device_class: 'signal_strength',
                        state_class: 'measurement',
                        entity_category: 'diagnostic',
                    },
                    frame_type: {
                        platform: 'sensor',
                        unique_id: '$deviceid-frame-type',
                        state_topic: '$this/frame_type',
                        name: 'Frame type',
                        icon: 'mdi:format-list-bulleted-type',
                        entity_category: 'diagnostic',
                        enabled_by_default: false,
                    },
                    profile_1: {
                        platform: 'sensor',
                        unique_id: '$deviceid-profile-1',
                        state_topic: '$this/profile_1',
                        name: 'Profile 1',
                        icon: 'mdi:identifier',
                    },
                    profile_2: {
                        platform: 'sensor',
                        unique_id: '$deviceid-profile-2',
                        state_topic: '$this/profile_2',
                        name: 'Profile 2',
                        icon: 'mdi:identifier',
                    },
                    raw_flags_1: {
                        platform: 'sensor',
                        unique_id: '$deviceid-raw-flags-1',
                        state_topic: '$this/raw_flags_1',
                        name: 'Raw flags 1',
                        icon: 'mdi:code-braces',
                        entity_category: 'diagnostic',
                        enabled_by_default: false,
                    },
                    raw_flags_2: {
                        platform: 'sensor',
                        unique_id: '$deviceid-raw-flags-2',
                        state_topic: '$this/raw_flags_2',
                        name: 'Raw flags 2',
                        icon: 'mdi:code-braces',
                        entity_category: 'diagnostic',
                        enabled_by_default: false,
                    },
                    // rec[1]: a constant 0x19 record marker, not a state code
                    // (13509/13509 records). Kept as a diagnostic so a firmware
                    // change would be visible.
                    state_code: {
                        platform: 'sensor',
                        unique_id: '$deviceid-state-code',
                        state_topic: '$this/state_code',
                        name: 'Record marker',
                        icon: 'mdi:numeric',
                        entity_category: 'diagnostic',
                        enabled_by_default: false,
                    },
                    // was a duplicate of the phase byte; now carries rec[11],
                    // the raw stage code behind the "Fase ciclo" sensor.
                    course_code: {
                        platform: 'sensor',
                        unique_id: '$deviceid-course-code',
                        state_topic: '$this/course_code',
                        name: 'Stage code',
                        icon: 'mdi:numeric',
                        entity_category: 'diagnostic',
                        enabled_by_default: false,
                    },
                    program_code: {
                        platform: 'sensor',
                        unique_id: '$deviceid-program-code',
                        state_topic: '$this/program_code',
                        name: 'Program code',
                        icon: 'mdi:tumble-dryer',
                        entity_category: 'diagnostic',
                        enabled_by_default: false,
                    },
                    // was the remaining-hours byte; now carries rec[18], the
                    // one-shot event byte (0x50 start/resume, 0x60 pause).
                    level_code: {
                        platform: 'sensor',
                        unique_id: '$deviceid-level-code',
                        state_topic: '$this/level_code',
                        name: 'Event code',
                        icon: 'mdi:flash-alert-outline',
                        entity_category: 'diagnostic',
                        enabled_by_default: false,
                    },
                    option_codes: {
                        platform: 'sensor',
                        unique_id: '$deviceid-option-codes',
                        state_topic: '$this/option_codes',
                        name: 'Option codes',
                        icon: 'mdi:tune',
                        entity_category: 'diagnostic',
                        enabled_by_default: false,
                    },
                    option_flags: {
                        platform: 'sensor',
                        unique_id: '$deviceid-option-flags',
                        state_topic: '$this/option_flags',
                        name: 'Option flags',
                        icon: 'mdi:flag-outline',
                        entity_category: 'diagnostic',
                        enabled_by_default: false,
                    },
                    feature_flags: {
                        platform: 'sensor',
                        unique_id: '$deviceid-feature-flags',
                        state_topic: '$this/feature_flags',
                        name: 'Feature flags',
                        icon: 'mdi:flag-variant-outline',
                        entity_category: 'diagnostic',
                        enabled_by_default: false,
                    },
                    stage2_code: {
                        platform: 'sensor',
                        unique_id: '$deviceid-stage2-code',
                        state_topic: '$this/stage2_code',
                        name: 'Stage code 2',
                        icon: 'mdi:numeric',
                        entity_category: 'diagnostic',
                        enabled_by_default: false,
                    },
                    counter_code: {
                        platform: 'sensor',
                        unique_id: '$deviceid-counter-code',
                        state_topic: '$this/counter_code',
                        name: 'Counter code',
                        icon: 'mdi:counter',
                        entity_category: 'diagnostic',
                        enabled_by_default: false,
                    },
                    status_record: {
                        platform: 'sensor',
                        unique_id: '$deviceid-status-record',
                        state_topic: '$this/status_record',
                        name: 'Status record',
                        icon: 'mdi:code-braces',
                        entity_category: 'diagnostic',
                        enabled_by_default: false,
                    },
                    packet_count: {
                        platform: 'sensor',
                        unique_id: '$deviceid-packet-count',
                        state_topic: '$this/packet_count',
                        name: 'Packet count',
                        icon: 'mdi:counter',
                        entity_category: 'diagnostic',
                        enabled_by_default: false,
                    },
                    last_payload_length: {
                        platform: 'sensor',
                        unique_id: '$deviceid-last-payload-length',
                        state_topic: '$this/last_payload_length',
                        name: 'Last payload length',
                        icon: 'mdi:ruler',
                        entity_category: 'diagnostic',
                        enabled_by_default: false,
                    },
                    last_payload: {
                        platform: 'sensor',
                        unique_id: '$deviceid-last-payload',
                        state_topic: '$this/last_payload',
                        name: 'Last payload',
                        icon: 'mdi:code-json',
                        entity_category: 'diagnostic',
                        enabled_by_default: false,
                    },
                },
            }),
        )
    }

    private subscribeLink() {
        this.thinq.on('link', (info) => {
            if (typeof info.rssi === 'number') this.publishProperty('rssi', info.rssi)
        })
    }

    // Turn the dial on the panel and the select follows; pick something in HA
    // and it stays put until the appliance itself says otherwise.
    private mirrorSelection(program: string, dryLevel: string, eco: string, antiCrease: boolean) {
        let changed = false

        if (program !== this.seenProgram) {
            this.seenProgram = program
            if (this.selectableProgram(program)) {
                this.selProgram = program
                changed = true
            }
        }

        if (dryLevel !== this.seenDryLevel) {
            this.seenDryLevel = dryLevel
            if (SELECTABLE_DRY_LEVELS.includes(dryLevel)) {
                this.selDryLevel = dryLevel
                changed = true
            }
        }

        if (eco !== this.seenEco) {
            this.seenEco = eco
            if (SELECTABLE_ECO_MODES.includes(eco)) {
                this.selEco = eco
                changed = true
            }
        }

        const antiCreaseState = antiCrease ? 'ON' : 'OFF'
        if (antiCreaseState !== this.seenAntiCrease) {
            this.seenAntiCrease = antiCreaseState
            this.selAntiCrease = antiCrease
            changed = true
        }

        if (changed) this.publishSelection()
    }

    private trackDownloaded(rec: Buffer, phaseCode: number) {
        const id = rec[25] ?? 0
        const remainingMinutes = (rec[3] ?? 0) * 60 + (rec[4] ?? 0)

        // A macchina ferma con il ciclo caricato, quello che riporta e' il suo
        // profilo: lo si impara da lei invece di indovinarlo.
        if (id && rec[22] === id && phaseCode === 0x01) {
            this.downloadedBase = rec[7] ?? 0
            this.downloadedLevel = rec[9] ?? 0
            this.downloadedEco = rec[10] ?? 0
            if (remainingMinutes > 0) this.downloadedMinutes = remainingMinutes
        }

        if (id === this.downloadedId) return

        // Uno zero subito dopo un nostro F0 25 e' opera nostra: scrivere un
        // programma normale porta [15]=00 e la macchina si dimentica il ciclo
        // scaricato. La voce in HA resta, perche' sceglierla lo rimanda.
        if (!id && this.clearedByUs) {
            this.clearedByUs = false
            return
        }
        this.clearedByUs = false

        this.downloadedId = id
        if (!id) {
            this.downloadedBase = 0
            this.downloadedLevel = 0
            this.downloadedEco = 0
            this.downloadedMinutes = 0
        }
        this.refreshProgramOptions()
    }

    private downloadedName() {
        return this.downloadedId ? smartCourseLabel(this.downloadedId) : ''
    }

    private selectableProgram(name: string) {
        return CYCLE_IDS[name] !== undefined || (!!this.downloadedName() && name === this.downloadedName())
    }

    // La tendina dei programmi guadagna una voce quando un ciclo viene
    // scaricato dall'app e la perde quando sparisce. Home Assistant aggiorna
    // l'elenco solo se gli si ripubblica la discovery.
    private refreshProgramOptions() {
        const comp = this.config?.components?.sel_program as { options?: string[] } | undefined
        if (!comp) return

        const name = this.downloadedName()
        const wanted = name ? [...SELECTABLE_CYCLES, name] : [...SELECTABLE_CYCLES]
        if (comp.options?.length === wanted.length && comp.options.every((o, i) => o === wanted[i])) return

        comp.options = wanted
        this.publishConfig()

        // Se la voce scelta e' appena sparita si torna al programma di base,
        // altrimenti in HA resterebbe selezionato un valore che non esiste piu'.
        if (!this.selectableProgram(this.selProgram)) {
            this.selProgram = mappedLabel(CYCLES, this.downloadedBase || 0x07, 'Programma')
            if (CYCLE_IDS[this.selProgram] === undefined) this.selProgram = 'Cotone'
        }
        this.publishSelection()
    }

    private publishSelection() {
        this.publishProperty('sel_program', this.selProgram)
        this.publishProperty('sel_dry_level', this.selDryLevel)
        this.publishProperty('sel_eco', this.selEco)
        this.publishProperty('sel_anticrease', this.selAntiCrease ? 'ON' : 'OFF')
        this.publishProperty('sel_delay', String(this.selDelayHours))
        this.publishBridgeState()
    }

    private publishBridgeState() {
        const ctl = this.HA.bridgeControl
        if (!ctl) return
        this.publishProperty('bridge_active', ctl.isActive(this.thinq.id) ? 'ON' : 'OFF')
    }

    start() {
        this.subscribeLink()
        this.publishSelection()
        this.publishProperty('connected', 'ON')
        this.publishProperty('status', 'Online')
        this.publishProperty('summary', 'In attesa del primo stato')
        this.publishProperty('packet_count', this.packetCount)
        this.pollStatus()
        this.startKeepalive()
    }

    drop() {
        this.stopKeepalive()
        this.publishProperty('connected', 'OFF')
        super.drop()
    }

    processAABB(buf: Buffer) {
        this.packetCount++
        this.publishProperty('connected', 'ON')
        this.publishProperty('packet_count', this.packetCount)
        this.publishProperty('last_payload_length', buf.length + 4)
        this.publishProperty('last_payload', this.wrapForDisplay(buf))

        if (this.processProfileList(buf)) return
        if (this.processStatusFrame(buf)) return

        // Unknown short frames (e.g. 0x30 acks) must not clobber the state.
        this.publishProperty('frame_type', `0x${buf[0]?.toString(16).padStart(2, '0') ?? '??'}`)
    }

    private processProfileList(buf: Buffer) {
        if (buf.length !== 51 || asciiField(buf, 0, 2) !== '01' || buf[2] !== 0x02) return false

        this.publishProperty('frame_type', 'profile_list')
        this.publishProperty('profile_1', asciiField(buf, 4, 11))
        this.publishProperty('profile_2', asciiField(buf, 28, 11))
        this.publishProperty('raw_flags_1', hexField(buf, 17, 10))
        this.publishProperty('raw_flags_2', hexField(buf, 41, 10))
        return true
    }

    private processStatusFrame(buf: Buffer) {
        if (buf[0] !== 0x30) return false

        let frameType: string
        let rec: Buffer
        if (buf[1] === 0xeb && buf.length === 2 + STATUS_RECORD_LEN) {
            frameType = 'status'
            rec = buf.subarray(2)
        } else if (buf[1] === 0xec && buf.length === 2 + STATUS_RECORD_LEN * 2) {
            frameType = 'status_delta'
            rec = buf.subarray(2 + STATUS_RECORD_LEN, 2 + STATUS_RECORD_LEN * 2)
        } else return false

        const stateCode = rec[1]
        const optionFlags = rec[17]
        // rec[2] is the power/phase byte, fully mapped live on the real dryer
        // (2026-07-22): the whole idle -> run -> pause -> resume -> end ->
        // auto-off lifecycle was observed. Values differ from the US
        // DLE7300WE handler (anszom/rethink#78), which uses 0x32/0x33.
        const phaseCode = rec[2]
        this.lastRecordAt = Date.now()
        // Prima di tutto il resto: da qui dipende il nome che il programma
        // prende qualche riga piu' sotto.
        this.trackDownloaded(rec, phaseCode)
        const isPoweredOn = phaseCode !== 0
        const cycleActive = phaseCode === 0x02 || phaseCode === 0x03
        const status = PHASES[phaseCode] ?? `Fase ${hexByte(phaseCode)}`
        // rec[22] e' lo SmartCourse applicato adesso; rec[7] resta il programma
        // di base su cui poggia. Se c'e', in HA si mostra il nome del ciclo
        // scaricato, che e' quello che l'utente ha scelto nell'app.
        const program =
            rec[22] && rec[22] === this.downloadedId
                ? smartCourseLabel(rec[22])
                : mappedLabel(CYCLES, rec[7], 'Programma')
        const ecoMode = mappedLabel(ECO_MODES, rec[10], 'Modo')
        const dryLevel = mappedLabel(DRY_LEVELS, rec[9], 'Livello')
        // Panel time bytes (calibrated 2026-07-22): while idle the programme
        // time sits in rec[3](hours):rec[4](minutes); during/after a cycle
        // those bytes hold the remaining time, the initial time moves to
        // rec[5](hours):rec[6](minutes) and rec[20] counts elapsed minutes.
        const remainingMinutes = (rec[3] ?? 0) * 60 + (rec[4] ?? 0)
        const initialMinutes = cycleActive || phaseCode === 0x04 ? (rec[5] ?? 0) * 60 + (rec[6] ?? 0) : remainingMinutes
        const selectedTime = formatPanelTime(initialMinutes)
        const remainingTime = formatPanelTime(remainingMinutes)
        const summary = !isPoweredOn
            ? status
            : cycleActive || phaseCode === 0x04
              ? `${status} - ${program} - residuo ${remainingTime}`
              : initialMinutes > 0 || rec[7] > 0 || rec[9] > 0 || rec[10] > 0
                ? `${selectedTime} - ${program} - ${ecoMode} - ${dryLevel}`
                : status

        this.publishProperty('frame_type', frameType)
        this.publishProperty('status', status)
        this.publishProperty('summary', summary)
        this.phase = phaseCode
        this.machineCycle = rec[7] ?? 0
        this.machineEco = rec[10] ?? 0

        // Appena accesa la macchina resta in attesa senza programma: le mandiamo
        // subito quello scelto in Home Assistant, cosi' e' pronta invece di
        // stare li' ad aspettare un giro di manopola. Una volta per accensione.
        if (phaseCode === 0x00) this.programmaGiaMandato = false
        if (phaseCode === 0x01 && this.machineCycle === 0 && !this.programmaGiaMandato) {
            this.programmaGiaMandato = true
            // Con Eco (1) la macchina scarta tutto il pacchetto e resta senza
            // programma: provato il 25/09 a macchina appena accesa e vuota, e
            // pure a macchina ferma con un programma gia' su. Il tasto del
            // pannello l'Eco lo prende, il comando no - non e' una questione di
            // stato, e' proprio che da remoto non si puo'. L'Eco si ottiene solo
            // col comando di avvio, che invece lo accetta.
            setTimeout(() => this.pushProgram(), 1200).unref?.()
        }
        this.cycleRunning = phaseCode === 0x02
        this.publishProperty('running', phaseCode === 0x02 ? 'ON' : 'OFF')
        this.publishProperty('power', isPoweredOn ? 'ON' : 'OFF')
        // Delayed start (calibrated live 2026-07-23): rec[12] holds the delay
        // hours (mirrored at rec[14]) and rec[16] bit0 arms it; changing the
        // programme clears it.
        this.publishProperty('delay_hours', isPoweredOn ? (rec[12] ?? 0) : 0)
        const delayMinutes = isPoweredOn ? (rec[12] ?? 0) * 60 + (rec[13] ?? 0) : 0
        this.publishProperty('delay_remaining', formatPanelTime(delayMinutes))
        this.publishProperty('delay_armed', isPoweredOn && ((rec[16] ?? 0) & 0x01) !== 0 ? 'ON' : 'OFF')
        // EcoHybrid has no dedicated state bit: on this panel the temperature
        // has no button of its own, so "very low temp" IS EcoHybrid engaged
        // (verified live: toggling EcoHybrid moves rec[10] 0x01<->0x03 and the
        // programme time 2:30<->2:10).
        this.publishProperty('ecohybrid', isPoweredOn && rec[10] === 0x01 ? 'ON' : 'OFF')
        this.publishProperty('program', program)
        this.publishProperty('temperature', ecoMode)
        this.publishProperty('error', mappedLabel(ERRORS, rec[8], 'Errore'))
        this.publishProperty('problem', rec[8] ? 'ON' : 'OFF')
        this.publishProperty('dry_level', dryLevel)
        // rec[18] = 0x10 e' il "bip senza effetto": la macchina ha ricevuto un
        // comando e l'ha rifiutato. Rimettiamo le tendine sui valori veri, cosi'
        // non restano a promettere qualcosa che la macchina non ha accettato
        // (succede con EcoHybrid su Eco, che rifiuta sempre).
        if (rec[18] === 0x10) {
            this.selProgram = this.selectableProgram(program) ? program : this.selProgram
            if (SELECTABLE_DRY_LEVELS.includes(dryLevel)) this.selDryLevel = dryLevel
            // l'EcoHybrid no: la scelta dell'utente vale per il prossimo avvio,
            // anche se la macchina adesso sta su un altro valore
            this.publishSelection()
        }

        const antiCreaseOn = isPoweredOn && ((rec[16] ?? 0) & 0x02) !== 0
        this.mirrorSelection(program, dryLevel, ecoMode, antiCreaseOn)
        this.publishProperty('anticrease', antiCreaseOn ? 'ON' : 'OFF')
        this.publishProperty('remote_start', isPoweredOn && ((rec[17] ?? 0) & 0x01) !== 0 ? 'ON' : 'OFF')
        this.publishProperty('stage', mappedLabel(STAGES, rec[11], 'Fase'))
        // rec[19]:rec[20] is a 16-bit BIG-endian counter that advances only while
        // the drum runs (about one step every 6-8 s), freezes when the cycle stops
        // and stays retained in the idle frames: the energy the cycle has used, in
        // Wh. Measured on five complete runs in the add-on log: Rapido 30 ended at
        // 237 and 266 Wh, Misti 1:20 at 964 Wh, the two long cycles at 1265 and
        // 1414 Wh - exactly what a 9 kg heat-pump dryer draws. The matching US
        // heat-pump model upstream (BDH_D30007_US) carries the same field, also
        // 16-bit big-endian Wh, which is the independent confirmation.
        this.publishProperty('energy', (rec[19] ?? 0) * 256 + (rec[20] ?? 0))
        this.publishProperty('state_code', hexByte(stateCode))
        this.publishProperty('course_code', hexByte(rec[11]))
        this.publishProperty('program_code', hexByte(rec[7]))
        this.publishProperty('level_code', hexByte(rec[18]))
        this.publishProperty('stage2_code', hexByte(rec[21]))
        // Ricalcolata solo quando il conto alla rovescia si muove: ricalcolarla a
        // ogni frame la farebbe ballare di qualche secondo ogni otto secondi.
        if ((cycleActive || phaseCode === 0x04) && remainingMinutes > 0) {
            if (remainingMinutes !== this.lastRemaining) {
                this.lastRemaining = remainingMinutes
                this.publishProperty('eta', new Date(Date.now() + remainingMinutes * 60_000).toISOString())
            }
        } else {
            this.lastRemaining = -1
            this.publishProperty('eta', 'None')
        }
        this.publishProperty('selected_time', selectedTime)
        this.publishProperty('remaining_time', remainingTime)
        // NOTE: rec[20] is not an elapsed-minutes byte (nor the modem uptime the
        // old comment here claimed): it is the low half of the cycle energy above.
        // Elapsed time is derived arithmetically instead.
        this.publishProperty(
            'elapsed_time',
            cycleActive || phaseCode === 0x04 ? Math.max(0, initialMinutes - remainingMinutes) : 0,
        )
        this.publishProperty('option_codes', rec.subarray(9, 12).toString('hex'))
        this.publishProperty('option_flags', hexByte(optionFlags))
        this.publishProperty('feature_flags', rec.subarray(12, 19).toString('hex'))
        // rec[25] is the SmartCourse/downloaded-cycle id (Bd[23] in the fork's
        // numbering). It reads 0x6b on this unit; track it so the wake packet
        // stays correct if a firmware update ever changes it.
        if (rec[25]) this.smartCourseId = rec[25]
        this.publishProperty('counter_code', rec[25])
        this.publishProperty('status_record', rec.toString('hex'))
        return true
    }

    private wrapForDisplay(buf: Buffer) {
        const inner = buf.toString('hex')
        const head = Buffer.from([0xaa, buf.length + 4])
        const packetNoChecksum = Buffer.concat([head, buf])
        let sum = 0
        for (const b of packetNoChecksum) sum += b
        const checksum = ((sum & 0xff) ^ 0x55).toString(16).padStart(2, '0')
        return `aa${(buf.length + 4).toString(16).padStart(2, '0')}${inner}${checksum}bb`
    }

    // F0 25 SmartCourse select. Layout from the fork's captures: [2] and [5]
    // eco hybrid, [3] constant 0x15, [6] default minutes, [14] base course id
    // (none here), [15] SmartCourse id, [19] default dry level.
    private buildWake() {
        const inner = Buffer.alloc(25, 0)
        inner[0] = 0xf0
        inner[1] = 0x25
        inner[2] = WAKE_DEFAULT_ECO
        inner[3] = 0x15
        inner[5] = WAKE_DEFAULT_ECO
        inner[6] = WAKE_DEFAULT_TIME
        inner[15] = this.smartCourseId
        return inner
    }

    // Same F0 25 the wake uses, but filled in: [14] base course, [6] its
    // duration, [2]/[5] ecoHybrid, [19] dry level. The appliance switches to
    // that programme with those settings and stays put - nothing starts.
    // Only worth sending while it sits powered on and waiting: running, it is
    // ignored, and off, there is nothing to set.
    //
    // (An earlier note here claimed ecoHybrid and dry level were ignored. They
    // are not - that reading came from miscounting the record's bytes. Sending
    // eco=3 on a Cotone left the appliance on Turbo, where the knob's own
    // Cotone sits on Eco.)
    private pushProgram(eco = ECO_MODE_IDS[this.selEco] ?? WAKE_DEFAULT_ECO) {
        // `config?` perche' nei test la connessione e' finta e non ne ha una.
        if (!this.HA.config?.push_program_to_appliance) return
        if (this.phase !== 0x01) return

        if (this.selProgram === this.downloadedName()) {
            this.sendDownloaded()
            return
        }

        const cycleId = CYCLE_IDS[this.selProgram]
        if (cycleId === undefined) return

        this.sendCourse(cycleId, eco, DRY_LEVEL_IDS[this.selDryLevel] ?? 0)
    }

    // Lo stesso F0 25 che manda l'app LG quando si sceglie un ciclo scaricato:
    // [14] il programma di base, [15] l'id del ciclo, [12] a 01. Sono i due
    // byte che non mettevamo, presi dal comando vero catturato il 25/09/2026.
    private sendDownloaded() {
        if (!this.downloadedId || !this.downloadedBase) return

        const inner = Buffer.alloc(25, 0)
        inner[0] = 0xf0
        inner[1] = 0x25
        inner[2] = F025_CONST
        inner[3] = 0x15
        inner[5] = this.downloadedEco || WAKE_DEFAULT_ECO
        inner[6] = this.downloadedMinutes || CYCLE_MINUTES[this.downloadedBase] || 0
        inner[12] = 0x01
        inner[14] = this.downloadedBase
        inner[15] = this.downloadedId
        inner[19] = this.downloadedLevel
        this.send(inner)
    }

    // Livello ed EcoHybrid la macchina li accetta solo se il pacchetto porta il
    // programma che ha gia' lei: mandarli insieme a un programma diverso fa
    // scartare tutto. Quindi qui si riusa il corso corrente e si cambiano solo
    // le due impostazioni (25/09: Cotone+Turbo e Sintetici+Pronto stiro, presi
    // entrambi al primo colpo).
    private pushSettings() {
        if (!this.HA.config?.push_program_to_appliance) return
        if (this.phase !== 0x01) return
        if (!this.machineCycle) return // nessun programma su cui applicarle

        // L'apparecchio, in questo comando, accetta solo 0 e 3 come ecoHybrid:
        // Eco (1) e Normale (2) li rifiuta col bip. Ma il comando di AVVIO li
        // prende (provato il 25/09: ciclo partito su Cotone, Pronto armadio,
        // Eco). Quindi se l'utente vuole Eco non glielo mandiamo qui - teniamo
        // l'eco che la macchina ha gia', cosi' il pacchetto resta valido e il
        // livello passa lo stesso - e l'Eco parte con "Avvia ciclo scelto".
        const voluto = ECO_MODE_IDS[this.selEco] ?? WAKE_DEFAULT_ECO
        const eco = voluto === 1 || voluto === 2 ? this.machineEco || WAKE_DEFAULT_ECO : voluto

        this.sendCourse(this.machineCycle, eco, DRY_LEVEL_IDS[this.selDryLevel] ?? 0)
    }

    private sendCourse(cycleId: number, eco: number, dryLevel: number) {
        const minutes = CYCLE_MINUTES[cycleId]
        if (minutes === undefined) {
            console.warn(`RC90U2_WW: durata del corso 0x${cycleId.toString(16)} sconosciuta, comando non inviato`)
            return
        }

        const inner = Buffer.alloc(25, 0)
        inner[0] = 0xf0
        inner[1] = 0x25
        inner[2] = F025_CONST
        inner[3] = 0x15
        inner[5] = eco
        inner[6] = minutes
        inner[14] = cycleId
        inner[19] = dryLevel
        this.clearedByUs = true
        this.send(inner)
    }

    // Prima si prova l'accensione liscia: a scheda sveglia basta quella, e
    // soprattutto non tocca la manopola. Solo se dopo qualche secondo la
    // macchina e' ancora spenta si tira fuori la sveglia F0 25, che la accende
    // anche da fredda ma le esclude la manopola fino allo stacco di corrente.
    // F0 25 con corso 0 e durata 0: la macchina resta accesa e torna senza
    // programma. Da usare quando si e' avviato quello sbagliato: a cesto in
    // moto serve prima la pausa, altrimenti il comando viene scartato.
    private clearProgram() {
        const vuoto = Buffer.alloc(25, 0)
        vuoto[0] = 0xf0
        vuoto[1] = 0x25
        vuoto[2] = WAKE_DEFAULT_ECO
        vuoto[3] = 0x15
        vuoto[5] = WAKE_DEFAULT_ECO

        if (!this.cycleRunning) {
            this.send(vuoto)
            return
        }

        this.send(Buffer.from(PAUSE, 'hex'))
        setTimeout(() => this.send(vuoto), PAUSE_BEFORE_PROGRAM_MS).unref?.()
    }

    private powerOn() {
        const inviatoA = Date.now()
        this.send(Buffer.from(POWER_ON, 'hex'))
        let sveglia = false

        const svegliala = () => {
            if (sveglia || this.phase !== 0x00) return
            sveglia = true
            console.log('RC90U2_WW: accensione liscia ignorata, provo con la sveglia F0 25')
            this.send(this.buildWake())
            setTimeout(() => this.send(Buffer.from(POWER_ON, 'hex')), WAKE_DELAY_MS).unref?.()
        }

        // Non si aspetta che la macchina si faccia viva da sola: le si chiede.
        setTimeout(() => {
            if (this.phase !== 0x00) return
            this.pollStatus()
        }, POWER_ON_POLL_MS).unref?.()

        // Risposta fresca e dice ancora spenta: non c'e' altro da aspettare.
        setTimeout(() => {
            if (this.lastRecordAt > inviatoA + POWER_ON_POLL_MS) svegliala()
        }, POWER_ON_EARLY_MS).unref?.()

        // Se invece non ha risposto affatto, si torna al vecchio margine largo.
        setTimeout(svegliala, POWER_ON_RETRY_MS).unref?.()
    }

    // F0 26: writes the programme and starts it. Layout from the fork's
    // captures: [2] cycle, [3] dry level, [4] eco hybrid, [8] delayed end
    // hours, [11] anti-crease, [12] operation.
    private buildProgramCommand(operation: number) {
        // Un ciclo scaricato parte col suo programma di base: nel comando di
        // avvio dell'app l'id dello SmartCourse non c'e', ci va il corso su cui
        // poggia (verificato il 25/09: Cotone + "Carico pieno" ha avviato 07).
        const cycleId = this.selProgram === this.downloadedName() ? this.downloadedBase : CYCLE_IDS[this.selProgram]
        if (cycleId === undefined || cycleId === 0) return undefined

        const inner = Buffer.alloc(16, 0)
        inner[0] = 0xf0
        inner[1] = 0x26
        inner[2] = cycleId
        inner[3] = DRY_LEVEL_IDS[this.selDryLevel] ?? 0
        inner[4] = ECO_MODE_IDS[this.selEco] ?? 0
        inner[8] = this.selDelayHours
        inner[11] = this.selAntiCrease ? 0x02 : 0x00
        inner[12] = operation
        return inner
    }

    private sendProgram(operation: number) {
        const cmd = this.buildProgramCommand(operation)
        if (!cmd) {
            console.warn(`RC90U2_WW: programma sconosciuto '${this.selProgram}', comando non inviato`)
            return
        }

        // Il ritardo vale per l'avvio che si sta mandando, non per sempre: se
        // restasse impostato, il prossimo avvio partirebbe ritardato senza che
        // nessuno l'abbia chiesto. Anche l'app lo riazzera a ogni ciclo.
        if (this.selDelayHours) {
            this.selDelayHours = 0
            this.publishSelection()
        }

        if (!this.cycleRunning) {
            this.send(cmd)
            return
        }

        // Mid-cycle: pause, then let the programme command resume it.
        this.send(Buffer.from(PAUSE, 'hex'))
        setTimeout(() => this.send(cmd), PAUSE_BEFORE_PROGRAM_MS).unref?.()
    }

    private pollStatus() {
        this.send(Buffer.from(POLL_STATUS, 'hex'))
    }

    private startKeepalive() {
        this.stopKeepalive()
        this.keepaliveTimer = setInterval(() => this.pollStatus(), KEEPALIVE_INTERVAL_MS)
        this.keepaliveTimer.unref?.()
    }

    private stopKeepalive() {
        if (!this.keepaliveTimer) return
        clearInterval(this.keepaliveTimer)
        this.keepaliveTimer = undefined
    }

    setProperty(prop: string, _mqttValue: string) {
        // _mqttValue carries the payload for the selects and the switch.
        if (prop === 'poll_status') this.pollStatus()
        if (prop === 'power_on') this.powerOn()
        if (prop === 'power_off') this.send(Buffer.from(POWER_OFF, 'hex'))
        if (prop === 'pause') this.send(Buffer.from(PAUSE, 'hex'))
        if (prop === 'reset') this.clearProgram()
        if (prop === 'sel_program' && CYCLE_IDS[_mqttValue] !== undefined) this.selProgram = _mqttValue
        if (prop === 'sel_dry_level' && DRY_LEVEL_IDS[_mqttValue] !== undefined) this.selDryLevel = _mqttValue
        if (prop === 'sel_eco' && ECO_MODE_IDS[_mqttValue] !== undefined) this.selEco = _mqttValue
        if (prop === 'sel_anticrease') this.selAntiCrease = _mqttValue === 'ON'
        if (prop === 'sel_delay') this.selDelayHours = clampDelay(_mqttValue)
        if (prop === 'bridge_active') {
            // Se l'accensione non riesce (mai registrato al cloud) si ripubblica
            // lo stato vero, cosi' l'interruttore in HA torna indietro da solo
            // invece di restare acceso per finta.
            this.HA.bridgeControl?.setActive(this.thinq.id, _mqttValue === 'ON')
            this.publishBridgeState()
        }
        if (prop.startsWith('sel_')) this.publishSelection()
        if (prop === 'sel_program') this.pushProgram()
        if (prop === 'sel_dry_level' || prop === 'sel_eco') this.pushSettings()
        if (prop === 'apply_program') this.sendProgram(OP_START_ALT)
        if (prop === 'start_cycle') this.sendProgram(OP_START)
    }
}
