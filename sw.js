/* PasoMaps — service worker
   - shell + asset versionati: precaricati all'installazione
   - navigazione: rete, altrimenti cache (mai salvare errori)
   - tile mappa: cache-first con limite (solo tile viste)
   - API routing/geocodifica: MAI in cache
*/
const VERSION = 'pasomaps-v29';
const TILE_CACHE = 'pasomaps-tiles';
const TILE_LIMIT = 3000;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://unpkg.com/maplibre-gl@5.24.1/dist/maplibre-gl.css',
  'https://unpkg.com/maplibre-gl@5.24.1/dist/maplibre-gl.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { mode: 'no-cors' }))));
    // precarica gli asset con ?v=... citati nell'HTML, così l'offline funziona al primo colpo
    try {
      const res = await fetch('./index.html', { cache: 'reload' });
      if (res && res.ok) {
        await c.put('./index.html', res.clone());
        const html = await res.text();
        const urls = Array.from(html.matchAll(/(?:src|href)="([^"]*\.(?:js|css)\?[^"]+)"/g))
          .map((m) => m[1])
          .filter((u) => !/^https?:/.test(u));
        await Promise.allSettled(urls.map((u) => c.add(new Request(u, { mode: 'no-cors' }))));
      }
    } catch (err) { /* offline al primo avvio: pazienza */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION && k !== TILE_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trimTiles() {
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  if (keys.length > TILE_LIMIT) {
    for (let i = 0; i < keys.length - TILE_LIMIT; i++) await c.delete(keys[i]);
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // API: sempre rete, mai cache (i tile della mappa TomTom invece si possono cacheare)
  if (/valhalla|nominatim|photon/.test(url.hostname)) return;
  if (url.hostname === 'api.tomtom.com' && url.pathname.indexOf('/map/') !== 0) return;

  // tile mappa
  const isTile = /tile\.openstreetmap\.org/.test(url.hostname) ||
    (url.hostname === 'api.tomtom.com' && url.pathname.indexOf('/map/') === 0) ||
    (url.hostname === 'tiles.openfreemap.org' && url.pathname.indexOf('/planet/') === 0);
  if (isTile) {
    e.respondWith((async () => {
      const c = await caches.open(TILE_CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) { c.put(req, res.clone()); trimTiles(); }
        return res;
      } catch (err) {
        return Response.error();
      }
    })());
    return;
  }

  // navigazione: rete se possibile, poi cache. Non salvare mai risposte d'errore.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === 'basic') await c.put('./index.html', res.clone());
        if (res && res.ok) return res;
        const hit = await c.match('./index.html', { ignoreSearch: true });
        if (hit) return hit;
        return res;
      } catch (err) {
        const hit = await c.match('./index.html', { ignoreSearch: true });
        return hit || Response.error();
      }
    })());
    return;
  }

  // asset: cache-first con aggiornamento in background
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(req, { ignoreSearch: false });
    const net = fetch(req).then(async (res) => {
      if (res && res.ok) await c.put(req, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await net) || Response.error();
  })());
});
