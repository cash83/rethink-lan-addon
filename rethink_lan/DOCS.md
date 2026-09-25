# LG LAN - Documentazione

## Perche' si chiama ancora rethink-cloud?

Nel repository upstream il server locale si chiama `rethink-cloud.js`, ma non e' un servizio cloud remoto. E' il server locale che emula la parte cloud LG ThinQ dentro la tua rete LAN.

Questo add-on lo avvia in modalita' LAN. L'opzione `enable_lg_cloud_bridge` e' disattivata di default.

## Dove sta il codice

Il codice di `anszom/rethink` e' incluso nella cartella:

```text
/addons/rethink_lan/app
```

Il `Dockerfile` copia `app/`, installa le dipendenze npm, compila TypeScript e poi avvia:

```text
/opt/rethink/dist/rethink-cloud.js
```

Quindi non c'e' piu' un `git clone` durante l'installazione dell'add-on.

## Opzioni principali

### `hostname`

Nome DNS locale usato nel certificato e dagli elettrodomestici LG. Non usare un IP.

Esempio:

```text
rethink.lan
```

### `mqtt_url`

URL del broker MQTT di Home Assistant.

Se lasci vuoto, l'add-on prova prima il servizio MQTT di Home Assistant OS; se non lo trova usa:

```text
mqtt://core-mosquitto:1883
```

Puoi anche inserire solo host/IP: l'add-on lo normalizza automaticamente.

Esempi validi:

```text
192.168.50.165
192.168.50.165:1883
mqtt://192.168.50.165:1883
```

### `mqtts_port`

Porta MQTT TLS privata usata dai dispositivi LG. Default upstream: `8884`.

Se nei log vedi:

```text
EADDRINUSE: address already in use :::8884
```

significa che un altro servizio su Home Assistant OS sta gia' usando quella porta. Le soluzioni sono:

- spegnere o disinstallare l'altro add-on/servizio che usa `8884`
- cambiare `mqtts_port` a una porta libera, ad esempio `8885`

Se hai gia' completato il pairing di un dispositivo LG con la vecchia porta, cambiare questa opzione puo' richiedere un nuovo provisioning del dispositivo.

### `mqtt_port`

Porta MQTT non TLS privata usata per appliance/debug. Default: `1884`.

Se occupata, puoi cambiarla ad esempio a `1885`.

### `https_port`

Porta HTTPS del server ThinQ locale. Default: `4433`.

Per il provisioning iniziale dei dispositivi LG serve far arrivare `common.lgthinq.com:443` a questa porta. Puoi usare:

- `https_port: 443`, se la porta 443 e' libera su Home Assistant
- NAT/redirect `443 -> 4433`, se lasci il default

### `management_port`

Porta della UI di gestione. Default:

```text
44401
```

Apri:

```text
http://HOME_ASSISTANT_IP:44401
```

### `enable_lg_cloud_bridge`

Default: `false`.

Lascialo `false` per uso LAN-only. Mettilo `true` solo se vuoi usare la modalita' bridge opzionale verso il cloud LG reale.

### Auto setup

L'add-on puo' provare a lanciare automaticamente `rethink-setup` senza usare un PC esterno.

Opzioni:

```yaml
auto_setup_enabled: true
auto_setup_device_host: "192.168.120.254"
auto_setup_wifi_ssid: "NOME_WIFI"
auto_setup_wifi_password: "PASSWORD_WIFI"
auto_setup_delay: 10
auto_setup_timeout: 20
auto_setup_run_once: true
```

`auto_setup_device_host` puo' essere:

- `192.168.120.254` quando il dispositivo LG e' in modalita' Wi-Fi setup/AP
- l'IP del dispositivo sulla tua LAN, se quel modello mantiene aperta la porta setup `5500`

Se il dispositivo e' gia' in rete ma non accetta piu' comandi setup sulla porta `5500`, l'add-on non puo' riscriverlo da solo. In quel caso serve fare in modo che il dispositivo chiami rethink invece del cloud LG:

```text
common.lgthinq.com -> IP_HOME_ASSISTANT
```

Poi riavvia fisicamente il dispositivo LG. Se usa `https_port: 4433`, aggiungi anche un redirect:

```text
443 -> 4433
```

Questo non e' un limite di Home Assistant: il modulo LG non espone una normale API LAN da cui importare dispositivi gia' registrati al cloud.

Se nei log resta fermo su `Request: deviceinfo`, aumenta `auto_setup_timeout` a `40` oppure considera il tentativo fallito: il dispositivo e' raggiungibile, ma non sta rispondendo alla procedura setup sulla LAN.

### `log_filter`

Lista separata da virgole degli argomenti di log di rethink.

Default:

```text
status,incoming,HTTPS,publish,MGMT
```

## Se non compare nello store

Controlla che il percorso sia esattamente:

```text
/addons/rethink_lan/config.yaml
```

Poi fai:

1. Settings > Apps / Add-ons > App store
2. menu in alto a destra
3. Check for updates
4. refresh forzato del browser

Se ancora non compare, apri i log del Supervisor: di solito c'e' una riga che indica quale campo di `config.yaml` non ha passato la validazione.
