// Custom routes: the player types a start and a finish anywhere in Edmonton, the game finds
// them (address search), plans the drive (OSRM) and builds the map in a background thread
// (src/mapgen/worker.js) with the same code and data as the built-in maps, showing a
// progress bar. Finished maps are kept on this device (IndexedDB) and listed under "Your
// routes". The typed places only go to the free search and route services (Photon or
// Nominatim, OSRM) and never to the leaderboard: custom routes have no online board.
import { insideEdmonton, EDMONTON_BBOX, CUSTOM_MIN_KM, CUSTOM_MAX_KM, osrmRouteUrl } from './mapgen/edmonton.js';

export const MAX_SAVED_ROUTES = 12;
export const isCustomId = (id) => typeof id === 'string' && id.startsWith('custom-');
const MAX_SAVED = MAX_SAVED_ROUTES;

// ---------- storage (IndexedDB: small entries for the menu, map files apart) ----------
const DB_NAME = 'driveHome';
const META = 'customMeta';
const DATA = 'customData';
let dbPromise = null;
function openDB() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(META, { keyPath: 'id' });
      req.result.createObjectStore(DATA);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function run(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const req = fn(tx);
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('storage aborted'));
  });
}
// Menu entries of the saved routes, newest first ([] where storage is unavailable).
export async function listCustomRoutes() {
  try {
    const all = await run([META], 'readonly', (tx) => tx.objectStore(META).getAll());
    return (all ?? []).sort((a, b) => b.created - a.created);
  } catch {
    return [];
  }
}
export async function loadCustomRoute(id) {
  const data = await run([DATA], 'readonly', (tx) => tx.objectStore(DATA).get(id));
  if (!data) throw Object.assign(new Error('That route is no longer saved on this device.'), { gone: true });
  return data;
}
export async function deleteCustomRoute(id) {
  await run([META, DATA], 'readwrite', (tx) => {
    tx.objectStore(META).delete(id);
    tx.objectStore(DATA).delete(id);
  });
}
// Saves a new route; past MAX_SAVED the oldest ones go, in the same transaction (so a failed
// save loses nothing). Returns the menu entries of the routes it dropped.
async function saveCustomRoute(meta, data) {
  const dropped = (await listCustomRoutes()).slice(MAX_SAVED - 1);
  await run([META, DATA], 'readwrite', (tx) => {
    tx.objectStore(META).put(meta);
    tx.objectStore(DATA).put(data, meta.id);
    for (const m of dropped) {
      tx.objectStore(META).delete(m.id);
      tx.objectStore(DATA).delete(m.id);
    }
  });
  return dropped;
}

// ---------- finding places ----------
// Photon (komoot) answers as you type; Nominatim (OpenStreetMap) is the fallback, only on
// Enter (its rules forbid search-as-you-type). Both are limited to Edmonton's box, and
// results outside the city limits are dropped.
function photonPlace(f) {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const addr = [p.housenumber, p.street].filter(Boolean).join(' ');
  const short = p.name || addr || p.district || 'Map point';
  const detail = [p.name && addr ? addr : null, p.district || p.locality, p.name || addr ? null : p.city].filter(Boolean).join(', ');
  return { label: short, detail, short, lon, lat, kind: `${p.osm_key}/${p.osm_value}` };
}
async function photon(text, signal) {
  const [w, s, e, n] = EDMONTON_BBOX;
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=8&lang=en&bbox=${w},${s},${e},${n}&lat=53.54&lon=-113.49`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`search ${r.status}`);
  return (await r.json()).features.map(photonPlace);
}
// Nominatim's rules: at most one request a second, and cache the answers.
const nominatimCache = new Map();
let nominatimLast = 0;
async function nominatim(text, signal) {
  const key = text.toLowerCase();
  if (nominatimCache.has(key)) return nominatimCache.get(key);
  const wait = nominatimLast + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  nominatimLast = Date.now();
  const list = await nominatimFetch(text, signal);
  nominatimCache.set(key, list);
  return list;
}
async function nominatimFetch(text, signal) {
  const [w, s, e, n] = EDMONTON_BBOX;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&bounded=1&viewbox=${w},${n},${e},${s}&q=${encodeURIComponent(text)}`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`search ${r.status}`);
  return (await r.json()).map((p) => {
    const parts = p.display_name.split(', ');
    const short = p.name || parts[0];
    return { label: short, detail: parts.slice(1, 3).join(', '), short, lon: +p.lon, lat: +p.lat, kind: `${p.category}/${p.type}` };
  });
}
async function searchPlaces(text, signal, { fallback = false } = {}) {
  const q = text.trim();
  // "53.52, -113.62" (or the other way round) is a map point.
  const c = q.match(/^(-?\d{1,3}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)$/);
  if (c) {
    const a = +c[1];
    const b = +c[2];
    const [lat, lon] = a > 0 ? [a, b] : [b, a];
    return insideEdmonton(lon, lat) ? [{ label: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, detail: 'Map point', short: 'Map point', lon, lat, kind: '' }] : [];
  }
  let list;
  let asked = false; // Nominatim at most once per search
  try {
    list = await photon(q, signal);
  } catch (e) {
    if (e.name === 'AbortError' || !fallback) throw e;
    asked = true;
    list = await nominatim(q, signal);
  }
  if (!list.length && fallback && !asked) list = await nominatim(q, signal).catch(() => []);
  const seen = new Set();
  return list.filter((p) => {
    const k = `${p.label}|${p.lon.toFixed(4)}|${p.lat.toFixed(4)}`;
    if (seen.has(k) || !insideEdmonton(p.lon, p.lat)) return false;
    seen.add(k);
    return true;
  }).slice(0, 6);
}

// The finish cutscene that suits the destination (see ending.js; video games stay the
// Downtown commute's own).
function endingFor(place) {
  const [k, v] = (place.kind || '/').split('/');
  const name = place.short || '';
  if (/\bski\b|snow valley|rabbit hill/i.test(name) || v === 'winter_sports') return 'ski';
  if (['fast_food', 'restaurant', 'cafe', 'food_court', 'ice_cream', 'pub', 'bar', 'bbq'].includes(v)) {
    return /noodle|pho\b|ramen|sushi|thai|chinese|japanese|korean|viet|dumpling|udon/i.test(name) ? 'noodle' : 'burger';
  }
  if (k === 'shop' || ['mall', 'marketplace', 'department_store', 'supermarket', 'retail'].includes(v)) return 'shopping';
  if (['beach', 'water_park', 'swimming_pool', 'swimming_area', 'water', 'lake', 'marina', 'beach_resort'].includes(v)) return 'beach';
  return 'bbq';
}

// ---------- the builder screen ----------
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
let screen = null;
let state = null;

function markup() {
  const el = document.createElement('div');
  el.id = 'custom-screen';
  el.className = 'screen';
  el.innerHTML = `
    <div class="card custom-card" role="dialog" aria-labelledby="cr-title">
      <h1 id="cr-title">Your own route</h1>
      <p class="sub">Pick any two places in Edmonton. The game builds the real streets, buildings and hills between them.</p>
      <div class="cr-field"><label for="cr-from">Start</label>
        <input id="cr-from" type="text" placeholder="An address or a place, e.g. West Edmonton Mall" autocomplete="off" spellcheck="false">
        <div class="cr-list" id="cr-from-list" role="listbox"></div></div>
      <div class="cr-field"><label for="cr-to">Finish</label>
        <input id="cr-to" type="text" placeholder="e.g. Rogers Place" autocomplete="off" spellcheck="false">
        <div class="cr-list" id="cr-to-list" role="listbox"></div></div>
      <div id="cr-preview" class="cr-preview"></div>
      <div class="cr-field" id="cr-name-row" hidden><label for="cr-name">Name</label>
        <input id="cr-name" type="text" maxlength="64" autocomplete="off"></div>
      <div id="cr-progress" class="cr-progress" hidden><div class="cr-bar"><i id="cr-fill"></i></div><span id="cr-stage"></span></div>
      <p id="cr-msg" class="cr-msg" role="status"></p>
      <button class="go-btn" id="cr-build" disabled>Build this map</button>
      <button class="link-btn" id="cr-close" type="button">Back to the menu</button>
      <p class="cr-fine">As you type, places are looked up with komoot’s Photon search (OpenStreetMap’s Nominatim when you press Enter). The start and finish go to the OSRM route planner, and the area along the route is downloaded from the City of Edmonton and Natural Resources Canada. Your routes are saved only on this device and have no online leaderboard.</p>
    </div>`;
  document.body.appendChild(el);
  return el;
}

// North-up preview of the planned route.
function previewSvg(coords) {
  const lat0 = coords[0][1];
  const k = Math.cos((lat0 * Math.PI) / 180);
  const pts = coords.map(([lon, lat]) => [lon * k, -lat]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const W = 320;
  const H = 150;
  const pad = 14;
  const s = Math.min((W - 2 * pad) / Math.max(1e-6, x1 - x0), (H - 2 * pad) / Math.max(1e-6, y1 - y0));
  const ox = (W - (x1 - x0) * s) / 2;
  const oy = (H - (y1 - y0) * s) / 2;
  const X = (x) => (ox + (x - x0) * s).toFixed(1);
  const Y = (y) => (oy + (y - y0) * s).toFixed(1);
  const step = Math.max(1, Math.floor(pts.length / 400));
  const d = 'M' + pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map(([x, y]) => `${X(x)} ${Y(y)}`).join('L');
  const [sx, sy] = pts[0];
  const [ex, ey] = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" aria-hidden="true">
    <path d="${d}" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="#ffb347" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${X(sx)}" cy="${Y(sy)}" r="5" fill="#39d353" stroke="#fff" stroke-width="1.5"/>
    <circle cx="${X(ex)}" cy="${Y(ey)}" r="5.5" fill="#ff5e3a" stroke="#fff" stroke-width="1.5"/>
    <text x="${W - 14}" y="16" font-size="12" font-weight="700" fill="rgba(255,255,255,.7)">N</text></svg>`;
}

function setMsg(text, bad = false) {
  const m = $('cr-msg');
  m.textContent = text;
  m.classList.toggle('bad', bad);
}

function wireField(which) {
  const input = $(`cr-${which}`);
  const list = $(`cr-${which}-list`);
  let timer = 0;
  let ctrl = null;
  let results = [];
  let active = -1;
  const close = () => { list.innerHTML = ''; list.classList.remove('show'); active = -1; };
  const show = () => {
    list.innerHTML = results.length
      ? results.map((p, i) => `<button type="button" class="cr-opt ${i === active ? 'on' : ''}" data-i="${i}" role="option"><b>${esc(p.label)}</b>${p.detail ? `<small>${esc(p.detail)}</small>` : ''}</button>`).join('')
      : '<div class="cr-none">No place inside Edmonton matches that.</div>';
    list.classList.add('show');
  };
  const choose = (p) => {
    state[which] = p;
    input.value = p.detail && p.detail !== 'Map point' ? `${p.label}, ${p.detail}` : p.label;
    close();
    if (which === 'from' && !state.to) setTimeout(() => $('cr-to').focus(), 0); // straight on to the finish
    planRoute();
  };
  const search = async (fallback) => {
    const q = input.value.trim();
    if (q.length < 3) { close(); return []; }
    ctrl?.abort();
    ctrl = new AbortController();
    try {
      results = await searchPlaces(q, ctrl.signal, { fallback });
      active = results.length ? 0 : -1;
      if (document.activeElement === input || fallback) show();
      if (results.length && $('cr-msg').classList.contains('bad')) setMsg('');
      return results;
    } catch (e) {
      if (e.name !== 'AbortError') {
        setMsg(fallback ? 'The address search is not answering. Check the connection and try again.'
          : 'Suggestions aren’t loading right now. Type the place and press Enter to search.', true);
      }
      return [];
    }
  };
  input.addEventListener('input', () => {
    state[which] = null;
    state.route = null;
    state.plan++; // a route still on its way is for the old places
    results = []; // Enter must search what the field says now
    close();
    updateButton();
    clearTimeout(timer);
    timer = setTimeout(() => search(false), 300);
  });
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
      show();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return; // a held key would search again and again
      clearTimeout(timer);
      if (list.classList.contains('show') && results[active]) choose(results[active]);
      else {
        const r = await search(true);
        if (r.length === 1) choose(r[0]);
      }
    } else if (e.key === 'Escape') {
      if (list.classList.contains('show')) close();
      else if (!state.building) closeBuilder();
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 180));
  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus while picking
  list.addEventListener('click', (e) => {
    const i = e.target.closest('[data-i]')?.dataset.i;
    if (i != null) choose(results[+i]);
  });
}

// "Build this map" once the drive is planned; "Plan the drive again" when planning failed.
function updateButton() {
  const btn = $('cr-build');
  const retry = !!(state.from && state.to && !state.route && !state.planning && state.planFailed);
  btn.disabled = state.building || !(state.from && state.to && (state.route || retry));
  if (!state.building) btn.textContent = retry ? 'Plan the drive again' : 'Build this map';
  $('cr-name-row').hidden = !state.route;
  if (!state.route) $('cr-preview').innerHTML = '';
}

async function planRoute() {
  state.route = null; // Build waits for the answer for these two places
  state.planFailed = false;
  updateButton();
  if (!state.from || !state.to) return;
  const { from, to } = state;
  if (Math.abs(from.lon - to.lon) < 1e-5 && Math.abs(from.lat - to.lat) < 1e-5) {
    setMsg('Start and finish are the same place.', true);
    return;
  }
  setMsg('Planning the drive…');
  const token = ++state.plan;
  state.planning = true;
  try {
    const r = await fetch(osrmRouteUrl([from.lon, from.lat], [to.lon, to.lat]));
    if (!r.ok) throw new Error(`planner ${r.status}`); // busy or down: worth trying again
    const j = await r.json();
    if (token !== state.plan) return;
    if (!j.routes?.length) throw new Error('No driving route was found between those two places.');
    const route = j.routes[0];
    const km = route.distance / 1000;
    if (km < CUSTOM_MIN_KM) throw new Error(`That drive is only ${km.toFixed(1)} km. Pick places at least ${CUSTOM_MIN_KM} km apart.`);
    if (km > CUSTOM_MAX_KM) throw new Error(`That drive is ${km.toFixed(1)} km. Custom routes can be up to ${CUSTOM_MAX_KM} km.`);
    state.route = { coords: route.geometry.coordinates, km };
    $('cr-preview').innerHTML = `${previewSvg(route.geometry.coordinates)}
      <p>${km.toFixed(1)} km · about ${Math.max(1, Math.round(route.duration / 60))} min in normal traffic</p>`;
    $('cr-name').value = `${from.short} → ${to.short}`.slice(0, 64);
    const saved = await listCustomRoutes();
    if (token !== state.plan) return;
    setMsg(saved.length >= MAX_SAVED ? `You have ${MAX_SAVED} routes saved: building this one replaces the oldest, “${saved[saved.length - 1].name}”.` : '');
  } catch (e) {
    if (token !== state.plan) return;
    state.route = null;
    const known = e.message.startsWith('That') || e.message.startsWith('No driving');
    state.planFailed = !known;
    setMsg(known ? e.message : 'The route planner is not answering. Wait a moment and press “Plan the drive again”.', true);
  } finally {
    if (token === state.plan) state.planning = false;
  }
  updateButton();
}

function setBusy(on) {
  state.building = on;
  for (const id of ['cr-from', 'cr-to', 'cr-name']) $(id).disabled = on;
  $('cr-progress').hidden = !on;
  if (on) $('cr-build').textContent = 'Building…';
  $('cr-close').textContent = on ? 'Cancel' : 'Back to the menu';
  updateButton();
}

function build() {
  const { from, to, route } = state;
  const name = $('cr-name').value.trim() || `${from.short} → ${to.short}`;
  const id = `custom-${Date.now().toString(36)}`;
  setBusy(true);
  setMsg('');
  const worker = new Worker(new URL('./mapgen/worker.js', import.meta.url), { type: 'module' });
  state.worker = worker;
  const fill = $('cr-fill');
  const stage = $('cr-stage');
  fill.style.width = '0%';
  stage.textContent = 'Starting…';
  const done = () => { worker.terminate(); state.worker = null; };
  worker.onmessage = async (e) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      fill.style.width = `${(msg.f * 100).toFixed(1)}%`;
      stage.textContent = `${msg.label} · ${Math.round(msg.f * 100)}%`;
    } else if (msg.type === 'done') {
      done();
      const meta = { ...msg.meta, custom: true, created: Date.now(), from: from.short, to: to.short, ending: endingFor(to), ...(msg.out.custom?.notes ? { notes: msg.out.custom.notes } : {}) };
      let dropped;
      try {
        dropped = await saveCustomRoute(meta, msg.out);
      } catch {
        setBusy(false);
        setMsg('The map was built but this browser would not save it (private window or storage full).', true);
        return;
      }
      setBusy(false);
      closeBuilder();
      resetForm(); // the next "New route" starts empty
      state.onAdded(meta, dropped);
    } else {
      done();
      setBusy(false);
      setMsg(msg.message, true);
    }
  };
  worker.onerror = (e) => {
    done();
    setBusy(false);
    setMsg(`Building failed: ${e.message || 'unknown error'}`, true);
  };
  worker.postMessage({ id, name, from: from.short, to: to.short, start: [from.lon, from.lat], dest: [to.lon, to.lat], coords: route.coords });
}

function resetForm() {
  Object.assign(state, { from: null, to: null, route: null, planning: false, planFailed: false });
  for (const id of ['cr-from', 'cr-to', 'cr-name']) $(id).value = '';
  setMsg('');
  updateButton();
}

function closeBuilder() {
  state?.worker?.terminate();
  if (state) state.worker = null;
  screen?.classList.remove('show');
}

export const customBuilderOpen = () => !!screen?.classList.contains('show');

// Opens the builder. onAdded(meta, dropped) is called with the new route's menu entry once
// its map is saved, and the entries of the oldest routes it replaced (at most MAX_SAVED).
export function openCustomBuilder({ onAdded }) {
  if (!screen) {
    screen = markup();
    state = { from: null, to: null, route: null, plan: 0, planning: false, planFailed: false, building: false, worker: null, onAdded };
    wireField('from');
    wireField('to');
    $('cr-build').addEventListener('click', () => {
      if ($('cr-build').disabled) return;
      if (state.route) build(); else planRoute();
    });
    $('cr-close').addEventListener('click', () => {
      if (state.building) {
        closeBuilder();
        setBusy(false);
        setMsg('Cancelled.');
        screen.classList.add('show');
        return;
      }
      closeBuilder();
    });
    screen.addEventListener('keydown', (e) => e.stopPropagation()); // typing must not steer the car
  }
  state.onAdded = onAdded;
  screen.classList.add('show');
  setTimeout(() => $('cr-from').focus(), 50);
}
