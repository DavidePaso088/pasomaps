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
  const DEFAULT_SETTINGS = { voice: true, brightness: 1, autoAdvance: true, ztlWarn: true, trafficKey: '', tomtomKey: '', mapStyle: 4, mapProvider: 'openfreemap', lastGiroId: null };
  const PALETTE = ['#3b82f6', '#22d3ee', '#a78bfa', '#f472b6', '#f59e0b', '#34d399', '#60a5fa', '#fb7185', '#c084fc', '#facc15', '#2dd4bf', '#f97316', '#818cf8', '#4ade80'];
  const APP_BUILD = (() => {
    try {
      const src = (document.currentScript && document.currentScript.src) || '';
      const m = src.match(/[?&]v=(\d+)/);
      return m ? 'build ' + m[1] : 'build locale';
    } catch (e) { return 'build locale'; }
  })();
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

  /* ---------- foto consegne (IndexedDB, fuori dal JSON dei giri) ---------- */
  const PhotoStore = (() => {
    let dbp = null;
    function open() {
      if (dbp) return Promise.resolve(dbp);
      return new Promise((res, rej) => {
        try {
          const r = indexedDB.open('pasomaps-photos', 1);
          r.onupgradeneeded = () => {
            const d = r.result;
            if (!d.objectStoreNames.contains('photos')) {
              const s = d.createObjectStore('photos', { keyPath: 'id' });
              s.createIndex('stopId', 'stopId', { unique: false });
            }
          };
          r.onsuccess = () => { dbp = r.result; res(dbp); };
          r.onerror = () => rej(r.error);
        } catch (e) { rej(e); }
      });
    }
    async function put(stopId, blob) {
      const d = await open();
      return new Promise((res, rej) => {
        const tx = d.transaction('photos', 'readwrite');
        const id = uid();
        tx.objectStore('photos').put({ id: id, stopId: stopId, at: Date.now(), blob: blob });
        tx.oncomplete = () => res(id);
        tx.onerror = () => rej(tx.error);
      });
    }
    async function list(stopId) {
      const d = await open();
      return new Promise((res, rej) => {
        const tx = d.transaction('photos', 'readonly');
        const rq = tx.objectStore('photos').index('stopId').getAll(stopId);
        rq.onsuccess = () => res(rq.result || []);
        rq.onerror = () => rej(rq.error);
      });
    }
    async function del(id) {
      const d = await open();
      return new Promise((res, rej) => {
        const tx = d.transaction('photos', 'readwrite');
        tx.objectStore('photos').delete(id);
        tx.oncomplete = () => res(true);
        tx.onerror = () => rej(tx.error);
      });
    }
    async function delStop(stopId) {
      const items = await list(stopId);
      for (const it of items) { try { await del(it.id); } catch (e) { } }
      return true;
    }
    async function counts() {
      const d = await open();
      return new Promise((res, rej) => {
        const out = {};
        const tx = d.transaction('photos', 'readonly');
        const rq = tx.objectStore('photos').index('stopId').openKeyCursor();
        rq.onsuccess = () => {
          const c = rq.result;
          if (!c) { res(out); return; }
          out[c.key] = (out[c.key] || 0) + 1;
          c.continue();
        };
        rq.onerror = () => rej(rq.error);
      });
    }
    return { put: put, list: list, del: del, delStop: delStop, counts: counts };
  })();

  const photoCounts = {};
  async function refreshPhotoCounts() {
    try {
      const c = await PhotoStore.counts();
      Object.keys(photoCounts).forEach((k) => { delete photoCounts[k]; });
      Object.keys(c).forEach((k) => { photoCounts[k] = c[k]; });
    } catch (e) { }
    return photoCounts;
  }
  function bumpPhotoCount(stopId, delta) {
    const n = (photoCounts[stopId] || 0) + delta;
    if (n > 0) photoCounts[stopId] = n; else delete photoCounts[stopId];
  }

  function compressImage(file, maxSide) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const scale = Math.min(1, (maxSide || 1100) / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          c.toBlob((blob) => { URL.revokeObjectURL(url); if (blob) resolve(blob); else reject(new Error('compress')); }, 'image/jpeg', 0.65);
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
      img.src = url;
    });
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

  function truckOptions(allowHighways) {
    const t = db.truck;
    return {
      height: +t.height || 3.2, width: +t.width || 2.2, length: +t.length || 6,
      weight: +t.weight || 35, axle_load: +t.axle_load || 11,
      use_highways: allowHighways ? 1.0 : 0.0
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
    if (!opts.allowHighways) p.append('avoid', 'motorways');
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
      costing_options: { truck: truckOptions(opts.allowHighways) },
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
      let bad = !opts.allowHighways && (r.highway || r.legs.some(legTouchesMotorway));
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
  const STYLE_OFM = 'https://tiles.openfreemap.org/styles/liberty';  // liberty = edifici estrusi in 3D (layer building-3d)
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
    allowHighways: false,
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
  const Nav = { active: false, watchId: null, route: null, busy: false, offCount: 0, spoken: {}, target: null, overrideDest: null };

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
    S.allowHighways = false;
    flushDB();
    showScreen('home');
    renderHome();
    S.giro = null;
    S.preview = null;
    S.shownRoute = null;
  }

  function renderHome() {
    const box = $('#giri-list');
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
  function openFreeMode() {
    openModal('' +
      '<div class="modal-head"><b>Modalità libera</b><button class="x" id="fm-close">✕</button></div>' +
      '<p class="hint" style="margin-top:-6px">Navigatore normale: <b>le autostrade sono permesse</b>. Scrivi la destinazione e tocca il risultato.</p>' +
      '<div class="field"><label>Dove vai?</label>' +
      '<div class="row"><input id="fm-q" placeholder="Via, numero, città" autocomplete="off" spellcheck="false"><button class="btn" id="fm-search" style="flex:0 0 auto;padding:12px 14px">Cerca</button></div>' +
      '<div class="results" id="fm-res"></div></div>');
    const box = $('#fm-res');
    const doSearch = async () => {
      const q = $('#fm-q').value.trim();
      if (q.length < 3) { toast('Scrivi almeno 3 caratteri', 'bad'); return; }
      box.innerHTML = '<div class="hint">Cerco…</div>';
      const rs = await geocode(q);
      if (!rs.length) { box.innerHTML = '<div class="hint">Nessun risultato: aggiungi la città.</div>'; return; }
      box.innerHTML = rs.map((r, i) => '<button class="result" data-i="' + i + '">' + esc(r.short || r.label) + '<span class="r2">' + esc(r.label) + '</span></button>').join('');
      $$('.result', box).forEach((b) => b.addEventListener('click', () => {
        startFreeTo(rs[+b.getAttribute('data-i')]);
      }));
    };
    $('#fm-close').addEventListener('click', closeModal);
    $('#fm-search').addEventListener('click', doSearch);
    $('#fm-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    setTimeout(() => { const i = $('#fm-q'); if (i) i.focus(); }, 200);
  }

  function startFreeTo(dest) {
    closeModal();
    const g = {
      id: 'free-' + Date.now(), name: 'Modalità libera', city: '', color: '#22d3ee',
      stops: [{ id: uid(), name: dest.short || dest.label || 'Destinazione', address: dest.label || dest.short || '', lat: dest.lat, lng: dest.lng, notes: '' }]
    };
    S.giro = g;
    S.session = { giroId: g.id, date: todayISO(), done: {}, skipped: [], outcomes: {}, startedAt: Date.now() };
    S.allowHighways = true;
    S.preview = null; S.shownRoute = null; S.previewAlt = null; S.altOn = false;
    Nav.route = null; Nav.overrideDest = null;
    showScreen('giro');
    pushState('giro');
    ensureMap();
    try { map.easeTo({ pitch: 0, bearing: 0, duration: 0 }); } catch (e) { }
    setTimeout(() => { try { map.resize(); } catch (e) { } }, 90);
    renderGiroChrome(); renderStops(); drawMarkers(); updateMeMarker(); updateEta();
    computePreview(true);
    setTimeout(() => { if (S.giro === g && !Nav.active) startNav(); }, 900);
  }

  function openGiro(id) {
    const g = db.giri.find((x) => x.id === id);
    if (!g) return;
    S.giro = g;
    S.allowHighways = false;
    const today = todayISO();
    if (!db.sessions) db.sessions = {};
    const skey = g.id + '|' + today;
    if (!db.sessions[skey]) {
      db.sessions[skey] = { giroId: g.id, date: today, done: {}, skipped: [], outcomes: {}, startedAt: Date.now() };
    }
    S.session = db.sessions[skey];
    if (!S.session.done) S.session.done = {};
    if (!Array.isArray(S.session.skipped)) S.session.skipped = [];
    if (!S.session.outcomes) S.session.outcomes = {};
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
    if (S.allowHighways) {
      $('#giro-city').textContent = 'Navigazione libera · autostrade permesse';
    } else {
      $('#giro-city').textContent = [city, g.stops.length + ' tappe', done ? done + ' fatte' : '', skipped ? skipped + ' saltate' : '']
        .filter(Boolean).join(' · ') || 'nessuna tappa';
    }
    $('#fab-badge').textContent = activeStops().length;
  }

  /* =============================== I. PERCORSO =============================== */
  function routeStartPoints() {
    const stops = activeStops();
    const fromMe = !!(S.me && (Date.now() - S.me.ts) < 10 * 60 * 1000);
    if (S.me) {
      const stale = (Date.now() - S.me.ts) > 10 * 60 * 1000;
      const acc = (S.me.acc != null && isFinite(S.me.acc)) ? S.me.acc : null;
      const bad = stale || (acc != null && acc > 50);
      const el = $('#me-acc');
      if (el) {
        el.style.display = bad ? 'flex' : 'none';
        el.textContent = stale ? 'GPS vecchio' : (acc != null && acc > 50 ? 'GPS impreciso · +' + Math.round(acc) + ' m' : '');
      }
    }
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
    const stops = activeStops();    if (!stops.length) {
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
      const r = await routePoints(start.points, { allowHighways: !!S.allowHighways });
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
      const roadTxt = S.allowHighways ? 'autostrade permesse' : (hw ? '⚠ possibile tratto autostradale, controlla' : 'senza autostrada ✓');
      setRouteState(
        fmtKmVal(r.km) + ' · ' + timeParts(r.sec).main + (timeParts(r.sec).unit ? ' ' + timeParts(r.sec).unit : '') +
        ' · ' + roadTxt + ' · ' + trafficTxt,
        hw && !S.allowHighways ? 'warn' : ''
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
    const acc = (S.me.acc != null && isFinite(S.me.acc)) ? S.me.acc : null;
    const stale = (Date.now() - S.me.ts) > 10 * 60 * 1000;
    if (stale || (acc != null && acc > 50)) {
      const b = document.createElement('div');
      b.className = 'me-badge';
      b.textContent = stale ? 'GPS vecchio' : 'GPS +' + Math.round(acc) + ' m';
      el.appendChild(b);
    }
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
    if (!S.giro || !leg || !leg.dest || !leg.dest.id || !leg.coords || leg.coords.length < 2) return;
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
    const ov = (Nav.active && Nav.overrideDest) ? Nav.overrideDest : null;
    $('#fab-badge').textContent = act.length;
    const camTarget = ov || act[0];
    const camN = (camTarget && camTarget.id) ? (photoCounts[camTarget.id] || 0) : 0;
    const camEl = $('#btn-cam');
    if (camEl) {
      if (camN) { camEl.classList.add('has'); camEl.setAttribute('data-n', camN); }
      else { camEl.classList.remove('has'); camEl.removeAttribute('data-n'); }
    }
    if (!act.length && !ov) {
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
    const st = ov || act[0];
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

  /* ---------- esiti delle consegne ---------- */
  const OUTCOMES = {
    ok: { label: 'Consegnata', short: '✓ Consegnata', cls: 'ok', delivered: true },
    paid: { label: 'Consegnata, ha pagato', short: 'Pagato', cls: 'paid', delivered: true },
    unpaid: { label: 'Consegnata, non ha pagato', short: '✓ Non pagato', cls: 'unpaid', delivered: true },
    absent: { label: 'Cliente non presente', short: '✗ Non presente', cls: 'absent', delivered: false },
    failed: { label: 'Non consegnata', short: '✗ Non consegnata', cls: 'failed', delivered: false }
  };

  function eur(n) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    return '€ ' + (Math.abs(v % 1) < 0.005 ? String(Math.round(v)) : v.toFixed(2).replace('.', ','));
  }

  function outcomeShort(oc) {
    const d = OUTCOMES[oc.code];
    if (!d) return 'Esito';
    if (oc.code === 'paid') return '✓ ' + eur(oc.amount);
    return d.short;
  }

  function outcomeLong(oc) {
    const d = OUTCOMES[oc.code];
    if (!d) return '';
    if (oc.code === 'paid') return 'Ha pagato ' + eur(oc.amount);
    if (oc.code === 'ok') return 'Consegnata';
    if (oc.code === 'unpaid') return 'Consegnata · non ha pagato';
    return d.label;
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

  function renderStops(opts) {
    opts = opts || {};
    const body = $('#sheet-body');
    const prevTop = body ? body.scrollTop : 0;
    const box = $('#stops-list');
    if (!S.giro) return;
    const sess = S.session || { done: {}, skipped: [] };
    const act = activeStops();
    const curId = act.length ? act[0].id : null;
    $('#sheet-count').textContent = S.giro.stops.length;
    if (!S.giro.stops.length) {
      box.innerHTML = '<div class="empty">Nessuna tappa in questo giro.<br>Tocca <b>+ Aggiungi</b> e cerca l’indirizzo.</div>';
      const s0 = $('#sheet-sum'); if (s0) s0.hidden = true;
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
      const total = S.giro.stops.length;
      const ph = photoCounts[st.id] || 0;
      const oc = (sess.outcomes || {})[st.id];
      return '<div class="stop-item' + (cur ? ' cur' : '') + (done ? ' done' : '') + (skipped ? ' skipped' : '') + '" data-id="' + st.id + '">' +
        '<div class="stop-idx">' + (done ? '✓' : skipped ? '–' : idx) + '</div>' +
        '<div class="stop-main" data-center="' + st.id + '">' +
        '<div class="stop-name">' + esc(st.name || 'Tappa ' + idx) + '</div>' +
        '<div class="stop-addr">' + esc(st.address || '') + '</div>' +
        (st.approx ? '<div class="stop-note" style="color:#ffc98b">civico approssimato · verifica il pin</div>' : '') +
        (st.notes ? '<div class="stop-note">' + esc(st.notes) + '</div>' : '') +
        (oc ? '<div class="stop-out ' + esc((OUTCOMES[oc.code] || {}).cls || '') + '">' + esc(outcomeLong(oc)) + '</div>' : '') +
        '<div class="stop-foot">' +
        '<div class="mv-group">' +
        '<button class="mv" data-act="up" data-id="' + st.id + '" aria-label="Sposta su"' + (idx <= 1 ? ' disabled' : '') + '>↑</button>' +
        '<button class="mv" data-act="down" data-id="' + st.id + '" aria-label="Sposta giù"' + (idx >= total ? ' disabled' : '') + '>↓</button>' +
        '</div>' +
        '<button class="mv ph-btn' + (ph ? ' has' : '') + '" data-act="photo" data-id="' + st.id + '" title="Foto consegna" aria-label="Foto consegna">📷' + (ph ? '<i class="ph-n">' + ph + '</i>' : '') + '</button>' +
        meta +
        '</div>' +
        '</div>' +
        '<div class="stop-acts">' +
        '<button class="sa out' + (oc ? ' set ' + esc((OUTCOMES[oc.code] || {}).cls || '') : '') + '" data-act="outcome" data-id="' + st.id + '" title="Esito della consegna" aria-label="Esito della consegna">⚑</button>' +
        '<button class="sa" data-act="edit" data-id="' + st.id + '" title="Modifica tappa" aria-label="Modifica tappa">✎</button>' +
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
    if (opts.scroll === 'bottom') {
      setTimeout(() => { if (body) body.scrollTop = body.scrollHeight; }, 40);
    } else if (opts.scroll === 'current') {
      scrollToCurrent();
    } else if (body) {
      body.scrollTop = prevTop;
    }
    paintOutcomeSummary(sess);
  }

  function paintOutcomeSummary(sess) {
    const el = $('#sheet-sum');
    if (!el) return;
    const outs = (sess && sess.outcomes) || {};
    let cash = 0, unpaid = 0, notDel = 0, n = 0;
    Object.keys(outs).forEach((id) => {
      const o = outs[id];
      if (!o || !OUTCOMES[o.code]) return;
      n++;
      if (o.code === 'paid') cash += Number(o.amount) || 0;
      else if (o.code === 'unpaid') unpaid++;
      else if (o.code === 'absent' || o.code === 'failed') notDel++;
    });
    if (!n) { el.hidden = true; el.textContent = ''; return; }
    const parts = [];
    if (cash > 0) parts.push('incassato ' + eur(cash));
    if (unpaid) parts.push(unpaid + (unpaid === 1 ? ' non pagata' : ' non pagate'));
    if (notDel) parts.push(notDel + (notDel === 1 ? ' non consegnata' : ' non consegnate'));
    el.hidden = !parts.length;
    el.textContent = parts.length ? 'Oggi: ' + parts.join(' · ') : '';
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
    if (!out.length) {
      // Pelias (Mapzen) — gratuito, senza chiave, buona copertura dei civici italiani
      try {
        const res = await fetch('https://pelias.mapzen.com/v1/search?text=' + encodeURIComponent(q) + '&size=6&country=ita&boundary.country=ITA');
        if (res.ok) {
          const j = await res.json();
          (j.features || []).forEach((f) => {
            const props = f.properties || {};
            const a = props.address || {};
            const street = [a.street, a.number].filter(Boolean).join(' ');
            const c = f.geometry && f.geometry.coordinates;
            if (!c) return;
            out.push({ label: props.label || street, short: street || props.label || '', lat: c[1], lng: c[0], num: a.number || '', city: a.locality || a.region || '' });
          });
        }
      } catch (e) { console.warn('pelias', e); }
    }
    return out;
  }

  function civicInfo(addr) {
    const m = String(addr || '').match(/^(.*?)(\d+)\s*[\/\-]?\s*([A-Za-z])\s*(bis|ter|quater)?\s*(,.*)?$/i);
    if (!m) return null;
    return { base: m[1].trim(), num: m[2], letter: m[3].toLowerCase(), suffix: (m[4] || '').toLowerCase(), tail: (m[5] || '').trim() };
  }
  const civicNorm = (s) => String(s || '').toLowerCase().replace(/[\s\/\-\.]/g, '');
  function civicVariants(addr) {
    const p = civicInfo(addr);
    if (!p) return [addr];
    const head = p.base + ' ' + p.num;
    const ls = p.letter + p.suffix;
    const tail = p.tail ? ' ' + p.tail : '';
    const out = [addr];
    const add = (v) => { if (out.indexOf(v) === -1) out.push(v); };
    add(head + ' ' + ls + tail);
    add(head + '/' + ls + tail);
    add(head + tail);
    return out;
  }

  async function geocodeWithVariants(q, center, cityLabel) {
    const p = civicInfo(q);
    const target = p ? civicNorm(p.num + p.letter + p.suffix) : '';
    const variants = civicVariants(q);
    let fallback = null, outside = false;
    for (let i = 0; i < variants.length; i++) {
      let rs = [];
      try { rs = await geocodeNear(variants[i], center, 35); } catch (e) { }
      const picked = pickBest(rs, center, cityLabel);
      if (picked.outside) outside = true;
      if (!picked.best) continue;
      if (!target) return { best: picked.best, approx: false, outside: outside };
      if (civicNorm(picked.best.num) === target) return { best: picked.best, approx: false, outside: outside };
      if (!fallback) fallback = picked.best;
    }
    return { best: fallback, approx: !!fallback, outside: outside };
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
      '<div class="field"><label>Foto della consegna</label>' +
      (isNew
        ? '<div class="hint">Prima salva la tappa: poi scatti le foto dal tasto 📷 nella lista o nella schermata di navigazione.</div>'
        : '<div class="hint">' + ((photoCounts[st.id] || 0) ? (photoCounts[st.id] + (photoCounts[st.id] === 1 ? ' foto salvata' : ' foto salvate')) : 'Nessuna foto') + ' · si gestiscono dal tasto <b>📷</b> qui fuori, così non perdi le modifiche in corso.</div>') +
      '</div>' +
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
        draft.approx = false;
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
        draft.approx = false;
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
      const pn = photoCounts[st.id] || 0;
      if (!confirm(!pn
        ? 'Eliminare definitivamente questa tappa dal giro?'
        : (pn === 1
          ? 'Eliminare questa tappa e la sua foto? La foto non si recupera.'
          : 'Eliminare questa tappa e le sue ' + pn + ' foto? Le foto non si recuperano.'))) return;
      PhotoStore.delStop(st.id).catch(() => { });
      delete photoCounts[st.id];
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
        S.giro.stops.push({ id: draft.id, name: name || address, address: address, lat: picked.lat, lng: picked.lng, notes: notes, pinned: !!draft.pinned, approx: !!draft.approx });
        S.session.skipped = S.session.skipped.filter((id) => id !== draft.id);
      } else {
        st.name = name || address; st.address = address; st.lat = picked.lat; st.lng = picked.lng; st.notes = notes; st.pinned = !!draft.pinned; st.approx = !!draft.approx;
      }
      saveDB(); closeModal();
      renderStops(isNew ? { scroll: 'bottom' } : {});
      drawMarkers(); renderGiroChrome();
      computePreview(true);
      updateEta();
      toast(isNew ? 'Tappa aggiunta · salvata per le prossime volte' : 'Tappa aggiornata', 'good');
      vibrate(20);
    });
  }

  /* ---------- foto della consegna ---------- */
  function openPhotos(stopId) {
    if (!S.giro) { toast('Apri prima un giro', 'bad'); return; }
    const st = S.giro.stops.find((s) => s.id === stopId);
    if (!st) { toast('Nessuna tappa da fotografare', 'bad'); return; }
    const urls = [];
    const clearUrls = () => { urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) { } }); urls.length = 0; };
    openModal('' +
      '<div class="modal-head"><b>Foto · ' + esc(st.name || st.address || 'tappa') + '</b><button class="x" id="ph-close">✕</button></div>' +
      '<div class="photo-grid" id="ph-grid"><div class="photo-empty">Carico…</div></div>' +
      '<div class="photo-acts">' +
      '<button class="btn primary" id="ph-cam">📷 Scatta foto</button>' +
      '<button class="btn" id="ph-gal">🖼 Galleria</button>' +
      '</div>' +
      '<input type="file" id="ph-in-cam" accept="image/*" capture="environment" hidden>' +
      '<input type="file" id="ph-in-gal" accept="image/*" multiple hidden>' +
      '<p class="hint" style="margin-top:10px">Le foto restano <b>solo su questo telefono</b>: non entrano nel backup dei giri e non vanno su internet. Se cancelli la tappa, spariscono.</p>' +
      '<div class="btn-row"><button class="btn" id="ph-done">Chiudi</button></div>');

    async function render() {
      const grid = $('#ph-grid');
      if (!grid) return;
      let items = [];
      try { items = await PhotoStore.list(stopId); } catch (e) { }
      items.sort((a, b) => (b.at || 0) - (a.at || 0));
      clearUrls();
      if (!items.length) {
        grid.innerHTML = '<div class="photo-empty">Nessuna foto.<br>Scatta la prova di consegna: pacco, portone, ricevuta.</div>';
        return;
      }
      grid.innerHTML = items.map((it) => {
        const u = URL.createObjectURL(it.blob); urls.push(u);
        return '<div class="photo-cell"><img src="' + u + '" alt="Foto consegna" data-view="' + it.id + '">' +
          '<button class="del" data-del="' + it.id + '" aria-label="Elimina foto">✕</button></div>';
      }).join('');
      $$('.photo-cell img', grid).forEach((im) => im.addEventListener('click', () => {
        const it = items.find((x) => x.id === im.getAttribute('data-view'));
        if (it) viewer(it);
      }));
      $$('.photo-cell .del', grid).forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Eliminare questa foto?')) return;
        await PhotoStore.del(b.getAttribute('data-del'));
        bumpPhotoCount(stopId, -1);
        renderStops();
        updateEta();
        render();
        toast('Foto eliminata', 'good');
      }));
    }

    function viewer(it) {
      clearUrls();
      const u = URL.createObjectURL(it.blob); urls.push(u);
      const base = (st.name || st.address || 'foto').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40).toLowerCase() || 'foto';
      const name = 'pasomaps-' + base + '-' + String(it.id || '').slice(-4) + '.jpg';
      $('#modal-card').innerHTML = '' +
        '<div class="modal-head"><b>Foto</b><button class="x" id="pv-close">✕</button></div>' +
        '<img class="photo-big" src="' + u + '" alt="Foto consegna">' +
        '<div class="btn-row"><button class="btn" id="pv-back">← Indietro</button><a class="btn primary" href="' + u + '" download="' + name + '" style="text-decoration:none">⬇ Scarica</a></div>';
      $('#pv-close').addEventListener('click', () => { clearUrls(); closeModal(); });
      $('#pv-back').addEventListener('click', () => { openPhotos(stopId); });
    }

    async function addFiles(fileList) {
      const files = Array.from(fileList || []).filter((f) => /^image\//.test(f.type || ''));
      if (!files.length) return;
      let ok = 0;
      toast(files.length > 1 ? 'Preparo ' + files.length + ' foto…' : 'Preparo la foto…');
      for (const f of files) {
        try {
          const blob = await compressImage(f, 1200);
          await PhotoStore.put(stopId, blob);
          bumpPhotoCount(stopId, 1);
          ok++;
        } catch (e) { }
      }
      renderStops();
      updateEta();
      await render();
      if (ok) { toast(ok > 1 ? ok + ' foto salvate' : 'Foto salvata', 'good'); vibrate(20); }
      else toast('Foto non salvata: riprova', 'bad');
    }

    $('#ph-close').addEventListener('click', () => { clearUrls(); closeModal(); });
    $('#ph-done').addEventListener('click', () => { clearUrls(); closeModal(); });
    $('#ph-cam').addEventListener('click', () => $('#ph-in-cam').click());
    $('#ph-gal').addEventListener('click', () => $('#ph-in-gal').click());
    $('#ph-in-cam').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
    $('#ph-in-gal').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
    render();
  }

  /* =============================== M. NAVIGAZIONE =============================== */
  /* ---------- esito della consegna ---------- */
  function openOutcomeModal(stopId) {
    if (!S.giro) return;
    const st = S.giro.stops.find((s) => s.id === stopId);
    if (!st) return;
    if (!S.session.outcomes) S.session.outcomes = {};
    const cur = S.session.outcomes[stopId] || null;
    let code = cur ? cur.code : '';
    const opts = [
      { c: 'ok', ic: '✓', t: 'Consegnata' },
      { c: 'paid', ic: '💶', t: 'Ha pagato una cifra' },
      { c: 'unpaid', ic: '⚠', t: 'Non ha pagato' },
      { c: 'absent', ic: '🚪', t: 'Non era presente' },
      { c: 'failed', ic: '✕', t: 'Non consegnata', wide: true }
    ];
    openModal('' +
      '<div class="modal-head"><b>Esito · ' + esc(st.name || st.address || 'tappa') + '</b><button class="x" id="o-close">✕</button></div>' +
      '<p class="hint" style="margin-top:-6px">Tocca com’è andata: la tappa viene segnata da sola come fatta o saltata, e l’incassato si somma nella lista tappe.</p>' +
      '<div class="out-grid" id="o-grid">' + opts.map((o) => '<button data-code="' + o.c + '"' + (o.wide ? ' class="wide"' : '') + '><span class="ic">' + o.ic + '</span>' + o.t + '</button>').join('') + '</div>' +
      '<div class="field" id="o-amt-wrap" style="display:none"><label>Quanto ha pagato (€)</label><input id="o-amt" type="text" inputmode="decimal" autocomplete="off" placeholder="es. 45,50" value="' + ((cur && cur.code === 'paid' && cur.amount) ? esc((Math.abs(cur.amount % 1) < 0.005 ? String(Math.round(cur.amount)) : Number(cur.amount).toFixed(2)).replace('.', ',')) : '') + '"></div>' +
      '<div class="btn-row">' + (cur ? '<button class="btn danger" id="o-clear">Togli</button>' : '') +
      '<button class="btn" id="o-cancel">Annulla</button><button class="btn primary" id="o-save">Salva</button></div>');
    const paint = () => {
      $$('#o-grid button').forEach((b) => b.classList.toggle('sel', b.getAttribute('data-code') === code));
      const w = $('#o-amt-wrap');
      if (w) w.style.display = code === 'paid' ? '' : 'none';
    };
    $$('#o-grid button').forEach((b) => b.addEventListener('click', () => {
      code = b.getAttribute('data-code');
      paint();
      if (code === 'paid') setTimeout(() => { const i = $('#o-amt'); if (i) i.focus(); }, 60);
    }));
    paint();
    $('#o-close').addEventListener('click', closeModal);
    $('#o-cancel').addEventListener('click', closeModal);
    if ($('#o-clear')) $('#o-clear').addEventListener('click', () => {
      applyOutcome(stopId, null, null);
      closeModal();
      toast('Esito rimosso', 'good');
    });
    $('#o-save').addEventListener('click', () => {
      if (!code) { toast('Scegli un esito', 'bad'); return; }
      let amount = null;
      if (code === 'paid') {
        const raw = String($('#o-amt').value || '').replace(/[^\d.,]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
        amount = parseFloat(raw);
        if (!isFinite(amount) || amount <= 0) { toast('Scrivi quanto ha pagato', 'bad'); return; }
      }
      applyOutcome(stopId, code, amount);
      closeModal();
      toast('Esito: ' + OUTCOMES[code].label + (amount ? ' · ' + eur(amount) : ''), 'good');
      vibrate(20);
    });
  }

  function applyOutcome(stopId, code, amount) {
    if (!S.session) return;
    if (!S.session.outcomes) S.session.outcomes = {};
    if (!S.session.skipped) S.session.skipped = [];
    if (!code) {
      const prev = S.session.outcomes[stopId];
      delete S.session.outcomes[stopId];
      if (prev) {
        const wasDelivered = !!(OUTCOMES[prev.code] && OUTCOMES[prev.code].delivered);
        if (wasDelivered) delete S.session.done[stopId];
        else S.session.skipped = S.session.skipped.filter((x) => x !== stopId);
      }
    } else {
      S.session.outcomes[stopId] = { code: code, amount: code === 'paid' ? amount : null, at: Date.now() };
      const d = OUTCOMES[code];
      if (d && d.delivered) {
        if (!S.session.done[stopId]) S.session.done[stopId] = Date.now();
        S.session.skipped = S.session.skipped.filter((x) => x !== stopId);
      } else {
        delete S.session.done[stopId];
        if (S.session.skipped.indexOf(stopId) === -1) S.session.skipped.push(stopId);
      }
    }
    saveDB();
    renderStops(); drawMarkers(); renderGiroChrome(); updateEta();
    const act = activeStops();
    const ov = (Nav.active && Nav.overrideDest) ? Nav.overrideDest : null;
    if (Nav.active && !ov) {
      if (!act.length) { stopNav(); computePreview(true); return; }
      Nav.route = null; Nav.spoken = {}; Nav.lastAlong = null;
      computePreview(false);
      refreshNavRoute();
      return;
    }
    computePreview(true);
  }

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
    const dest = Nav.overrideDest || act[0] || null;
    if (!dest) { toast('Nessuna tappa da raggiungere', 'bad'); return; }
    if (db.settings.ztlWarn !== false) {
      const city = (S.giro && S.giro.city) ? S.giro.city.trim() : '';
      if (city) {
        setTimeout(() => toast('Routing senza autostrada, ma ' + esc(city) + ' ha ZTL/divieti locali che il percorso non conosce: controlla la segnaletica prima di entrare.', 'warn'), 900);
      }
    }
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
    speak('Navigazione avviata verso ' + (dest.name || dest.address || 'la prossima tappa'));
    toast('Navigazione avviata · solo strade senza autostrada', 'good');
  }

  function stopNav(silent) {
    Nav.active = false;
    Nav.overrideDest = null;
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
    S.me = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, speed: pos.coords.speed, ts: Date.now(), head: pos.coords.heading };
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
    const dest = Nav.overrideDest || activeStops()[0] || null;
    if (!dest || !S.me) return;
    Nav.busy = true;
    try {
      const r = await routePoints([stopPoint(S.me), stopPoint(dest)], { allowHighways: !!S.allowHighways });
      const leg = r.legs[0];
      if (!leg) throw new Error('nessun percorso');
      Nav.route = leg;
      Nav.route.dest = dest;
      Nav.route.sections = r.sections;
      Nav.spoken = {};
      Nav.lastAlong = null;
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
          Nav.lastAlong = null;
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
    // inversione a U: stiamo tornando indietro lungo il percorso
    const speed = (typeof S.me.speed === 'number' && isFinite(S.me.speed)) ? S.me.speed : 0;
    if (Nav.lastAlong == null) Nav.lastAlong = pr.along;
    else if (speed > 5 && pr.along < Nav.lastAlong - 40) {
      Nav.lastAlong = null;
      toast('Inversione rilevata · ricalcolo', 'bad');
      refreshNavRoute();
      return;
    } else {
      Nav.lastAlong = pr.along;
    }
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
    if (pr.d > 55 && S.me.acc < 60) Nav.offCount++; else Nav.offCount = 0;
    if (Nav.offCount >= 4) { Nav.offCount = 0; refreshNavRoute(); }
  }
  function digest(s) { let h = 0; s = String(s || ''); for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return h; }
  function navKey(i, k) { return i + ':' + k; }

  function arrive() {
    if (Nav.overrideDest) {
      const d = Nav.overrideDest;
      Nav.overrideDest = null;
      stopNav();
      if (d.id && S.giro) {
        const st = S.giro.stops.find((x) => x.id === d.id);
        if (st) { S.session.done[st.id] = Date.now(); saveDB(); renderStops(); drawMarkers(); renderGiroChrome(); }
      }
      toast('Arrivato: ' + (d.name || d.address || 'destinazione'), 'good');
      speak('Sei arrivato');
      updateEta(); computePreview(true);
      return;
    }
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
    if (!$('#nav-osmand')) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.id = 'nav-osmand';
      b.style.padding = '16px';
      b.innerHTML = '🟠 Apri OsmAnd <small style="color:#8fa1bd;font-weight:400">(offline, profili camion)</small>';
      b.addEventListener('click', () => { $('#navmenu').classList.remove('on'); if (S.pendingStop) openOsmAndFor(S.pendingStop); });
      $('#nav-google').parentNode.insertBefore(b, $('#nav-google').nextSibling);
    }
    const hint = $('#navmenu .hint');
    if (hint) {
      hint.innerHTML = 'La navigazione in app rispetta <b>altezza, peso e larghezza</b> del mezzo. Google Maps accetta “evita autostrade”, ma non conosce le misure del camioncino. OsmAnd funziona <b>offline</b> e ha profili camion, ma va configurato a mano (profilo mezzo, ZTL): il tasto apre il selettore app di Android, scegli OsmAnd.';
    }
    $('#navmenu').classList.add('on');
  }

  function openGoogleFor(st) {
    const u = 'https://www.google.com/maps/dir/?api=1&destination=' + st.lat + ',' + st.lng + '&travelmode=driving&dir_action=navigate&avoid=highways';
    window.open(u, '_blank');
  }

  function openOsmAndFor(st) {
    // OsmAnd: intent Android. Apre OsmAnd (o chiede con quale app aprire), funziona offline.
    const nm = encodeURIComponent((st.name || st.address || 'tappa').slice(0, 60));
    const coords = st.lat + ',' + st.lng;
    const geo = 'geo:' + coords + '?q=' + coords + '(' + nm + ')';
    try { window.location.href = geo; }
    catch (e) { window.open('https://osmand.net/map/?pin=' + coords, '_blank'); }
  }

  /* ---------- comandi vocali (push-to-talk) ---------- */
  const SRClass = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listeningVoice = false, voiceFinalText = '';

  function initVoice() {
    const btn = $('#btn-mic');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!SRClass) { toast('Comandi vocali non supportati: usa Chrome su Android', 'bad'); return; }
      if (listeningVoice) stopVoice(); else startVoice();
    });
    const x = $('#voice-cancel');
    if (x) x.addEventListener('click', stopVoice);
  }

  function startVoice() {
    if (listeningVoice) return;
    voiceFinalText = '';
    try { window.speechSynthesis.cancel(); } catch (e) { }
    try {
      rec = new SRClass();
      rec.lang = 'it-IT';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onstart = () => {
        listeningVoice = true;
        $('#voice-bar').hidden = false;
        $('#voice-heard').textContent = 'Ti ascolto…';
        $('#btn-mic').classList.add('listening');
      };
      rec.onresult = (e) => {
        let interim = '', final = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const tr = e.results[i][0].transcript;
          if (e.results[i].isFinal) final += tr; else interim += tr;
        }
        if (final) voiceFinalText = final.trim();
        $('#voice-heard').textContent = (final || interim).trim() || 'Ti ascolto…';
      };
      rec.onerror = (e) => {
        const m = {
          'not-allowed': 'Microfono non autorizzato: concedi il permesso',
          'no-speech': 'Non ho sentito niente',
          'audio-capture': 'Microfono non disponibile',
          'network': 'Riconoscimento non disponibile: serve la rete'
        };
        toast(m[e.error] || ('Microfono: ' + e.error), 'bad');
      };
      rec.onend = () => {
        listeningVoice = false;
        $('#btn-mic').classList.remove('listening');
        setTimeout(() => { const b = $('#voice-bar'); if (b) b.hidden = true; }, 800);
        if (voiceFinalText) runVoiceText(voiceFinalText);
      };
      rec.start();
    } catch (e) { toast('Microfono non avviato', 'bad'); }
  }

  function stopVoice() {
    listeningVoice = false;
    if (rec) { try { rec.stop(); } catch (e) { } }
    const b = $('#voice-bar'); if (b) b.hidden = true;
    const btn = $('#btn-mic'); if (btn) btn.classList.remove('listening');
  }

  function parseVoiceCommand(raw) {
    const t = ' ' + String(raw || '').toLowerCase().replace(/[.,!?;]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    if (/\b(salta|salta tappa|salta consegna|prossima tappa)\b/.test(t)) return { intent: 'skip' };
    if (/\b(ferma|stop|interrompi)\b/.test(t) && /\b(navigazione|naviga|percorso)\b/.test(t)) return { intent: 'stop' };
    if (/\b(quanto manca|quanto tempo|tempo rimasto)\b/.test(t)) return { intent: 'eta' };
    if (/\b(apri|mostra)\b/.test(t) && /\btappe\b/.test(t)) return { intent: 'sheet' };
    if (/\b(chiudi|annulla)\b/.test(t) && /\btappe\b/.test(t)) return { intent: 'closesheet' };
    let m = t.match(/\b(?:portami|porta mi|naviga|vai|guidami)\b(?:\s+(?:a|verso|in|alla|al|da))?\s+(.+?)\s*$/);
    if (m) return { intent: 'navigate', query: m[1].replace(/^(a|verso|in|alla|al|da)\s+/, '').trim() };
    m = t.match(/\b(?:aggiungi|inserisci|nuova|nuovo|crea)\b(?:\s+(?:una|un|la|il))?\s*(.+)$/);
    if (m) {
      let q = m[1].trim();
      if (/^(via|viale|piazza|piazzale|corso|strada|largo|vicolo|indirizzo|tappa|consegna|cliente)$/i.test(q)) q = '';
      return { intent: 'add', query: q };
    }
    if (STREET_RE.test(t.trim())) return { intent: 'add', query: t.trim() };
    return { intent: 'unknown', query: '' };
  }

  async function runVoiceText(text) {
    const cmd = parseVoiceCommand(text);
    toast('“' + text + '”', 'good');
    if (cmd.intent === 'unknown') {
      toast('Non ho capito. Prova: “aggiungi via Roma 1” o “portami a via Roma 1”', 'bad');
      speak('Non ho capito');
      return;
    }
    if (!S.giro) { toast('Apri prima un giro', 'bad'); return; }
    if (cmd.intent === 'skip') {
      if (Nav.active && Nav.overrideDest) { toast('Stai andando a una destinazione libera: usa “ferma”', 'bad'); return; }
      if (Nav.active) skipCurrentNav();
      else {
        const a = activeStops()[0];
        if (a) { toggleSkip(a.id); speak('Tappa saltata'); }
        else toast('Nessuna tappa', 'bad');
      }
      return;
    }
    if (cmd.intent === 'stop') {
      if (Nav.active) { stopNav(); speak('Navigazione fermata'); }
      else toast('Navigazione non attiva', 'bad');
      return;
    }
    if (cmd.intent === 'eta') {
      const t = ($('#eta-time').textContent || '') + ' ' + ($('#eta-unit').textContent || '');
      const s = $('#eta-stop').textContent || '';
      toast('Mancano ' + t.trim() + ' per ' + s);
      speak('Mancano ' + t.trim() + ' per ' + s);
      return;
    }
    if (cmd.intent === 'sheet') { openSheet(); return; }
    if (cmd.intent === 'closesheet') { closeSheet(); return; }
    if (cmd.intent === 'add') {
      if (!cmd.query) { toast('Dimmi la via: “aggiungi via Roma 1”', 'bad'); speak('Dimmi la via'); return; }
      await voiceAddStop(cmd.query);
      return;
    }
    if (cmd.intent === 'navigate') {
      if (!cmd.query) { toast('Dimmi dove: “portami a via Roma 1”', 'bad'); speak('Dimmi dove'); return; }
      await voiceNavigate(cmd.query);
    }
  }

  function voiceZone() {
    const z = (S.giro && (S.giro.city || (!GIRO_RE.test(S.giro.name) ? S.giro.name : ''))) || '';
    return z.trim();
  }

  async function voiceAddStop(q) {
    const z = voiceZone();
    const center = z ? await resolveZone(z) : null;
    const city = center && center.city ? center.city : z;
    const query = q + ((city && q.toLowerCase().indexOf(city.toLowerCase()) === -1) ? ', ' + city : '');
    toast('Cerco “' + q + '”…');
    const res = await geocodeWithVariants(query, center, city);
    if (!res.best) {
      toast('Non trovo “' + q + '”: cercala a mano con + Aggiungi', 'bad');
      speak('Non trovo ' + q);
      return;
    }
    S.giro.stops.push({ id: uid(), name: '', address: q, lat: res.best.lat, lng: res.best.lng, notes: '', approx: !!res.approx });
    saveDB();
    renderStops({ scroll: 'bottom' });
    drawMarkers(); renderGiroChrome(); computePreview(false); updateEta();
    toast('Aggiunta: ' + q, 'good');
    speak('Aggiunta ' + q);
  }

  async function voiceNavigate(q) {
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9àèéìòù ]/g, ' ').replace(/\s+/g, ' ').trim();
    const nq = norm(q);
    let dest = null;
    if (nq.length >= 3) {
      dest = S.giro.stops.find((s) => {
        const addr = norm(s.address), nm = norm(s.name);
        return (addr && addr.indexOf(nq) !== -1) || (nm && nm.indexOf(nq) !== -1) || (addr && nq.indexOf(addr) !== -1);
      });
    }
    if (!dest) {
      const z = voiceZone();
      const center = z ? await resolveZone(z) : null;
      const city = center && center.city ? center.city : z;
      const query = q + ((city && q.toLowerCase().indexOf(city.toLowerCase()) === -1) ? ', ' + city : '');
      toast('Cerco “' + q + '”…');
      const res = await geocodeWithVariants(query, center, city);
      if (!res.best) { toast('Non trovo “' + q + '”', 'bad'); speak('Non trovo ' + q); return; }
      dest = { id: null, name: q, address: q, lat: res.best.lat, lng: res.best.lng, free: true };
    }
    if (Nav.active) stopNav();
    Nav.overrideDest = dest;
    startNav();
    speak('Ti porto a ' + (dest.name || dest.address));
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
      (isNew ? '<div class="field"><label>Oppure importa l’elenco</label>' +
        '<button class="btn" id="g-import" style="width:100%;padding:13px">📄 Importa elenco giro</button>' +
        '<div class="hint">File di testo, CSV di Excel o PDF con testo: <b>una riga = una tappa</b>, i giri si creano da soli.</div></div>' : '') +
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
    if ($('#g-import')) $('#g-import').addEventListener('click', () => { closeModal(); openImportModal(); });
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
      const pn = (g.stops || []).reduce((a, s) => a + (photoCounts[s.id] || 0), 0);
      if (!confirm('Eliminare il giro “' + g.name + '” con tutte le sue tappe?' +
        (!pn ? '' : (pn === 1
          ? ' Si cancella anche la sua foto: non si recupera.'
          : ' Si cancellano anche le ' + pn + ' foto delle consegne: non si recuperano.')))) return;
      (g.stops || []).forEach((s) => { PhotoStore.delStop(s.id).catch(() => { }); delete photoCounts[s.id]; });
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
      '<div class="switch"><div class="lbl">Avvisa ZTL/divieti locali<small>Toast quando avvi la navigazione in una città</small></div><button class="tgl ' + (db.settings.ztlWarn !== false ? 'on' : '') + '" id="s-ztl"></button></div>' +
      '<div class="switch"><div class="lbl">Autostrade<small>Bloccate: i percorsi non le usano mai. Statali e provinciali sì.</small></div><button class="tgl on locked" id="s-hw" style="opacity:.55"></button></div>' +
      '<div class="section-t">Mappa</div>' +
      '<div class="field"><label>Luminosità mappa</label><input id="s-bright" type="range" min="0.7" max="1.3" step="0.05" value="' + db.settings.brightness + '"><div class="hint">La mappa è chiara; il resto dell’app resta scuro.</div></div>' +
      '<div class="field"><label>Base mappa</label><div class="chips" id="s-map-provider">' +
      '<button data-p="openfreemap">OpenFreeMap</button><button data-p="osm">OpenStreetMap</button><button data-p="tomtom">TomTom</button></div>' +
      '<div class="hint">OpenFreeMap è vettoriale, gratuita e senza chiave: è quella che abilita il 3D. OpenStreetMap e TomTom sono raster (nessun 3D); TomTom usa la chiave qui sopra.</div></div>' +
      '<div class="section-t">Traffico (TomTom)</div>' +
      '<div class="field"><label>Chiave API TomTom</label>' +
      '<input id="s-tt" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="incolla qui la chiave" value="' + esc(db.settings.tomtomKey || '') + '">' +
      '<div class="hint">Con la chiave i tempi e i tratti colorati usano il traffico TomTom. La chiave resta <b>solo su questo telefono</b> e non finisce nel backup né nel repository. Senza chiave l’app funziona come prima, con tempi senza traffico.<br><br>La chiave è <b>consigliata</b>: senza di essa l’import degli indirizzi trova meno civici e più lenta (usa Nominatim). TomTom è gratuito e basta per un uso personale.</div></div>' +
      '<div class="btn-row"><button class="btn" id="s-tt-verify">Verifica chiave</button><button class="btn" id="s-tt-clear">Rimuovi</button></div>' +
      '<div class="section-t">Dati</div>' +
      (function () {
        const d = db.lastExport ? Date.now() - db.lastExport : null;
        const days = d == null ? null : Math.floor(d / 864e5);
        return days == null ? '' : ('<p class="hint" style="margin:0 0 8px">Ultimo backup: ' + (days < 1 ? 'oggi' : days + (days === 1 ? ' giorno' : ' giorni') + ' fa') + (days >= 7 ? ' · <span style="color:#ffb4b4">Fai un backup</span>' : '') + '</p>');
      })() +
      '<div class="btn-row"><button class="btn" id="s-export">Esporta backup</button><button class="btn" id="s-import">Importa</button></div>' +
      '<button class="btn" id="s-reset-day" style="width:100%;margin-top:9px">Azzera il giro di oggi</button>' +
      '<button class="btn" id="s-update" style="width:100%;margin-top:9px">Forza aggiornamento app</button>' +
      '<button class="btn" id="s-changelog" style="width:100%;margin-top:9px">📋 Cosa è cambiato (dalla build 40)</button>' +
      '<button class="btn danger" id="s-wipe" style="width:100%;margin-top:9px">Cancella tutti i dati</button>' +
      '<p class="hint">I dati stanno solo in questo telefono: se cancelli la cache del browser o cambi telefono, senza backup li perdi. <b>Le foto delle consegne non entrano nel backup</b>: per tenerle, scaricale dalla foto stessa (⬇).</p>' +
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
    $('#s-ztl').addEventListener('click', (e) => { db.settings.ztlWarn = db.settings.ztlWarn === false; e.target.classList.toggle('on', db.settings.ztlWarn !== false); saveDB(); });
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
    $('#s-update').addEventListener('click', async () => {
      if (!confirm('Forzare l’aggiornamento?\nViene svuotata la cache della mappa offline; giri, tappe e chiave restano.')) return;
      flushDB();
      try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); } catch (e) { }
      try { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); } catch (e) { }
      location.replace(location.pathname + '?u=' + Date.now());
    });
    if ($('#s-import-list')) $('#s-import-list').addEventListener('click', () => { closeModal(); openImportModal(); });
    if ($('#s-changelog')) $('#s-changelog').addEventListener('click', () => { closeModal(); openChangelog(); });
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
      S.session = { giroId: S.giro.id, date: todayISO(), done: {}, skipped: [], outcomes: {}, startedAt: Date.now() };
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

  /* ---------- lettura PDF (pdf.js caricato solo quando serve) ---------- */
  let pdfLibPromise = null;
  function loadPdfLib() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfLibPromise) return pdfLibPromise;
    pdfLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js';
      s.onload = () => {
        try {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        } catch (e) { }
        resolve(window.pdfjsLib);
      };
      s.onerror = () => { pdfLibPromise = null; reject(new Error('cdn')); };
      document.head.appendChild(s);
    });
    return pdfLibPromise;
  }

  async function pdfToText(file) {
    const lib = await loadPdfLib();
    const buf = await file.arrayBuffer();
    const doc = await lib.getDocument({ data: buf }).promise;
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const rows = [];
      tc.items.forEach((it) => {
        const str = String(it.str || '');
        if (!str.trim()) return;
        const y = it.transform[5];
        let row = rows.find((r) => Math.abs(r.y - y) <= 3);
        if (!row) { row = { y: y, items: [] }; rows.push(row); }
        row.items.push({ x: it.transform[4], s: str });
      });
      rows.sort((a, b) => b.y - a.y);
      rows.forEach((r) => {
        const line = r.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim();
        if (line) out.push(line);
        // stacco fra blocchi molto distanti: aiuta il parser a riconoscere i titoli
        else out.push('');
      });
    }
    try { doc.cleanup(); } catch (e) { }
    return out.join('\n');
  }

  function openImportModal() {
    openModal('' +
      '<div class="modal-head"><b>Importa elenco giro</b><button class="x" id="i-close">✕</button></div>' +
      '<p class="hint" style="margin-top:-6px">Incolla il testo o scegli il file. <b>Una riga = una tappa</b>. Una riga con “Giro …”, “Giorno …”, “Lunedì …” apre un nuovo giro. Esempio:<br><code>Giro 1 - Verona</code><br><code>Via Roma 1 - Rossi</code><br><code>Via Mazzini 10 (piano 3, citofono)</code></p>' +
      '<details style="margin:0 0 6px"><summary style="cursor:pointer;color:#9db4d6;font-size:12px">Formati accettati e come prepararli</summary>' +
      '<div class="hint" style="margin-top:7px;line-height:1.55">' +
      '<b>.txt</b> — Notepad del telefono: una riga per indirizzo, salva come testo. È il formato più affidabile.<br>' +
      '<b>.csv</b> — da Excel o Fogli Google “Salva come / Scarica → CSV”. Se la prima riga ha intestazioni tipo <i>Cliente, Indirizzo, Note, Giro</i>, le uso per sistemare le colonne.<br>' +
      '<b>.pdf</b> — solo se il testo si può selezionare col dito (non scansioni o fotografie). Il PDF viene letto e copiato qui sotto: <b>controlla sempre il riepilogo</b> prima di importare. Per leggere un PDF serve la rete.<br>' +
      '<b>Excel .xlsx</b> — non supportato direttamente: salvalo in CSV.' +
      '</div></details>' +
      '<div class="field"><label>Elenco</label><textarea id="i-text" style="min-height:150px" placeholder="Giro 1 - Verona&#10;Via Roma 1 - Rossi&#10;Via Mazzini 10 (piano 3)&#10;&#10;Giro 2 - Vicenza&#10;..."></textarea>' +
      '<div class="chips" style="margin-top:8px"><button id="i-file">📄 Scegli file (.txt .csv .pdf)</button><button id="i-clear">Svuota</button></div></div>' +
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
      inp.type = 'file'; inp.accept = '.txt,.csv,.tsv,.pdf,text/plain,text/csv,application/pdf';
      inp.addEventListener('change', async () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const isPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
        if (!isPdf) {
          try {
            ta.value = await f.text();
            refresh();
            const n = parseList(ta.value).reduce((a, g) => a + g.stops.length, 0);
            toast(n ? 'File letto: ' + n + ' tappe' : 'File letto, ma nessuna via riconosciuta', n ? 'good' : 'bad');
          } catch (e) { toast('File non leggibile', 'bad'); }
          return;
        }
        const btn = $('#i-file'); const old = btn.textContent;
        btn.textContent = 'Leggo il PDF…'; btn.disabled = true;
        try {
          const txt = await pdfToText(f);
          if (!txt || !txt.trim()) throw new Error('vuoto');
          ta.value = txt;
          refresh();
          const n = parseList(txt).reduce((a, g) => a + g.stops.length, 0);
          if (n) toast('PDF letto: ' + n + ' tappe riconosciute · controlla l’elenco', 'good');
          else toast('PDF letto, ma nessuna via riconosciuta: correggi l’elenco a mano', 'bad');
        } catch (e) {
          toast(e && e.message === 'cdn'
            ? 'Per leggere i PDF serve la rete: riprova online'
            : 'PDF senza testo (scansione o foto): non riesco a leggerlo', 'bad');
        } finally {
          btn.textContent = old; btn.disabled = false;
        }
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
            const res = await geocodeWithVariants(q, t.center, t.cityLabel);
            t.res = res.best;
            if (res.outside) t.outside = true;
            if (res.approx) t.approx = true;
          } catch (e) { t.res = null; }
          tick();
        }
      };
      await Promise.all(Array.from({ length: Math.min(workers, total) }, work));
    }

    let withNum = 0, noNum = 0, failed = 0, outside = 0, approx = 0;
    const failedAddrs = [];
    tasks.forEach((t) => {
      const r = t.res || null;
      if (r) { if (r.num) withNum++; else noNum++; } else if (geoOn) failed++;
      if (t.outside) outside++;
      if (t.approx) approx++;
      if (geoOn && !r && t.s.address) failedAddrs.push(t.s.address + (t.cityLabel ? ' — ' + t.cityLabel : ''));
      t.ng.stops.push({
        id: uid(),
        name: (t.s.name && t.city && t.s.name.toLowerCase() === t.city.toLowerCase()) ? '' : (t.s.name || ''),
        address: t.s.address || '',
        lat: r ? r.lat : null,
        lng: r ? r.lng : null,
        notes: t.s.notes || '',
        approx: !!t.approx
      });
    });

    created.forEach(({ ng }) => db.giri.push(ng));
    saveDB();
    const totStops = tasks.length;
    openModal('<div class="modal-head"><b>Importazione completata</b><button class="x" id="i-done">✕</button></div>' +
      '<p class="hint" style="margin-top:-6px"><b>' + created.length + ' giri</b> e <b>' + totStops + ' tappe</b> importati.</p>' +
      (geoOn ? '<p class="hint">Civico esatto: <b>' + withNum + '</b><br>Senza civico: <b>' + noNum + '</b><br>Non trovate: <b>' + failed + '</b>' + (outside ? '<br>Fuori zona: <b>' + outside + '</b>' : '') + (approx ? '<br>Civico approssimato: <b>' + approx + '</b>' : '') + '</p>' : '<p class="hint">Nessuna ricerca coordinate: apri le tappe e usa “Posiziona il pin”.</p>') +
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
        const res = await geocodeWithVariants(q, center, cityLabel);
        best = res.best;
        if (res.outside) outside++;
        if (res.approx) s.approx = true; else s.approx = false;
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

  const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * Math.pow(2, z));
  const lat2y = (lat, z) => {
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
  };

  async function prepareOffline() {
    if (!S.giro) return;
    if (mapProvider() !== 'openfreemap') { toast('Per l’offline usa OpenFreeMap come base mappa', 'bad'); return; }
    const pts = (S.shownRoute && S.shownRoute.coords && S.shownRoute.coords.length > 1)
      ? S.shownRoute.coords
      : S.giro.stops.filter(hasCoords);
    if (!pts.length) { toast('Nessuna tappa posizionata', 'bad'); return; }
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    pts.forEach((p) => { minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat); minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng); });
    const pad = 0.008;
    openModal('<div class="modal-head"><b>Preparo la mappa offline</b></div>' +
      '<p class="hint" id="o-status">Scarico i tile della zona…</p>' +
      '<div style="height:8px;background:#1e293b;border-radius:6px;overflow:hidden"><div id="o-bar" style="height:100%;width:0;background:linear-gradient(90deg,#2563eb,#22d3ee);transition:width .2s"></div></div>' +
      '<p class="hint" id="o-size">0 MB</p>');
    let tmpl = null;
    try {
      const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
      tmpl = tj && tj.tiles && tj.tiles[0];
    } catch (e) { }
    if (!tmpl) { closeModal(); toast('Servizio mappe non raggiungibile', 'bad'); return; }
    const list = [];
    for (let z = 10; z <= 14; z++) {
      const x0 = lon2x(minLng - pad, z), x1 = lon2x(maxLng + pad, z);
      const y0 = lat2y(maxLat + pad, z), y1 = lat2y(minLat - pad, z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) list.push(tmpl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    }
    const uniq = Array.from(new Set(list)).slice(0, 3000);
    const cache = await caches.open('pasomaps-tiles');
    let idx = 0, ok = 0, fail = 0, bytes = 0;
    const cap = 45 * 1024 * 1024;
    const bar = $('#o-bar'), status = $('#o-status'), sizeEl = $('#o-size');
    const upd = () => {
      if (bar) bar.style.width = Math.round((idx / uniq.length) * 100) + '%';
      if (status) status.textContent = 'Scarico la mappa… ' + idx + ' / ' + uniq.length;
      if (sizeEl) sizeEl.textContent = (bytes / 1048576).toFixed(1) + ' MB';
    };
    const work = async () => {
      while (idx < uniq.length && bytes < cap) {
        const u = uniq[idx++];
        try {
          const hit = await cache.match(u);
          if (hit) { bytes += (await hit.clone().blob()).size; ok++; }
          else {
            const res = await fetch(u);
            if (res.ok) {
              const blob = await res.clone().blob();
              bytes += blob.size; ok++;
              await cache.put(u, res);
            } else fail++;
          }
        } catch (e) { fail++; }
        upd();
      }
    };
    await Promise.all([work(), work(), work(), work()]);
    const mb = (bytes / 1048576).toFixed(1);
    try { localStorage.setItem('pasomaps.offline.' + S.giro.id, JSON.stringify({ at: Date.now(), tiles: ok, bytes: bytes })); } catch (e) { }
    const btn = $('#btn-offline');
    if (btn) btn.style.color = '#22c55e';
    openModal('<div class="modal-head"><b>Offline pronto</b><button class="x" id="o-done">✕</button></div>' +
      '<p class="hint" style="margin-top:-6px"><b>' + ok + '</b> tile scaricati · <b>' + mb + ' MB</b>' + (fail ? '<br>' + fail + ' non scaricati' : '') + '</p>' +
      '<p class="hint">Ora la zona del giro resta visibile senza rete. I ricalcoli e il traffico richiedono comunque connessione.</p>' +
      '<button class="btn primary" id="o-done2" style="width:100%;margin-top:10px">Chiudi</button>');
    if ($('#o-done')) $('#o-done').addEventListener('click', closeModal);
    if ($('#o-done2')) $('#o-done2').addEventListener('click', closeModal);
    toast('Offline pronto · ' + ok + ' tile · ' + mb + ' MB', 'good');
  }



    function commitStopOrder() {
      const ids = Array.from(document.querySelectorAll('#stops-list .stop-item')).map((x) => x.getAttribute('data-id'));
      const map = {};
      S.giro.stops.forEach((s) => { map[s.id] = s; });
      const next = ids.map((id) => map[id]).filter(Boolean);
      S.giro.stops.forEach((s) => { if (next.indexOf(s) === -1) next.push(s); });
      S.giro.stops = next;
      saveDB();
      renderStops();
      drawMarkers(); renderGiroChrome(); updateEta(); computePreview(false);
      if (Nav.active) { Nav.route = null; Nav.spoken = {}; Nav.lastAlong = null; refreshNavRoute(); }
      toast('Ordine aggiornato', 'good');
    }

    function moveStopBy(id, dir) {
      if (!S.giro) return;
      const arr = S.giro.stops;
      const i = arr.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return;
      const [it] = arr.splice(i, 1);
      arr.splice(j, 0, it);
      saveDB();
      renderStops();
      drawMarkers(); updateEta(); computePreview(false);
      if (Nav.active) { Nav.route = null; Nav.spoken = {}; Nav.lastAlong = null; refreshNavRoute(); }
      toast('Tappa spostata', 'good');
      vibrate(12);
    }

    function attachStopDrag() {
      const list = $('#stops-list');
      if (!list || list.__dragBound) return;
      list.__dragBound = true;
      let st = null;
      const clearTimer = () => { if (st && st.timer) { clearTimeout(st.timer); st.timer = 0; } };
      const blockScroll = (e) => { if (st && st.dragging) e.preventDefault(); };
      const finish = () => {
        if (!st) return;
        clearTimer();
        document.removeEventListener('touchmove', blockScroll);
        if (st.dragging) { st.item.classList.remove('dragging'); commitStopOrder(); }
        st = null;
      };
      const begin = () => {
        if (!st) return;
        st.dragging = true;
        st.item.classList.add('dragging');
        document.addEventListener('touchmove', blockScroll, { passive: false });
        try { if (navigator.vibrate) navigator.vibrate(18); } catch (e) { }
        if (!S.__dragHint) { S.__dragHint = true; toast('Sposta la tappa dove vuoi, poi rilascia', 'good'); }
      };
      const onDown = (e) => {
        const item = e.target.closest ? e.target.closest('.stop-item') : null;
        if (!item || (e.target.closest && e.target.closest('button'))) return;
        if (e.touches && e.touches.length > 1) return;
        const y = e.clientY;
        st = { item: item, startY: y, dragging: false, timer: setTimeout(begin, 450) };
      };
      const onMove = (e) => {
        if (!st) return;
        const y = e.clientY;
        if (!st.dragging) {
          if (Math.abs(y - st.startY) > 10) { clearTimer(); st = null; }
          return;
        }
        if (e.cancelable) e.preventDefault();
        const el = document.elementFromPoint(e.clientX, y);
        const over = el && el.closest ? el.closest('.stop-item') : null;
        if (over && over !== st.item) {
          const r = over.getBoundingClientRect();
          const before = y < r.top + r.height / 2;
          over.parentNode.insertBefore(st.item, before ? over : over.nextSibling);
        }
        const body = $('#sheet-body');
        if (body) {
          const br = body.getBoundingClientRect();
          if (y < br.top + 70) body.scrollTop -= 8;
          else if (y > br.bottom - 70) body.scrollTop += 8;
        }
      };
      list.addEventListener('pointerdown', onDown);
      document.addEventListener('pointermove', onMove, { passive: false });
      document.addEventListener('pointerup', finish);
      document.addEventListener('pointercancel', finish);
    }

    async function skipCurrentNav() {
    const act = activeStops();
    if (!act.length) { toast('Nessuna tappa da saltare', 'bad'); return; }
    const st = act[0];
    if (S.session.skipped.indexOf(st.id) === -1) S.session.skipped.push(st.id);
    saveDB();
    renderStops(); drawMarkers(); renderGiroChrome();
    const next = activeStops()[0];
    const name = st.name || st.address || 'tappa';
    if (!next) {
      stopNav();
      updateEta();
      computePreview(true);
      toast('Saltata: ' + name + ' · giro completato', 'good');
      vibrate(20);
      return;
    }
    if (Nav.active) {
      Nav.route = null; Nav.spoken = {}; Nav.lastAlong = null;
      updateEta();
      computePreview(false);
      refreshNavRoute();
      toast('Saltata: ' + name + ' · prossima: ' + (next.name || next.address), 'good');
    } else {
      updateEta();
      computePreview(true);
      toast('Saltata: ' + name, 'good');
    }
    vibrate(20);
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

  /* ---------- changelog: cosa è cambiato negli aggiornamenti ---------- */
  function buildNumber() {
    const m = String(APP_BUILD).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  async function fetchChangelog() {
    try {
      const res = await fetch('changelog.json?ts=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  async function showUpdateBar() {
    const bar = $('#update-bar');
    if (!bar) return;
    bar.hidden = false;
    const cur = buildNumber();
    const j = await fetchChangelog();
    if (!j || !Array.isArray(j.builds)) return;
    const newer = j.builds.filter((b) => b.build > cur).sort((a, b) => b.build - a.build);
    if (!newer.length) return;
    const top = newer[0];
    if (Array.isArray(top.changes) && top.changes.length) {
      bar.innerHTML = '<div class="ub-title">Aggiornamento alla build ' + top.build + ' — tocca per aggiornare</div>' +
        '<ul class="ub-list">' + top.changes.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>';
    }
  }

  async function showWhatsNew() {
    const cur = buildNumber();
    if (!cur) return;
    let seen = 0;
    try { seen = parseInt(localStorage.getItem('pasomaps.seenBuild') || '0', 10) || 0; } catch (e) { }
    try { localStorage.setItem('pasomaps.seenBuild', String(cur)); } catch (e) { }
    if (seen >= cur) return;
    if (!seen && !(db.giri && db.giri.length)) return;
    const j = await fetchChangelog();
    if (!j || !Array.isArray(j.builds)) return;
    const entry = j.builds.find((b) => b.build === cur);
    if (!entry || !Array.isArray(entry.changes) || !entry.changes.length) return;
    openModal('<div class="modal-head"><b>Cosa è cambiato · build ' + cur + '</b><button class="x" id="n-close">✕</button></div>' +
      '<ul class="news-list">' + entry.changes.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>' +
      '<button class="btn" id="n-all" style="width:100%;margin-top:9px">Vedi tutti gli aggiornamenti dalla build 40</button>' +
      '<button class="btn primary" id="n-ok" style="width:100%;margin-top:9px">OK</button>');
    if ($('#n-close')) $('#n-close').addEventListener('click', closeModal);
    if ($('#n-all')) $('#n-all').addEventListener('click', openChangelog);
    if ($('#n-ok')) $('#n-ok').addEventListener('click', closeModal);
  }

  async function openChangelog() {
    const cur = buildNumber();
    toast('Carico gli aggiornamenti…');
    const j = await fetchChangelog();
    if (!j || !Array.isArray(j.builds)) {
      toast('Elenco non disponibile: serve la rete', 'bad');
      return;
    }
    const list = j.builds.filter((b) => b.build >= 40 && Array.isArray(b.changes) && b.changes.length)
      .sort((a, b) => b.build - a.build);
    if (!list.length) { toast('Nessun aggiornamento da mostrare', 'bad'); return; }
    const latest = list[0].build;
    openModal('' +
      '<div class="modal-head"><b>Aggiornamenti</b><button class="x" id="cl-close">✕</button></div>' +
      '<p class="hint" style="margin-top:-6px">Dalla build <b>40</b> alla <b>' + latest + '</b>, dal più recente al più vecchio. ' +
      (cur ? 'Su questo telefono è installata la <b>' + cur + '</b>.' : '') + '</p>' +
      list.map((b) => '<div class="log-build' + (b.build === cur ? ' now' : '') + '">' +
        '<div class="log-n">Build ' + b.build + (b.build === cur ? ' · installata' : '') + '</div>' +
        '<ul class="news-list">' + b.changes.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>' +
        '</div>').join('') +
      '<div class="btn-row"><button class="btn" id="cl-done">Chiudi</button></div>');
    if ($('#cl-close')) $('#cl-close').addEventListener('click', closeModal);
    if ($('#cl-done')) $('#cl-done').addEventListener('click', closeModal);
  }

  /* =============================== P. EVENTI =============================== */
  function bind() {
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-new-giro').addEventListener('click', () => openGiroModal(null));
    $('#btn-free').addEventListener('click', openFreeMode);
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
    $('#btn-cam').addEventListener('click', () => {
      const act = activeStops();
      const ov = (Nav.active && Nav.overrideDest) ? Nav.overrideDest : null;
      const st = ov ? (ov.id && S.giro ? S.giro.stops.find((s) => s.id === ov.id) : null) : act[0];
      if (!st) { toast('Nessuna consegna da fotografare', 'bad'); return; }
      openPhotos(st.id);
    });
    $('#btn-offline').addEventListener('click', prepareOffline);
    $('#nb-refresh').addEventListener('click', () => {
      if (!Nav.active) return;
      toast('Ricalcolo percorso…');
      refreshNavRoute();
    });
    $('#nav-skip').addEventListener('click', skipCurrentNav);
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
        if (act === 'photo') { openPhotos(id); }
        if (act === 'outcome') { openOutcomeModal(id); }
        if (act === 'up') { moveStopBy(id, -1); }
        if (act === 'down') { moveStopBy(id, 1); }
        return;
      }
      if (center) {
        const st = S.giro.stops.find((s) => s.id === center.getAttribute('data-center'));
        if (st && isFinite(st.lat)) { closeSheet(); map.easeTo({ center: [st.lng, st.lat], zoom: 16, duration: 500 }); }
      }
    });
    attachStopDrag();
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
    initVoice();
    refreshPhotoCounts().then(() => { if (S.giro) { renderStops(); updateEta(); } });

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
    setTimeout(showWhatsNew, 900);

    // service worker (solo se servito da http/https)
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) return;
        showUpdateBar();
      });
      navigator.serviceWorker.register('sw.js').catch(() => { });
    }
    const ub = $('#update-bar');
    if (ub) ub.addEventListener('click', () => location.reload());
    const bt = $('#build-tag');
    if (bt) bt.textContent = APP_BUILD;
    // iOS: le voci arrivano in ritardo
    if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = () => { voiceIt = null; };
    window.PasoMaps = { db: () => db, S: S, Nav: Nav, getMap: () => map, computePreview: computePreview, voice: { parse: parseVoiceCommand, run: runVoiceText }, photos: { open: openPhotos, counts: () => photoCounts, refresh: refreshPhotoCounts }, imports: { parse: parseList, pdf: pdfToText } };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
