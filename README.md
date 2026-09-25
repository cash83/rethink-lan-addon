# LG LAN — add-on Home Assistant

Fa funzionare gli elettrodomestici LG ThinQ **solo in rete locale**, senza cloud: la
macchina parla con Home Assistant e basta. Include il supporto completo per l'asciugatrice
a pompa di calore **LG RC90U2** (`RC90U2_WW`), scritto e verificato su un apparecchio vero.

> **English:** Home Assistant OS add-on that keeps LG ThinQ appliances on the local network
> instead of LG's cloud, with full support for the RC90U2 heat-pump dryer.

## Installazione

In Home Assistant: **Impostazioni → Add-on → Store → ⋮ → Repository**, e incolla

```text
https://github.com/cash83/rethink-lan-addon
```

Poi installa **LG LAN** dall'elenco. La guida completa, compresa la riscrittura DNS che
serve a dirottare `*.lgthinq.com` sul box, è in [`rethink_lan/DOCS.md`](rethink_lan/DOCS.md).

## L'asciugatrice RC90U2

**Cosa legge** — programma, fase del ciclo, livello di asciugatura, EcoHybrid, antipiega,
avvio a distanza, partenza ritardata, tempi (trascorso, residuo, fine prevista), errori,
segnale WiFi, e l'**energia del ciclo** in Wh.

**Cosa comanda** — accensione e spegnimento, programma, livello, EcoHybrid, antipiega,
partenza ritardata, avvio, pausa, e l'annullamento di un programma avviato per sbaglio.
I cicli scaricati dall'app LG compaiono da soli nella tendina dei programmi, col nome
italiano ufficiale, e spariscono quando la macchina non li ha più.

Tre cose che l'app ufficiale di LG **non** sa fare, e qui invece si fanno:

- **accendere l'asciugatrice da spenta** — da remoto LG non lo permette;
- **annullare un programma** — nell'app c'è solo "Riprendi", e il modo previsto da LG è
  lasciare la macchina in pausa finché il ciclo scade da solo;
- **leggere l'energia del ciclo** — il dato c'è nell'apparecchio, ma l'app non lo mostra.

### Il protocollo, per chi ci mette le mani

Tutto quello che segue è stato ricavato leggendo l'apparecchio e confrontandolo con i
comandi veri dell'app LG, e ogni riga è verificata sulla macchina.

- **energia del ciclo**: `rec[19]:rec[20]`, 16 bit big-endian, in Wh. Avanza solo mentre il
  cesto gira, resta nei frame da fermo (quindi dice anche quanto è costato l'ultimo ciclo)
  e si azzera all'accensione del pannello. Confrontato con un ciclo reale: 3h38 e 1754 Wh,
  contro i 212 minuti e 1,66 kWh che LG dichiara per quel programma;
- nel comando impostazioni `F0 25` il byte `[2]` **non** è l'EcoHybrid: vale `0x03` in tutti
  i comandi dell'app, compreso quello che imposta Eco. L'EcoHybrid sta solo in `[5]`.
  Mettere il valore scelto anche in `[2]` fa scartare il pacchetto senza nessun errore;
- nel comando di avvio `F0 26`, `[8]` è la partenza ritardata in ore, contate dalla **fine**
  del ciclo e non dall'inizio, e `[5]` una durata che sovrascrive quella del programma;
- `rec[25]` è il ciclo scaricato **memorizzato**, `rec[22]` quello **applicato**: sono due
  cose diverse, e la macchina ne tiene uno solo alla volta;
- il pacchetto `30 2B 01 00` non è un rifiuto: arriva a raffica per tutta la durata di una
  sessione di comandi. Il riscontro vero è `30 00 <comando> <esito>`, con `00` ricevuto e
  `FF` rifiutato;
- a scheda addormentata l'accensione semplice `F0 2A` viene accettata e ignorata: serve un
  `F0 25` mezzo secondo prima per sbloccarla.

## Ponte al cloud LG

Chi vuole tenere anche l'app ufficiale può accendere il ponte verso il cloud LG. Un
interruttore in Home Assistant lo sospende e lo riprende **senza cancellare la
registrazione**, al contrario del tasto nel pannello web, che cancella il certificato e
obbliga a rifare tutta la procedura. Lo stato sta su disco e sopravvive ai riavvii.

## Licenza

**GNU General Public License v2** — testo completo in
[`rethink_lan/app/COPYING`](rethink_lan/app/COPYING).

Il motore in [`rethink_lan/app/`](rethink_lan/app/) deriva da
[`anszom/rethink`](https://github.com/anszom/rethink) di Andrzej Szombierski, ripreso al
commit `3ce7385`, e resta sotto la stessa licenza. Grazie a lui per il lavoro su cui questo
add-on è costruito.

Rispetto a quella base, qui sono nuovi o modificati i file seguenti; tutti gli altri sono
invariati:

| file | | cosa fa |
| --- | --- | --- |
| `cloud/devices/RC90U2_WW.ts` | nuovo | il gestore dell'asciugatrice |
| `tests/cloud/devices/RC90U2_WW.test.ts` | nuovo | i suoi test |
| `tests/bridge/state.test.ts` | nuovo | test del ponte sospeso |
| `bridge/index.ts` | modificato | `suspend` / `resume` senza perdere il certificato |
| `bridge/state.ts` | modificato | il file `suspended.json` |
| `cloud/homeassistant.ts` | modificato | `BridgeControl`, il filo fra apparecchio e ponte |
| `cloud/ha_bridge.ts` | modificato | registrazione del gestore, confronto su `modelId`/`modelName` |
| `cloud/thinq2/device.ts` | modificato | evento `link`, per esporre il segnale WiFi |
| `cloud/thinq1/device.ts` | modificato | stesso evento, per tenere l'unione dei tipi richiamabile |
| `cloud/mqtt-broker.ts` | modificato | timeout di inattività da 5 minuti a un'ora: il modem LG tace a lungo a macchina spenta, e buttarlo fuori lo costringe a una riconnessione lentissima |
| `rethink-cloud.ts` | modificato | chiavi dei ticket TLS salvate su disco: il modem QCA4010 prova a riprendere la sessione e, se il server è stato riavviato, ammutolisce per minuti |
| `rethink-setup.ts` | modificato | timeout configurabili e chiavi PEM senza rientro, che i firmware CLIP recenti rifiutano |
| `util/config.ts` | modificato | opzioni `cloud_style_availability` e `push_program_to_appliance` |

L'impacchettamento come add-on — `config.yaml`, `Dockerfile`, `run.sh`, documentazione — e
tutto il lavoro sull'RC90U2 sono di questo repository.

Non affiliato a LG. "LG" e "ThinQ" appartengono ai rispettivi proprietari.
