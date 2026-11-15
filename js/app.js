/* =========================================================================
   PasoMaps — app.js
   Corriere · giri a ciclo · percorsi SEMPRE senza autostrada
   ========================================================================= */
(function () {
  'use strict';

  /* =============================== A. UTIL =============================== */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  function toast(msg, kind) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.innerHTML = msg;
    box.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s, transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateY(-6px)'; }, 3200);
    setTimeout(() => el.remove(), 3600);
  }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { } }

  function fmtMeters(m) {
    if (m == null || !isFinite(m)) return '—';
    if (m < 1000) return Math.max(10, Math.round(m / 10) * 10) + ' m';
    const km = m / 1000;
    return (km < 10 ? km.toFixed(1) : String(Math.round(km))).replace('.', ',') + ' km';
  }
  function fmtKmVal(km) {
    if (km == null || !isFinite(km)) return '—';
    return (km < 10 ? km.toFixed(1) : String(Math.round(km))).replace('.', ',') + ' km';
  }
  function timeParts(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    if (sec <= 0) return { main: '0', unit: 'min' };
    if (sec < 60) return { main: '1', unit: 'min' };
    if (sec < 3600) return { main: String(Math.round(sec / 60)), unit: 'min' };
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return { main: h + 'h ' + String(m).padStart(2, '0'), unit: '' };
  }
  function clockIn(sec) {
    const d = new Date(Date.now() + Math.max(0, sec || 0) * 1000);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /* =============================== B. DATI =============================== */
  const DB_KEY = 'pasomaps.db.v1';
  const DEFAULT_TRUCK = { height: 2.8, width: 2.1, length: 6.0, weight: 3.5, axle_load: 1.8 };
  const DEFAULT_SETTINGS = { voice: true, brightness: 1, autoAdvance: true, trafficKey: '', tomtomKey: '', mapStyle: 4, mapProvider: 'openfreemap', lastGiroId: null };
  const PALETTE = ['#3b82f6', '#22d3ee', '#a78bfa', '#f472b6', '#f59e0b', '#34d399', '#60a5fa', '#fb7185', '#c084fc', '#facc15', '#2dd4bf', '#f97316', '#818cf8', '#4ade80'];
  const APP_BUILD = '1.34';
  const ROUTE_CACHE = 'pasomaps.route.';
  const NAV_CACHE = 'pasomaps.nav.';
  let offlineWarned = 0;

  let db = null;
  let saveTimer = null;

  function freshDB() {
    return { v: 2, truck: Object.assign({}, DEFAULT_TRUCK), settings: Object.assign({}, DEFAULT_SETTINGS), giri: [], sessions: {}, lastExport: 0 };
  }
  function migrate(d) {
    const f = freshDB();
    if (!d || typeof d !== 'object') return f;
    d.truck = Object.assign({}, f.truck, d.truck || {});
    const hadStyle = !!(d.settings && d.settings.mapStyle === 4);
    d.settings = Object.assign({}, f.settings, d.settings || {});
    if (!hadStyle) {
      // passaggio a MapLibre + OpenFreeMap (mappa vettoriale, 3D)
      d.settings.mapStyle = 4;
      d.settings.mapProvider = 'openfreemap';
    }
    d.giri = Array.isArray(d.giri) ? d.giri : [];
    d.giri.forEach((g) => {
      g.id = g.id || uid();
      g.name = g.name || 'Giro';
      g.city = g.city || '';
      g.color = g.color || PALETTE[0];
      g.stops = Array.isArray(g.stops) ? g.stops : [];
      g.stops.forEach((s) => { s.id = s.id || uid(); s.notes = s.notes || ''; s.name = s.name || ''; s.address = s.address || ''; });
    });
    if (!d.session || !d.session.giroId) d.session = null;
    else { d.session.done = d.session.done || {}; d.session.skipped = d.session.skipped || []; }
    // v2: sessioni multiple (una per giro per giorno) — non si perde il progresso cambiando giro
    d.sessions = (d.sessions && typeof d.sessions === 'object') ? d.sessions : {};
    if (d.session && d.session.giroId) {
      const k = d.session.giroId + '|' + (d.session.date || todayISO());
      if (!d.sessions[k]) d.sessions[k] = d.session;
    }
    delete d.session;
    d.v = 2;
    const cutoff = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
    Object.keys(d.sessions).forEach((k) => {
      const s = d.sessions[k];
      if (!s || !s.date || s.date < cutoff) { delete d.sessions[k]; return; }
      s.done = s.done || {}; s.skipped = s.skipped || [];
    });
    return d;
  }
  function loadDB() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) return migrate(JSON.parse(raw));
    } catch (e) { console.warn('DB non leggibile', e); }
    return freshDB();
  }
  function saveDB() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushDB, 250);
  }
  function flushDB() {
    clearTimeout(saveTimer); saveTimer = null;
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
    catch (e) { toast('Memoria del telefono piena: esporta un backup', 'bad'); }
  }

  /* =============================== C. GEO =============================== */
  const R_EARTH = 6371008.8;
  const toRad = (d) => d * Math.PI / 180;
  function hav(a, b) {
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lng - a.lng);
    const la1 = toRad(a.lat), la2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function decodePolyline(str, precision) {
    const factor = Math.pow(10, precision == null ? 6 : precision);
    let index = 0, lat = 0, lng = 0;
    const out = [];
    while (index < str.length) {
      let result = 0, shift = 0, b;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      result = 0; shift = 0;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);
      out.push({ lat: lat / factor, lng: lng / factor });
    }
    return out;
  }
  function withCum(coords) {
    const cum = [0];
    let d = 0;
    for (let i = 1; i < coords.length; i++) { d += hav(coords[i - 1], coords[i]); cum.push(d); }
    return { coords: coords, cum: cum, total: d };
  }
  function projectOnPath(path, p) {
    let best = { d: Infinity, along: 0, i: 0 };
    if (!path || path.coords.length < 2) return best;
    const kx = 111320 * Math.cos(toRad(p.lat)), ky = 110540;
    for (let i = 1; i < path.coords.length; i++) {
      const a = path.coords[i - 1], b = path.coords[i];
      const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky;
      const bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? clamp(-(ax * dx + ay * dy) / l2, 0, 1) : 0;
      const px = ax + t * dx, py = ay + t * dy;
      const d = Math.hypot(px, py);
      if (d < best.d) best = { d: d, along: path.cum[i - 1] + t * (path.cum[i] - path.cum[i - 1]), i: i };
    }
    return best;
  }

  /* =============================== D. ROUTING =============================== */
  const VH_ROUTE = 'https://valhalla1.openstreetmap.de/route';
  const MW_REF = /(^|[\s,\/])A\s?\d{1,2}(?![\d])/i;

  function arrowFor(type) {
    const map = {
      1: '↑', 2: '↑', 3: '↑', 4: '↑', 5: '↗', 6: '⬈', 7: '↖', 8: '⬉',
      9: '→', 10: '↱', 11: '⬈', 12: '↰', 13: '⬉', 14: '⚠', 15: '↪', 16: '↩',
      17: '↘', 18: '◀', 19: '⤴', 20: '⤵', 21: '🔄', 22: '↔', 23: '↰', 24: '↱',
      25: '↰', 26: '↱', 27: '⚠', 28: '🚏', 29: '⛴', 30: '🏁', 31: '↘', 32: '↗'
    };
    return map[type] || '↑';
  }

  function truckOptions() {
    const t = db.truck;
    return {
      height: +t.height || 3.2, width: +t.width || 2.2, length: +t.length || 6,
      weight: +t.weight || 35, axle_load: +t.axle_load || 11,
      use_highways: 0.0
    };
  }

  /* ---------- TomTom (traffico + camion), usato solo se c'è la chiave ---------- */
  const TT_ROUTE = 'https://api.tomtom.com/routing/1/calculateRoute/';
  const tomtomKey = () => ((db.settings.tomtomKey || '').trim());
  const tomtomReady = () => tomtomKey().length >= 20;
  let ttWarned = 0;

  function arrowTT(m) {
    const s = String(m || '').toUpperCase();
    if (/ROUNDABOUT/.test(s)) return '🔄';
    if (/UTURN/.test(s)) return '↩';
    if (/SHARP_LEFT|TURN_LEFT|KEEP_LEFT|RAMP_LEFT/.test(s) && !/RIGHT/.test(s)) return /SHARP/.test(s) ? '⬉' : '↰';
    if (/SHARP_RIGHT|TURN_RIGHT|KEEP_RIGHT|RAMP_RIGHT/.test(s) && !/LEFT/.test(s)) return /SHARP/.test(s) ? '⬈' : '↱';
    if (/SLIGHT_LEFT/.test(s)) return '↖';
    if (/SLIGHT_RIGHT/.test(s)) return '↗';
    if (/ARRIVE/.test(s)) return '🏁';
    if (/FERRY/.test(s)) return '⛴';
    return '↑';
  }

  function ttUrlParams(opts) {
    const t = db.truck;
    const p = new URLSearchParams();
    p.set('key', tomtomKey());
    p.set('travelMode', 'truck');
    p.set('traffic', 'true');
    p.append('avoid', 'motorways');
    p.set('routeType', opts.shortest ? 'shortest' : 'fastest');
    p.set('vehicleHeight', String(+t.height || 2.8));
    p.set('vehicleWidth', String(+t.width || 2.1));
    p.set('vehicleLength', String(+t.length || 6));
    p.set('vehicleWeight', String(Math.round((+t.weight || 3.5) * 1000)));
    p.set('vehicleAxleWeight', String(Math.round((+t.axle_load || 1.8) * 1000)));
    p.set('vehicleCommercial', 'true');
    p.set('language', 'it-IT');
    p.set('instructionsType', 'text');
    p.set('computeTravelTimeFor', 'all');
    p.append('sectionType', 'traffic');
    p.append('sectionType', 'motorway');
    return p;
  }

  async function requestRouteTomTom(points, opts) {
    const locs = points.map((p) => (+p.lat).toFixed(6) + ',' + (+p.lng).toFixed(6)).join(':');
    const res = await fetch(TT_ROUTE + locs + '/json?' + ttUrlParams(opts).toString());
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const e = await res.json(); msg += ' ' + ((e.detailedError && e.detailedError.message) || (e.error && e.error.description) || ''); } catch (e2) { }
      throw new Error(msg.trim());
    }
    return parseTomTom(await res.json());
  }

  function parseTomTom(j) {
    const route = (j.routes || [])[0];
    if (!route) throw new Error('nessun percorso');
    const all = [];
    const legs = [];
    (route.legs || []).forEach((leg) => {
      const pts = (leg.points || []).map((p) => ({ lat: p.latitude, lng: p.longitude }));
      pts.forEach((p) => {
        const last = all[all.length - 1];
        if (!last || last.lat !== p.lat || last.lng !== p.lng) all.push(p);
      });
      const path = withCum(pts);
      const sum = leg.summary || {};
      legs.push({
        coords: pts,
        cum: path.cum,
        total: path.total,
        maneuvers: [],
        km: sum.lengthInMeters != null ? sum.lengthInMeters / 1000 : path.total / 1000,
        sec: sum.travelTimeInSeconds || 0,
        delay: sum.trafficDelayInSeconds || 0,
        highway: false,
        toll: false
      });
    });
    if (!legs.length) throw new Error('nessuna gamba');
    const ins = (route.guidance && route.guidance.instructions) || [];
    if (legs.length === 1) {
      legs[0].maneuvers = ins.map((m) => ({
        type: m.maneuver,
        text: m.message || m.instruction || '',
        verbal: m.message || m.instruction || '',
        arrow: arrowTT(m.maneuver),
        along: m.routeOffsetInMeters || 0,
        length: 0,
        refs: '',
        names: m.street || ''
      })).filter((m) => m.text);
    }
    const sections = [];
    let motorway = 0;
    (route.sections || []).forEach((s) => {
      if (s.sectionType === 'TRAFFIC') {
        sections.push({ from: s.startPointIndex || 0, to: s.endPointIndex || 0, mag: s.magnitudeOfDelay || 1, delay: s.delayInSeconds || 0 });
      } else if (s.sectionType === 'MOTORWAY') motorway++;
    });
    const sum = route.summary || {};
    return {
      legs: legs,
      coords: all,
      sections: sections,
      source: 'tomtom',
      km: sum.lengthInMeters != null ? sum.lengthInMeters / 1000 : legs.reduce((a, l) => a + l.km, 0),
      sec: sum.travelTimeInSeconds || legs.reduce((a, l) => a + l.sec, 0),
      trafficDelay: sum.trafficDelayInSeconds || 0,
      highway: motorway > 0,
      motorwayWarning: motorway > 0
    };
  }

  async function verifyTomTomKey(key) {
    try {
      const url = TT_ROUTE + '45.4384,10.9916:45.5455,11.5353/json?key=' + encodeURIComponent(key) +
        '&travelMode=car&traffic=true&computeTravelTimeFor=all';
      const res = await fetch(url);
      if (!res.ok) {
        let detail = '';
        try { const e = await res.json(); detail = (e.detailedError && e.detailedError.message) || ''; } catch (e2) { }
        return { ok: false, msg: 'HTTP ' + res.status + (detail ? ' · ' + detail : '') };
      }
      const j = await res.json();
      const s = j.routes && j.routes[0] && j.routes[0].summary;
      if (!s) return { ok: false, msg: 'risposta senza percorso' };
      return { ok: true, km: Math.round(s.lengthInMeters / 1000), min: Math.round(s.travelTimeInSeconds / 60), delay: Math.round((s.trafficDelayInSeconds || 0) / 60) };
    } catch (e) {
      return { ok: false, msg: e.message || 'rete bloccata' };
    }
  }

  async function requestRoute(points, opts) {
    opts = opts || {};
    if (tomtomReady()) {
      try { return await requestRouteTomTom(points, opts); }
      catch (e) {
        const now = Date.now();
        if (now - ttWarned > 60000) {
          ttWarned = now;
          toast('TomTom non risponde (' + esc(e.message || 'errore') + '): uso il percorso senza traffico', 'bad');
        }
      }
    }
    const body = {
      locations: points.map((p) => ({ lat: +p.lat, lon: +p.lng, type: 'break' })),
      costing: 'truck',
      costing_options: { truck: truckOptions() },
      units: 'kilometers',
      language: 'it-IT',
      directions_options: { units: 'kilometers', language: { text_locale: 'it-IT' } }
    };
    if (opts.shortest) body.shortest = true;
    const res = await fetch(VH_ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      let detail = '';
      try { const e = await res.json(); detail = (e && (e.error || e.error_code)) || ''; } catch (e2) { }
      throw new Error('Routing ' + res.status + (detail ? ' · ' + detail : ''));
    }
    return parseTrip(await res.json());
  }

  function parseTrip(j) {
    const legs = ((j.trip && j.trip.legs) || []).map((leg) => {
      const coords = decodePolyline(leg.shape, 6);
      const path = withCum(coords);
      const maneuvers = (leg.maneuvers || []).map((m) => {
        const b = clamp(m.begin_shape_index || 0, 0, Math.max(0, coords.length - 1));
        return {
          type: m.type,
          text: m.instruction || '',
          verbal: m.verbal_pre_transition_instruction || m.verbal_succinct_transition_instruction || m.instruction || '',
          arrow: arrowFor(m.type),
          along: path.cum[b] || 0,
          length: (m.length || 0) * 1000,
          refs: (m.ref || []).join(' '),
          names: (m.street_names || []).join(' ')
        };
      });
      return {
        coords: coords,
        cum: path.cum,
        total: path.total,
        maneuvers: maneuvers,
        km: typeof leg.summary.length === 'number' ? leg.summary.length : path.total / 1000,
        sec: leg.summary.time || 0,
        highway: !!leg.summary.has_highway,
        toll: !!leg.summary.has_toll
      };
    });
    const sum = (j.trip && j.trip.summary) || {};
    const all = [];
    legs.forEach((l) => l.coords.forEach((p) => {
      const last = all[all.length - 1];
      if (!last || last.lat !== p.lat || last.lng !== p.lng) all.push(p);
    }));
    return {
      legs: legs,
      coords: all,
      sections: [],
      km: sum.length || legs.reduce((a, l) => a + l.km, 0),
      sec: sum.time || legs.reduce((a, l) => a + l.sec, 0),
      trafficDelay: 0,
      highway: !!sum.has_highway || legs.some((l) => l.highway)
    };
  }

  // controllo extra: refs tipo "A4" nei passaggi
  function legTouchesMotorway(leg) {
    for (const m of leg.maneuvers) {
      if (MW_REF.test(m.refs || '')) return true;
      if (/autostrada/i.test(m.names || '')) return true;
    }
    return false;
  }

  const MAX_LOCATIONS = 10; // limite del server pubblico Valhalla

  async function routePoints(points, opts) {
    opts = opts || {};
    if (points.length < 2) throw new Error('Servono almeno due punti');
    const maxLoc = tomtomReady() ? 100 : MAX_LOCATIONS;
    if (points.length <= maxLoc) {
      let r = await requestRoute(points, opts);
      let bad = r.highway || r.legs.some(legTouchesMotorway);
      if (bad && !opts.shortest) {
        // secondo tentativo: percorso più corto (tende a stare sulle statali)
        try {
          const r2 = await requestRoute(points, { shortest: true });
          if (!r2.highway && !r2.legs.some(legTouchesMotorway)) { r2.retry = true; return r2; }
        } catch (e) { }
      }
      r.motorwayWarning = !!(r.highway || r.legs.some(legTouchesMotorway));
      return r;
    }
    // molti punti: il server accetta max 10 locations per richiesta
    let legs = [], km = 0, sec = 0, motorwayWarning = false;
    for (let i = 0; i < points.length - 1; i += maxLoc - 1) {
      const slice = points.slice(i, Math.min(i + maxLoc, points.length));
      const r = await routePoints(slice, opts);
      legs = legs.concat(r.legs);
      km += r.km; sec += r.sec;
      motorwayWarning = motorwayWarning || r.motorwayWarning || r.highway;
    }
    return { legs: legs, km: km, sec: sec, highway: false, motorwayWarning: motorwayWarning };
  }

  /* =============================== E. MAPPA (MapLibre GL) =============================== */
  const TILES_OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const TILES_TT = 'https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=';
  const STYLE_OFM = 'https://tiles.openfreemap.org/styles/bright';
  const OFM_ATTRIB = '&copy; OpenFreeMap &copy; OpenMapTiles &copy; OpenStreetMap';

  let map = null;
  let stopMarkers = [];
  let meMarker = null;
  let ttTileErrors = 0;

  function mapProvider() {
    if (db.settings.mapProvider === 'openfreemap') return 'openfreemap';
    if (db.settings.mapProvider === 'tomtom' && tomtomReady()) return 'tomtom';
    return 'osm';
  }

  function rasterStyle(url, attribution) {
    return {
      version: 8,
      sources: { base: { type: 'raster', tiles: [url], tileSize: 256, maxzoom: 19, attribution: attribution } },
      layers: [{ id: 'base', type: 'raster', source: 'base' }]
    };
  }

  function styleForProvider() {
    const p = mapProvider();
    if (p === 'tomtom') return rasterStyle(TILES_TT + encodeURIComponent(tomtomKey()), '&copy; TomTom');
    if (p === 'osm') return rasterStyle(TILES_OSM, '&copy; OpenStreetMap contributors');
    return STYLE_OFM;
  }

  const canPitch = () => mapProvider() === 'openfreemap';
  const emptyFC = () => ({ type: 'FeatureCollection', features: [] });

  function firstSymbolLayer() {
    try {
      const l = (map.getStyle().layers || []).find((x) => x.type === 'symbol');
      return l ? l.id : undefined;
    } catch (e) { return undefined; }
  }

  function ensureRouteLayers() {
    if (!map) return false;
    const before = firstSymbolLayer();
    try {
      if (!map.getSource('route')) {
        map.addSource('route', { type: 'geojson', data: emptyFC() });
        map.addLayer({ id: 'route-halo', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'base'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0b2a63', 'line-width': 9, 'line-opacity': 0.45 } }, before);
        map.addLayer({ id: 'route-main', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'base'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#3b82f6', 'line-width': 5, 'line-opacity': 0.98 } }, before);
        map.addLayer({ id: 'route-traffic', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'traffic'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 5 } }, before);
      }
      if (!map.getSource('nav')) {
        map.addSource('nav', { type: 'geojson', data: emptyFC() });
        map.addLayer({ id: 'nav-halo', type: 'line', source: 'nav', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.2 } }, before);
        map.addLayer({ id: 'nav-main', type: 'line', source: 'nav', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#38bdf8', 'line-width': 6 } }, before);
        map.addLayer({ id: 'nav-traffic', type: 'line', source: 'nav', filter: ['==', ['get', 'kind'], 'traffic'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 6 } }, before);
      }
      return true;
    } catch (e) { return false; }
  }

  function applyMapLayer() {
    if (!map) return;
    ttTileErrors = 0;
    try { map.setStyle(styleForProvider()); }
    catch (e) { console.warn('style', e); }
  }

  function clearRouteSource() {
    if (map && map.getSource('route')) map.getSource('route').setData(emptyFC());
  }
  function clearNavSource() {
    if (map && map.getSource('nav')) map.getSource('nav').setData(emptyFC());
  }

  function pointAtAlong(path, along) {
    along = clamp(along, 0, path.total);
    let i = 1;
    while (i < path.cum.length - 1 && path.cum[i] < along) i++;
    const a = path.coords[i - 1], b = path.coords[i];
    const seg = (path.cum[i] - path.cum[i - 1]) || 1;
    const t = clamp((along - path.cum[i - 1]) / seg, 0, 1);
    return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  }

  function bearingBetween(a, b) {
    const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
    const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function bearingAt(path, p) {
    const pr = projectOnPath(path, p);
    const a = pointAtAlong(path, Math.max(0, pr.along - 8));
    const b = pointAtAlong(path, Math.min(path.total, pr.along + 30));
    return bearingBetween(a, b);
  }

  function ensureMap() {
    if (map) return map;
    map = new maplibregl.Map({
      container: 'map',
      style: styleForProvider(),
      center: [12.4, 42.2],
      zoom: 6,
      attributionControl: false,
      renderWorldCopies: false
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    const collapseAttrib = () => {
      try { const el = map.getContainer().querySelector('.maplibregl-ctrl-attrib'); if (el) el.classList.remove('maplibregl-compact-show'); } catch (e) { }
    };
    map.on('load', collapseAttrib);
    setTimeout(collapseAttrib, 1200);
    map.on('load', () => { ensureRouteLayers(); redrawMap(); });
    map.on('style.load', () => { ensureRouteLayers(); redrawMap(); });
    map.once('idle', () => { ensureRouteLayers(); redrawMap(); });
    map.on('dragstart', () => { S.follow = false; });
    map.on('error', (e) => {
      if (mapProvider() !== 'tomtom') return;
      if (e && e.sourceId === 'base') {
        ttTileErrors++;
        if (ttTileErrors >= 4) {
          db.settings.mapProvider = 'openfreemap';
          saveDB();
          applyMapLayer();
          toast('Le mappe TomTom non rispondono: torno a OpenFreeMap', 'bad');
        }
      }
    });
    return map;
  }

  function pinEl(num, state) {
    const d = document.createElement('div');
    const cls = 'pin' + (state === 'cur' ? ' cur' : state === 'done' ? ' done' : state === 'skip' ? ' skip' : state === 'plain' ? ' plain' : '');
    d.className = cls;
    const s = document.createElement('span');
    s.textContent = state === 'done' ? '✓' : state === 'skip' ? '–' : String(num);
    d.appendChild(s);
    return d;
  }

  /* =============================== F. STATO SCHERMATA =============================== */
  const S = {
    giro: null,
    session: null,
    preview: null,
    shownRoute: null,
    previewFromMe: false,
    previewAlt: null,
    altOn: false,
    navRoute: null,
    me: null,
    computing: false,
    pendingCompute: false,
    pendingStop: null
  };
  const Nav = { active: false, watchId: null, route: null, busy: false, offCount: 0, spoken: {}, target: null };

  const hasCoords = (s) => !!s && s.lat != null && s.lng != null && isFinite(+s.lat) && isFinite(+s.lng);

  function activeStops() {
    if (!S.giro) return [];
    const sess = S.session || { done: {}, skipped: [] };
    return S.giro.stops.filter((s) => hasCoords(s) && !sess.done[s.id] && sess.skipped.indexOf(s.id) === -1);
  }
  function stopIndexLabel(id) {
    const i = (S.giro ? S.giro.stops : []).findIndex((s) => s.id === id);
    return i + 1;
  }

  /* =============================== G. HOME =============================== */
  function showScreen(name) {
    $('#s-home').classList.toggle('on', name === 'home');
    $('#s-giro').classList.toggle('on', name === 'giro');
  }
  function pushState(v) { try { history.pushState({ pm: v }, ''); } catch (e) { } }
  let ignorePop = false;
  function goHome() {
    if (Nav.active) stopNav(true);
    closeSheet(false);
    flushDB();
    showScreen('home');
    renderHome();
    S.giro = null;
    S.preview = null;
    S.shownRoute = null;
  }

  function renderHome() {
    const box = $('#giri-list');
    $('#btn-cycle').hidden = false;
    if (!db.giri.length) {
      box.innerHTML = '<div class="empty">Non hai ancora nessun giro.<br><br>Tocca <b>+ Nuovo giro</b>, dagli un nome (es. “Lunedì 1ª settimana”), indica la zona e aggiungi le tappe.<br><br>Ogni giro resta salvato e lo ritrovi uguale tra due settimane.</div>';
      return;
    }
    const today = todayISO();
    box.innerHTML = db.giri.map((g) => {
      const sess = (db.sessions && db.sessions[g.id + '|' + today]) || null;
      const done = sess ? Object.keys(sess.done).length : 0;
      const skipped = sess ? sess.skipped.length : 0;
      const left = Math.max(0, g.stops.length - done - skipped);
      const city = g.city || (g.stops[0] && g.stops[0].address ? g.stops[0].address.split(',').slice(-2).join(',').trim() : 'Zona non indicata');
      return '<div class="giro-card" data-open="' + g.id + '" role="button" tabindex="0">' +
        '<span class="bar" style="background:' + esc(g.color) + '"></span>' +
        '<span class="main">' +
        '<span class="name">' + esc(g.name) + '</span>' +
        '<span class="city">' + esc(city) + '</span>' +
        '<span class="meta">' +
        '<span class="tag">' + g.stops.length + (g.stops.length === 1 ? ' tappa' : ' tappe') + '</span>' +
        (sess ? '<span class="tag live">in corso · ' + left + ' da fare</span>' : '') +
        (!g.stops.length ? '<span class="tag warn">da impostare</span>' : '') +
        '</span>' +
        '</span>' +
        '<button class="card-edit" data-edit="' + g.id + '" aria-label="Modifica giro">✎</button>' +
        '</div>';
    }).join('');
    $$('.giro-card', box).forEach((el) => {
      el.addEventListener('click', (e) => {
        if (el.__lp) { el.__lp = false; return; }
        const editId = e.target.closest('[data-edit]');
        if (editId) { openGiroModal(db.giri.find((g) => g.id === editId.getAttribute('data-edit'))); return; }
        openGiro(el.getAttribute('data-open'));
      });
      // pressione lunga = modifica giro
      let t = null;
      el.addEventListener('pointerdown', () => {
        t = setTimeout(() => {
          t = null; el.__lp = true;
          openGiroModal(db.giri.find((g) => g.id === el.getAttribute('data-open')));
        }, 650);
      });
      el.addEventListener('pointerup', () => { if (t) clearTimeout(t); });
      el.addEventListener('pointercancel', () => { if (t) clearTimeout(t); });
      el.addEventListener('pointermove', () => { if (t) { clearTimeout(t); t = null; } });
    });
  }

  /* =============================== H. APRI GIRO =============================== */
  function openGiro(id) {
    const g = db.giri.find((x) => x.id === id);
    if (!g) return;
    S.giro = g;
    const today = todayISO();
    if (!db.sessions) db.sessions = {};
    const skey = g.id + '|' + today;
    if (!db.sessions[skey]) {
      db.sessions[skey] = { giroId: g.id, date: today, done: {}, skipped: [], startedAt: Date.now() };
    }
    S.session = db.sessions[skey];
    db.settings.lastGiroId = g.id;
    saveDB();
    S.preview = null; S.previewAlt = null; S.altOn = false;
    Nav.route = null;
    showScreen('giro');
    pushState('giro');
    ensureMap();
    try { map.easeTo({ pitch: 0, bearing: 0, duration: 0 }); } catch (e) { }
    setTimeout(() => { try { if (map) map.resize(); } catch (e) { } }, 90);
    renderGiroChrome();
    renderStops();
    drawMarkers();
    updateMeMarker();
    updateEta();
    const cached = loadRouteCache(g.id);
    if (cached) {
      S.preview = cached; S.shownRoute = cached; S.previewFromMe = !!cached.fromMe;
      drawPreview(cached);
      setRouteState('Ultimo percorso salvato · ' + fmtKmVal(cached.km) + ' · ' + timeParts(cached.sec).main + ' ' + timeParts(cached.sec).unit, '');
      updateEta(); renderStops();
    }
    computePreview(true);
    if (!g.stops.length) {
      setTimeout(() => openStopEditor(null, {}), 220);
    }
  }

  function renderGiroChrome() {
    const g = S.giro;
    if (!g) return;
    $('#giro-name').textContent = g.name;
    const done = S.session ? Object.keys(S.session.done).length : 0;
    const skipped = S.session ? S.session.skipped.length : 0;
    const city = g.city || '';
    $('#giro-city').textContent = [city, g.stops.length + ' tappe', done ? done + ' fatte' : '', skipped ? skipped + ' saltate' : '']
      .filter(Boolean).join(' · ') || 'nessuna tappa';
    $('#fab-badge').textContent = activeStops().length;
  }

  /* =============================== I. PERCORSO =============================== */
  function routeStartPoints() {
    const stops = activeStops();
    const fromMe = !!(S.me && (Date.now() - S.me.ts) < 10 * 60 * 1000);
    if (!stops.length) return { points: [], fromMe: false };
    if (!fromMe) return { points: stops.map(stopPoint), fromMe: false };
    if (hav(S.me, stopPoint(stops[0])) < 45) return { points: stops.map(stopPoint), fromMe: false };
    return { points: [stopPoint(S.me)].concat(stops.map(stopPoint)), fromMe: true };
  }
  const stopPoint = (s) => ({ lat: s.lat, lng: s.lng });

  function setRouteState(text, cls) {
    const el = $('#route-state');
    el.textContent = text;
    el.className = 'map-hint' + (cls ? ' ' + cls : '');
    el.classList.remove('hide');
  }

  async function computePreview(fit) {
    if (!S.giro) return;
    if (S.computing) { S.pendingCompute = true; return; }
    const stops = activeStops();
    if (!stops.length) {
      S.preview = null; S.shownRoute = null;
      clearRouteSource();
      setRouteState('Nessuna tappa da fare: aggiungi o ripristina una tappa', 'good');
      updateEta();
      return;
    }
    if (stops.some((s) => !hasCoords(s))) {
      setRouteState('Alcune tappe non hanno un indirizzo valido: aprile e correggile', 'bad');
      return;
    }
    const start = routeStartPoints();
    if (start.points.length < 2) {
      S.preview = null; S.shownRoute = null;
      clearRouteSource();
      setRouteState('Una sola tappa: aggiungine un’altra, oppure tocca ➤ per navigare verso questa', '');
      updateEta();
      return;
    }
    S.computing = true;
    setRouteState('Calcolo percorso senza autostrada…');
    try {
      const r = await routePoints(start.points);
      if (!S.giro) return;
      S.preview = r;
      S.shownRoute = r;
      S.previewFromMe = start.fromMe;
      S.altOn = false; S.previewAlt = null;
      drawPreview(r);
      saveRouteCache(S.giro, r);
      const hw = r.motorwayWarning;
      const tt = r.source === 'tomtom';
      const trafficTxt = tt ? (r.trafficDelay > 90 ? 'traffico +' + Math.round(r.trafficDelay / 60) + ' min' : 'traffico ok') : 'senza traffico';
      setRouteState(
        fmtKmVal(r.km) + ' · ' + timeParts(r.sec).main + (timeParts(r.sec).unit ? ' ' + timeParts(r.sec).unit : '') +
        ' · ' + (hw ? '⚠ possibile tratto autostradale, controlla' : 'senza autostrada ✓') +
        ' · ' + trafficTxt,
        hw ? 'warn' : ''
      );
      updateEta(); renderStops();
      if (fit && !Nav.active) fitAll();
    } catch (e) {
      console.warn(e);
      const cached = S.preview && S.preview.cached ? S.preview : loadRouteCache(S.giro.id);
      if (cached) {
        S.preview = cached; S.shownRoute = cached; S.previewFromMe = !!cached.fromMe;
        drawPreview(cached);
        setRouteState('Senza rete · ultimo percorso salvato (' + fmtKmVal(cached.km) + ' · ' + timeParts(cached.sec).main + ' ' + timeParts(cached.sec).unit + ')', 'warn');
        updateEta(); renderStops();
        if (Date.now() - offlineWarned > 60000) {
          offlineWarned = Date.now();
          toast('Nessuna rete: uso l’ultimo percorso salvato', 'bad');
        }
      } else {
        S.preview = null; S.shownRoute = null;
        setRouteState('Nessuna rete e nessun percorso salvato · tocca per riprovare', 'bad');
        updateEta();
      }
    } finally {
      S.computing = false;
      if (S.pendingCompute) { S.pendingCompute = false; setTimeout(() => computePreview(false), 60); }
    }
  }

  function trafficColor(delaySec) {
    if (delaySec >= 300) return '#ef4444';   // oltre 5 min di ritardo
    if (delaySec >= 120) return '#f97316';   // 2-5 min
    if (delaySec >= 30) return '#f59e0b';    // mezzo minuto - 2 min
    return null;                             // nessun ritardo: percorso resta blu
  }

  function routeFeatures(r, prefix) {
    const feats = [];
    let pts = [];
    if (r.coords && r.coords.length > 1) {
      pts = r.coords.map((c) => [+c.lng.toFixed(6), +c.lat.toFixed(6)]);
    } else if (r.legs) {
      r.legs.forEach((l) => l.coords.forEach((c, i) => { if (i === 0 && pts.length) return; pts.push([+c.lng.toFixed(6), +c.lat.toFixed(6)]); }));
    }
    if (pts.length < 2) return feats;
    feats.push({ type: 'Feature', properties: { kind: 'base' }, geometry: { type: 'LineString', coordinates: pts } });
    (r.sections || []).forEach((s) => {
      const col = trafficColor(s.delay || 0);
      if (!col) return;
      const seg = (r.coords || []).slice(Math.max(0, s.from), Math.min((r.coords || []).length, s.to + 1))
        .map((c) => [+c.lng.toFixed(6), +c.lat.toFixed(6)]);
      if (seg.length < 2) return;
      feats.push({ type: 'Feature', properties: { kind: 'traffic', color: col }, geometry: { type: 'LineString', coordinates: seg } });
    });
    return feats;
  }

  function drawPreview(r) {
    if (!map) return;
    if (!map.getSource('route') && !ensureRouteLayers()) return;
    try { map.getSource('route').setData({ type: 'FeatureCollection', features: routeFeatures(r) }); } catch (e) { }
  }

  function drawNav(leg) {
    if (!map) return;
    if (!map.getSource('nav') && !ensureRouteLayers()) return;
    try { map.getSource('nav').setData({ type: 'FeatureCollection', features: routeFeatures(leg) }); } catch (e) { }
  }

  function drawMarkers() {
    if (!map || !S.giro) return;
    stopMarkers.forEach((m) => { try { m.remove(); } catch (e) { } });
    stopMarkers = [];
    const act = activeStops();
    S.giro.stops.forEach((st) => {
      if (!hasCoords(st)) return;
      let state = 'plain';
      if (S.session && S.session.done[st.id]) state = 'done';
      else if (S.session && S.session.skipped.indexOf(st.id) !== -1) state = 'skip';
      else if (act.length && act[0].id === st.id) state = 'cur';
      const el = pinEl(stopIndexLabel(st.id), state);
      el.addEventListener('click', (ev) => { ev.stopPropagation(); openStopEditor(st.id, {}); });
      const m = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([st.lng, st.lat]).addTo(map);
      stopMarkers.push(m);
    });
  }

  function updateMeMarker() {
    if (meMarker) { try { meMarker.remove(); } catch (e) { } meMarker = null; }
    if (!map || !S.me) return;
    const pos = (Nav.active && S.meSnap) ? S.meSnap : S.me;
    const el = document.createElement('div');
    el.className = 'me';
    meMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([pos.lng, pos.lat]).addTo(map);
  }

  function redrawMap() {
    if (!map) return;
    if (S.shownRoute) drawPreview(S.shownRoute);
    if (Nav.route) drawNav(Nav.route);
    drawMarkers();
    updateMeMarker();
  }

  function clearLayer() { /* compatibilità: le sorgenti MapLibre si svuotano con setData */ }

  /* ---------- cache del percorso: l'app resta utile senza rete ---------- */
  function saveRouteCache(g, r) {
    if (!g || !r || !r.coords || r.coords.length < 2) return;
    try {
      let coords = r.coords;
      let sections = r.sections || [];
      if (coords.length > 6000) { coords = coords.filter((c, i) => i % 2 === 0); sections = []; }
      const payload = {
        at: Date.now(),
        km: r.km, sec: r.sec,
        trafficDelay: r.trafficDelay || 0,
        source: r.source || 'valhalla',
        fromMe: !!S.previewFromMe,
        coords: coords.map((c) => [+c.lat.toFixed(5), +c.lng.toFixed(5)]),
        sections: sections.map((s) => ({ from: s.from, to: s.to, mag: s.mag, delay: s.delay })),
        legs: r.legs.map((l) => ({ km: l.km, sec: l.sec, total: l.total }))
      };
      localStorage.setItem(ROUTE_CACHE + g.id, JSON.stringify(payload));
    } catch (e) { console.warn('cache percorso', e); }
  }

  function loadRouteCache(id) {
    try {
      const raw = localStorage.getItem(ROUTE_CACHE + id);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p || !Array.isArray(p.coords) || p.coords.length < 2) return null;
      const coords = p.coords.map((c) => ({ lat: c[0], lng: c[1] }));
      return {
        cached: true,
        at: p.at,
        coords: coords,
        sections: p.sections || [],
        km: p.km,
        sec: p.sec,
        trafficDelay: p.trafficDelay || 0,
        source: p.source,
        fromMe: !!p.fromMe,
        legs: (p.legs || []).map((l) => ({
          km: l.km, sec: l.sec, total: l.total || l.km * 1000,
          coords: [], cum: [], maneuvers: [], highway: false, toll: false, delay: 0
        })),
        highway: false,
        motorwayWarning: false
      };
    } catch (e) { return null; }
  }

  function pruneRouteCache() {
    try {
      const ids = new Set((db.giri || []).map((g) => g.id));
      Object.keys(localStorage).forEach((k) => {
        const isRoute = k.indexOf(ROUTE_CACHE) === 0;
        const isNav = k.indexOf(NAV_CACHE) === 0;
        if (!isRoute && !isNav) return;
        const id = k.slice((isRoute ? ROUTE_CACHE : NAV_CACHE).length);
        if (!ids.has(id)) localStorage.removeItem(k);
      });
    } catch (e) { }
  }

  function saveNavCache(leg) {
    if (!S.giro || !leg || !leg.dest || !leg.coords || leg.coords.length < 2) return;
    try {
      const payload = {
        at: Date.now(),
        destId: leg.dest.id,
        destName: leg.dest.name || leg.dest.address || '',
        total: leg.total, km: leg.km, sec: leg.sec, delay: leg.delay || 0,
        coords: leg.coords.map((c) => [+c.lat.toFixed(5), +c.lng.toFixed(5)]),
        maneuvers: (leg.maneuvers || []).map((m) => ({ along: Math.round(m.along), text: m.text, verbal: m.verbal, arrow: m.arrow })),
        sections: (leg.sections || []).map((s) => ({ from: s.from, to: s.to, mag: s.mag, delay: s.delay }))
      };
      localStorage.setItem(NAV_CACHE + S.giro.id, JSON.stringify(payload));
    } catch (e) { }
  }

  function loadNavCache(giroId) {
    try {
      const raw = localStorage.getItem(NAV_CACHE + giroId);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p || !Array.isArray(p.coords) || p.coords.length < 2) return null;
      const coords = p.coords.map((c) => ({ lat: c[0], lng: c[1] }));
      const path = withCum(coords);
      return {
        cached: true,
        destId: p.destId,
        destName: p.destName,
        coords: coords,
        cum: path.cum,
        total: path.total,
        km: p.km,
        sec: p.sec,
        delay: p.delay || 0,
        maneuvers: p.maneuvers || [],
        sections: p.sections || [],
        highway: false, toll: false
      };
    } catch (e) { return null; }
  }

  function fitAll() {
    if (!map) return;
    const pts = [];
    if (S.shownRoute && S.shownRoute.coords && S.shownRoute.coords.length > 1) {
      S.shownRoute.coords.forEach((c) => pts.push([c.lat, c.lng]));
    } else if (S.shownRoute) {
      S.shownRoute.legs.forEach((l) => l.coords.forEach((c) => pts.push([c.lat, c.lng])));
    }
    if (!pts.length && S.giro) S.giro.stops.forEach((s) => { if (hasCoords(s)) pts.push([s.lat, s.lng]); });
    if (S.me) pts.push([S.me.lat, S.me.lng]);
    if (!pts.length) return;
    if (pts.length === 1) { map.easeTo({ center: [pts[0][1], pts[0][0]], zoom: 16, duration: 0 }); return; }
    const lngs = pts.map((p) => p[1]), lats = pts.map((p) => p[0]);
    map.fitBounds([[Math.min.apply(null, lngs), Math.min.apply(null, lats)], [Math.max.apply(null, lngs), Math.max.apply(null, lats)]],
      { padding: { top: 90, bottom: 70, left: 42, right: 42 }, maxZoom: 16, duration: 0 });
  }

  /* ---------- scelta manuale del pin (civico non presente nella mappa) ---------- */
  function openPinPicker(start, onPick) {
    const wrap = document.createElement('div');
    wrap.id = 'pinpicker';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:90;display:flex;flex-direction:column;background:#0b1220';
    wrap.innerHTML =
      '<div style="padding:14px 16px;background:#0f1728;color:#eaf1ff;font:600 14px system-ui">' +
      'Posiziona il pin sul punto esatto' +
      '<div style="font-weight:400;color:#93a3bd;font-size:12px;margin-top:3px">Trascina la mappa e tocca il portone, oppure trascina il pin.</div></div>' +
      '<div id="pinmap" style="flex:1;min-height:0"></div>' +
      '<div style="display:flex;gap:9px;padding:12px 14px calc(14px + env(safe-area-inset-bottom,0px));background:#0f1728">' +
      '<button id="pin-cancel" style="flex:1;padding:14px;border-radius:14px;border:1px solid #2b3a55;background:#131c2e;color:#eaf1ff;font:600 14px system-ui">Annulla</button>' +
      '<button id="pin-ok" style="flex:1;padding:14px;border-radius:14px;border:0;background:linear-gradient(145deg,#1d4ed8,#2563eb);color:#fff;font:700 14px system-ui">Usa questa posizione</button></div>';
    document.body.appendChild(wrap);
    const pm = new maplibregl.Map({
      container: 'pinmap',
      style: styleForProvider(),
      center: [start.lng, start.lat],
      zoom: 17,
      attributionControl: false
    });
    pm.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    setTimeout(() => { try { const el = pm.getContainer().querySelector('.maplibregl-ctrl-attrib'); if (el) el.classList.remove('maplibregl-compact-show'); } catch (e) { } }, 800);
    const marker = new maplibregl.Marker({ draggable: true, color: '#2563eb' })
      .setLngLat([start.lng, start.lat]).addTo(pm);
    setTimeout(() => { try { pm.resize(); } catch (e) { } }, 120);
    const close = () => { try { pm.remove(); } catch (e) { } wrap.remove(); };
    document.getElementById('pin-cancel').onclick = close;
    document.getElementById('pin-ok').onclick = () => {
      const p = marker.getLngLat();
      close();
      onPick(p.lat, p.lng);
    };
  }

  /* =============================== J. ETA =============================== */
  function updateEta() {
    const act = activeStops();
    $('#fab-badge').textContent = act.length;
    if (!act.length) {
      const any = S.giro && S.giro.stops ? S.giro.stops.length : 0;
      const noPos = (S.giro && S.giro.stops) ? S.giro.stops.filter((s) => !hasCoords(s)).length : 0;
      if (!any) {
        $('#eta-label').textContent = 'Nessuna tappa';
        $('#eta-time').textContent = '+';
        $('#eta-unit').textContent = '';
        $('#eta-km').textContent = '0 tappe';
        $('#eta-arr').textContent = '';
        $('#eta-stop').textContent = 'Aggiungi la prima tappa con “+ Aggiungi”';
      } else if (noPos === any) {
        $('#eta-label').textContent = 'Tappe senza posizione';
        $('#eta-time').textContent = '!';
        $('#eta-unit').textContent = '';
        $('#eta-km').textContent = noPos + ' tappe';
        $('#eta-arr').textContent = '';
        $('#eta-stop').textContent = 'Apri Tappe → “Riprova indirizzi mancanti”';
      } else {
        $('#eta-label').textContent = 'Giro finito';
        $('#eta-time').textContent = '✓';
        $('#eta-unit').textContent = '';
        $('#eta-km').textContent = any + ' tappe';
        $('#eta-arr').textContent = 'tutte fatte';
        $('#eta-stop').textContent = 'Nessuna tappa rimasta';
      }
      const sep = $('.eta-sub .sep');
      if (sep) sep.style.display = $('#eta-arr').textContent ? '' : 'none';
      $('#btn-nav').disabled = true;
      $('#btn-nav').style.opacity = '.35';
      return;
    }
    const sep2 = $('.eta-sub .sep');
    if (sep2) sep2.style.display = '';
    $('#btn-nav').disabled = false;
    $('#btn-nav').style.opacity = '1';
    const st = act[0];
    $('#eta-stop').textContent = st.name || st.address || 'Tappa';
    let km = null, sec = null, label = 'Prossima tappa';

    if (S.shownRoute && S.shownRoute.legs.length) {
      if (S.previewFromMe) {
        const leg = S.shownRoute.legs[0];
        km = leg.total / 1000; sec = leg.sec;
        label = 'Prossima tappa';
      } else {
        const tot = S.shownRoute.legs.reduce((a, l) => ({ km: a.km + l.km, sec: a.sec + l.sec }), { km: 0, sec: 0 });
        km = tot.km; sec = tot.sec;
        label = 'Totale giro';
      }
    }
    if (km == null) {
      $('#eta-label').textContent = label;
      $('#eta-time').textContent = '--';
      $('#eta-unit').textContent = 'min';
      $('#eta-km').textContent = '-- km';
      $('#eta-arr').textContent = '--:--';
      return;
    }
    const tp = timeParts(sec);
    $('#eta-label').textContent = label;
    $('#eta-time').textContent = tp.main;
    $('#eta-unit').textContent = tp.unit;
    $('#eta-km').textContent = fmtKmVal(km);
    $('#eta-arr').textContent = 'arrivo ' + clockIn(sec);
    let delayShow = 0;
    if (S.previewFromMe && S.shownRoute && S.shownRoute.legs[0]) delayShow = S.shownRoute.legs[0].delay || 0;
    else if (S.shownRoute) delayShow = S.shownRoute.trafficDelay || 0;
    paintEtaTraffic(delayShow);
  }

  function paintEtaTraffic(delaySec) {
    const el = $('#eta-time');
    const lb = $('#eta-label');
    if (!el || !lb) return;
    if (delaySec > 120) {
      el.style.color = '#f5a623';
      if (lb.textContent.indexOf('traffico') === -1) lb.textContent = lb.textContent + ' · traffico +' + Math.round(delaySec / 60) + ' min';
    } else {
      el.style.color = '';
    }
  }

  /* =============================== K. SHEET TAPPE =============================== */
  function openSheet() {
    $('#sheet').classList.add('on');
    $('#sheet-bg').classList.add('on');
    pushState('sheet');
    scrollToCurrent();
  }
  function closeSheet(touchHistory) {
    const wasOpen = $('#sheet').classList.contains('on');
    $('#sheet').classList.remove('on');
    $('#sheet-bg').classList.remove('on');
    if (wasOpen && touchHistory !== false && history.state && history.state.pm === 'sheet') {
      ignorePop = true;
      try { history.back(); } catch (e) { }
    }
  }
  function scrollToCurrent() {
    const cur = $('.stop-item.cur');
    if (cur) setTimeout(() => { cur.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 260);
  }

  function renderStops() {
    const box = $('#stops-list');
    if (!S.giro) return;
    const sess = S.session || { done: {}, skipped: [] };
    const act = activeStops();
    const curId = act.length ? act[0].id : null;
    $('#sheet-count').textContent = S.giro.stops.length;
    if (!S.giro.stops.length) {
      box.innerHTML = '<div class="empty">Nessuna tappa in questo giro.<br>Tocca <b>+ Aggiungi</b> e cerca l’indirizzo.</div>';
      return;
    }
    box.innerHTML = S.giro.stops.map((st) => {
      const done = !!sess.done[st.id];
      const skipped = sess.skipped.indexOf(st.id) !== -1;
      const cur = st.id === curId;
      const idx = stopIndexLabel(st.id);
      const actIdx = act.findIndex((a) => a.id === st.id);
      let meta = '';
      if (S.shownRoute && actIdx >= 0) {
        const leg = S.previewFromMe ? S.shownRoute.legs[actIdx] : S.shownRoute.legs[actIdx - 1];
        if (leg) meta = '<div class="stop-meta"><span>' + fmtKmVal(leg.total / 1000) + '</span><span>·</span><span>' + timeParts(leg.sec).main + ' ' + timeParts(leg.sec).unit + '</span></div>';
        else if (actIdx === 0) meta = '<div class="stop-meta"><span>partenza</span></div>';
      } else if (!hasCoords(st)) {
        meta = '<div class="stop-meta" style="color:#ffc98b"><span>posizione mancante</span></div>';
      }
      return '<div class="stop-item' + (cur ? ' cur' : '') + (done ? ' done' : '') + (skipped ? ' skipped' : '') + '" data-id="' + st.id + '">' +
        '<div class="stop-idx">' + (done ? '✓' : skipped ? '–' : idx) + '</div>' +
        '<div class="stop-main" data-center="' + st.id + '">' +
        '<div class="stop-name">' + esc(st.name || 'Tappa ' + idx) + '</div>' +
        '<div class="stop-addr">' + esc(st.address || '') + '</div>' +
        (st.notes ? '<div class="stop-note">' + esc(st.notes) + '</div>' : '') +
        meta +
        '</div>' +
        '<div class="stop-acts">' +
        '<button class="sa go" data-act="nav" data-id="' + st.id + '" title="Naviga">➤</button>' +
        '<button class="sa ' + (skipped ? 'warn' : '') + '" data-act="skip" data-id="' + st.id + '" title="' + (skipped ? 'Ripristina' : 'Salta oggi') + '">' + (skipped ? '↺' : '⤼') + '</button>' +
        '<button class="sa" data-act="edit" data-id="' + st.id + '" title="Modifica">✎</button>' +
        '</div>' +
        '</div>';
    }).join('');
    const missingN = S.giro.stops.filter((s) => !hasCoords(s)).length;
    const withAddr = S.giro.stops.filter((s) => s.address && !s.pinned).length;
    const retryBtn = $('#btn-retry');
    if (retryBtn) {
      if (missingN) {
        retryBtn.style.display = '';
        retryBtn.textContent = 'Riprova indirizzi mancanti (' + missingN + ')';
      } else if (withAddr) {
        retryBtn.style.display = '';
        retryBtn.textContent = 'Ricalcola posizioni (' + withAddr + ')';
      } else {
        retryBtn.style.display = 'none';
      }
    }
    scrollToCurrent();
  }

  /* =============================== L. EDITOR TAPPA =============================== */
  let geocodeLast = 0;
  const cityCenterCache = {};

  async function cityCenter(name) {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return null;
    if (cityCenterCache[key]) return cityCenterCache[key];
    try {
      const rs = await geocode(key + ', Italia');
      const r = rs && rs[0];
      if (r) {
        const out = { lat: r.lat, lng: r.lng, city: r.city || String(name).trim() };
        cityCenterCache[key] = out;
        return out;
      }
    } catch (e) { }
    return null;
  }

  async function resolveZone(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    const parts = t.split(/[\s,–-]+/).filter(Boolean);
    const full = await cityCenter(t);
    if (full) {
      const cl = (full.city || '').toLowerCase();
      if (!cl || parts.some((w) => w.length > 2 && cl.indexOf(w.toLowerCase()) !== -1)) return full;
    }
    for (const w of parts) {
      if (w.length < 3 || /^(giro|giorno|zona|settimana|giri)$/i.test(w)) continue;
      const c = await cityCenter(w);
      if (c && c.city) return c;
    }
    return full || null;
  }

  function pickBest(rs, center, cityLabel) {
    if (!rs || !rs.length) return { best: null, outside: false };
    const cl = ((center && center.city) || cityLabel || '').toLowerCase();
    if (cl) {
      const matches = rs.filter((r) => (r.city || '').toLowerCase() === cl);
      if (matches.length) {
        const best = center ? matches.slice().sort((a, b) => hav(center, a) - hav(center, b))[0] : matches[0];
        return { best: best, outside: false };
      }
    }
    if (center) {
      const sorted = rs.slice().sort((a, b) => hav(center, a) - hav(center, b));
      if (hav(center, sorted[0]) <= 45000) return { best: sorted[0], outside: false };
      return { best: null, outside: true };
    }
    return { best: rs[0], outside: false };
  }

  async function geocodeNear(q, center, radiusKm) {
    const rk = radiusKm || 35;
    if (tomtomReady() && center) {
      try {
        const u = 'https://api.tomtom.com/search/2/search/' + encodeURIComponent(q) + '.json' +
          '?key=' + encodeURIComponent(tomtomKey()) + '&lat=' + center.lat + '&lon=' + center.lng +
          '&radius=' + Math.min(50000, Math.round(rk * 1000)) + '&limit=6&language=it-IT&countrySet=IT&typeahead=false';
        const res = await fetch(u);
        if (res.ok) {
          const j = await res.json();
          const out = (j.results || []).map((r) => {
            const a = r.address || {};
            const street = [a.streetName, a.streetNumber].filter(Boolean).join(' ');
            const pos = r.position || {};
            return { label: a.freeformAddress || street, short: street || a.freeformAddress || '', lat: pos.lat, lng: pos.lon, num: a.streetNumber || '', city: a.municipality || '' };
          }).filter((r) => isFinite(r.lat) && isFinite(r.lng));
          if (out.length) return out;
        }
      } catch (e) { }
      try {
        const u = 'https://api.tomtom.com/search/2/geocode/' + encodeURIComponent(q) + '.json' +
          '?key=' + encodeURIComponent(tomtomKey()) + '&limit=6&language=it-IT&countrySet=IT';
        const res = await fetch(u);
        if (res.ok) {
          const j = await res.json();
          const out = (j.results || []).map((r) => {
            const a = r.address || {};
            const street = [a.streetName, a.streetNumber].filter(Boolean).join(' ');
            const pos = r.position || {};
            return { label: a.freeformAddress || street, short: street || a.freeformAddress || '', lat: pos.lat, lng: pos.lon, num: a.streetNumber || '', city: a.municipality || '' };
          }).filter((r) => isFinite(r.lat) && isFinite(r.lng));
          if (out.length) return out;
        }
      } catch (e) { }
    }
    if (center) {
      try {
        const dLat = rk / 111;
        const dLng = rk / (111 * Math.cos(toRad(center.lat)) || 1);
        const box = (center.lng - dLng) + ',' + (center.lat + dLat) + ',' + (center.lng + dLng) + ',' + (center.lat - dLat);
        const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&accept-language=it&bounded=1&viewbox=' + box + '&q=' + encodeURIComponent(q);
        const wait = Math.max(0, 1050 - (Date.now() - geocodeLast));
        if (wait) await sleep(wait);
        geocodeLast = Date.now();
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (res.ok) {
          const j = await res.json();
          const out = (j || []).map((x) => {
            const a = x.address || {};
            const street = [a.road || a.pedestrian || a.footway, a.house_number].filter(Boolean).join(' ');
            return { label: x.display_name, short: street || x.name || x.display_name, lat: +x.lat, lng: +x.lon, num: a.house_number || '' };
          });
          if (out.length) return out;
        }
      } catch (e) { }
      try {
        const res = await fetch('https://photon.komoot.io/api?q=' + encodeURIComponent(q) + '&limit=6&lang=it&lat=' + center.lat + '&lon=' + center.lng);
        if (res.ok) {
          const j = await res.json();
          const out = (j.features || []).map((f) => {
            const p = f.properties || {};
            const c = f.geometry && f.geometry.coordinates;
            if (!c) return null;
            const street = [p.street || p.name, p.housenumber].filter(Boolean).join(' ');
            return { label: [street, p.city, p.postcode].filter(Boolean).join(', '), short: street || p.name || '', lat: c[1], lng: c[0], num: p.housenumber || '' };
          }).filter(Boolean);
          if (out.length) return out;
        }
      } catch (e) { }
    }
    return geocode(q);
  }

  async function geocodeTomTom(q) {
    const url = 'https://api.tomtom.com/search/2/geocode/' + encodeURIComponent(q) + '.json' +
      '?key=' + encodeURIComponent(tomtomKey()) + '&limit=6&language=it-IT&countrySet=IT&typeahead=false';
    const res = await fetch(url);
    if (!res.ok) throw new Error('TomTom ' + res.status);
    const j = await res.json();
    return (j.results || []).map((r) => {
      const a = r.address || {};
      const street = [a.streetName, a.streetNumber].filter(Boolean).join(' ');
      const label = a.freeformAddress || [street, a.municipality].filter(Boolean).join(', ');
      const pos = r.position || {};
      return {
        label: label,
        short: street || a.freeformAddress || '',
        lat: pos.lat, lng: pos.lon,
        num: a.streetNumber || '',
        city: a.municipality || a.municipalitySubdivision || '',
        type: r.type || '',
        src: 'tomtom'
      };
    }).filter((r) => isFinite(r.lat) && isFinite(r.lng));
  }

  async function geocodeOsm(q) {
    const out = [];
    try {
      const wait = Math.max(0, 1050 - (Date.now() - geocodeLast));
      if (wait) await sleep(wait);
      geocodeLast = Date.now();
      const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&accept-language=it&q=' + encodeURIComponent(q);
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const j = await res.json();
        (j || []).forEach((x) => {
          const a = x.address || {};
          const line = [a.road || a.pedestrian || a.footway, a.house_number].filter(Boolean).join(' ');
          out.push({ label: x.display_name, short: line || x.name || x.display_name, lat: +x.lat, lng: +x.lon, num: a.house_number || '', city: a.city || a.town || a.village || a.municipality || '' });
        });
      }
    } catch (e) { console.warn('nominatim', e); }
    if (!out.length) {
      try {
        const res = await fetch('https://photon.komoot.io/api?q=' + encodeURIComponent(q) + '&limit=6&lang=it');
        if (res.ok) {
          const j = await res.json();
          (j.features || []).forEach((f) => {
            const p = f.properties || {};
            const c = f.geometry && f.geometry.coordinates;
            if (!c) return;
            const street = [p.street || p.name, p.housenumber].filter(Boolean).join(' ');
            const line = [street, p.city || p.town || p.village || p.district, p.postcode].filter(Boolean).join(', ');
            out.push({ label: line || p.name, short: street || p.name || line, lat: c[1], lng: c[0], num: p.housenumber || '', city: p.city || p.town || p.village || '' });
          });
        }
      } catch (e) { console.warn('photon', e); }
    }
    return out;
  }

  async function geocode(q) {
    if (!q || q.trim().length < 3) return [];
    let out = [];
    if (tomtomReady()) {
      try { out = await geocodeTomTom(q); } catch (e) { console.warn('geocode tomtom', e); out = []; }
    }
    if (!out.length) out = await geocodeOsm(q);
    // dedupe ravvicinati
    const uniq = [];
    out.forEach((r) => {
      if (!isFinite(r.lat) || !isFinite(r.lng)) return;
      if (uniq.some((u) => hav(u, r) < 25)) return;
      uniq.push(r);
    });
    return uniq.slice(0, 6);
  }

  function openStopEditor(stopId, opts) {
    opts = opts || {};
    if (!S.giro) return;
    const st = stopId ? S.giro.stops.find((s) => s.id === stopId) : null;
    const draft = st ? Object.assign({}, st) : { id: uid(), name: '', address: '', lat: null, lng: null, notes: '' };
    const isNew = !st;

    const html = '' +
      '<div class="modal-head"><b>' + (isNew ? 'Nuova tappa' : 'Tappa ' + stopIndexLabel(st.id)) + '</b><button class="x" id="m-close">✕</button></div>' +
      '<div class="field"><label>Nome / cliente</label><input id="f-name" placeholder="es. Rossi — portineria" value="' + esc(draft.name) + '"></div>' +
      '<div class="field"><label>Indirizzo</label>' +
      '<div class="row"><input id="f-addr" placeholder="Via, numero, città" value="' + esc(draft.address) + '">' +
      '<button class="btn" id="f-search" style="flex:0 0 auto;padding:12px 14px">Cerca</button></div>' +
      '<div class="chips"><button id="f-geo">📍 Posizione attuale</button><button id="f-paste">Incolla coordinate</button></div>' +
      '<div class="results" id="f-results"></div>' +
      '<div class="hint" id="f-coords">' + (isFinite(draft.lat) && draft.lat != null ? 'Coordinate: ' + draft.lat.toFixed(5) + ', ' + draft.lng.toFixed(5) : 'Nessuna posizione selezionata: cerca e tocca un risultato.') + '</div>' +
      '<button class="btn" id="f-pin" style="margin-top:9px;padding:11px">📌 Posiziona il pin sulla mappa</button>' +
      '<div class="hint" id="f-civic" style="display:none;color:#ffd9a8"></div>' +
      '</div>' +
      '<div class="field"><label>Note per la consegna</label>' +
      '<textarea id="f-notes" placeholder="Piano 3 interno B, citofono Rossi, lasciare i pacchi in portineria…">' + esc(draft.notes) + '</textarea>' +
      '<div class="chips" id="f-chips">' +
      '<button data-add="Piano ">Piano</button><button data-add="Citofono ">Citofono</button>' +
      '<button data-add="Lasciare in portineria">Portineria</button><button data-add="Lasciare nel garage">Garage</button>' +
      '<button data-add="Consegna a mano">A mano</button><button data-add="Non suonare">Non suonare</button>' +
      '</div></div>' +
      '<div class="btn-row">' +
      (isNew ? '' : '<button class="btn danger" id="f-del">Elimina</button>') +
      '<button class="btn" id="m-cancel">Annulla</button>' +
      '<button class="btn primary" id="f-save">Salva</button>' +
      '</div>' +
      (!isNew && stopIndexLabel(st.id) !== 1 ? '<button class="btn-ghost" id="f-first">↑ Rendi prossima tappa</button>' : '');

    openModal(html);
    const resBox = $('#f-results');
    let picked = hasCoords(draft) ? { lat: draft.lat, lng: draft.lng } : null;

    function setCoords(lat, lng, addr) {
      picked = { lat: lat, lng: lng };
      $('#f-coords').textContent = 'Coordinate: ' + lat.toFixed(5) + ', ' + lng.toFixed(5) + (addr ? ' · ' + addr : '');
      if (addr && !$('#f-addr').value) $('#f-addr').value = addr;
    }

    async function doSearch() {
      const q = $('#f-addr').value.trim();
      if (q.length < 3) { toast('Scrivi almeno 3 caratteri', 'bad'); return; }
      resBox.innerHTML = '<div class="hint">Ricerca…</div>';
      const rs = await geocode(q);
      if (!rs.length) { resBox.innerHTML = '<div class="hint">Nessun risultato. Aggiungi la città o usa “Posizione attuale”.</div>'; return; }
      resBox.innerHTML = rs.map((r, i) => '<button class="result" data-i="' + i + '">' + esc(r.short || r.label) + '<span class="r2">' + esc(r.label) + '</span></button>').join('');
      $$('.result', resBox).forEach((b) => b.addEventListener('click', () => {
        const r = rs[+b.getAttribute('data-i')];
        const typed = ($('#f-addr').value || '').trim();
        const keepTyped = !r.num && /\d/.test(typed);
        $('#f-addr').value = keepTyped ? typed : (r.short || r.label);
        setCoords(r.lat, r.lng, keepTyped ? '' : (r.short || r.label));
        draft.pinned = false;
        const civic = $('#f-civic');
        if (civic) {
          if (!r.num) {
            civic.style.display = '';
            civic.textContent = 'Civico non presente nella mappa: il pin è sulla via. Usa “Posiziona il pin” per metterlo sul portone.';
          } else {
            civic.style.display = 'none';
          }
        }
        resBox.innerHTML = '<div class="hint" style="color:#8ff0b1">✓ Posizione impostata</div>';
        vibrate(15);
      }));
    }

    $('#f-search').addEventListener('click', doSearch);
    $('#f-addr').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    $('#f-pin').addEventListener('click', () => {
      if (!picked) { toast('Prima cerca e seleziona la via', 'bad'); return; }
      openPinPicker(picked, (lat, lng) => {
        picked = { lat: lat, lng: lng };
        draft.pinned = true;
        $('#f-coords').textContent = 'Coordinate: ' + lat.toFixed(5) + ', ' + lng.toFixed(5) + ' · scelte a mano';
        const civic = $('#f-civic');
        if (civic) { civic.style.display = ''; civic.textContent = 'Pin spostato a mano: il percorso arriva esattamente qui.'; }
        toast('Posizione aggiornata', 'good');
      });
    });
    $('#f-geo').addEventListener('click', () => {
      if (!navigator.geolocation) { toast('GPS non disponibile', 'bad'); return; }
      toast('Rilevo la posizione…');
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        let label = '';
        try {
          const r = await fetch('https://photon.komoot.io/reverse?lat=' + lat + '&lon=' + lng + '&lang=it');
          if (r.ok) { const j = await r.json(); const p = (j.features && j.features[0] && j.features[0].properties) || {}; label = [p.street, p.housenumber, p.city].filter(Boolean).join(' '); }
        } catch (e) { }
        setCoords(lat, lng, label);
      }, () => toast('Posizione non disponibile: controlla i permessi', 'bad'), { enableHighAccuracy: true, timeout: 20000 });
    });
    $('#f-paste').addEventListener('click', () => {
      const v = prompt('Incolla coordinate o link Google Maps:');
      if (!v) return;
      const m = v.match(/(-?\d{1,3}[.,]\d{3,})[ ,;]+(-?\d{1,3}[.,]\d{3,})/) || v.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (!m) { toast('Coordinate non riconosciute', 'bad'); return; }
      const lat = parseFloat(String(m[1]).replace(',', '.')), lng = parseFloat(String(m[2]).replace(',', '.'));
      if (!isFinite(lat) || !isFinite(lng)) { toast('Coordinate non valide', 'bad'); return; }
      setCoords(lat, lng, '');
    });
    $$('#f-chips button').forEach((b) => b.addEventListener('click', () => {
      const ta = $('#f-notes');
      ta.value = (ta.value ? ta.value.replace(/\s*$/, ' ') : '') + b.getAttribute('data-add');
      ta.focus();
    }));

    $('#m-close').addEventListener('click', closeModal);
    $('#m-cancel').addEventListener('click', closeModal);
    if ($('#f-del')) $('#f-del').addEventListener('click', () => {
      if (!confirm('Eliminare definitivamente questa tappa dal giro?')) return;
      S.giro.stops = S.giro.stops.filter((x) => x.id !== st.id);
      saveDB(); closeModal(); renderStops(); drawMarkers(); renderGiroChrome(); computePreview(true); toast('Tappa eliminata', 'good');
    });
    if ($('#f-first')) $('#f-first').addEventListener('click', () => {
      const arr = S.giro.stops;
      const i = arr.findIndex((x) => x.id === st.id);
      const firstActive = arr.findIndex((x) => !S.session.done[x.id] && S.session.skipped.indexOf(x.id) === -1);
      if (i < 0) return;
      const [item] = arr.splice(i, 1);
      arr.splice(firstActive < 0 ? 0 : firstActive, 0, item);
      // se era saltata, la ripristino
      S.session.skipped = S.session.skipped.filter((id) => id !== st.id);
      saveDB(); closeModal(); renderStops(); drawMarkers(); computePreview(true); toast('Ora è la prossima tappa', 'good');
    });

    $('#f-save').addEventListener('click', async () => {
      const name = $('#f-name').value.trim();
      const address = $('#f-addr').value.trim();
      const notes = $('#f-notes').value.trim();
      if (!name && !address) { toast('Serve almeno un nome o un indirizzo', 'bad'); return; }
      if (!picked) {
        const btn = $('#f-save'); const old = btn.textContent; btn.textContent = 'Cerco…'; btn.disabled = true;
        const rs = await geocode(address || name);
        btn.textContent = old; btn.disabled = false;
        if (!rs.length) { toast('Indirizzo non trovato: tocca un risultato o usa la posizione attuale', 'bad'); return; }
        picked = { lat: rs[0].lat, lng: rs[0].lng };
        if (!$('#f-addr').value) $('#f-addr').value = rs[0].short || rs[0].label;
      }
      if (isNew) {
        S.giro.stops.push({ id: draft.id, name: name || address, address: address, lat: picked.lat, lng: picked.lng, notes: notes, pinned: !!draft.pinned });
        S.session.skipped = S.session.skipped.filter((id) => id !== draft.id);
      } else {
        st.name = name || address; st.address = address; st.lat = picked.lat; st.lng = picked.lng; st.notes = notes; st.pinned = !!draft.pinned;
      }
      saveDB(); closeModal();
      renderStops(); drawMarkers(); renderGiroChrome();
      computePreview(true);
      updateEta();
      toast(isNew ? 'Tappa aggiunta · salvata per le prossime volte' : 'Tappa aggiornata', 'good');
      vibrate(20);
    });
  }

  /* =============================== M. NAVIGAZIONE =============================== */
  let voiceIt = null;
  function speak(text) {
    if (!db.settings.voice || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'it-IT';
      u.rate = 0.98;
      u.pitch = 1;
      if (!voiceIt) {
        const vs = window.speechSynthesis.getVoices() || [];
        voiceIt = vs.find((v) => /it[-_]IT/i.test(v.lang)) || vs.find((v) => /^it/i.test(v.lang)) || null;
      }
      if (voiceIt) u.voice = voiceIt;
      window.speechSynthesis.speak(u);
    } catch (e) { }
  }

  function setNavButton(on) {
    const b = $('#btn-nav');
    b.classList.toggle('stop', on);
    b.textContent = on ? '■' : '➤';
    b.setAttribute('aria-label', on ? 'Ferma navigazione' : 'Naviga');
  }

  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch (e) { }
  }

  function startNav() {
    if (!('geolocation' in navigator)) { toast('GPS non disponibile su questo browser', 'bad'); return; }
    const act = activeStops();
    if (!act.length) { toast('Nessuna tappa da raggiungere', 'bad'); return; }
    Nav.active = true; Nav.spoken = {}; Nav.offCount = 0; S.follow = true;
    keepAwake(true);
    $('#route-state').classList.add('hide');
    setNavButton(true);
    $('#nav-banner').classList.add('on');
    $('#nb-title').textContent = 'Cerco il segnale GPS…';
    $('#nb-sub').textContent = 'navigazione senza autostrada';
    try {
      Nav.watchId = navigator.geolocation.watchPosition(onFix, onFixErr, { enableHighAccuracy: true, maximumAge: 2000, timeout: 25000 });
    } catch (e) { toast('GPS non avviato', 'bad'); stopNav(); return; }
    if (S.me) refreshNavRoute();
    speak('Navigazione avviata verso ' + (act[0].name || 'la prossima tappa'));
    toast('Navigazione avviata · solo strade senza autostrada', 'good');
  }

  function stopNav(silent) {
    Nav.active = false;
    keepAwake(false);
    if (Nav.watchId != null) { try { navigator.geolocation.clearWatch(Nav.watchId); } catch (e) { } Nav.watchId = null; }
    Nav.route = null; Nav.busy = false;
    setNavButton(false);
    $('#nav-banner').classList.remove('on');
    clearNavSource();
    $('#route-state').classList.remove('hide');
    if (map && map.getPitch && map.getPitch() > 0) { try { map.easeTo({ pitch: 0, bearing: 0, duration: 600 }); } catch (e) { } }
    if (!silent) { try { window.speechSynthesis.cancel(); } catch (e) { } }
    updateEta();
  }

  function onFixErr(err) {
    const msg = err && err.code === 1 ? 'Permesso posizione negato: attivalo nelle impostazioni del browser' : 'GPS debole, riprovo…';
    toast(msg, 'bad');
    if (err && err.code === 1 && Nav.active) stopNav();
  }

  function pointAhead(path, p, meters) {
    const pr = projectOnPath(path, p);
    const target = Math.min(path.total - 1, pr.along + meters);
    let i = 1;
    while (i < path.cum.length - 1 && path.cum[i] < target) i++;
    const a = path.coords[i - 1], b = path.coords[i];
    const seg = (path.cum[i] - path.cum[i - 1]) || 1;
    const t = Math.max(0, Math.min(1, (target - path.cum[i - 1]) / seg));
    return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  }

  function applyNavCamera() {
    if (!map || !S.me || !Nav.route || !Nav.route.coords || Nav.route.coords.length < 2) return;
    const path = { coords: Nav.route.coords, cum: Nav.route.cum, total: Nav.route.total };
    const pr = projectOnPath(path, S.me);
    const snap = pointAtAlong(path, pr.along);
    const ahead = pointAtAlong(path, pr.along + (canPitch() ? 60 : 90));
    const opt = {
      center: [ahead.lng, ahead.lat],
      zoom: Math.max(map.getZoom(), canPitch() ? 17 : 16),
      duration: 700,
      padding: canPitch() ? { top: 0, bottom: 150, left: 0, right: 0 } : { top: 0, bottom: 0, left: 0, right: 0 }
    };
    if (canPitch()) {
      opt.pitch = 55;
      opt.bearing = hav(snap, ahead) > 2 ? bearingBetween(snap, ahead) : 0;
    }
    try { map.easeTo(opt); } catch (e) { }
  }

  function onFix(pos) {
    S.me = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, ts: Date.now(), head: pos.coords.heading };
    S.meSnap = null;
    if (Nav.active && Nav.route && Nav.route.coords && Nav.route.coords.length > 2) {
      const path = { coords: Nav.route.coords, cum: Nav.route.cum, total: Nav.route.total };
      const pr = projectOnPath(path, S.me);
      if (pr.d < 100) S.meSnap = pointAtAlong(path, pr.along);
    }
    updateMeMarker();
    if (S.follow !== false && map) {
      if (Nav.active && Nav.route && Nav.route.coords && Nav.route.coords.length > 2) {
        applyNavCamera();
      } else {
        const z = Math.max(map.getZoom(), 16);
        const c = map.getCenter();
        const d = hav(S.me, { lat: c.lat, lng: c.lng });
        if (d > 25) map.easeTo({ center: [S.me.lng, S.me.lat], zoom: z, pitch: 0, bearing: 0, duration: 500 });
        else if (map.getZoom() < z) map.easeTo({ zoom: z, duration: 300 });
      }
    }
    if (!Nav.active) { updateEta(); return; }
    if (!Nav.route) { refreshNavRoute(); return; }
    navUpdate();
  }

  async function refreshNavRoute() {
    if (Nav.busy) return;
    const act = activeStops();
    if (!act.length || !S.me) return;
    const dest = act[0];
    Nav.busy = true;
    try {
      const r = await routePoints([stopPoint(S.me), stopPoint(dest)]);
      const leg = r.legs[0];
      if (!leg) throw new Error('nessun percorso');
      Nav.route = leg;
      Nav.route.dest = dest;
      Nav.route.sections = r.sections;
      Nav.spoken = {};
      drawNav(leg);
      saveNavCache(Nav.route);
      navUpdate();
      if (S.follow !== false) applyNavCamera();
    } catch (e) {
      console.warn(e);
      const cached = S.giro ? loadNavCache(S.giro.id) : null;
      let used = false;
      if (cached && cached.destId === dest.id && S.me) {
        const pr = projectOnPath({ coords: cached.coords, cum: cached.cum, total: cached.total }, S.me);
        if (pr.d < 500) {
          cached.dest = dest;
          Nav.route = cached;
          Nav.spoken = {};
          drawNav(cached);
          navUpdate();
          if (S.follow !== false) applyNavCamera();
          used = true;
          toast('Senza rete: continuo con l’ultimo percorso salvato', 'bad');
        }
      }
      if (!used) toast('Non riesco a calcolare il percorso ora', 'bad');
    } finally { Nav.busy = false; }
  }

  function navUpdate() {
    if (!Nav.route || !S.me) return;
    const path = { coords: Nav.route.coords, cum: Nav.route.cum, total: Nav.route.total };
    const pr = projectOnPath(path, S.me);
    const remaining = Math.max(0, path.total - pr.along);
    const ratio = path.total > 0 ? remaining / path.total : 0;
    const remSec = Math.max(0, Nav.route.sec * ratio);
    const dest = Nav.route.dest;
    const name = dest ? (dest.name || dest.address || 'destinazione') : 'destinazione';

    $('#eta-label').textContent = 'Prossima tappa';
    const tp = timeParts(remSec);
    $('#eta-time').textContent = tp.main;
    $('#eta-unit').textContent = tp.unit;
    $('#eta-km').textContent = fmtMeters(remaining);
    $('#eta-arr').textContent = 'arrivo ' + clockIn(remSec);
    $('#eta-stop').textContent = name;
    paintEtaTraffic(Nav.route.delay || 0);

    // prossima manovra
    const mans = Nav.route.maneuvers || [];
    let next = null, nextIdx = -1;
    for (let i = 0; i < mans.length; i++) {
      if (mans[i].along > pr.along + 10) { next = mans[i]; nextIdx = i; break; }
    }
    if (next) {
      const dist = Math.max(0, next.along - pr.along);
      $('#nb-title').textContent = fmtMeters(dist) + ' · ' + (next.text || 'prosegui');
      $('#nb-sub').textContent = next.names ? next.names : (next.refs || '');
      $('#nb-arrow').textContent = next.arrow || '↑';
      const key = navKey(nextIdx, 'a');
      if (db.settings.voice && dist < 75 && !Nav.spoken[digest(next.text) + ':near']) {
        Nav.spoken[digest(next.text) + ':near'] = 1;
        speak(next.verbal);
      } else if (db.settings.voice && dist < 320 && !Nav.spoken[digest(next.text) + ':far']) {
        Nav.spoken[digest(next.text) + ':far'] = 1;
        speak('Tra ' + Math.round(dist / 10) * 10 + ' metri, ' + next.verbal);
      }
    } else {
      $('#nb-title').textContent = 'Arrivo a destinazione';
      $('#nb-sub').textContent = name;
      $('#nb-arrow').textContent = '🏁';
    }

    // arrivo
    if (remaining < 35 || (dest && hav(S.me, stopPoint(dest)) < 38) || pr.d > 60 && remaining < 60) {
      arrive();
      return;
    }
    // fuori percorso
    if (pr.d > 65 && S.me.acc < 60) Nav.offCount++; else Nav.offCount = 0;
    if (Nav.offCount >= 4) { Nav.offCount = 0; refreshNavRoute(); }
  }
  function digest(s) { let h = 0; s = String(s || ''); for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return h; }
  function navKey(i, k) { return i + ':' + k; }

  function arrive() {
    const act = activeStops();
    const st = act[0];
    if (!st) { stopNav(); return; }
    const wasDone = !!S.session.done[st.id];
    if (!wasDone) { S.session.done[st.id] = Date.now(); saveDB(); }
    vibrate([90, 70, 90]);
    speak('Arrivato a ' + (st.name || 'destinazione'));
    renderStops(); drawMarkers(); renderGiroChrome();
    const next = activeStops()[0];
    if (!next) {
      stopNav();
      updateEta();
      computePreview(true);
      toast('Giro completato 🎉', 'good');
      speak('Giro completato. Ottimo lavoro.');
      return;
    }
    if (!db.settings.autoAdvance) {
      stopNav();
      updateEta(); computePreview(true);
      toast('Arrivato · prossima: ' + (next.name || 'tappa'), 'good');
      return;
    }
    toast('Arrivato · prossima: ' + (next.name || 'tappa'), 'good');
    Nav.route = null; Nav.spoken = {};
    updateEta(); computePreview(false);
    refreshNavRoute();
  }

  function openNavMenu(stop) {
    S.pendingStop = stop || activeStops()[0] || null;
    if (!S.pendingStop) { toast('Nessuna tappa selezionata', 'bad'); return; }
    $('#navmenu').classList.add('on');
  }

  function openGoogleFor(st) {
    const u = 'https://www.google.com/maps/dir/?api=1&destination=' + st.lat + ',' + st.lng + '&travelmode=driving&dir_action=navigate&avoid=highways';
    window.open(u, '_blank');
  }

  /* =============================== N. MODALI =============================== */
  function openModal(html) {
    $('#modal-card').innerHTML = html;
    $('#modal').classList.add('on');
    $('#modal').onclick = (e) => { if (e.target === $('#modal')) closeModal(); };
  }
  function closeModal() {
    $('#modal').classList.remove('on');
    $('#modal-card').innerHTML = '';
  }

  function openGiroModal(giro, opts) {
    opts = opts || {};
    const isNew = !giro;
    const g = giro || { id: uid(), name: '', city: '', color: PALETTE[db.giri.length % PALETTE.length], stops: [] };
    openModal('' +
      '<div class="modal-head"><b>' + (isNew ? 'Nuovo giro' : 'Modifica giro') + '</b><button class="x" id="g-close">✕</button></div>' +
      '<div class="field"><label>Nome del giro</label><input id="g-name" placeholder="es. Lunedì 1ª settimana" value="' + esc(g.name) + '"></div>' +
      '<div class="field"><label>Città / zona</label><input id="g-city" placeholder="es. Verona sud" value="' + esc(g.city) + '"></div>' +
      '<div class="field"><label>Colore</label><div class="chips" id="g-colors">' +
      PALETTE.map((c) => '<button data-c="' + c + '" style="background:' + c + '33;border-color:' + c + (c === g.color ? ';box-shadow:0 0 0 2px ' + c : '') + '">●</button>').join('') +
      '</div></div>' +
      '<div class="btn-row">' + (!isNew ? '<button class="btn danger" id="g-del">Elimina</button>' : '') +
      '<button class="btn" id="g-cancel">Annulla</button><button class="btn primary" id="g-save">' + (isNew ? 'Crea' : 'Salva') + '</button></div>' +
      (isNew ? '<p class="hint">Dopo la creazione puoi aggiungere subito le tappe.</p>' : '<p class="hint">La pressione lunga su un giro nella home apre questa finestra.</p>'));
    let color = g.color;
    $$('#g-colors button').forEach((b) => b.addEventListener('click', () => {
      color = b.getAttribute('data-c');
      $$('#g-colors button').forEach((x) => { x.style.boxShadow = ''; });
      b.style.boxShadow = '0 0 0 2px ' + color;
    }));
    $('#g-close').addEventListener('click', closeModal);
    $('#g-cancel').addEventListener('click', closeModal);
    $('#g-save').addEventListener('click', () => {
      const name = $('#g-name').value.trim() || (isNew ? 'Giro ' + (db.giri.length + 1) : g.name);
      const city = $('#g-city').value.trim();
      if (isNew) {
        const ng = { id: g.id, name: name, city: city, color: color, stops: [] };
        db.giri.push(ng); saveDB(); closeModal(); renderHome();
        setTimeout(() => openGiro(ng.id), 120);
      } else {
        g.name = name; g.city = city; g.color = color; saveDB(); closeModal(); renderHome();
        if (S.giro && S.giro.id === g.id) { renderGiroChrome(); }
      }
      toast(isNew ? 'Giro creato' : 'Giro aggiornato', 'good');
    });
    if ($('#g-del')) $('#g-del').addEventListener('click', () => {
      if (!confirm('Eliminare il giro “' + g.name + '” con tutte le sue tappe?')) return;
      db.giri = db.giri.filter((x) => x.id !== g.id);
      Object.keys(db.sessions || {}).forEach((k) => { if (k.indexOf(g.id + '|') === 0) delete db.sessions[k]; });
      saveDB(); closeModal(); renderHome();
      if (S.giro && S.giro.id === g.id) { S.giro = null; showScreen('home'); }
      toast('Giro eliminato', 'good');
    });
  }

  function openCycleModal() {
    openModal('' +
      '<div class="modal-head"><b>Crea un ciclo di giri</b><button class="x" id="c-close">✕</button></div>' +
      '<p class="hint" style="margin-top:-6px">Crea subito i giri numerati: poi rinomini e riempi le tappe con calma.</p>' +
      '<div class="field"><label>Quanti giri nel ciclo?</label><input id="c-n" type="number" min="2" max="21" value="10"></div>' +
      '<div class="field"><label>Prefisso (facoltativo)</label><input id="c-p" placeholder="es. Giro"></div>' +
      '<div class="btn-row"><button class="btn" id="c-cancel">Annulla</button><button class="btn primary" id="c-ok">Crea</button></div>');
    $('#c-close').addEventListener('click', closeModal);
    $('#c-cancel').addEventListener('click', closeModal);
    $('#c-ok').addEventListener('click', () => {
      const n = clamp(parseInt($('#c-n').value, 10) || 10, 2, 21);
      const p = $('#c-p').value.trim() || 'Giro';
      for (let i = 0; i < n; i++) db.giri.push({ id: uid(), name: p + ' ' + (i + 1), city: '', color: PALETTE[(db.giri.length + i) % PALETTE.length], stops: [] });
      saveDB(); closeModal(); renderHome(); toast(n + ' giri creati', 'good');
    });
  }

  function openSettings() {
    const t = db.truck;
    const html = '' +
      '<div class="modal-head"><b>Impostazioni</b><button class="x" id="s-close">✕</button></div>' +
      '<div class="section-t">Il mio camioncino</div>' +
      '<p class="hint" style="margin-top:0">Servono per evitare sottopassi bassi e strade vietate ai mezzi pesanti.</p>' +
      '<div class="row"><div class="field"><label>Altezza (m)</label><input id="t-h" type="number" step="0.1" value="' + t.height + '"></div>' +
      '<div class="field"><label>Larghezza (m)</label><input id="t-w" type="number" step="0.1" value="' + t.width + '"></div></div>' +
      '<div class="row"><div class="field"><label>Lunghezza (m)</label><input id="t-l" type="number" step="0.1" value="' + t.length + '"></div>' +
      '<div class="field"><label>Peso (t)</label><input id="t-k" type="number" step="0.5" value="' + t.weight + '"></div></div>' +
      '<div class="section-t">Navigazione</div>' +
      '<div class="switch"><div class="lbl">Voce<small>Istruzioni lette ad alta voce</small></div><button class="tgl ' + (db.settings.voice ? 'on' : '') + '" id="s-voice"></button></div>' +
      '<div class="switch"><div class="lbl">Passa da sola alla tappa dopo<small>Quando arrivi, segna fatta e riparte</small></div><button class="tgl ' + (db.settings.autoAdvance ? 'on' : '') + '" id="s-auto"></button></div>' +
      '<div class="switch"><div class="lbl">Autostrade<small>Bloccate: i percorsi non le usano mai. Statali e provinciali sì.</small></div><button class="tgl on locked" id="s-hw" style="opacity:.55"></button></div>' +
      '<div class="section-t">Mappa</div>' +
      '<div class="field"><label>Luminosità mappa</label><input id="s-bright" type="range" min="0.7" max="1.3" step="0.05" value="' + db.settings.brightness + '"><div class="hint">La mappa è chiara; il resto dell’app resta scuro.</div></div>' +
      '<div class="field"><label>Base mappa</label><div class="chips" id="s-map-provider">' +
      '<button data-p="openfreemap">OpenFreeMap</button><button data-p="osm">OpenStreetMap</button><button data-p="tomtom">TomTom</button></div>' +
      '<div class="hint">OpenFreeMap è vettoriale, gratuita e senza chiave: è quella che abilita il 3D. OpenStreetMap e TomTom sono raster (nessun 3D); TomTom usa la chiave qui sopra.</div></div>' +
      '<div class="section-t">Traffico (TomTom)</div>' +
      '<div class="field"><label>Chiave API TomTom</label>' +
      '<input id="s-tt" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="incolla qui la chiave" value="' + esc(db.settings.tomtomKey || '') + '">' +
      '<div class="hint">Con la chiave i tempi e i tratti colorati usano il traffico TomTom. La chiave resta <b>solo su questo telefono</b> e non finisce nel backup né nel repository. Senza chiave l’app funziona come prima, con tempi senza traffico.</div></div>' +
      '<div class="btn-row"><button class="btn" id="s-tt-verify">Verifica chiave</button><button class="btn" id="s-tt-clear">Rimuovi</button></div>' +
      '<div class="section-t">Dati</div>' +
      '<div class="btn-row"><button class="btn" id="s-export">Esporta backup</button><button class="btn" id="s-import">Importa</button></div>' +
      '<button class="btn" id="s-import-list" style="width:100%;margin-top:9px">Importa elenco (testo/CSV)</button>' +
      '<button class="btn" id="s-reset-day" style="width:100%;margin-top:9px">Azzera il giro di oggi</button>' +
      '<button class="btn danger" id="s-wipe" style="width:100%;margin-top:9px">Cancella tutti i dati</button>' +
      '<p class="hint">I dati stanno solo in questo telefono: se cancelli la cache del browser o cambi telefono, senza backup li perdi.</p>' +
      '<div class="section-t">Info</div>' +
      '<p class="hint">Versione <b>' + APP_BUILD + '</b> · mappa MapLibre + OpenFreeMap.<br>Base: OpenStreetMap + Valhalla (profilo camion, autostrade escluse). Con la chiave TomTom, percorso e tempi usano TomTom con <b>traffico live</b>, sempre con camion e autostrade escluse; se TomTom non risponde l’app torna da sola al calcolo senza traffico.<br><br>Il routing conosce altezza, larghezza, lunghezza e peso del mezzo, ma <b>non tutte le ordinanze locali, ZTL o divieti temporanei</b>: la segnaletica sul posto resta l’unica verità.</p>';
    openModal(html);
    $('#s-close').addEventListener('click', closeModal);
    const bindTruck = (id, key, min, max) => $('#' + id).addEventListener('change', (e) => {
      const v = parseFloat(e.target.value);
      if (isFinite(v)) db.truck[key] = clamp(v, min, max);
      saveDB();
    });
    bindTruck('t-h', 'height', 1.5, 4.5);
    bindTruck('t-w', 'width', 1.4, 2.6);
    bindTruck('t-l', 'length', 2, 18);
    bindTruck('t-k', 'weight', 1, 44);
    $('#s-voice').addEventListener('click', (e) => { db.settings.voice = !db.settings.voice; e.target.classList.toggle('on', db.settings.voice); saveDB(); if (db.settings.voice) speak('Voce attiva'); });
    $('#s-auto').addEventListener('click', (e) => { db.settings.autoAdvance = !db.settings.autoAdvance; e.target.classList.toggle('on', db.settings.autoAdvance); saveDB(); });
    $('#s-hw').addEventListener('click', () => toast('Le autostrade sono escluse per scelta: non si possono attivare', 'good'));
    $('#s-bright').addEventListener('input', (e) => {
      db.settings.brightness = parseFloat(e.target.value) || 1.35;
      applyBrightness(); saveDB();
    });
    const paintProvider = () => {
      const cur = mapProvider();
      $$('#s-map-provider button').forEach((b) => {
        const on = b.getAttribute('data-p') === cur;
        b.style.background = on ? '#2563eb' : '';
        b.style.borderColor = on ? '#60a5fa' : '';
        b.style.color = on ? '#fff' : '';
      });
    };
    if ($('#s-map-provider')) {
      paintProvider();
      $$('#s-map-provider button').forEach((b) => b.addEventListener('click', () => {
        const p = b.getAttribute('data-p');
        if (p === 'tomtom' && !tomtomReady()) { toast('Prima inserisci la chiave TomTom', 'bad'); return; }
        db.settings.mapProvider = p;
        saveDB(); applyMapLayer(); paintProvider();
        toast(p === 'tomtom' ? 'Mappa TomTom attiva' : 'Mappa OpenStreetMap attiva', 'good');
      }));
    }
    $('#s-export').addEventListener('click', exportData);
    $('#s-import').addEventListener('click', importData);
    if ($('#s-import-list')) $('#s-import-list').addEventListener('click', () => { closeModal(); openImportModal(); });
    const ttInput = $('#s-tt');
    if (ttInput) {
      ttInput.addEventListener('change', () => {
        db.settings.tomtomKey = ttInput.value.trim();
        saveDB();
        if (db.settings.mapProvider === 'tomtom') applyMapLayer();
        toast(db.settings.tomtomKey ? 'Chiave salvata sul telefono' : 'Chiave rimossa', 'good');
      });
    }
    if ($('#s-tt-verify')) $('#s-tt-verify').addEventListener('click', async () => {
      const v = (ttInput.value || '').trim();
      if (!v) { toast('Incolla prima la chiave', 'bad'); return; }
      const b = $('#s-tt-verify');
      const old = b.textContent;
      b.textContent = 'Verifico…'; b.disabled = true;
      const res = await verifyTomTomKey(v);
      b.textContent = old; b.disabled = false;
      if (res.ok) {
        db.settings.tomtomKey = v; saveDB();
        if (db.settings.mapProvider === 'tomtom') applyMapLayer();
        toast('Chiave valida · ' + res.km + ' km in ' + res.min + ' min' + (res.delay > 0 ? ' · +' + res.delay + ' min di traffico' : ''), 'good');
        vibrate(20);
      } else {
        toast('Chiave non valida: ' + esc(res.msg), 'bad');
      }
    });
    if ($('#s-tt-clear')) $('#s-tt-clear').addEventListener('click', () => {
      ttInput.value = ''; db.settings.tomtomKey = ''; saveDB();
      toast('Chiave rimossa', 'good');
    });
    $('#s-reset-day').addEventListener('click', () => {
      if (!S.giro) { toast('Apri prima un giro', 'bad'); return; }
      if (!confirm('Azzerare lo stato di oggi del giro “' + S.giro.name + '”? Le tappe restano, tornano solo “da fare”.')) return;
      S.session = { giroId: S.giro.id, date: todayISO(), done: {}, skipped: [], startedAt: Date.now() };
      if (!db.sessions) db.sessions = {};
      db.sessions[S.giro.id + '|' + S.session.date] = S.session;
      saveDB(); closeModal(); renderStops(); drawMarkers(); renderGiroChrome(); updateEta(); computePreview(true);
      toast('Giro azzerato: tutte le tappe da fare', 'good');
    });
    $('#s-wipe').addEventListener('click', () => {
      if (!confirm('Cancellare TUTTI i giri e le tappe? Operazione irreversibile.')) return;
      if (!confirm('Sicuro? Fai prima un backup se non ne hai uno.')) return;
      db = freshDB(); flushDB(); closeModal(); renderHome(); showScreen('home'); toast('Dati cancellati', 'good');
    });
  }

  function exportData() {
    db.lastExport = Date.now();
    // la chiave non esce dal telefono, nemmeno nel backup
    const copy = JSON.parse(JSON.stringify(db));
    copy.settings = Object.assign({}, copy.settings, { tomtomKey: '' });
    const blob = new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pasomaps-backup-' + todayISO() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    saveDB();
    toast('Backup salvato nei Download', 'good');
  }

  function importData() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      try {
        const txt = await f.text();
        const data = JSON.parse(txt);
        if (!data || !Array.isArray(data.giri)) throw new Error('file non valido');
        if (!confirm('Sostituire i dati attuali con questo backup (' + data.giri.length + ' giri)?')) return;
        const oldKey = db.settings.tomtomKey;
        db = migrate(data);
        db.settings.tomtomKey = db.settings.tomtomKey || oldKey || '';
        db.lastExport = db.lastExport || 0;
        flushDB(); closeModal(); renderHome(); showScreen('home');
        toast('Backup importato', 'good');
      } catch (e) { toast('File non valido', 'bad'); }
    });
    inp.click();
  }

  /* ---------- import elenco da testo/CSV (Notepad Android) ---------- */
  const STREET_RE = /^(via|viale|v\.le|piazza|p\.zza|piazzale|corso|c\.so|strada|str\.|largo|vicolo|vico|contrada|salita|traversa|lungadige|lungomare|borgo|località|localita|frazione|ss|sp|sr|tangenziale)\b/i;
  const GIRO_RE = /^(giro|giorno|settimana|sett\.|lun|mar|mer|gio|ven|sab|dom)\b/i;

  function parseStopLine(line) {
    let s = String(line).replace(/^[-•*]\s*/, '').replace(/^\d{1,3}[.)]\s+/, '').replace(/\s+/g, ' ').trim();
    let notes = '';
    const par = s.match(/\(([^)]+)\)/);
    if (par) { notes = par[1].trim(); s = s.replace(par[0], '').trim(); }
    let name = '';
    let addr = s;
    if (/\s[-–|]\s/.test(s)) {
      const parts = s.split(/\s[-–|]\s/);
      const a = parts[0].trim();
      const b = parts.slice(1).join(' - ').trim();
      if (STREET_RE.test(b) && !STREET_RE.test(a)) { addr = b; name = a; }
      else if (STREET_RE.test(a) && !STREET_RE.test(b)) { addr = a; name = b; }
      else { addr = a; name = b; }
    }
    return { name: name.trim(), address: addr.trim(), notes: notes, query: addr.trim() };
  }

  function parseList(text) {
    const lines = String(text || '').split(/\r?\n/);
    const giri = [];
    let cur = null;
    let csvCols = null;
    const newGiro = (name, city) => {
      cur = { name: (name || ('Giro ' + (giri.length + 1))).replace(/\s+/g, ' ').trim(), city: (city || '').trim(), stops: [] };
      giri.push(cur);
    };
    lines.forEach((raw) => {
      let line = raw.replace(/\u00a0/g, ' ').trim();
      if (!line) return;
      if (/^[-=_*#]{3,}$/.test(line)) return;
      if (/^(elenco|lista|tappe|indirizzi|note|clienti)\b[: ]*$/i.test(line)) return;

      // riga tabellare (CSV / TSV)
      if (/[;\t]/.test(line)) {
        const parts = line.split(/[;\t]/).map((x) => x.trim());
        if (csvCols === null && parts.some((p) => /giro/i.test(p)) && parts.some((p) => /indirizzo|via|strada|cliente|nome|note/i.test(p))) {
          csvCols = {
            giro: parts.findIndex((p) => /giro|giorno/i.test(p)),
            addr: parts.findIndex((p) => /indirizzo|via|strada/i.test(p)),
            name: parts.findIndex((p) => /cliente|nome|destinatario/i.test(p)),
            note: parts.findIndex((p) => /note|citofono|piano/i.test(p))
          };
          return;
        }
        const clean = parts.filter(Boolean);
        if (!clean.length) return;
        if (csvCols) {
          const gname = csvCols.giro >= 0 ? parts[csvCols.giro] : '';
          const addr = csvCols.addr >= 0 ? parts[csvCols.addr] : '';
          const nm = csvCols.name >= 0 ? parts[csvCols.name] : '';
          const nt = csvCols.note >= 0 ? parts[csvCols.note] : '';
          if (!addr) return;
          if (gname) {
            const found = giri.find((x) => x.name.toLowerCase() === gname.toLowerCase());
            if (found) cur = found; else newGiro(gname, '');
          }
          if (!cur) newGiro('Giro 1', '');
          cur.stops.push({ name: nm, address: addr, notes: nt, query: addr });
          return;
        }
        const si = clean.findIndex((p) => STREET_RE.test(p));
        if (si === -1) {
          if (!cur || cur.stops.length) newGiro(clean[0], clean[1] || '');
          return;
        }
        const addr = clean[si];
        const gname = si > 0 ? clean.slice(0, si).join(' ') : '';
        if (gname && GIRO_RE.test(gname)) {
          const found = giri.find((x) => x.name.toLowerCase() === gname.toLowerCase());
          if (found) cur = found; else newGiro(gname, '');
        }
        if (!cur) newGiro('Giro 1', '');
        const nm = (si > 0 && !GIRO_RE.test(gname)) ? clean[0] : '';
        const notes = clean.filter((_, i) => i !== si && !(i === 0 && nm === clean[0])).join(' · ');
        cur.stops.push({ name: nm, address: addr, notes: notes, query: addr });
        return;
      }

      const isStreet = STREET_RE.test(line);
      const looksHeader = GIRO_RE.test(line) || (!isStreet && !/\d/.test(line) && line.length < 40) || /:$/.test(line);
      if (!isStreet && looksHeader) {
        const m = line.match(/[-–:|(]\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ' .]{2,30})\s*\)?$/);
        const city = m ? m[1].trim() : '';
        let name = line.replace(/\([^)]*\)\s*$/, '').trim();
        if (city && name.toLowerCase().endsWith(city.toLowerCase())) {
          name = name.slice(0, name.length - city.length).replace(/[\s\-–:|]+$/, '').trim();
        }
        newGiro(name, city);
        return;
      }
      if (!cur) newGiro('Giro 1', '');
      cur.stops.push(parseStopLine(line));
    });
    return giri.filter((g) => g.stops.length > 0);
  }

  function openImportModal() {
    openModal('' +
      '<div class="modal-head"><b>Importa elenco</b><button class="x" id="i-close">✕</button></div>' +
      '<p class="hint" style="margin-top:-6px">Incolla dal Notepad o scegli il file. <b>Una riga = una tappa</b>. Una riga con “Giro …”, “Giorno …”, “Lunedì …” apre un nuovo giro. Esempio:<br><code>Giro 1 - Verona</code><br><code>Via Roma 1 - Rossi</code><br><code>Via Mazzini 10 (piano 3, citofono)</code></p>' +
      '<div class="field"><label>Elenco</label><textarea id="i-text" style="min-height:150px" placeholder="Giro 1 - Verona&#10;Via Roma 1 - Rossi&#10;Via Mazzini 10 (piano 3)&#10;&#10;Giro 2 - Vicenza&#10;..."></textarea>' +
      '<div class="chips" style="margin-top:8px"><button id="i-file">Scegli file .txt/.csv</button><button id="i-clear">Svuota</button></div></div>' +
      '<div class="field"><label>Zona (città)</label><input id="i-zone" placeholder="es. Viareggio"><div class="hint">La ricerca resta entro ~35 km da questa città. Se il giro si chiama come la città (“Viareggio” o “Viareggio Marco Polo”) viene usata quella; se si chiama “Giro 1”, scrivila qui.</div></div>' +
      '<div class="switch" style="border-bottom:0;padding-top:0"><div class="lbl">Cerca le coordinate<small>' + (tomtomReady() ? 'Con la chiave TomTom i civici sono più precisi.' : 'Senza chiave TomTom uso OpenStreetMap: più lento e con meno civici.') + '</small></div><button class="tgl ' + (tomtomReady() ? 'on' : '') + '" id="i-geo"></button></div>' +
      '<div id="i-preview" class="hint"></div>' +
      '<div class="btn-row"><button class="btn" id="i-cancel">Annulla</button><button class="btn primary" id="i-run">Importa</button></div>');
    let geoOn = tomtomReady();
    let zoneTouched = false;
    const ta = $('#i-text');
    const prev = $('#i-preview');
    const zoneInp = $('#i-zone');
    if (zoneInp) zoneInp.addEventListener('input', () => { zoneTouched = true; });
    const refresh = () => {
      const giri = parseList(ta.value);
      const tot = giri.reduce((a, g) => a + g.stops.length, 0);
      if (zoneInp && !zoneTouched && !zoneInp.value && giri[0] && giri[0].city) zoneInp.value = giri[0].city;
      if (!tot) { prev.innerHTML = 'Nessuna tappa riconosciuta.'; return; }
      prev.innerHTML = '<b>' + giri.length + ' giri · ' + tot + ' tappe</b><br>' + giri.slice(0, 6).map((g) => '• ' + esc(g.name) + (g.city ? ' (' + esc(g.city) + ')' : '') + ' — ' + g.stops.length + ' tappe').join('<br>') + (giri.length > 6 ? '<br>…' : '');
    };
    ta.addEventListener('input', () => { clearTimeout(ta.__t); ta.__t = setTimeout(refresh, 250); });
    $('#i-geo').addEventListener('click', (e) => { geoOn = !geoOn; e.target.classList.toggle('on', geoOn); });
    $('#i-clear').addEventListener('click', () => { ta.value = ''; refresh(); });
    $('#i-file').addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.txt,.csv,text/plain,text/csv';
      inp.addEventListener('change', async () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        ta.value = await f.text();
        refresh();
      });
      inp.click();
    });
    $('#i-close').addEventListener('click', closeModal);
    $('#i-cancel').addEventListener('click', closeModal);
    $('#i-run').addEventListener('click', async () => {
      const giri = parseList(ta.value);
      const tot = giri.reduce((a, g) => a + g.stops.length, 0);
      if (!tot) { toast('Nessuna tappa riconosciuta: controlla il formato', 'bad'); return; }
      if (!confirm('Importare ' + giri.length + ' giri e ' + tot + ' tappe?\nSi aggiungono a quelli che hai già.')) return;
      await runImport(giri, geoOn, zoneInp ? zoneInp.value.trim() : '');
    });
    refresh();
  }

  async function runImport(giri, geoOn, zone) {
    openModal('<div class="modal-head"><b>Importazione</b></div>' +
      '<p class="hint" id="i-status">Preparo…</p>' +
      '<div style="height:8px;background:#1e293b;border-radius:6px;overflow:hidden"><div id="i-bar" style="height:100%;width:0;background:linear-gradient(90deg,#2563eb,#22d3ee);transition:width .2s"></div></div>' +
      '<p class="hint" id="i-sub">Non chiudere: la ricerca degli indirizzi può richiedere qualche minuto.</p>');
    const zoneName = (zone || '').trim();

    const existing = new Set(db.giri.map((g) => g.name.toLowerCase()));
    const created = [];
    giri.forEach((g) => {
      let name = g.name || 'Giro';
      let k = 2;
      while (existing.has(name.toLowerCase())) { name = (g.name || 'Giro') + ' (' + k + ')'; k++; }
      existing.add(name.toLowerCase());
      created.push({ ng: { id: uid(), name: name, city: g.city || zoneName || '', color: PALETTE[db.giri.length % PALETTE.length], stops: [] }, g: g });
    });

    const tasks = [];
    created.forEach(({ ng, g }) => {
      let zoneText = (g.city || '').trim();
      if (!zoneText) zoneText = (zoneName || '').trim();
      if (!zoneText && g.name && !GIRO_RE.test(g.name)) zoneText = g.name.trim();
      g.stops.forEach((s) => tasks.push({ ng: ng, s: s, zoneText: zoneText, cityLabel: '', center: null }));
    });
    const total = tasks.length;
    let done = 0;
    const bar = $('#i-bar'), status = $('#i-status');
    const tick = () => {
      done++;
      if (bar) bar.style.width = Math.round((done / total) * 100) + '%';
      if (status) status.textContent = 'Cerco gli indirizzi… ' + done + ' / ' + total;
    };

    if (geoOn && total) {
      const zones = Array.from(new Set(tasks.map((t) => t.zoneText).filter(Boolean)));
      const zoneInfo = {};
      for (const z of zones) {
        if (status) status.textContent = 'Individuo la zona: ' + z + '…';
        zoneInfo[z.toLowerCase()] = await resolveZone(z);
      }
      tasks.forEach((t) => {
        const info = t.zoneText ? zoneInfo[t.zoneText.toLowerCase()] : null;
        t.center = info || null;
        t.cityLabel = info && info.city ? info.city : t.zoneText;
      });
    }

    if (geoOn && total) {
      let cursor = 0;
      const workers = tomtomReady() ? 4 : 1;
      const work = async () => {
        while (cursor < total) {
          const t = tasks[cursor++];
          const q = t.s.query + ((t.cityLabel && t.s.query.toLowerCase().indexOf(t.cityLabel.toLowerCase()) === -1) ? ', ' + t.cityLabel : '');
          try {
            const rs = await geocodeNear(q, t.center, 35);
            const picked = pickBest(rs, t.center, t.cityLabel);
            t.res = picked.best;
            if (picked.outside) t.outside = true;
          } catch (e) { t.res = null; }
          tick();
        }
      };
      await Promise.all(Array.from({ length: Math.min(workers, total) }, work));
    }

    let withNum = 0, noNum = 0, failed = 0, outside = 0;
    const failedAddrs = [];
    tasks.forEach((t) => {
      const r = t.res || null;
      if (r) { if (r.num) withNum++; else noNum++; } else if (geoOn) failed++;
      if (t.outside) outside++;
      if (geoOn && !r && t.s.address) failedAddrs.push(t.s.address + (t.cityLabel ? ' — ' + t.cityLabel : ''));
      t.ng.stops.push({
        id: uid(),
        name: (t.s.name && t.city && t.s.name.toLowerCase() === t.city.toLowerCase()) ? '' : (t.s.name || ''),
        address: t.s.address || '',
        lat: r ? r.lat : null,
        lng: r ? r.lng : null,
        notes: t.s.notes || ''
      });
    });

    created.forEach(({ ng }) => db.giri.push(ng));
    saveDB();
    const totStops = tasks.length;
    openModal('<div class="modal-head"><b>Importazione completata</b><button class="x" id="i-done">✕</button></div>' +
      '<p class="hint" style="margin-top:-6px"><b>' + created.length + ' giri</b> e <b>' + totStops + ' tappe</b> importati.</p>' +
      (geoOn ? '<p class="hint">Civico esatto: <b>' + withNum + '</b><br>Senza civico: <b>' + noNum + '</b><br>Non trovate: <b>' + failed + '</b>' + (outside ? '<br>Fuori zona: <b>' + outside + '</b>' : '') + '</p>' : '<p class="hint">Nessuna ricerca coordinate: apri le tappe e usa “Posiziona il pin”.</p>') +
      (failedAddrs.length ? '<details style="margin-top:6px"><summary style="cursor:pointer;color:#9db4d6;font-size:12px">Indirizzi da controllare (' + failedAddrs.length + ')</summary><div style="max-height:150px;overflow:auto;font-size:11.5px;color:#93a3bd;line-height:1.5;margin-top:6px">' + failedAddrs.slice(0, 40).map((a) => '• ' + esc(a)).join('<br>') + (failedAddrs.length > 40 ? '<br>…' : '') + '</div></details>' : '') +
      '<p class="hint">Le tappe senza civico, non trovate o fuori zona restano da sistemare: apri la tappa e sposta il pin sul portone.</p>' +
      '<button class="btn primary" id="i-done2" style="width:100%;margin-top:10px">Vai ai giri</button>');
    const done2 = () => { closeModal(); renderHome(); };
    if ($('#i-done')) $('#i-done').addEventListener('click', done2);
    if ($('#i-done2')) $('#i-done2').addEventListener('click', done2);
    toast('Importate ' + totStops + ' tappe in ' + created.length + ' giri', 'good');
    vibrate(30);
  }

  async function retryMissing() {
    const g = S.giro;
    if (!g) return;
    const missing = g.stops.filter((s) => !hasCoords(s) && s.address);
    const all = g.stops.filter((s) => s.address && !s.pinned);
    let list = missing;
    let mode = 'missing';
    if (!missing.length) {
      if (!all.length) { toast('Nessuna tappa con indirizzo', 'bad'); return; }
      if (!confirm('Ricalcolare le posizioni di ' + all.length + ' tappe nella zona del giro?\nLe posizioni attuali verranno sostituite. I pin messi a mano restano.')) return;
      list = all;
      mode = 'all';
    }
    openModal('<div class="modal-head"><b>' + (mode === 'all' ? 'Ricalcolo posizioni' : 'Riprovo gli indirizzi') + '</b></div>' +
      '<p class="hint" id="r-status">0 / ' + list.length + '</p>' +
      '<div style="height:8px;background:#1e293b;border-radius:6px;overflow:hidden"><div id="r-bar" style="height:100%;width:0;background:linear-gradient(90deg,#2563eb,#22d3ee);transition:width .2s"></div></div>' +
      '<p class="hint">Ricerca limitata alla zona del giro.</p>');
    const zoneText = (g.city || (!GIRO_RE.test(g.name) ? g.name : '')).trim();
    const center = zoneText ? await resolveZone(zoneText) : null;
    const cityLabel = center && center.city ? center.city : zoneText;
    let ok = 0, outside = 0, cleared = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const q = s.address + ((cityLabel && s.address.toLowerCase().indexOf(cityLabel.toLowerCase()) === -1) ? ', ' + cityLabel : '');
      let best = null;
      try {
        const rs = await geocodeNear(q, center, 35);
        const picked = pickBest(rs, center, cityLabel);
        best = picked.best;
        if (picked.outside) outside++;
      } catch (e) { }
      if (best) { s.lat = best.lat; s.lng = best.lng; ok++; }
      else if (mode === 'all' && center && hasCoords(s) && hav(center, s) > 45000) { s.lat = null; s.lng = null; cleared++; }
      const st = $('#r-status'); if (st) st.textContent = (i + 1) + ' / ' + list.length;
      const bar = $('#r-bar'); if (bar) bar.style.width = Math.round(((i + 1) / list.length) * 100) + '%';
      if (tomtomReady()) await sleep(60);
    }
    saveDB();
    closeModal();
    renderStops(); drawMarkers(); computePreview(true);
    toast(ok + '/' + list.length + ' ' + (mode === 'all' ? 'aggiornate' : 'trovate') + (outside ? ' · ' + outside + ' fuori zona' : '') + (cleared ? ' · ' + cleared + ' azzerate' : ''), ok ? 'good' : 'bad');
  }


  function toggleSkip(id) {
    if (!S.session) return;
    const i = S.session.skipped.indexOf(id);
    if (i === -1) {
      S.session.skipped.push(id);
      toast('Tappa saltata per oggi (resta salvata nel giro)', 'good');
    } else {
      S.session.skipped.splice(i, 1);
      toast('Tappa ripristinata', 'good');
    }
    saveDB(); renderStops(); drawMarkers(); renderGiroChrome(); updateEta(); computePreview(true);
  }

  function markDoneManual(id) {
    if (!S.session) return;
    if (S.session.done[id]) delete S.session.done[id]; else S.session.done[id] = Date.now();
    saveDB(); renderStops(); drawMarkers(); renderGiroChrome(); updateEta(); computePreview(true);
  }

  function optimizeOrder() {
    const act = activeStops();
    if (act.length < 3) { toast('Servono almeno 3 tappe da fare', 'bad'); return; }
    const fixed = S.giro.stops.filter((s) => act.indexOf(s) === -1);
    let start = S.me || stopPoint(act[0]);
    const left = act.slice();
    const ordered = [];
    while (left.length) {
      let bi = 0, bd = Infinity;
      left.forEach((s, i) => { const d = hav(start, stopPoint(s)); if (d < bd) { bd = d; bi = i; } });
      const [nx] = left.splice(bi, 1);
      ordered.push(nx);
      start = stopPoint(nx);
    }
    // reinserisce le tappe fatte/saltate nelle posizioni originali
    const result = [];
    let k = 0;
    S.giro.stops.forEach((s) => { result.push(fixed.indexOf(s) !== -1 ? s : ordered[k++]); });
    S.giro.stops = result;
    saveDB(); renderStops(); drawMarkers(); computePreview(true);
    toast('Tappe riordinate per vicinanza', 'good');
  }

  async function toggleAlt() {
    const stops = activeStops();
    if (!stops.length) { toast('Nessuna tappa', 'bad'); return; }
    if (!S.preview) { toast('Aspetta il calcolo del percorso', 'bad'); return; }
    const start = routeStartPoints();
    const lbl = (r) => fmtKmVal(r.km) + ' · ' + timeParts(r.sec).main + (timeParts(r.sec).unit ? ' ' + timeParts(r.sec).unit : '') + ' · senza autostrada ✓';
    if (S.altOn) {
      S.altOn = false; S.shownRoute = S.preview; drawPreview(S.preview);
      updateEta(); renderStops(); setRouteState('Consigliato · ' + lbl(S.preview));
      toast('Percorso consigliato');
      return;
    }
    if (S.previewAlt) {
      S.altOn = true; S.shownRoute = S.previewAlt; drawPreview(S.previewAlt);
      updateEta(); renderStops(); setRouteState('Alternativa più corta · ' + lbl(S.previewAlt));
      toast('Alternativa più corta attiva');
      return;
    }
    setRouteState('Cerco un’alternativa senza autostrada…');
    try {
      const r = await routePoints(start.points, { shortest: true });
      S.previewAlt = r; S.altOn = true; S.shownRoute = r;
      drawPreview(r); updateEta(); renderStops();
      setRouteState('Alternativa più corta · ' + lbl(r));
      toast('Alternativa più corta trovata · tocca ⇄ per tornare', 'good');
    } catch (e) { toast('Nessuna alternativa disponibile', 'bad'); }
  }

  function applyBrightness() {
    document.documentElement.style.setProperty('--map-filter', 'brightness(' + db.settings.brightness + ') contrast(1.02)');
  }

  /* =============================== P. EVENTI =============================== */
  function bind() {
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-new-giro').addEventListener('click', () => openGiroModal(null));
    $('#btn-cycle').addEventListener('click', openCycleModal);
    $('#btn-back').addEventListener('click', () => {
      if ($('#sheet').classList.contains('on')) { closeSheet(true); return; }
      if (Nav.active && !confirm('Fermare la navigazione?')) return;
      if (Nav.active) stopNav();
      if (history.state && history.state.pm) { try { history.back(); } catch (e) { goHome(); } }
      else goHome();
    });
    window.addEventListener('popstate', () => {
      if (ignorePop) { ignorePop = false; return; }
      if ($('#sheet').classList.contains('on')) { closeSheet(false); return; }
      if ($('#s-giro').classList.contains('on')) goHome();
    });
    $('#btn-sheet').addEventListener('click', () => {
      if ($('#sheet').classList.contains('on')) closeSheet(); else openSheet();
    });
    $('#sheet-bg').addEventListener('click', closeSheet);
    $('#sheet-grip').addEventListener('click', closeSheet);
    $('#btn-close-sheet').addEventListener('click', closeSheet);
    $('#btn-add-stop').addEventListener('click', () => openStopEditor(null, {}));
    $('#btn-save').addEventListener('click', () => {
      flushDB();
      toast('Percorso aggiornato e salvato', 'good');
      computePreview(false);
      vibrate(15);
    });
    $('#btn-optimize').addEventListener('click', optimizeOrder);
    $('#btn-retry').addEventListener('click', retryMissing);
    $('#btn-recenter').addEventListener('click', () => {
      if (S.me) { map.easeTo({ center: [S.me.lng, S.me.lat], zoom: Math.max(map.getZoom(), 16), pitch: 0, bearing: 0, duration: 500 }); S.follow = true; }
      else { fitAll(); }
    });
    $('#btn-alt').addEventListener('click', toggleAlt);
    $('#btn-nav').addEventListener('click', () => {
      if (Nav.active) { stopNav(); toast('Navigazione fermata'); return; }
      openNavMenu(activeStops()[0]);
    });
    $('#nav-inapp').addEventListener('click', () => {
      $('#navmenu').classList.remove('on');
      const st = S.pendingStop;
      const act = activeStops();
      if (st && act.length && st.id !== act[0].id) {
        toast('Prima raggiungi la tappa attuale: usa “Rendi prossima” nella scheda', 'bad');
        return;
      }
      startNav();
    });
    $('#nav-google').addEventListener('click', () => { $('#navmenu').classList.remove('on'); if (S.pendingStop) openGoogleFor(S.pendingStop); });
    $$('[data-close]').forEach((b) => b.addEventListener('click', () => { $('#' + b.getAttribute('data-close')).classList.remove('on'); }));

    // lista tappe (delegato)
    $('#stops-list').addEventListener('click', (e) => {
      const actBtn = e.target.closest('[data-act]');
      const center = e.target.closest('[data-center]');
      if (actBtn) {
        const id = actBtn.getAttribute('data-id');
        const st = S.giro.stops.find((s) => s.id === id);
        const act = actBtn.getAttribute('data-act');
        if (act === 'nav') { openNavMenu(st); }
        if (act === 'skip') { toggleSkip(id); }
        if (act === 'edit') { openStopEditor(id, {}); }
        return;
      }
      if (center) {
        const st = S.giro.stops.find((s) => s.id === center.getAttribute('data-center'));
        if (st && isFinite(st.lat)) { closeSheet(); map.easeTo({ center: [st.lng, st.lat], zoom: 16, duration: 500 }); }
      }
    });
    $('#stops-list').addEventListener('dblclick', (e) => {
      const item = e.target.closest('.stop-item');
      if (item) markDoneManual(item.getAttribute('data-id'));
    });

    // tocco sulla mappa disattiva il "segui"
    $('#route-state').addEventListener('click', () => { if (!S.computing) computePreview(true); });
    $('#navmenu').addEventListener('click', (e) => { if (e.target === $('#navmenu')) $('#navmenu').classList.remove('on'); });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushDB();
    });
    window.addEventListener('pagehide', flushDB);
  }

  /* =============================== Q. AVVIO =============================== */
  function init() {
    db = loadDB();
    applyBrightness();
    pruneRouteCache();
    renderHome();

    bind();

    if (S.me == null && 'geolocation' in navigator) {
      // posizione in background: silenziosa, serve per l'ETA alla prossima tappa
      try {
        navigator.geolocation.getCurrentPosition((pos) => {
          S.me = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, ts: Date.now() };
          if (map) { updateMeMarker(); if (S.giro) computePreview(false); }
        }, () => { }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 });
      } catch (e) { }
    }

    setTimeout(() => $('#boot').classList.add('hide'), 420);

    // service worker (solo se servito da http/https)
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => { });
    }
    // iOS: le voci arrivano in ritardo
    if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = () => { voiceIt = null; };
    window.PasoMaps = { db: () => db, S: S, Nav: Nav, getMap: () => map, computePreview: computePreview };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
