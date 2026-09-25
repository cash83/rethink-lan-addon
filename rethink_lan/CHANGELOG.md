## 0.2.61

- **Documentazione corretta e tradotta.** Descriveva un blocco di opzioni `auto_setup_*` che non esistono piu': quella funzione e' stata tolta il 22/07/2026 perche' a ogni avvio dell'addon bussava alla porta di provisioning dell'apparecchio e stordiva il modem LG (misurato: 17 minuti per tornare in rete contro 76 secondi senza). Chi copiava quel blocco prendeva un errore di validazione.
- Corretti i valori di default, che erano rimasti a quelli dell'upstream: `https_port` 443 (non 4433), `mqtts_port` 8883 (non 8884), `mqtt_port` 1886 (non 1884), `hostname` `common.lgthinq.com` (non `rethink.lan`).
- Documentate le sei opzioni che mancavano: `mqtt_user`, `mqtt_pass`, `discovery_prefix`, `rethink_prefix`, `cloud_style_availability`, `push_program_to_appliance`.
- Aggiunta la versione inglese (`DOCS.en.md`), con il selettore di lingua.

## 0.2.60

- **La partenza ritardata non resta piu' appiccicata.** Impostata una volta, restava nel comando di avvio per sempre: il ciclo successivo sarebbe partito ritardato senza che nessuno l'avesse chiesto. Ora si azzera appena l'avvio viene mandato, come fa l'app.
- Coperti da test l'interruttore del ponte (compreso il caso in cui torna da solo su spento perche' il ponte non e' mai stato registrato) e il file `suspended.json`, che prima non erano controllati da niente.
- Aggiunto il test che sorveglia davvero la correzione dell'EcoHybrid: quello esistente usava Turbo, che vale 3 come la costante di `[2]`, quindi passava sia col difetto sia senza.

## 0.2.59

- **Accensione piu' rapida quando la scheda dorme.** Prima si aspettavano 4 secondi buoni prima di decidere che l'accensione semplice era stata ignorata, e il tasto sembrava non funzionare (misurato: 9,2 secondi dal clic all'accensione). Ora a 1,2 secondi si chiede lo stato alla macchina e, se risponde che e' ancora spenta, la sveglia parte subito. Se invece non risponde affatto resta il vecchio margine dei 4 secondi, per non mandare la sveglia - che esclude la manopola - quando non serve.

## 0.2.58

- Corretta la tabella dei cicli scaricati della 0.2.57, che era sbagliata: l'id del protocollo binario non e' nel file di LG e la numerazione ipotizzata non reggeva al confronto con i dati veri. Ora i nomi coprono solo l'intervallo ancorato a misure reali (`0x64`-`0x70`, verificato alle due estremita' associando il profilo riportato dalla macchina ai valori di fabbrica dichiarati da LG) piu' `0x74` = Carico Pieno. Gli id `0x71`-`0x73` restano col numero finche' non se ne scarica uno.

## 0.2.57

- I cicli scaricati hanno il **nome italiano ufficiale di LG**, tutti e sedici, non piu' il numero. La tabella e' stata ricavata scaricando dal cloud, attraverso il ponte, il modelJSON del modello e il language pack italiano: gli id sono 101 + la posizione nella lista SmartCourse.

## 0.2.56

- **Trovato perche' l'EcoHybrid da HA non veniva mai preso.** Il byte `[2]` dell'`F0 25` non e' l'EcoHybrid: vale `0x03` in tutti i comandi veri dell'app, anche in quello che mette Eco. L'EcoHybrid sta solo in `[5]`. Mettendo il valore scelto anche in `[2]`, come si faceva fin qui, la macchina scartava il pacchetto senza dire niente. Ora `[2]` e' costante e l'EcoHybrid scelto in Home Assistant viene scritto sulla macchina subito, a cesto fermo, come fa l'app.
- Il programma scritto da HA porta con se anche il livello di asciugatura scelto, non piu' zero.
- Scrivere un programma non fa piu' sparire dalla tendina il ciclo scaricato: la macchina se lo dimentica (`[15]=00`), ma la voce resta e sceglierla lo rimanda. La voce cambia quando se ne scarica un altro, perche' la macchina ne tiene uno solo alla volta.

## 0.2.55

- I **cicli scaricati** dall'app LG compaiono da soli nella tendina dei programmi e spariscono quando la macchina non li ha piu'. Il nome si conosce per `0x74` ("Carico pieno"); gli altri arrivano come "Ciclo scaricato 0x.." finche' non si incontrano.
- Sceglierne uno rimanda lo stesso `F0 25` dell'app: `[12]=01`, `[14]` il programma di base, `[15]` l'id del ciclo, piu' livello, EcoHybrid e durata **letti dalla macchina stessa** quando lo aveva caricato. Avviarlo usa il programma di base, come fa l'app.
- Distinti i due byte che si somigliavano: `rec[25]` e' il ciclo memorizzato (quello che fa comparire la voce), `rec[22]` quello applicato adesso (quello che fa seguire la tendina).

## 0.2.54

- Nuovo interruttore **Ponte al cloud LG**: spegne e riaccende il ponte senza toccare la registrazione. E' diverso dal tasto Bridge del pannello web, che invece *cancella* il certificato e obbliga a rifare tutta la procedura col cloud. Lo stato sta su disco (`suspended.json`), quindi resta come l'hai lasciato anche dopo un riavvio dell'addon, e a ponte spento l'elettrodomestico che torna online non lo riattacca da solo.
- Se il ponte non e' mai stato registrato, accendere l'interruttore non fa niente e l'interruttore torna da solo su spento invece di restare acceso per finta.

## 0.2.53

- Nuovo campo **Termina fra (ore)**: arma la partenza ritardata dal comando di avvio, come fa l'app LG. 0 = nessun ritardo, altrimenti 3-19 ore (sotto il minimo si sale a 3). Le ore si contano dalla FINE del ciclo, non dall'inizio: "termina fra 3 ore" su un programma da 2h20 lo fa partire fra una quarantina di minuti.
- Il ritardo viaggia nel byte `[8]` del comando `F0 26`, catturato dal vero comando dell'app LG attraverso il ponte al cloud il 25/09/2026.

## 0.2.52

- Preso dall'upstream il `bridge/util.ts` nuovo (agosto): i sottoprocessi openssl che il ponte usa per generare il certificato hanno ora un **timeout** e riportano l'**errore** invece di restare appesi in silenzio. Con la versione vecchia la registrazione al cloud LG si fermava su "Trying to generate a certificate" senza dire perche'.

## 0.2.51

- Nuovo pulsante **Annulla programma**: manda un `F0 25` col corso e la durata a **zero**, e la macchina torna in attesa **senza programma, restando accesa** (provato il 25/09: da Misti 1:10 a display vuoto). Serve quando si e' avviato il programma sbagliato e il pannello non risponde perche' comanda il remoto.
- A ciclo avviato manda prima la pausa e poi il corso vuoto, perche' a cesto in moto la macchina scarta i comandi.
- Non c'e' un vero "annulla" nel protocollo: anche l'app LG per annullare spegne. Questo e' il modo piu' gentile che siamo riusciti a trovare.

## 0.2.50

- Annullata la prova della 0.2.49: con Eco l'impostazione automatica all'accensione viene **scartata in blocco** e la macchina resta senza programma. Si torna al valore che accetta sempre.
- **Verdetto sull'EcoHybrid, con prova in doppio cieco**: a macchina ferma, stesso programma, stesso istante — il **tasto del pannello** mette Eco senza problemi, il **comando** riceve solo il bip di rifiuto. Non e' questione di stato ne' di come e' fatto il pacchetto: da remoto quel valore non si puo' impostare. L'unico modo di avere un ciclo in Eco da Home Assistant resta il comando di **avvio**, che invece lo accetta.

## 0.2.49

- Quando la macchina si accende e l'add-on le manda da solo il programma, prova a chiederle **Eco** invece del Turbo neutro: finora l'Eco e' stato rifiutato solo con un programma gia' impostato, e appena accesa la situazione e' diversa. Se lo rifiutasse, salta soltanto l'impostazione automatica — il cambio programma manuale continua a usare il valore che la macchina accetta sempre.

## 0.2.48

- **Risolto l'EcoHybrid su Eco.** Il comando delle impostazioni (`F0 25`) accetta solo 0 e 3: Eco e Normale li rifiuta col bip. Ma il comando di **avvio** (`F0 26`) li prende — provato il 25/09 facendo partire un ciclo su Cotone, Pronto armadio, **Eco**. Quindi ora la scelta Eco non viene piu' mandata subito (dove verrebbe scartata) ma resta nella selezione e parte con "Avvia ciclo scelto".
- Di conseguenza il rimbalzo delle tendine sui comandi rifiutati non tocca piu' l'EcoHybrid: e' una richiesta per il prossimo avvio, non una cosa che la macchina applica subito. Programma e livello continuano a rimbalzare.
- **All'accensione la macchina riceve subito il programma scelto in Home Assistant**, invece di restare in attesa che qualcuno giri la manopola. Una volta sola per accensione.

## 0.2.47

- **Tolto il sensore "Manopola esclusa"**: diceva in modo approssimativo, deducendolo dai comandi mandati, quello che **`Avvio a distanza`** dice esatto leggendolo dalla macchina. Quando quel bit e' acceso il pannello e' bloccato — LG disabilita tutti i tasti tranne Power e Avvio a distanza — e si sblocca tenendo premuto Segnale 3 secondi, aprendo lo sportello o spegnendo e riaccendendo.
- Verificato in diretta il 25/09: l'utente arma e disarma dal pannello, il bit segue in un secondo (evento 0x20 = tasto premuto).
- Chiarito anche chi arma il remoto senza chiedere: **l'accensione da Home Assistant**. Accendendo col tasto fisico il remoto resta spento e i comandi da HA funzionano lo stesso, senza bloccare niente.

## 0.2.46

- **Le tendine non mentono piu' quando la macchina rifiuta.** Se il record riporta l'evento `0x10` — il "bip senza effetto", cioe' comando ricevuto e scartato — le tre tendine tornano subito sui valori veri della macchina. Serve soprattutto per EcoHybrid su **Eco**, che la macchina rifiuta sempre: prima la tendina restava a dire Eco mentre la macchina stava su Turbo.
- Misurato il 25/09: dei quattro valori possibili l'apparecchio accetta solo 0 (nessuno) e 3 (Turbo); 1 (Eco) e 2 (Normale) rispondono col bip di rifiuto. L'Eco si imposta solo dal tasto sul pannello.

## 0.2.45

- **Livello ed EcoHybrid ora si cambiano da Home Assistant.** Il trucco e' mandarli insieme al programma che la macchina ha gia' addosso, non a quello scelto nella tendina: con il corso corrente li prende al primo colpo (25/09: Cotone+Turbo e Sintetici+Pronto stiro), con un corso diverso scarta tutto il pacchetto.
- Quindi ora muovendo la tendina del **programma** parte un F0 25 col solo corso, muovendo quelle di **livello** o **EcoHybrid** parte un F0 25 col corso attuale della macchina piu' le due impostazioni.
- **Tolto "Normale" dalle scelte EcoHybrid**: su questo pannello il tasto fa solo Eco <-> Turbo, e in ogni giro di manopola registrato la macchina ha riportato 0, 1 o 3, mai il 2. Il valore esiste nel modelJSON del modello gemello, non qui.

## 0.2.44

- **Torna la forma del comando che la macchina accettava davvero.** La 0.2.41 aveva aggiunto livello ed EcoHybrid dentro l'`F0 25` del programma: da quel momento la macchina ha cominciato a respingere (evento 0x60) o ignorare. Il comando che invece aveva funzionato (25/09 09:07:50, da Misti a Personalizzato) portava il solo programma, con ecoHybrid neutro e livello 0.
- Probabile motivo: certe combinazioni non esistono per certi programmi (Rapido 30 e gli altri a tempo non hanno livello di asciugatura), e la macchina scarta tutto il pacchetto invece di correggere il campo.
- Livello ed EcoHybrid tornano a viaggiare solo col comando di avvio, dove sono sempre stati accettati.

## 0.2.43

- **Il pulsante Power on non esclude piu' la manopola quando non serve.** Dalla 0.2.28 mandava SEMPRE la sveglia `F0 25` prima dell'accensione: ma l'`F0 25` e' lo stesso comando che toglie il controllo alla manopola fino allo stacco di corrente, quindi bastava accendere da Home Assistant per ritrovarsi il pannello muto.
- Ora si manda prima l'accensione liscia (`F0 2A`) e si aspettano 4 secondi: se la macchina si accende — cioe' quasi sempre, quando e' stata usata di recente — la sveglia non parte proprio. Solo se resta spenta si ricorre all'`F0 25`, che la tira su anche da fredda al prezzo della manopola.

## 0.2.42

- **L'ordine della tendina e' quello vero del giro della manopola**, misurato sul giro completo del 25/09 alle 06:42: Cotone, Misti, Sintetici, Piumini, Asciugamani, Allergy Care, Rapido 30, **Personalizzato**, Aria calda, Aria fredda, Con cestello, Lingerie, Trattamento Delicato, Speciale Sport, e si torna a Cotone.
- La 0.2.36 aveva messo l'ordine letto sul pannello (colonna sinistra dall'alto, poi colonna destra dall'alto): sembra logico guardando la serigrafia, ma non e' la sequenza che la manopola percorre davvero.

## 0.2.41

- **Anche Livello ed EcoHybrid si scrivono sulla macchina** (con `push_program_to_appliance` acceso): viaggiano nello stesso `F0 25` del programma, `inner[2]`/`inner[5]` per l'ecoHybrid e `inner[19]` per il livello. Muovendo una qualunque delle tre tendine si rimanda il pacchetto completo.
- CORREGGE la nota della 0.2.38, che diceva che quei due campi la macchina li ignorava: era una lettura sbagliata: avevo contato male i byte del record. La prova nei log del 25/09: un Cotone imposto con eco=3 lascia la macchina su Turbo, mentre il Cotone scelto con la manopola sta su Eco.
- L'antipiega resta fuori: quella l'`F0 25` non la porta, continua a viaggiare col comando di avvio.

## 0.2.40

- Nuovo binary_sensor **Manopola esclusa**: si accende nell'istante in cui l'add-on scrive un programma sulla macchina (opzione `push_program_to_appliance`) e si spegne da solo appena la macchina riporta un programma **diverso da quello imposto**, cioe' quando la manopola e' tornata a rispondere. Serve a non lasciare la famiglia a chiedersi perche' la manopola fa solo bip.
- Alla riconnessione la spia riparte da spenta: se la macchina e' tornata su dopo essere stata staccata, la manopola e' libera.

## 0.2.39

- **La scrittura del programma sulla macchina diventa opzionale ed e' SPENTA di default** (nuova opzione `push_program_to_appliance`). Sul campo l'effetto collaterale e' risultato peggiore del previsto: dopo un F0 25 la manopola non solo viene ignorata, ma **perde il giro completo** (da Personalizzato salta a Cotone invece di proseguire sulla colonna destra), e non basta lo spegnimento da Home Assistant per rimetterla a posto.
- Con l'opzione spenta la tendina torna a essere quello che era: la scelta si applica quando si preme "Avvia ciclo scelto".
- Chi la vuole la accende dalla configurazione dell'add-on, sapendo cosa comporta.

## 0.2.38

- **Cambiare programma in Home Assistant lo scrive subito sull'asciugatrice**, senza avviare niente. Si usa l'`F0 25` (SmartCourse select) con il corso base in `inner[14]` e la sua durata in `inner[6]`: provato dal vivo il 25/09, la macchina passa al programma scelto in due secondi e resta in attesa.
- Succede **solo a macchina accesa e in attesa**. Da spenta la scelta resta un desiderio per il prossimo avvio; a ciclo in corso non si manda nulla, perche' la macchina ignorerebbe il comando rispondendo con un bip.
- La durata va passata nel comando: mandare il numero sbagliato fa comparire un tempo sbagliato sul display (Cotone con 30 dava 0:30). Quindi c'e' una tabella con i default delle quattordici posizioni della manopola, letti dalla macchina stessa in due giri completi.
- Livello ed EcoHybrid restano nel comando di avvio: l'`F0 25` non li applica, la macchina tiene i default del programma.
- ⚠️ **Effetto collaterale reale**: quando il programma viene imposto da remoto, la manopola fisica viene esclusa e risponde solo con un bip (codice evento 0x10) finche' non si spegne e riaccende la macchina. E' lo stesso comportamento dell'app LG quando scarica un programma.

## 0.2.37

- Nuovo sensore **Fine prevista** (`device_class: timestamp`): l'ora dell'orologio a cui il ciclo finira', cioe' adesso piu' il tempo residuo. Home Assistant lo mostra come orario o come "fra un'ora", a scelta della card.
- Si ricalcola **solo quando il conto alla rovescia si muove**, non a ogni frame, altrimenti ballerebbe di qualche secondo ogni otto secondi. Quando la macchina rivede il residuo al rialzo (comportamento documentato da LG per i carichi misti) l'orario si sposta di conseguenza: e' una previsione, non una promessa.
- A macchina spenta o ferma il sensore torna sconosciuto invece di restare con un orario vecchio appiccicato.

## 0.2.36

- **La tendina dei programmi segue l'ordine della manopola**: Cotone, Misti, Sintetici, Piumini, Asciugamani, Allergy Care, Rapido 30, Speciale Sport, Trattamento Delicato, Lingerie, Con cestello, Aria fredda, Aria calda, Personalizzato. Prima seguiva il codice interno, quindi apriva con Personalizzato e metteva Cotone in mezzo: un ordine che sulla macchina non esiste.
- Verificato con un giro completo della manopola (25/09 06:42): la sequenza dei codici e' esattamente questa, e fra Con cestello e Lingerie **non c'e' nessun codice**. Quindi "ASCIUGATURA A TEMPO" stampato sul pannello e' l'intestazione dei tre programmi a tempo manuale (Con cestello 3:00, Aria fredda 1:00, Aria calda 1:00), non una quindicesima posizione.

## 0.2.35

- **"Fase ciclo" ribattezzato con i nomi veri.** `rec[11]` non e' una fase generica: sono i traguardi di asciugatura che il pannello accende da sinistra a destra (i DRY_LV1/LV2/LV3 del modelJSON). Le etichette inventate "Avvio" e "Asciugatura finale" diventano **Asciugatura → Pronto stiro → Pronto armadio → Raffreddamento → Fine ciclo**, piu' Vapore e Antipiega che il modelJSON prevede ma che qui non si sono mai visti.
- Verificato sul ciclo del 23/09 (Misti, livello Extra, 3h38): 0x02 per 1h50 mentre i panni erano ancora umidi, 0x03 dalle 22:59, 0x04 dalle 23:59, 0x05 negli ultimi due minuti, 0x07 sul frame di chiusura.
- Il sensore e' ora un `device_class: enum` con la lista completa dei valori, cosi' Home Assistant sa che e' uno stato fra tanti e non testo libero.

## 0.2.34

- **Le select seguono la macchina.** Se il programma (o il livello, o l'EcoHybrid, o l'antipiega) viene cambiato sul pannello, le select "da remoto" si aggiornano da sole: prima restavano ferme sull'ultima scelta fatta in HA e sembrava che HA non capisse. Il sensore "Programma" era sempre stato corretto, era la select a non specchiare.
- Il rispecchiamento scatta **solo quando cambia il valore della macchina**, quindi una scelta fatta in HA non viene sovrascritta dal frame di stato successivo: resta li' finche' non premi Avvia o finche' non e' la macchina a cambiare idea.

## 0.2.33

- Nuovo sensore **Ritardo residuo**: `rec[13]` sono i minuti della partenza ritardata, che scorrono a fianco delle ore di `rec[12]`. Mostrato come sul pannello ("3:45" o "45"). Campo preso dal fork alexw23/rethink, che decodifica entrambe le meta' (Bd[10]/Bd[11]).

## 0.2.32

- Il pulsante doppio "Avvia ciclo (variante 0x03)" viene **cancellato** davvero, non solo nascosto: nella discovery a dispositivo di Home Assistant un componente si elimina pubblicandolo con il solo campo `platform`, ed e' quello che ora fa l'add-on. Resta un solo pulsante di avvio.
- La variante 0x03 resta comunque raggiungibile pubblicando sul topic `<prefisso>/<id>/apply_program/set`, se un giorno servisse.

## 0.2.31

- **Cambiare le impostazioni a ciclo avviato ora funziona.** A cesto in moto la macchina ignora la F0 26 (risponde con un bip, codice evento 0x10 in rec[18]) e tiene le vecchie impostazioni; da ferma o in pausa invece le accetta e riparte. Osservato dal vivo il 22/09 fra le 04:02 e le 04:03. Quindi "Avvia ciclo scelto", se il ciclo sta girando, ora manda prima la pausa e 1,2 s dopo il programma, che lo fa ripartire con le impostazioni nuove.
- Lo switch antipiega si chiama ora **"Antipiega (al prossimo avvio)"**: non comanda la macchina in diretta, viaggia dentro il comando di avvio.

## 0.2.30

- CORREZIONE alla 0.2.29: su questa macchina il byte operazione `0x01` dell'F0 26 **non** si limita a impostare il programma, lo **avvia**. Provato dal vivo il 22/09 alle 03:55 con la macchina accesa e in attesa: programma scritto (Rapido 30 / Pronto armadio / Eco, esattamente le tre select) e cesto partito entro 2 secondi.
- Quindi il pulsante buono e' **"Avvia ciclo scelto"**, e manda 0x01 (quello verificato). La variante 0x03 (che il fork documenta come "start" sul modello gemello) resta come pulsante diagnostico nascosto, da provare solo se un aggiornamento firmware cambiasse le carte in tavola.
- Sparisce il pulsante "Imposta programma": prometteva una cosa che questa macchina non sa fare.

## 0.2.29

Le tre cose prese dal fork alexw23/rethink (handler RH90V9_WW, ricavato dal modelJSON ufficiale del modello gemello):

- **Sensore Errore + binary_sensor Guasto**: `rec[8]` non era mai stato decodificato. Ora dice serbatoio acqua pieno, filtro mancante, porta aperta, errori motore/sonda/scarico. Su questa macchina non e' mai stato diverso da zero, quindi le etichette sono quelle del gemello, non nostre osservazioni.
- **"Temperatura" era sbagliato: e' ecoHybrid.** `rec[10]` vale 0 Nessuno / 1 Eco / 2 Normale / 3 Turbo. Il pannello non ha un tasto temperatura proprio perche' quel byte non e' la temperatura: il tasto EcoHybrid commuta fra Eco e Turbo. Il sensore ora si chiama "EcoHybrid modo" (stesso topic, l'entita' non cambia).
- **Scelta del programma da Home Assistant** (comando `F0 26`): tre select (Programma, Livello, EcoHybrid), uno switch Antipiega e due pulsanti — **Imposta programma** (byte [12]=0x01, scrive le impostazioni senza partire) e **Avvia ciclo scelto** ([12]=0x03, imposta e avvia). Finche' non si preme un pulsante non parte nulla verso la macchina.

## 0.2.28

- RC90U2_WW: **l'accensione da remoto ora funziona anche a macchina ferma da ore.** Il firmware ha un blocco di sicurezza per inattivita' che fa ignorare la F0 2A (power on) dopo pochi minuti di spegnimento; mandare prima una **F0 25 (SmartCourse select)** vale come interazione dell'utente e lo azzera. Il pulsante Power on ora manda wake + power on a 500 ms di distanza.
- Idea e layout del pacchetto presi dal fork **alexw23/rethink**, handler `RH90V9_WW` (LG RC90V9AV2N, pompa di calore europea, parente stretto di questa). SmartCourse usata: 0x6b (Deodorization), che e' quella che questa macchina riporta in rec[25].
- Verificato dal vivo il 22/09 alle 03:41 dopo **dieci ore** di macchina spenta: accesa in 2 secondi, dove il solo power on era stato ignorato due volte il giorno prima.
- Test: aggiunto il caso che controlla la sequenza (prima il frame di wake, poi il power on mezzo secondo dopo).

## 0.2.27

- RC90U2_WW: due opzioni del pannello finalmente mappate, calibrate dal vivo il 21/09 con tre passate e foto del display: **Antipiega** = `rec[16]` bit1 (il tasto e' la funzione extra di EcoHybrid), **Avvio a distanza** = `rec[17]` bit0 (funzione extra di Segnale, tenere 3 secondi). Entrambe sono interruttori veri: si accendono alla prima pressione e restano, si spengono alla seconda.
- Nota su Avvio a distanza: lo stesso bit vale 1 anche mentre un ciclo e' in corso (e 0 in pausa), quindi la macchina lo usa come "accetto comandi da remoto adesso" piu' che come "avvio a distanza armato". La vecchia lettura "rec[17] bit0 = ciclo attivo" era quindi incompleta.
- rec[16] e' un byte di flag: bit0 partenza ritardata armata, bit1 antipiega, bit3 pannello sveglio.
- Test: aggiunti i due frame reali della calibrazione (antipiega ON e avvio a distanza ON) come casi di regressione.

## 0.2.26

- RC90U2_WW: nuovo sensore **Energia ciclo** (Wh, adatto alla dashboard Energia): rec[19]:rec[20] e' un contatore a 16 bit big-endian che avanza solo a cesto in moto e resta memorizzato a fine ciclo. Misurato su 5 cicli completi nel log (Rapido 30 = 237 e 266 Wh, Misti 1:20 = 964 Wh, cicli lunghi = 1265 e 1414 Wh); lo stesso campo esiste sul modello a pompa di calore americano BDH_D30007_US a monte.
- RC90U2_WW: nuovo sensore **Fase ciclo** (rec[11]): Avvio, Asciugatura, Asciugatura finale, Raffreddamento, Fine ciclo. Sale sempre durante il ciclo e 0x07 cade esattamente sul frame in cui la fase diventa "Fine ciclo".
- RC90U2_WW: nuovo sensore diagnostico **Segnale WiFi** (dBm), preso dall'envelope CLIP del modem (nuovo evento `link` su thinq1/thinq2).
- RC90U2_WW: corretti tre diagnostici che mostravano il byte sbagliato: "State code" era il marker di record costante 0x19 (ora **Record marker**), "Course code" duplicava la fase (ora **Stage code**, rec[11]), "Level code" erano le ore residue (ora **Event code**, rec[18]: 0x50 avvio/ripresa, 0x60 pausa). Aggiunto **Stage code 2** (rec[21]).
- RC90U2_WW: la nota su rec[20] "uptime del modem" era sbagliata, e' la meta' bassa dell'energia del ciclo.
- Test della RC90U2 riscritti sui frame reali catturati dal log: erano fermi alla 0.2.6 e 6 casi su 7 fallivano (si aspettavano ancora lo stato "Pronta" e il pulsante Avvia rimosso nella 0.2.13).

## 0.2.25

- L'app ora si chiama **LG LAN** (prima Rethink LAN). Cambia solo il nome mostrato: impostazioni, entita' e riscritture DNS restano identiche.
- Non e' piu' marcata come sperimentale: gira stabile da mesi.

# Changelog

## 0.2.24

- RC90U2_WW: dry level labels renamed to the words printed on the panel display — Pronto stiro / Pronto armadio / Extra (calibrated live: the level button cycles exactly these three). "Aumenta/Riduci durata" adjust the delayed-start hours (3-19h) when the delay is armed.

## 0.2.23

- RC90U2_WW: new sensors calibrated live on the panel — "Partenza ritardata" (delay hours, rec[12]; armed flag on rec[16] bit0; cleared by programme change), "Partenza ritardata attiva" and "EcoHybrid" (derived from the temperature byte: this panel has no temperature button, so very-low temp == EcoHybrid engaged).
- Aligned bundled rethink-setup.ts PEM with upstream commit 7c52739 (no leading whitespace inside the public key).

## 0.2.22

- New `cloud_style_availability` option (default false). Off: devices go unavailable when the appliance's modem sleeps (honest link state). On: entities stay available with the retained last state while the add-on runs — like the LG cloud used to behave — and only the "Connected" sensor reflects the real link.

## 0.2.21

- RC90U2_WW: reverted the 0.2.20 cloud-like availability at the owner's request — entities correctly show unavailable while the modem is in deep standby (honest behavior; it always reconnects on use).

## 0.2.20

- RC90U2_WW: cloud-like availability — entities remain available with the retained last state (e.g. "Spenta") while the add-on runs, instead of going unavailable whenever the modem enters deep standby for hours. The "Connected" binary sensor keeps reporting the real link state.

## 0.2.19

- RC90U2_WW: "Tempo trascorso" is now derived as initial minus remaining time. The byte used before (rec[20]) is the modem's uptime in minutes, not the cycle elapsed time — they coincided during calibration only because the modem had just rebooted.

## 0.2.18

- Log TLS handshakes on the HTTPS and MQTTS listeners (successful connections and handshake errors with the client IP): makes the LG modem's silent connection attempts visible in the add-on log.

## 0.2.17

- FIX: options are now read directly from /data/options.json with jq instead of bashio::config — newer base images ship a bashio that silently fails without Supervisor API access, which made every option fall back to its default (hostname degraded to rethink.lan and the regenerated TLS certificate broke the appliance connection).
- Configuration cleaned up: removed the auto_setup_* options, the unused ThinQ1 port options (hardcoded 46030/47878) and bridge_storage_path (hardcoded /data/state) from the UI. Defaults now match the working setup (hostname common.lgthinq.com, HTTPS 443, MQTTS 8883).

## 0.2.16

- REMOVED the automatic onboarding (auto-setup) feature: poking the appliance's setup port 5500 at every add-on start stunned the LG modem for 15+ minutes (A/B measured: 17 min reconnection with it on, 76 s with it off). The auto_setup_* options remain in the schema for compatibility but are ignored. Pair devices with the companion app or rethink-setup from a PC.

## 0.2.15

- Persist TLS session ticket keys in /data/ticket.keys and reuse them on all TLS/HTTPS listeners: the LG modem resumes its cached TLS session across add-on restarts instead of going silent for many minutes after a failed resumption.

## 0.2.14

- MQTT discovery configs are now published retained: entities survive add-on restarts (they show as unavailable until the appliance reconnects) instead of disappearing until the next HA birth message.

## 0.2.13

- RC90U2_WW: removed the useless "Avvia" button (command F0240501 is acked with a beep but ignored by this model); the real remote start is the Start/Pause toggle F0240401, now exposed as a single "Avvia / Pausa" button. Verified live: remote toggle starts the cycle even without arming remote start on the panel.

## 0.2.12

- RC90U2_WW: full phase map calibrated on a real cycle (0x00 Spenta, 0x01 In attesa, 0x02 In funzione, 0x03 In pausa, 0x04 Fine ciclo). "Stato" and "Running" now follow the real phase.
- RC90U2_WW: during a cycle "Tempo" keeps the programmed time, "Tempo residuo" counts down, new "Tempo trascorso" sensor (elapsed minutes byte).
- RC90U2_WW: unknown short frames no longer overwrite the status; buttons renamed to Avvia / Pausa-Riprendi.
- Broker: MQTT idle timeout raised 5 -> 60 min; CA certificate generated with *.lgthinq.com SANs for instant TLS acceptance.

## 0.2.11

- RC90U2_WW: real program names calibrated live on the dryer dial (14 programs, anchored on Speciale Sport 0x08 and Cotone 0x07).
- RC90U2_WW: selected time now decodes hours (rec[3]) + minutes (rec[4]) as shown on the panel (e.g. Cotone 2:30 = 150 min).

## 0.2.6

- Add preliminary diagnostics-only Home Assistant discovery for LG dryer model `RC90U2_WW`.

## 0.2.5

- Add timeout handling to automatic onboarding so `rethink-setup` does not hang forever on devices that keep port `5500` open but do not answer setup commands.

## 0.2.4

- Add optional automatic onboarding via the bundled `rethink-setup` tool.
- Document the limitation for devices already registered to the LG cloud.

## 0.2.3

- Add startup preflight checks for LAN TCP port conflicts with clearer error messages.

## 0.2.2

- Accept bare MQTT hosts/IPs such as `192.168.50.165` and normalize them to `mqtt://192.168.50.165:1883`.

## 0.2.1

- Bundle the upstream `anszom/rethink` source under `app/`.
- Build from local source instead of cloning GitHub during the Home Assistant install.

## 0.2.0

- Add LAN-focused Home Assistant OS wrapper.
- Keep optional LG cloud bridge disabled by default.
- Use direct local app folder layout for `/addons/rethink_lan`.
- Add common Home Assistant OS architectures.
