# PasoMaps

**Italiano** · [English](#english)

![PasoMaps](icons/icon-192.png)

App per il giro del corriere: tappe fisse per ogni giro, note di consegna, navigazione con
profilo camion e percorsi **sempre senza autostrada**. Si installa sul telefono come app
(PWA), non ha account, non ha server e non manda i tuoi dati da nessuna parte.

**Installa:** <https://davidepaso088.github.io/pasomaps/>

---

## Italiano

### Cos'è

PasoMaps serve a chi fa consegne con un ciclo di giri che si ripete (per esempio due
settimane). Ogni giro ha le sue tappe, salvate una volta e riutilizzate le volte successive.
Il giorno scegli il giro, l'app mostra il percorso e ti porta alla tappa successiva, con le
note che hai scritto tu: piano, citofono, dove lasciare i pacchi.

Non è un sostituto di Google Maps per cercare negozi o ristoranti: è uno strumento di lavoro
per il giro di consegne.

### Funzioni

| Funzione | Stato |
|---|---|
| Giri illimitati (ciclo di 2 settimane: crei i giri una volta) | ✅ |
| Scelta manuale del giro del giorno | ✅ |
| Tappe con indirizzo cercato, GPS o pin spostato a mano | ✅ |
| Note di consegna (piano, citofono, portineria, garage) | ✅ |
| Mappa al 78% dello schermo, chiara, con percorso blu | ✅ |
| Minuti e km alla prossima tappa, ora di arrivo | ✅ |
| Pannello tappe: salta una tappa, aggiungine una al volo | ✅ |
| Navigazione in app: manovre, voce italiana, arrivo automatico | ✅ |
| Navigazione 3D inclinata (stile Google) in navigazione | ✅ con OpenFreeMap |
| Traffico live e tratti colorati | ✅ con chiave TomTom |
| Percorsi **mai in autostrada** | ✅ sempre |
| Preparazione offline della zona del giro | ✅ |
| Importazione elenco da testo/CSV (Notepad) | ✅ |
| Backup e ripristino JSON | ✅ |
| Foto delle consegne | ❌ |
| Sincronizzazione tra telefoni | ❌ (i dati restano sul dispositivo) |

### Installazione su Android

1. Apri <https://davidepaso088.github.io/pasomaps/> con **Chrome**.
2. Menu `⋮` → **Installa app** (o “Aggiungi alla schermata Home”).
3. Apri l'icona: parte a schermo intero, come un'app normale.

Su **iPhone** funziona da Safari: `Condividi` → **Aggiungi alla schermata Home**. Le funzioni
ci sono tutte, ma l'installazione è meno “nativa” rispetto ad Android.

Serve una connessione per il primo avvio; dopo, l'interfaccia resta disponibile anche offline.

### Primo avvio

1. `Impostazioni` → **Il mio camioncino**: altezza, larghezza, lunghezza, peso. Servono per
   evitare sottopassi bassi e strade vietate ai mezzi pesanti.
2. `Nuovo giro` (oppure `Crea ciclo di più giri` per generarne 10/14 in un colpo).
3. Nel giro: `+ Aggiungi` → cerca l'indirizzo → tocca il risultato.
4. `Impostazioni` → **Esporta backup**: fallo subito, è l'unica copia di sicurezza.

### Come si usa ogni giorno

1. Home → tocca il giro che stai facendo.
2. La mappa mostra il percorso; sotto ci sono i minuti alla prossima tappa.
3. `☰ Tappe` apre l'elenco: la tappa attuale è evidenziata e l'elenco si posiziona da solo.
4. `➤` avvia la navigazione. In app, oppure con Google Maps (`avoid=highways`) o OsmAnd.
5. All'arrivo la tappa viene segnata fatta e si passa alla successiva (disattivabile).
6. Se un cliente non c'è: `⤼` salta la tappa per oggi, resta salvata per la prossima volta.
7. Se si aggiunge un cliente: `+ Aggiungi`; la tappa resta salvata nel giro.

### Chiave TomTom (opzionale ma consigliata)

`Impostazioni` → **Traffico (TomTom)** → incolla la chiave → **Verifica**.

- È gratuita (piano con 20.000 richieste/mese al 16/11/2026, da verificare sul sito TomTom) e
  non richiede carta di credito.
- Con la chiave: tempi con traffico reale, tratti arancioni/rossi, ricerca indirizzi più
  precisa (anche i civici con lettera come 3B) e mappa TomTom opzionale.
- Senza chiave: tempi senza traffico, ricerca con OpenStreetMap, tutto il resto funziona.
- La chiave resta **solo nel telefono**: non finisce nel repository e non è nel backup.

### Offline

Nel giro, in alto sulla mappa, il tasto **⬇** scarica i tile della zona (zoom 10-14):
in genere **2-10 MB per giro**, con un limite di 3.000 tile / 50 MB per scaricamento
(limite di OpenFreeMap). L'icona diventa verde quando ha finito.

Senza rete restano disponibili la mappa preparata, il percorso del giro e le istruzioni del
tratto che stavi navigando. **Non** funzionano i ricalcoli e il traffico.

### Perché non passa mai dalle autostrade

1. Profilo **camion** con autostrade escluse (`use_highways=0` su Valhalla,
   `avoid=motorways` su TomTom).
2. Il risultato viene controllato: se compare un tratto autostradale (ref `A1`, `A4`, …) il
   percorso viene rifiutato e ricalcolato.
3. Se anche il secondo tentativo le contiene, l'app lo dice in chiaro.
4. Il passaggio a Google Maps usa `avoid=highways`.

Waze, OsmAnd e Organic Maps non permettono di forzare l'esclusione delle autostrade da link:
vanno impostate a mano dentro l'app.

### Limiti da sapere

- **Traffico**: solo con chiave TomTom. Senza, i tempi sono stime senza traffico.
- **Offline**: solo le zone preparate col ⬇, non tutta l'Italia.
- **Istruzioni offline**: salvate per il tratto navato online, non per tutte le tappe.
- **Dati stradali**: OpenStreetMap/OpenFreeMap/TomTom non conoscono tutte le ordinanze
  locali, le ZTL temporanee o i cantieri. La segnaletica sul posto vince sempre.
- **Servizi gratuiti**: OpenFreeMap e i server pubblici non hanno garanzie di continuità.
- **Dati**: stanno nel browser del telefono. Se cancelli i dati del sito o cambi telefono,
  senza backup li perdi.

### Privacy

- Nessun account, nessun tracciamento, nessun server dell'autore.
- Giri, tappe e chiave TomTom stanno in `localStorage` sul dispositivo.
- Il backup JSON **non contiene la chiave**.
- Quando cerchi un indirizzo o calcoli un percorso, l'indirizzo/le coordinate vengono inviati
  al servizio usato (TomTom o OpenStreetMap/Valhalla): è lo stesso traffico di una ricerca
  manuale.

### Struttura del progetto

```
index.html                 interfaccia
css/app.css                stile scuro, layout mobile
js/app.js                  dati, mappa (MapLibre), routing, navigazione, import
manifest.webmanifest       installazione PWA
sw.js                      cache offline (shell, mappa, tile)
icons/                     icone 192/512/maskable
PasoMaps-single.html       versione tutto-in-uno, senza hosting
README.md                  questo file
```

Tecnologie: **MapLibre GL JS** per la mappa, **OpenFreeMap** (vettoriale), **TomTom** per
routing/traffico quando c'è la chiave, **Valhalla** (FOSSGIS) come alternativa senza chiave.

### Crediti

Mappe e dati: © OpenStreetMap contributors · © OpenFreeMap · © OpenMapTiles · © TomTom.
Motore mappa: MapLibre GL JS. Routing senza chiave: Valhalla su istanza pubblica FOSSGIS.

---

## English

### What it is

PasoMaps is a delivery-driver route app for repeating rounds (for example a two-week cycle).
Each round stores its stops once and reuses them; every day you pick the round and the app
shows the route, guides you stop by stop and keeps your delivery notes (floor, doorbell,
where to leave the parcels).

It is not a replacement for Google Maps for finding shops or restaurants. It is a work tool
for delivery rounds.

### Features

| Feature | Status |
|---|---|
| Unlimited rounds (two-week cycle) | ✅ |
| Manual choice of today's round | ✅ |
| Stops by address search, GPS or a pin you drag | ✅ |
| Delivery notes (floor, doorbell, concierge, garage) | ✅ |
| Map at 78% of the screen, light, blue route | ✅ |
| Minutes/distance to the next stop, arrival time | ✅ |
| Stop panel: skip one stop, add one on the fly | ✅ |
| In-app navigation: turn-by-turn, Italian voice, auto-arrival | ✅ |
| Tilted 3D navigation (Google-style) | ✅ with OpenFreeMap |
| Live traffic and coloured segments | ✅ with a TomTom key |
| **Never takes motorways** | ✅ always |
| Offline map preparation for the round | ✅ |
| Import a list from text/CSV | ✅ |
| JSON backup and restore | ✅ |
| Delivery photos | ❌ |
| Sync between phones | ❌ (data stays on the device) |

### Install on Android

1. Open <https://davidepaso088.github.io/pasomaps/> in **Chrome**.
2. Menu `⋮` → **Install app** (“Add to Home screen”).
3. Open the icon: it runs full screen like a native app.

On **iPhone** use Safari: `Share` → **Add to Home Screen**. All features work, but the
installation is less “native” than on Android.

The first launch needs a connection; after that the interface stays available offline.

### First setup

1. `Settings` → **My van**: height, width, length, weight. They are used to avoid low
   underpasses and roads closed to heavy vehicles.
2. `New round` (or `Create a cycle` to generate 10/14 rounds at once).
3. Inside the round: `+ Add` → search the address → tap the result.
4. `Settings` → **Export backup**: do it immediately, it is your only safety copy.

### Daily use

1. Home → tap the round you are doing.
2. The map shows the route; below it, the time to the next stop.
3. `☰ Stops` opens the list: the current stop is highlighted and the list scrolls to it.
4. `➤` starts navigation: in-app, Google Maps (`avoid=highways`) or OsmAnd.
5. On arrival the stop is marked done and the app moves to the next one (can be disabled).
6. Customer not there: `⤼` skips the stop for today, keeping it for next time.
7. New customer: `+ Add`; the stop is saved in the round.

### TomTom key (optional, recommended)

`Settings` → **Traffic (TomTom)** → paste the key → **Verify**.

- Free tier (20,000 requests/month as of 16 Nov 2026; check TomTom's site) with no credit card.
- With the key: real-traffic travel times, orange/red segments, better address search
  (including sub-numbers like 3B) and an optional TomTom base map.
- Without it: traffic-free estimates, OpenStreetMap search, everything else works.
- The key stays **on the phone only**: it is not in the repository and not in backups.

### Offline

Inside a round, the **⬇** button on the map downloads the area's tiles (zoom 10-14):
usually **2-10 MB per round**, within OpenFreeMap's 3,000 tiles / 50 MB per download limit.
The icon turns green when it is done.

Without a connection you keep the prepared map, the round's route and the instructions for
the leg you were navigating. Rerouting and traffic do **not** work offline.

### Why it never uses motorways

1. **Truck** profile with motorways excluded (`use_highways=0` on Valhalla,
   `avoid=motorways` on TomTom).
2. The result is checked: if a motorway segment appears (`A1`, `A4`, …) the route is rejected
   and recalculated.
3. If the second attempt still contains one, the app says so explicitly.
4. The Google Maps hand-off uses `avoid=highways`.

Waze, OsmAnd and Organic Maps cannot be forced to avoid motorways from a link: they must be
configured inside the app.

### Known limits

- **Traffic**: only with a TomTom key; otherwise times are traffic-free estimates.
- **Offline**: only the areas you prepared with ⬇, not the whole country.
- **Offline instructions**: cached for the leg you navigated while online, not for every stop.
- **Map data**: OpenStreetMap/OpenFreeMap/TomTom do not know every local restriction,
  temporary ZTL or roadwork. Road signs always win.
- **Free services**: OpenFreeMap and public routing servers have no continuity guarantee.
- **Data**: stored in the phone's browser. Clearing site data or changing phones without a
  backup loses everything.

### Privacy

- No account, no tracking, no author's server.
- Rounds, stops and the TomTom key live in `localStorage` on the device.
- The JSON backup **does not contain the key**.
- Address searches and route calculations send the address/coordinates to the chosen service
  (TomTom or OpenStreetMap/Valhalla), exactly like a manual search.

### Project layout

```
index.html                 UI
css/app.css                dark theme, mobile layout
js/app.js                  data, map (MapLibre), routing, navigation, import
manifest.webmanifest       PWA install
sw.js                      offline cache (shell, map, tiles)
icons/                     192/512/maskable icons
PasoMaps-single.html       all-in-one build, no hosting needed
README.md                  this file
```

Stack: **MapLibre GL JS**, **OpenFreeMap** (vector tiles), **TomTom** for routing/traffic when
a key is present, **Valhalla** (FOSSGIS) as the key-less fallback.

### Credits

Map data: © OpenStreetMap contributors · © OpenFreeMap · © OpenMapTiles · © TomTom.
Map engine: MapLibre GL JS. Key-less routing: Valhalla on the public FOSSGIS instance.
