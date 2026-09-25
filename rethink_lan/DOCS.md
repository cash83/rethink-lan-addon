# LG LAN - Documentazione

*[English](DOCS.en.md) · **Italiano***

## Perche' si chiama ancora rethink-cloud?

Il server locale si chiama `rethink-cloud.js`, ma non e' un servizio cloud remoto: e' il
server che emula la parte cloud di LG ThinQ dentro la tua rete locale.

Questo add-on lo avvia in modalita' LAN. Il ponte verso il cloud LG vero
(`enable_lg_cloud_bridge`) e' disattivato di default.

## Dove sta il codice

Il codice e' incluso nella cartella:

```text
/addons/rethink_lan/app
```

Il `Dockerfile` copia `app/`, installa le dipendenze npm, compila TypeScript e poi avvia:

```text
/opt/rethink/dist/rethink-cloud.js
```

Non c'e' nessun `git clone` durante l'installazione dell'add-on.

## Opzioni

### `hostname`

Nome DNS usato nel certificato e dagli elettrodomestici LG. Non usare un indirizzo IP.

Default:

```text
common.lgthinq.com
```

E' lo stesso nome a cui gli apparecchi LG cercano di collegarsi: tenendolo cosi' basta
dirottare quel nome sul box (vedi [Far arrivare l'apparecchio qui](#far-arrivare-lapparecchio-qui)).

### `mqtt_url`

URL del broker MQTT di Home Assistant.

Se lo lasci vuoto, l'add-on prova prima il servizio MQTT di Home Assistant OS; se non lo
trova usa `mqtt://core-mosquitto:1883`.

Puoi anche scrivere solo host o host e porta: l'add-on lo normalizza da solo. Sono tutti
validi:

```text
192.168.1.10
192.168.1.10:1883
mqtt://192.168.1.10:1883
```

### `mqtt_user`, `mqtt_pass`

Credenziali del broker MQTT. Se le lasci vuote e il servizio MQTT di Home Assistant OS e'
disponibile, l'add-on usa quelle.

### `discovery_prefix`

Prefisso della discovery MQTT di Home Assistant. Default `homeassistant`: cambialo solo se
l'hai cambiato anche in Home Assistant.

### `rethink_prefix`

Prefisso dei topic MQTT usati da questo add-on. Default `rethink`.

### `https_port`

Porta HTTPS del server ThinQ locale. Default `443`.

Gli apparecchi LG cercano `common.lgthinq.com:443`, quindi la scelta e' fra:

- `https_port: 443`, se la porta 443 e' libera su Home Assistant (il default, ed e' la via
  piu' semplice);
- una porta diversa piu' un redirect `443 -> porta` sul router.

### `mqtts_port`

Porta MQTT TLS usata dagli apparecchi LG. Default `8883`.

Se nei log vedi:

```text
EADDRINUSE: address already in use :::8883
```

un altro servizio sta gia' usando quella porta. Puoi spegnere l'altro add-on oppure
cambiare `mqtts_port` a una porta libera.

Attenzione: se un apparecchio e' gia' abbinato con la porta vecchia, cambiarla puo'
richiedere di rifare il provisioning.

### `mqtt_port`

Porta MQTT non TLS, per debug e uso interno. Default `1886`. Se e' occupata, cambiala.

### `management_port`

Porta della pagina di gestione. Default `44401`:

```text
http://INDIRIZZO_HOME_ASSISTANT:44401
```

Da li' si vedono gli apparecchi collegati, i pacchetti in tempo reale e si accende il ponte
verso il cloud LG.

### `enable_lg_cloud_bridge`

Default `false`.

Lascialo `false` per il solo uso locale. Mettilo `true` se vuoi che l'apparecchio resti
raggiungibile **anche** dall'app ufficiale LG: l'add-on fa da ponte fra la macchina e il
cloud vero.

Due cose da sapere:

- la registrazione al cloud si fa una volta sola dalla pagina di gestione, e le credenziali
  restano su disco anche dopo un riavvio;
- il telefono con l'app LG deve stare **fuori** dalla riscrittura DNS, altrimenti cerca il
  cloud e trova il box. Con i dati mobili funziona.

Una volta registrato, l'interruttore **Ponte al cloud LG** in Home Assistant lo sospende e
lo riprende senza cancellare la registrazione. Il tasto nella pagina di gestione fa un'altra
cosa: cancella il certificato e obbliga a rifare tutta la procedura.

### `cloud_style_availability`

Default `false`.

Con `false` le entita' diventano non disponibili appena l'apparecchio chiude la sessione
MQTT. Con `true` restano disponibili con l'ultimo stato noto finche' l'add-on gira, e il
sonno profondo dell'apparecchio si vede solo nel sensore "Connected" — come fa il cloud LG.

### `push_program_to_appliance`

Default `false`.

Con `true`, scegliere un programma in Home Assistant lo scrive **subito** sulla macchina, a
cesto fermo, invece di aspettare l'avvio.

### `log_filter`

Elenco separato da virgole degli argomenti di log. Default:

```text
status,incoming,HTTPS,publish,MGMT
```

Aggiungi `bridge` per vedere anche il traffico da e verso il cloud LG.

## Far arrivare l'apparecchio qui

L'apparecchio va convinto a cercare questo add-on invece del cloud LG. Si fa con una
riscrittura DNS sul server DNS di casa (AdGuard Home, Pi-hole, il router):

```text
common.lgthinq.com -> INDIRIZZO_HOME_ASSISTANT
```

Poi togli e rimetti corrente all'apparecchio. Se non usi `https_port: 443`, aggiungi anche
un redirect `443 -> porta scelta`.

Se l'apparecchio non e' ancora abbinato, l'abbinamento va fatto con l'app ufficiale LG
oppure con `rethink-setup` da un PC, con l'apparecchio in modalita' punto d'accesso Wi-Fi.

### Perche' non c'e' un abbinamento automatico

C'era, ed e' stato tolto il 22 luglio 2026. Con l'abbinamento automatico acceso, **ogni**
avvio dell'add-on bussava alla porta di provisioning `5500` dell'apparecchio, e questo
stordiva il modem LG: misurato, 17 minuti per tornare in rete contro i 76 secondi che ci
mette senza. Non vale il prezzo, e l'abbinamento si fa una volta sola.

Non e' un limite di Home Assistant: il modulo LG non espone una normale API locale da cui
importare un apparecchio gia' registrato al cloud.

## Se l'add-on non compare nello store

Controlla che il percorso sia esattamente:

```text
/addons/rethink_lan/config.yaml
```

Poi: **Impostazioni → Add-on → Store**, menu in alto a destra, **Controlla aggiornamenti**,
e ricarica la pagina forzando l'aggiornamento del browser.

Se ancora non compare, apri i log del Supervisor: di solito c'e' una riga che dice quale
campo di `config.yaml` non ha passato la validazione.
