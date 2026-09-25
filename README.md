# LG LAN — add-on Home Assistant

Add-on per Home Assistant OS che fa parlare gli elettrodomestici LG ThinQ **solo in rete
locale**, senza passare dal cloud di LG. Dentro c'è [`anszom/rethink`](https://github.com/anszom/rethink),
impacchettato come add-on e con un gestore scritto su misura per l'asciugatrice a pompa di
calore **RC90U2_WW**.

> **English:** Home Assistant OS add-on that keeps LG ThinQ appliances on the local network
> instead of LG's cloud. It bundles [`anszom/rethink`](https://github.com/anszom/rethink)
> and adds a device handler for the RC90U2_WW heat-pump dryer. See
> [Licenza e provenienza](#licenza-e-provenienza) for the fork base and the list of changes.

## Installazione

In Home Assistant: **Impostazioni → Add-on → Store → ⋮ → Repository**, e incolla

```text
https://github.com/cash83/rethink-lan-addon
```

Poi installa **LG LAN** dall'elenco. La guida completa, compresa la riscrittura DNS che
serve a dirottare `*.lgthinq.com` sul box, è in [`rethink_lan/DOCS.md`](rethink_lan/DOCS.md).

## L'asciugatrice RC90U2_WW

Il gestore `RC90U2_WW` è stato scritto leggendo il protocollo dell'apparecchio, e in gran
parte **confrontandolo con i comandi veri dell'app LG** catturati attraverso il ponte al
cloud. Ogni campo elencato qui sotto è stato verificato sulla macchina.

**Cosa legge** — programma, fase del ciclo, livello di asciugatura, EcoHybrid, antipiega,
avvio a distanza, partenza ritardata, tempi (trascorso, residuo, fine prevista), errori, e
l'**energia del ciclo** in Wh (`rec[19]:rec[20]`, 16 bit big-endian). Quel campo non risulta
documentato altrove: è stato ricavato e confrontato con un ciclo reale (3h38, 1754 Wh,
contro i 212 min / 1,66 kWh che LG dichiara per quel programma).

**Cosa comanda** — accensione e spegnimento, programma, livello, EcoHybrid, antipiega,
partenza ritardata, avvio, pausa, e l'annullamento di un programma avviato per sbaglio.
I cicli scaricati dall'app compaiono da soli nella tendina dei programmi, col nome italiano
ufficiale di LG, e spariscono quando la macchina non li ha più.

Tre cose che l'app ufficiale **non** sa fare e questo add-on sì:

- **accendere l'apparecchio da spento** — LG non lo permette da remoto;
- **annullare un programma** — nell'app c'è solo "Riprendi", e il modo previsto da LG è
  lasciare la macchina in pausa finché il ciclo scade da solo;
- **leggere l'energia del ciclo**.

### Note sul protocollo, per chi ci mette le mani

- nel comando impostazioni `F0 25` il byte `[2]` **non** è l'EcoHybrid: vale `0x03` in tutti
  i comandi dell'app, anche in quello che imposta Eco. L'EcoHybrid sta solo in `[5]`.
  Mettere il valore scelto anche in `[2]` fa scartare il pacchetto senza nessun errore;
- nel comando di avvio `F0 26`, `[8]` è la partenza ritardata in ore (contate dalla **fine**
  del ciclo, non dall'inizio) e `[5]` una durata che sovrascrive quella del programma;
- `rec[25]` è il ciclo scaricato **memorizzato**, `rec[22]` quello **applicato**: sono due
  cose diverse, e la macchina ne tiene uno solo alla volta;
- il pacchetto `30 2B 01 00` non è un rifiuto: arriva a raffica per tutta la durata di una
  sessione di comandi. Il riscontro vero è `30 00 <comando> <esito>`, con `00` ricevuto e
  `FF` rifiutato.

## Ponte al cloud LG

Un interruttore in Home Assistant sospende e riprende il ponte **senza cancellare la
registrazione**, al contrario del tasto nel pannello web, che cancella il certificato e
obbliga a rifare tutta la procedura con il cloud. Lo stato sta su disco e sopravvive ai
riavvii.

## Licenza e provenienza

Il codice in [`rethink_lan/app/`](rethink_lan/app/) viene da
[`anszom/rethink`](https://github.com/anszom/rethink) di Andrzej Szombierski, sotto **GNU
General Public License v2** (testo in [`rethink_lan/app/COPYING`](rethink_lan/app/COPYING)).
Questo è un lavoro derivato e resta sotto la stessa licenza.

**Questa non è una copia aggiornata dell'upstream.** Il punto di partenza è lo stato di
`anszom/rethink` attorno al commit `3ce7385` del **25 giugno 2026**, con il solo
`bridge/util.ts` preso più avanti (`6eae194`, 2 agosto 2026). Da quel punto l'upstream ha
fatto altri **103 commit** che qui non ci sono: altri elettrodomestici supportati, `util/sni.ts`,
`util/enum.ts`, `bridge/resolver.ts` e una ventina di test. Chi cerca il progetto vivo e
completo deve andare dall'upstream; questo repository serve a chi ha una RC90U2_WW e la
vuole in Home Assistant.

Rispetto a quella base, il confronto file per file dice esattamente questo — tre file nuovi
e dieci modificati, tutto il resto identico all'upstream:

| file | | modifica |
| --- | --- | --- |
| `cloud/devices/RC90U2_WW.ts` | nuovo | il gestore dell'asciugatrice |
| `tests/cloud/devices/RC90U2_WW.test.ts` | nuovo | i suoi test |
| `tests/bridge/state.test.ts` | nuovo | test del ponte sospeso |
| `bridge/index.ts` | +30 | `suspend` / `resume` senza perdere il certificato |
| `bridge/state.ts` | +27 | il file `suspended.json` |
| `cloud/homeassistant.ts` | +21 | `BridgeControl`, il filo fra apparecchio e ponte |
| `cloud/ha_bridge.ts` | +13 −3 | registrazione del gestore, confronto su `modelId`/`modelName` |
| `cloud/thinq2/device.ts` | +3 | evento `link`, per esporre il segnale WiFi |
| `cloud/thinq1/device.ts` | +4 | stesso evento, per tenere l'unione dei tipi richiamabile |
| `cloud/mqtt-broker.ts` | +5 −1 | timeout di inattività da 5 minuti a un'ora: il modem LG tace a lungo a macchina spenta, e buttarlo fuori lo costringe a una riconnessione lentissima |
| `rethink-cloud.ts` | +54 −6 | chiavi dei ticket TLS salvate su disco (il modem QCA4010 tenta di riprendere la sessione e, se il server è stato riavviato, ammutolisce per minuti) |
| `rethink-setup.ts` | +23 −12 | timeout configurabili e chiavi PEM senza rientro, che i firmware CLIP recenti rifiutano |
| `util/config.ts` | +10 | opzioni `cloud_style_availability` e `push_program_to_appliance` |

Dei workflow dell'upstream è stato tolto quello che pubblica immagini su GHCR, e la CI è
stata adattata al percorso `rethink_lan/app`. L'impacchettamento come add-on (`config.yaml`,
`Dockerfile`, `run.sh`, documentazione) è di questo repository.

Non affiliato a LG. "LG" e "ThinQ" appartengono ai rispettivi proprietari.
