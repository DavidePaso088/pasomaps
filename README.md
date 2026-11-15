# PasoMaps

App per il giro del corriere: tappe fisse per ogni giro, note di consegna,
mappa scura e **percorsi calcolati sempre senza autostrada**.

Non è un prototipo grafico: il routing è reale (OpenStreetMap + Valhalla,
profilo *truck*), la posizione è quella del telefono, la navigazione parla.

---

## 1. Cosa fa

| Funzione | Stato |
|---|---|
| Giri illimitati (ciclo 2 settimane: crei 10/14 giri e li nomini) | ✅ |
| Scelta manuale del giro del giorno | ✅ |
| Tappe con indirizzo cercato o posizione GPS | ✅ |
| Note per tappa: piano, citofono, portineria, garage… | ✅ |
| Mappa 78% dello schermo, **mappa chiara** su app scura, percorso blu | ✅ |
| Sotto la mappa: minuti e km alla prossima tappa + ora di arrivo | ✅ |
| Tasto “Tappe” in basso: elenco scorrevole, si posiziona da solo sulla tappa attuale | ✅ |
| Saltare una tappa (“⤼”) senza perderla per le prossime settimane | ✅ |
| Aggiungere un cliente al volo (“+”) — resta salvato nel giro | ✅ |
| “Salva percorso” | ✅ |
| Navigazione in app: manovre, voce italiana, arrivo automatico, ricalcolo se sbagli strada | ✅ |
| Oppure passaggio a **Google Maps** (con `avoid=highways`) | ✅ |
| Ricalcolo percorso, alternativa più corta (tasto ⇄) | ✅ |
| Autostrade escluse | ✅ sempre |
| Traffico in tempo reale e colorazione rosso/arancione | ✅ con chiave TomTom (gratuita); senza chiave stime senza traffico |
| Foto delle consegne | ❌ (non richieste, aggiungibili) |
| Sincronizzazione cloud | ❌ (dati solo sul telefono, backup JSON manuale) |

---

## 2. Come metterla su Android

### Opzione A — GitHub Pages (consigliata: app installabile)

Serve un repository **pubblico**: con un account gratuito GitHub Pages non pubblica
i repository privati. Nel repository non ci sono dati personali (i giri restano nel
telefono), solo il codice.

**La cartella è già pronta come repository Git** (`main`, primo commit fatto).

1. Crea un repository nuovo su <https://github.com/new>:
   nome `pasomaps`, visibilità **Public**, **non** aggiungere README o .gitignore.
2. Carica i file, scegli una delle due strade:
   - **Senza Git** — nella pagina del repository: `Add file` → `Upload files`,
     trascina il **contenuto** della cartella `PasoMaps` (non la cartella stessa),
     poi `Commit changes`.
   - **Con Git** — da PowerShell:
     ```
     cd C:\Users\Paso\Downloads\opencode\PasoMaps
     git remote add origin https://github.com/TUO-UTENTE/pasomaps.git
     git push -u origin main
     ```
     Al primo push Git per Windows apre il browser per l’accesso a GitHub.
3. Repository → `Settings` → `Pages` → Source: **Deploy from a branch**,
   Branch `main`, cartella `/ (root)` → `Save`.
4. Dopo 1–2 minuti l’indirizzo è `https://TUO-UTENTE.github.io/pasomaps/`.
5. Aprilo da Chrome sul telefono → menu → **Installa app**.

Il file `.nojekyll` è già incluso: GitHub serve i file così come sono, senza
rielaborarli.

### Opzione B — Netlify Drop (alternativa senza Git)
1. Vai su <https://app.netlify.com/drop> e crea un account gratuito.
2. Trascina la cartella `PasoMaps`.
3. Apri il link, da Chrome sul telefono → **Installa app**.

### Opzione C — un solo file, senza hosting
`PasoMaps-single.html` contiene tutto (CSS e JS inclusi). Mandalo su Drive/WhatsApp,
aprilo con Chrome dal telefono.

- Funziona per pianificare, vedere mappa e percorsi, aprire Google Maps.
- L’installazione come app e il service worker **non** sono disponibili.
- Il GPS da `file://` può essere bloccato da Chrome: se ti serve, usa l’opzione A.

### Opzione D — provarla sul PC
Doppio click su `index.html`. Nessuna installazione.

> **Importante:** i giri sono salvati nel browser, legati all’indirizzo da cui apri
> l’app. Se cambi indirizzo (es. da Netlify a GitHub Pages) esporta il backup JSON
> e reimportalo, altrimenti riparti da zero.

---

## 3. Come si usa

1. **Home** → `+ Nuovo giro` (o `Crea ciclo di più giri`: 10/14 giri numerati in un colpo).
2. Nel giro: `+ Aggiungi` → scrivi l’indirizzo → `Cerca` → tocca il risultato giusto.
   In alternativa `📍 Posizione attuale` se sei davanti al cliente.
3. Nella stessa finestra scrivi le note (“Piano 3, citofono Rossi, lasciare in portineria”)
   con i bottoni rapidi.
4. Torna alla home, tocca il giro: la mappa mostra il percorso e sotto i minuti alla prima tappa.
5. `☰ Tappe` apre l’elenco; `➤` su una tappa apre la navigazione.
6. All’arrivo la tappa viene segnata fatta e passa da sola alla successiva
   (disattivabile in Impostazioni).

### Chiave TomTom (traffico)

`Impostazioni` (⚙ in alto a destra) → sezione **Traffico (TomTom)** → incolla la chiave
→ **Verifica chiave**. Se risponde con km e minuti, è valida.

- La chiave è salvata **solo nella memoria del telefono** (localStorage), non nel
  repository e **non nel backup JSON**.
- Con la chiave: percorso e tempi passano a TomTom (camion, `avoid=motorways`,
  traffico live), i tratti congestionati si colorano di arancione/rosso e l’ETA
  mostra il ritardo.
- Senza chiave, o se TomTom non risponde: si torna automaticamente a Valhalla,
  tempi senza traffico. L’app non si blocca mai.
- La chiave è legata al singolo dispositivo: su un secondo telefono va reinserita.

**Pressione lunga su un giro** (o la matita ✎) = rinomina, cambia colore, elimina.
**Tasto indietro di Android** = chiude il pannello, poi torna alla home.

---

## 4. Come sono garantiti i percorsi senza autostrada

1. Ogni richiesta usa il profilo `truck` di Valhalla con `use_highways = 0`
   (le autostrade vengono pesate zero, non “preferite meno”).
2. Il risultato viene controllato: se `has_highway` è vero, o se compare un
   riferimento tipo `A1`, `A4`, `A14` o il nome “Autostrada”, il percorso viene
   **rifiutato e ricalcolato** in modalità “più corto”.
3. Se anche il secondo tentativo contiene un tratto autostradale, l’app lo dice
   in chiaro (banner giallo) invece di fingere che vada tutto bene.
4. Il passaggio a Google Maps usa `avoid=highways`.
   **Solo Google Maps** permette di forzare l’esclusione delle autostrade da link:
   Waze, OsmAnd e Organic Maps vanno impostate a mano dentro l’app, quindi non sono
   affiliate. Google però non conosce le misure del mezzo: la navigazione in app sì.

Altezza, larghezza, lunghezza e peso del mezzo (Impostazioni) entrano nel calcolo:
sottopassi bassi, ponti con limite di peso e strade vietate ai camion vengono evitati.
I valori predefiniti sono da furgone (2,8 m × 2,1 m × 6 m, 3,5 t): **se il tuo mezzo è
diverso, cambiali subito.**

---

## 5. Limiti da sapere (senza girarci intorno)

- **Traffico**: c’è, se inserisci la chiave TomTom gratuita (20.000 richieste/mese).
  Senza chiave i tempi sono stime senza traffico. Il servizio è di TomTom: la qualità
  dipende dalla loro copertura, non da PasoMaps.
- **Dati stradali**: OpenStreetMap è ottimo ma non conosce tutte le ordinanze locali,
  le ZTL temporanee, i divieti di transito giornalieri o i cantieri. La segnaletica
  sul posto vince sempre.
- **Server di routing**: è l’istanza pubblica `valhalla1.openstreetmap.de`, adatta a un
  uso personale leggero. Se un giorno risponde lento o blocca, va sostituita con un
  servizio con chiave (GraphHopper, OpenRouteService, Stadia, self-hosted).
- **Senza rete**: la mappa delle zone che hai già guardato resta disponibile (cache dei
  tile) e l'ultimo percorso calcolato viene salvato, con navigazione, manovre e voce.
  Non si può però **ricalcolare** né aggiornare il traffico senza connessione, e non
  esiste un pulsante “scarica la mappa”: la policy di OpenStreetMap vieta il download
  preventivo dei tile. Chi vuole mappe offline complete deve passare a un fornitore
  che le concede (TomTom, Mapbox) o a tile propri.
- **Dati sul telefono**: `localStorage`. Se cancelli i dati del browser o cambi telefono
  senza backup, i giri spariscono. `Impostazioni → Esporta backup` produce un JSON;
  `Importa` lo rimette dentro.
- **Un giro alla volta per giorno**: il progresso di ogni giro è salvato separatamente
  per data, quindi puoi aprire un altro giro senza perdere quello che hai fatto.
- Le tappe senza coordinate valide bloccano il calcolo: l’app te lo dice e ti porta a correggerle.

---

## 6. File del progetto

```
PasoMaps/
├── index.html               interfaccia
├── css/app.css              stile (dark, mobile)
├── js/app.js                logica: dati, routing, mappa, navigazione
├── manifest.webmanifest     installazione PWA
├── sw.js                    cache offline (shell + tile)
├── icons/                   icone 192/512/maskable
├── PasoMaps-single.html     versione tutto-in-uno (da mandare sul telefono)
└── README.md
```

Servizi esterni usati, tutti senza chiave:

- **Tile mappa**: OpenStreetMap standard, stile chiaro (niente chiavi, niente CARTO).
- **Routing**: Valhalla, profilo truck.
- **Geocodifica**: Nominatim con fallback Photon.
- **Leaflet** da unpkg.

---

## 7. Cose che aggiungerei dopo (in ordine di utilità)

1. **Traffico live + colore del percorso** — fatto, con TomTom (serve la chiave).
2. **Foto della consegna** e firma, con compressione lato telefono.
3. **Ciclo guidato dalla data**: “oggi tocca al Giro 7” calcolato dalla data di inizio.
4. **Percorsi alternativi multipli** affiancati (oggi ce n’è uno alternativo).
5. **Sincronizzazione** tra due telefoni.
6. **Esportazione GPX** del giro.
