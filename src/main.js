import * as THREE from 'three';
import './style.css';
import { createWorld, loadMapData } from './world.js';
import { makeCar, spinWheels, initCarEnvironment, CAR_MODELS, CAR_IDS, PAINTS } from './cars.js';
import { Traffic } from './traffic.js';
import { Signals } from './signals.js';
import { activeSignals } from './lane-layout.js';
import { Collectibles, makeNitroCan } from './pickups.js';
import { POWERS, randomPower, makeMysteryBox, PowerVisuals } from './powers.js';
import { leaderboardEnabled, topScores, submitScore, allBestTimes } from './leaderboard.js';
import { progress, progressReady, ACHIEVEMENTS } from './progress.js';
import { Effects } from './effects.js';
import { Ending } from './ending.js';
import { buildFun, FUN_RIDES, FUN_IDS } from './funrides.js';
import { readInput, setupTouch, isTouch } from './input.js';
import { sound } from './sound.js';

// Game-side flavour per map. Names, distances and route facts come from maps/index.json,
// which tools/build-maps.mjs writes.
const MAP_INFO = {
  home: {
    to: 'the Legislature', cheer: 'FINALLY HOME!!', ending: 'game',
    desc: 'The full commute: up Gateway Boulevard past South Edmonton Common, through Old Strathcona, then down into the river valley and over the white arches of the Walterdale Bridge to the Legislature. Nineteen sets of lights and a river valley: beat the real rush hour.',
  },
  burger: {
    to: 'Odd Burger, Ellerslie Rd', cheer: 'MADE IT!!', ending: 'burger',
    desc: 'Out of Summerside, left on Parsons Road, three lights and you are at Odd Burger on Ellerslie. The warm-up lap: do this one first.',
  },
  beachclub: {
    to: 'the lake', cheer: 'MADE IT!!', ending: 'beach',
    desc: 'Around the lake on Savaryn Drive and 88 Street to the residents’ beach club on Summerside Grande Boulevard. No traffic lights, just tight residential corners.',
  },
  noodle: {
    to: 'Parsons Place, 34 Ave', cheer: 'MADE IT!!', ending: 'noodle',
    desc: 'Parsons Road to Ellerslie, then Gateway Boulevard north under the Henday and past IKEA to 34 Avenue and the noodle shop at Parsons Place. Short, fast and only five lights: a lunch-hour time attack.',
  },
  windermere: {
    to: 'Windermere, 170 St', cheer: 'MADE IT!!', ending: 'shopping',
    desc: 'Straight west on Ellerslie Road, over the QE II and the Whitemud Creek ravine to the shops at Windermere. Twenty sets of lights in eleven kilometres: time them, or sit at every one.',
  },
  sherwood: {
    to: 'Sherwood Park', cheer: 'MADE IT!!', ending: 'bbq',
    desc: 'North on 91 Street, then the Anthony Henday ring road around the east side and off at Wye Road into Sherwood Park. Almost no lights for 22 km, so it is all about top speed.',
  },
  snowvalley: {
    to: 'Snow Valley ski hill', cheer: 'MADE IT!!', ending: 'ski',
    desc: 'Over the High Level Bridge, past the University and the Jubilee, down 114 Street beside the LRT, over the Whitemud on 122 Street and down Rainbow Valley Road into the ravine. Two bridges and a 50-metre drop: brake before the bottom.',
  },
  refinery: {
    to: 'Sherwood Park Mall', cheer: 'MADE IT!!', ending: 'shopping',
    desc: 'Over the James MacDonald Bridge past the Muttart pyramids, up 98 Avenue out of the valley, then Baseline Road past the refineries and tank farms and over the Henday to Sherwood Park Mall. Sixteen kilometres of city, valley and industry.',
  },
};
const NEW_MAPS = new Set(['snowvalley', 'refinery']);
const GROUPS = [
  { from: 'Summerside', title: 'From Summerside', start: 'start: 91 St SW' },
  { from: 'Downtown', title: 'From Downtown', start: 'start: the Legislature' },
];
const mapIndex = await (await fetch('maps/index.json')).json();
const MAPS = mapIndex.map((meta) => ({ to: '', desc: '', cheer: 'MADE IT!!', ending: 'bbq', ...meta, ...MAP_INFO[meta.id] }));

const BASE_SPEED = 45; // m/s ≈ 162 km/h before car stats
const NITRO_BONUS = 21; // m/s on top of the car's top speed
const TURBO_SPEED = 90; // m/s ≈ 324 km/h
const FLY_HEIGHT = 7;
const LIFTOFF_SPEED = 250 / 3.6; // rides that can fly (the Rocket) take off above this
const BLAST_RANGE = 110;
const RUSH_HOUR_SPEED = 8; // m/s, roughly what the real commute averages at rush hour
const PREFS_KEY = 'driveHome.prefs';

const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), time: $('time'), dist: $('dist'), fill: $('progress-fill'), carIcon: $('car-icon'),
  speed: $('speed'), speedo: $('speedo'), nitro: $('nitro-fill'), crashes: $('crashes'), street: $('street'), turn: $('turn'),
  power: $('power'), powerLabel: $('power-label'), powerFill: $('power-fill'), landmark: $('landmark'),
  toast: $('toast'), countdown: $('countdown'), touch: $('touch'), loading: $('loading'),
  start: $('start'), mapList: $('map-list'), carList: $('car-list'), paint: $('paint'), credits: $('credits'),
  finish: $('finish'), result: $('result'),
};

// --- Three.js setup ---
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
initCarEnvironment(renderer);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 4000);

const effects = new Effects(scene);
const traffic = new Traffic(scene, effects);
const nitroCans = new Collectibles(scene, makeNitroCan, {
  count: 7, y: 1, firstGap: 120, spacing: 140, respawnMin: 340, respawnRange: 240,
});
const mysteryBoxes = new Collectibles(scene, makeMysteryBox, {
  count: 4, y: 1.4, firstGap: 250, spacing: 300, respawnMin: 460, respawnRange: 340, radius: 1.9,
});
const ending = new Ending(scene);

// --- Preferences ---
// Locked rides (the Rocket) need every achievement first.
const carAvailable = (id) => !FUN_RIDES[id]?.locked || progress.rocketUnlocked;

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY));
    if (p) {
      const out = { map: 'home', car: 'modelx', colors: {}, ...p };
      if (!MAPS.some((m) => m.id === out.map)) out.map = 'home';
      if (!CAR_MODELS[out.car] && !(FUN_RIDES[out.car] && carAvailable(out.car))) out.car = 'modelx';
      return out;
    }
  } catch { /* fall through */ }
  return { map: 'home', car: 'modelx', colors: {} };
}
const prefs = loadPrefs();
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
}
// v2: routes moved to public start/end spots in October 2026, so older times don't compare.
const bestKey = (id) => `driveHome.best.v2.${id}`;
function loadBest(id) {
  try { return parseFloat(localStorage.getItem(bestKey(id))) || null; } catch { return null; }
}
function saveBest(id, t) {
  try { localStorage.setItem(bestKey(id), String(t)); } catch { /* storage unavailable */ }
}

// --- Game state ---
const S = {
  mode: 'loading', // loading | menu | countdown | race | finished
  s: 0, x: 0, y: 0, speed: 0, steer: 0, nitro: 1, boosting: false, drifting: false, driftYaw: 0,
  power: null, powerTime: 0, len: 4.6, width: 2,
  time: 0, crashes: 0, smashed: 0, reds: 0, invuln: 0, shake: 0, countdown: 0, fov: 62,
};
let world = null;
let route = null;
let signals = null;
let player = null;
let powerFx = null;
let flames = [];
let stats = null;
const modelOf = (id) => CAR_MODELS[id] ?? FUN_RIDES[id];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mapInfo = () => MAPS.find((m) => m.id === prefs.map);

function fmt(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

let toastTimer = 0;
function toast(text, cls) {
  ui.toast.textContent = text;
  ui.toast.className = `show ${cls}`;
  toastTimer = 1.1;
}

// --- Car selection ---
const flameMat = new THREE.MeshBasicMaterial({ color: 0x5fd4ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending });
const flameGeo = new THREE.ConeGeometry(0.18, 1.2, 8).rotateX(Math.PI / 2);

function selectCar(id) {
  const model = modelOf(id);
  if (!model) return;
  if (!carAvailable(id)) {
    const done = progress.data.achievements.length;
    toast(`🔒 Earn all achievements (${done}/${ACHIEVEMENTS.length})`, 'crash');
    $('ach-box').open = true;
    $('ach-box').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  prefs.car = id;
  savePrefs();
  sound.setVehicle(id);
  stats = model.stats;
  if (player) scene.remove(player);
  player = FUN_RIDES[id] ? buildFun(model.spec) : makeCar(id, prefs.colors[id] ?? model.color);
  scene.add(player);
  S.len = player.userData.len;
  S.width = player.userData.width;
  powerFx = new PowerVisuals(player);
  flames = [-0.5, 0.5].map((x) => {
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.position.set(x, 0.5, S.len / 2 + 0.6);
    player.add(f);
    return f;
  });
  renderMenu();
}

// --- Map selection ---
let loadToken = 0;
async function selectMap(id) {
  prefs.map = id;
  savePrefs();
  renderMenu();
  const token = ++loadToken;
  S.mode = 'loading';
  ui.loading.textContent = 'Loading Edmonton…';
  ui.loading.classList.add('show');
  try {
    const data = await loadMapData(id);
    if (token !== loadToken) return;
    world?.dispose();
    signals?.dispose();
    world = createWorld(scene, data, { maxAnisotropy });
    route = world.route;
    // Skip signals in the last stretch so they don't block the ending camera.
    signals = new Signals(scene, route, activeSignals(data.signals, route.length));
    traffic.setWorld(route, signals);
    nitroCans.setRoute(route);
    mysteryBoxes.setRoute(route);
    ending.setRoute(route, world.heightAt, mapInfo().cheer, mapInfo().ending);
    ui.credits.textContent = data.credits;
    S.landmarks = (data.landmarks || []).map((l) => ({ ...l, shown: false }));
    reset();
    S.mode = 'menu';
  } catch (e) {
    console.error(e);
    ui.loading.textContent = `Could not load the map: ${e.message}`;
    return;
  }
  ui.loading.classList.remove('show');
}

// ---------- Map select ----------
// Difficulty: 1-5 stars from length, lights, corners and climb.
function stars(m) {
  const score = m.km * 0.08 + m.signals * 0.1 + m.curves * 0.12 + (m.climb > 50 ? 0.4 : 0);
  return score <= 1 ? 1 : score <= 2.2 ? 2 : score <= 3.2 ? 3 : score <= 4.5 ? 4 : 5;
}
function badges(m) {
  const out = [];
  if (NEW_MAPS.has(m.id)) out.push('New');
  if (m.km === Math.max(...MAPS.map((x) => x.km))) out.push('Longest');
  if (m.highwayM / (m.km * 1000) >= 0.5) out.push('Highway');
  if (m.bridgeM >= 100 || m.climb >= 50) out.push('Scenic');
  if (m.km <= 2) out.push('Short');
  if (m.signals / m.km >= 1.5) out.push('Stop & go');
  return out.slice(0, 2);
}
const rushMin = (m) => Math.round((m.km * 1000) / RUSH_HOUR_SPEED / 60);
const esc2 = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// North-up route map as inline SVG. Big = labelled landmarks and a north arrow.
const svgCache = new Map();
function routeSvg(m, big) {
  const key = `${m.id}|${big}`;
  if (svgCache.has(key)) return svgCache.get(key);
  const W = big ? 260 : 160;
  const H = big ? 200 : 100;
  const pad = big ? 22 : 10;
  const xs = m.poly.map((p) => p[0]);
  const zs = m.poly.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const k = Math.min((W - pad * 2) / Math.max(1, maxX - minX), (H - pad * 2) / Math.max(1, maxZ - minZ));
  const offX = (W - (maxX - minX) * k) / 2;
  const offZ = (H - (maxZ - minZ) * k) / 2;
  const X = (x) => (offX + (x - minX) * k).toFixed(1);
  const Y = (z) => (offZ + (z - minZ) * k).toFixed(1); // z grows southwards, so north is up
  const d = 'M' + m.poly.map(([x, z]) => `${X(x)} ${Y(z)}`).join('L');
  const [sx, sz] = m.poly[0];
  const [ex, ez] = m.poly[m.poly.length - 1];
  let lm = '';
  for (const l of m.landmarks || []) {
    lm += `<circle cx="${X(l.x)}" cy="${Y(l.z)}" r="${big ? 3.5 : 2.5}" fill="#fff" stroke="rgba(0,0,0,.5)" stroke-width="1"/>`;
    if (big) {
      // Labels flip to the left near the right edge so they stay inside the map.
      const right = +X(l.x) > W * 0.62;
      lm += `<text x="${+X(l.x) + (right ? -6 : 6)}" y="${+Y(l.z) + 4}" font-size="10" fill="#fff" stroke="rgba(0,0,0,.7)" stroke-width="2" paint-order="stroke" text-anchor="${right ? 'end' : 'start'}">${esc2(l.name)}</text>`;
    }
  }
  const svg = `<svg class="rmap" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path class="rline" d="${d}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    ${lm}
    <circle cx="${X(sx)}" cy="${Y(sz)}" r="4" fill="#39d353" stroke="#fff" stroke-width="1.5"/>
    <circle cx="${X(ex)}" cy="${Y(ez)}" r="4.5" fill="#ff5e3a" stroke="#fff" stroke-width="1.5"/>
    ${big ? `<text x="${W - 14}" y="16" font-size="12" font-weight="700" fill="rgba(255,255,255,.7)">N</text><path d="M${W - 10} 20 l0 10" stroke="rgba(255,255,255,.7)" stroke-width="1.5"/>` : ''}
  </svg>`;
  svgCache.set(key, svg);
  return svg;
}

// Online best times for every map (fetched once per menu visit when the database is on).
let ranks = null;
async function loadRanks() {
  if (!leaderboardEnabled) return;
  try {
    const rows = await allBestTimes();
    ranks = {};
    for (const r of rows) (ranks[r.map] ??= []).push(r);
    for (const list of Object.values(ranks)) list.sort((a, b) => a.time_ms - b.time_ms);
    if (S.mode === 'menu') renderMenu();
  } catch { /* offline */ }
}

function mapCard(m) {
  const best = loadBest(m.id);
  const sel = m.id === prefs.map;
  const st = stars(m);
  let ledger;
  if (best) {
    const list = ranks?.[m.id];
    const rank = list ? 1 + list.filter((r) => r.time_ms < best * 1000).length : null;
    ledger = `Best ${fmt(best)}${rank ? ` · #${rank} online` : ''}`;
  } else ledger = `Rush hour ≈ ${rushMin(m)} min · beat it`;
  return `<button class="tile route ${sel ? 'sel' : ''}" data-map="${m.id}" aria-pressed="${sel}">
    <div class="rmap-wrap">${routeSvg(m, false)}<div class="badges">${badges(m).map((b) => `<span class="badge ${b === 'New' ? 'new' : ''}">${b}</span>`).join('')}</div></div>
    <b>${esc2(m.name)}</b>
    <span class="fromto">${esc2(m.from)} → ${esc2(m.to || m.name)}</span>
    <span class="rstats">${m.km} km · <i class="stars" title="${st} of 5">${'★'.repeat(st)}${'☆'.repeat(5 - st)}</i> · ${m.signals} lights</span>
    <small>${ledger}</small></button>`;
}

function mapDetail(m) {
  const best = loadBest(m.id);
  const rush = rushMin(m) * 60;
  const list = ranks?.[m.id] || null;
  const top = list?.[0] || null;
  const rank = best && list ? 1 + list.filter((r) => r.time_ms < best * 1000).length : null;
  const pct = (sec) => `${clamp((sec / rush) * 100, 2, 100).toFixed(1)}%`;
  const chips = [`${m.km} km`, `${'★'.repeat(stars(m))} difficulty`, `${m.signals} lights`, m.bridgeM >= 60 ? `${Math.round(m.bridgeM)} m of bridges` : null, m.climb >= 20 ? `${m.climb} m of climbing` : null, m.highwayM >= 1000 ? `${(m.highwayM / 1000).toFixed(1)} km of freeway` : null].filter(Boolean);
  return `<div class="detail-inner">
    ${routeSvg(m, true)}
    <h3>${esc2(m.name)}</h3>
    <p class="fromto">${esc2(m.from)} → ${esc2(m.to || m.name)}</p>
    <p class="desc">${esc2(m.desc)}</p>
    <div class="chips">${chips.map((c) => `<span>${c}</span>`).join('')}</div>
    <div class="race">
      <div class="track"></div>
      <div class="mark rush" style="left:100%"><i></i><span>Rush hour ${rushMin(m)}:00</span></div>
      ${top ? `<div class="mark top" style="left:${pct(top.time_ms / 1000)}"><i></i><span>Top ${fmt(top.time_ms / 1000)} by ${esc2(top.name)}</span></div>` : ''}
      ${best ? `<div class="mark you" style="left:${pct(best)}"><i></i><span>You ${fmt(best)}${rank ? ` · #${rank} of ${list.length}` : ''}</span></div>` : ''}
    </div>
    ${!best ? `<p class="hint">Not driven yet. Real traffic takes about ${rushMin(m)} minutes.</p>` : ''}
    ${m.landmarks?.length ? `<p class="hint">Passes: ${m.landmarks.map((l) => esc2(l.name)).join(' · ')}</p>` : ''}
  </div>`;
}

function renderMenu() {
  const currentMap = MAPS.find((m) => m.id === prefs.map) || MAPS[0];
  ui.mapList.innerHTML = GROUPS.map((g) => {
    const list = MAPS.filter((m) => (m.from || 'Summerside') === g.from);
    if (!list.length) return '';
    // The commute first, then the rest by distance.
    list.sort((a, b) => (a.id === 'home' ? -1 : b.id === 'home' ? 1 : a.km - b.km));
    return `<h2 class="group">${g.title} <span>${g.start}</span></h2>
      <div class="tiles routes">${list.map((m) => mapCard(m) + (m.id === currentMap.id ? `<div class="detail inline">${mapDetail(m)}</div>` : '')).join('')}</div>`;
  }).join('');
  $('route-detail').innerHTML = mapDetail(currentMap);
  const bar = (label, v) => `<div class="stat"><i>${label}</i><div><em style="width:${clamp((v - 0.75) / 0.55, 0.08, 1) * 100}%"></em></div></div>`;
  ui.carList.innerHTML = CAR_IDS.map((id) => {
    const c = CAR_MODELS[id];
    return `<button class="tile car ${id === prefs.car ? 'sel' : ''}" data-car="${id}">
      <small>${c.brand}</small><b>${c.name}</b>
      ${bar('Speed', c.stats.top)}${bar('Accel', c.stats.accel)}${bar('Grip', c.stats.grip)}
      <span>${c.desc}</span></button>`;
  }).join('') + FUN_IDS.map((id) => {
    const f = FUN_RIDES[id];
    const locked = !carAvailable(id);
    const desc = f.locked && !locked ? 'Endless nitro, flies above 250 km/h, smashes through traffic' : f.desc;
    return `<button class="tile car fun ${id === prefs.car ? 'sel' : ''} ${locked ? 'locked' : ''}" data-car="${id}">
      <small>${f.locked ? (locked ? '🔒 Locked' : '🚀 Unlocked') : 'Fun ride'}</small><b>${f.name}</b>
      ${bar('Speed', f.stats.top)}${bar('Accel', f.stats.accel)}${bar('Grip', f.stats.grip)}
      <span>${desc}</span></button>`;
  }).join('');
  renderAchievements();
  if (FUN_RIDES[prefs.car]) {
    ui.paint.innerHTML = '';
    return;
  }
  const current = prefs.colors[prefs.car] ?? CAR_MODELS[prefs.car].color;
  ui.paint.innerHTML = PAINTS.map((p) => {
    const hex = `#${p.toString(16).padStart(6, '0')}`;
    return `<button class="swatch ${p === current ? 'sel' : ''}" data-paint="${p}" style="background:${hex}" aria-label="Paint ${hex}"></button>`;
  }).join('');
}

function renderAchievements() {
  const done = progress.data.achievements.length;
  $('achievements').innerHTML = ACHIEVEMENTS.map((a) => {
    const v = progress.value(a);
    const got = progress.unlocked.has(a.id);
    return `<div class="ach ${got ? 'got' : ''}">
      <span class="ico">${a.icon}</span>
      <div><b>${a.name}</b><small>${a.desc}</small>
        <div class="bar"><em style="width:${(v / a.goal) * 100}%"></em></div></div>
      <span class="count">${got ? '✓' : `${v}/${a.goal}`}</span></div>`;
  }).join('');
  $('ach-summary').textContent = progress.rocketUnlocked
    ? '🚀 Rocket unlocked!'
    : `${done}/${ACHIEVEMENTS.length} done · finish them all to unlock the 🚀 Rocket${progress.online ? '' : ' · saved on this device'}`;
}

// Achievement pop-ups, one after another, each with its chime.
const achQueue = [];
let achBusy = false;
function popAchievement(text, sfx = 'achievement') {
  achQueue.push([text, sfx]);
  if (achBusy) return;
  achBusy = true;
  const next = () => {
    const item = achQueue.shift();
    if (!item) {
      achBusy = false;
      return;
    }
    $('achieve').textContent = item[0];
    $('achieve').classList.add('show');
    sound.play(item[1]);
    setTimeout(() => {
      $('achieve').classList.remove('show');
      setTimeout(next, 350);
    }, 2600);
  };
  next();
}
progress.onChange((fresh) => {
  for (const a of fresh) popAchievement(`🏅 ${a.icon} ${a.name}!`);
  if (fresh.length && progress.rocketUnlocked) popAchievement('🚀 ROCKET UNLOCKED! Pick it in the garage', 'unlock');
  if (S.mode === 'menu') renderMenu();
});

ui.mapList.addEventListener('click', (e) => {
  const id = e.target.closest('[data-map]')?.dataset.map;
  if (id && (id !== prefs.map || !world)) selectMap(id);
});
ui.paint.addEventListener('click', (e) => {
  const p = e.target.closest('[data-paint]')?.dataset.paint;
  if (!p) return;
  prefs.colors[prefs.car] = Number(p);
  savePrefs();
  player.userData.bodyMat.color.setHex(Number(p));
  renderMenu();
});
ui.carList.addEventListener('click', (e) => {
  const id = e.target.closest('[data-car]')?.dataset.car;
  if (id && id !== prefs.car) selectCar(id);
});

// --- Race flow ---
function reset() {
  for (const l of S.landmarks || []) l.shown = false;
  Object.assign(S, {
    s: 8, y: 0, speed: 0, steer: 0, nitro: 1, boosting: false, drifting: false, driftYaw: 0,
    power: null, powerTime: 0, time: 0, crashes: 0, smashed: 0, reds: 0, invuln: 0, shake: 0, airborne: false,
  });
  S.x = route.laneLat(0, S.s);
  traffic.reset(S);
  nitroCans.reset(S.s);
  mysteryBoxes.reset(S.s);
  ending.reset();
  setBanner(true);
  if (player?.userData.rider) player.userData.rider.visible = true;
}

function showMenu() {
  ui.finish.classList.remove('show');
  loadRanks();
  if (S.mode === 'finished') {
    reset();
    S.mode = 'menu';
  }
  renderMenu();
  ui.start.classList.add('show');
}

function startRace() {
  if (!route || S.mode === 'loading') return;
  reset();
  ui.start.classList.remove('show');
  ui.finish.classList.remove('show');
  S.mode = 'countdown';
  S.countdown = 3;
  beepAt = 0;
  snapCamera = true;
}

function setBanner(visible) {
  const banner = world?.group.getObjectByName('finishBanner');
  if (banner) banner.visible = visible;
}

function finish() {
  S.mode = 'finished';
  S.boosting = false;
  S.power = null;
  S.x = 1000; // out of the traffic's way during the cutscene
  if (player.userData.rider) player.userData.rider.visible = false; // the rider hops off
  setBanner(false); // already driven under it; it would block the ending shot
  progress.finishTrip(prefs.map);
  ending.start();
  sound.play('finish');
}

function showResult() {
  const id = prefs.map;
  const best = loadBest(id);
  const isRecord = best === null || S.time < best;
  if (isRecord) {
    saveBest(id, S.time);
    sound.play('record');
  }
  const realMin = Math.round(route.length / RUSH_HOUR_SPEED / 60);
  ui.result.innerHTML = `
    <p class="big">${fmt(S.time)}</p>
    ${isRecord ? '<p class="record">New best time!</p>' : `<p>Best: ${fmt(best)}</p>`}
    <p>Crashes: ${S.crashes} · Cars smashed: ${S.smashed} · Red lights run: ${S.reds}</p>
    <p>In rush-hour traffic this drive takes about ${realMin} minutes.</p>
    ${leaderboardEnabled ? boardHTML() : ''}`;
  ui.finish.classList.add('show');
  if (leaderboardEnabled) setupBoard(id, S.time, S.crashes);
}

// --- Online leaderboard ---
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function boardHTML() {
  return `
    <div id="board">
      <div id="board-post"></div>
      <h3>🏆 World top 10</h3>
      <ol id="board-list"><li class="dim">Loading…</li></ol>
    </div>`;
}

async function showBoard(map) {
  const list = $('board-list');
  try {
    const rows = await topScores(map);
    if (!list.isConnected) return;
    list.innerHTML = rows.length
      ? rows.map((r) => {
        const car = modelOf(r.car)?.name ?? r.car;
        const me = progress.name && r.name.toLowerCase() === progress.name.toLowerCase();
        return `<li class="${me ? 'me' : ''}"><span>${esc(r.name)}</span><small>${esc(car)}</small><b>${fmt(r.time_ms / 1000)}</b></li>`;
      }).join('')
      : '<li class="dim">No times yet. Be the first!</li>';
  } catch {
    list.innerHTML = '<li class="dim">Leaderboard is offline right now.</li>';
  }
}

// The posting area: pick a name once, then always post under it.
function renderPost(map, time, crashes) {
  const box = $('board-post');
  if (!box) return;
  if (!progress.online) {
    box.innerHTML = '<p class="dim">Posting times needs the online player account, which isn\'t available right now.</p>';
    return;
  }
  const naming = !progress.name;
  box.innerHTML = naming
    ? `<form id="board-form">
        <input id="board-name" maxlength="16" placeholder="Pick your player name" autocomplete="nickname" required />
        <button type="submit">Save &amp; post</button>
      </form>
      <p class="hint" id="board-msg">Choose carefully: your name is yours for good and can't be changed.</p>`
    : `<form id="board-form">
        <span class="as">Posting as <b>${esc(progress.name)}</b></span>
        <button type="submit">Post time</button>
      </form>
      <p class="hint" id="board-msg"></p>`;
  $('board-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = $('board-form').querySelector('button');
    const msg = $('board-msg');
    button.disabled = true;
    if (naming) {
      const name = $('board-name').value.trim();
      if (!name) { button.disabled = false; return; }
      button.textContent = 'Saving…';
      const err = await progress.setName(name);
      if (err) {
        msg.textContent = err === 'taken' ? 'That name is taken. Try another one.' : 'Couldn\'t save the name. Try again.';
        button.disabled = false;
        button.textContent = 'Save & post';
        return;
      }
    }
    button.textContent = 'Posting…';
    try {
      await submitScore({ map, car: prefs.car, name: progress.name, timeMs: time * 1000, crashes });
      box.innerHTML = `<p class="record">Posted as ${esc(progress.name)}!</p>`;
      showBoard(map);
    } catch {
      msg.textContent = 'Couldn\'t post right now. Try again.';
      button.disabled = false;
      button.textContent = 'Post time';
    }
  });
}

function setupBoard(map, time, crashes) {
  showBoard(map);
  renderPost(map, time, crashes);
}

document.querySelectorAll('.go-btn').forEach((b) => b.addEventListener('click', startRace));
$('menu-btn').addEventListener('click', showMenu);
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'Enter' && (S.mode === 'menu' || S.mode === 'finished')) startRace();
  if (e.code === 'Escape' && S.mode === 'finished') showMenu();
  if (e.code === 'KeyM' && !e.repeat) {
    const muted = sound.toggleMute();
    if (S.mode === 'race' || S.mode === 'countdown') toast(muted ? '🔇 Sound off' : '🔊 Sound on', 'power');
  }
});
setupTouch(ui.touch);
// Sound: on/off buttons (HUD and menu) and a soft click on every menu button.
sound.bindButton($('mute-hud'));
sound.bindButton($('mute-menu'));
document.addEventListener('click', (e) => {
  const el = e.target.closest?.('button, summary');
  if (el && !el.closest('#touch')) sound.play('click');
});

// --- Powers ---
function activatePower(kind) {
  S.power = kind;
  S.powerTime = POWERS[kind].duration;
  toast(`${POWERS[kind].icon} ${POWERS[kind].label}!`, 'power');
  sound.play(kind);
  if (kind === 'blast') blast();
}

function smash(c) {
  traffic.launch(c, S);
  const p = c.mesh.position;
  effects.explode(p.x, p.y + 1, p.z, 20);
  S.smashed++;
  if (S.mode === 'race') progress.add('smashed');
}

function blast() {
  for (const c of traffic.cars) {
    if (c.active && !c.flying && c.s > S.s - 3 && c.s < S.s + BLAST_RANGE) smash(c);
  }
  const f = route.frame(S.s);
  effects.shockwave(route.toWorld(S.s + 3, S.x, 1 + S.y), new THREE.Vector3(f.tx, 0, f.tz));
  S.shake = 0.8;
}

// --- Driving ---
function drive(dt, input) {
  S.steer += (input.steer - S.steer) * Math.min(1, dt * 8);
  S.boosting = input.nitro && S.nitro > 0.02 && !input.brake;
  const turbo = S.power === 'turbo';
  const top = BASE_SPEED * stats.top;

  let accel;
  if (input.brake) accel = -32;
  else if (input.gas || S.boosting || turbo) accel = (S.speed < 20 ? 16 : 10) * stats.accel;
  else accel = -5;

  let max = top;
  if (S.boosting) {
    accel += 22;
    max = top + NITRO_BONUS;
    if (!modelOf(prefs.car).infiniteNitro) S.nitro = Math.max(0, S.nitro - dt * 0.3);
  } else {
    S.nitro = Math.min(1, S.nitro + dt * 0.025);
  }
  if (turbo) {
    accel = Math.max(accel, 0) + 30;
    max = TURBO_SPEED;
  }

  // Above the cap (e.g. after nitro ends) the car eases back down instead of snapping.
  const prev = S.speed;
  S.speed += accel * dt;
  if (S.speed > max) S.speed = Math.max(max, Math.min(S.speed, prev - 25 * dt));
  S.speed = Math.max(0, S.speed);

  // Taking a corner too fast: the car drifts wide and scrubs speed.
  const grip = route.vmaxAt(S.s) * stats.grip * 1.15;
  S.drifting = S.y < 1 && S.speed > grip;
  const curv = route.curvAt(S.s);
  if (S.drifting) {
    const excess = S.speed - grip;
    S.speed -= excess * 1.2 * dt;
    S.x -= Math.sign(curv) * Math.min(excess, 15) * 0.25 * dt;
    if (Math.random() < dt * 30) {
      const p = route.toWorld(S.s - S.len / 2, S.x + (Math.random() - 0.5) * S.width, 0.3);
      effects.puff(p.x, p.y, p.z);
    }
  }
  S.driftYaw += ((S.drifting ? -Math.sign(curv) * 0.35 : 0) - S.driftYaw) * Math.min(1, dt * 5);

  const steerRate = (0.5 + Math.min(S.speed, 30) * 0.3) * Math.sqrt(stats.grip);
  const [lo, hi] = route.latLimits(S.s, S.width / 2);
  S.x += S.steer * steerRate * dt;
  // Ease back onto the road if it narrows.
  if (S.x < lo) S.x = Math.min(lo, S.x + 8 * dt);
  if (S.x > hi) S.x = Math.max(hi, S.x - 8 * dt);

  const nextSig = signals.nextAhead(S.s, 200);
  const ds = S.speed * dt;
  S.s += ds;
  if (nextSig && S.s >= nextSig.stopS && S.s - ds < nextSig.stopS && nextSig.state === 'red') {
    S.reds++;
    toast('😈 RAN A RED!', 'crash');
  }
  spinWheels(player, ds);
  // The Rocket lifts off at high speed and lands again when it slows down.
  const airborne = modelOf(prefs.car).liftoff && S.speed > LIFTOFF_SPEED;
  if (airborne && !S.airborne) {
    toast('🚀 LIFT OFF!', 'power');
    sound.play('liftoff');
  }
  S.airborne = airborne;
  S.y += ((S.power === 'fly' || airborne ? FLY_HEIGHT : 0) - S.y) * Math.min(1, dt * 3);
}

function checkCollisions() {
  if (S.y > 1.5) return; // flying over traffic
  const heavy = modelOf(prefs.car).heavy;
  for (const c of traffic.cars) {
    if (!c.active || c.flying) continue;
    const dx = S.x - c.lat;
    const ds = S.s - c.s;
    if (Math.abs(dx) >= (S.width + 2) * 0.46 || Math.abs(ds) >= (S.len + c.len) * 0.46) continue;

    if (S.power === 'shield' || S.power === 'turbo' || modelOf(prefs.car).smasher) {
      smash(c);
      S.shake = Math.max(S.shake, 0.3);
      sound.play('smash', { strength: clamp(S.speed / 50, 0.3, 1) });
      continue;
    }
    if (S.invuln > 0) return;

    // How hard it hit: closing speed for bumps from behind or ahead, a share of speed for side swipes.
    const endOn = Math.abs(ds) > (S.len + c.len) * 0.3;
    const impact = endOn ? Math.abs(S.speed - c.speed) : S.speed * 0.5;
    sound.play('crash', { strength: clamp(impact / 25 + 0.1, 0.15, 1), pan: clamp((c.lat - S.x) / 2, -1, 1) });
    if (endOn) {
      if (ds < 0) {
        // Rear-ended the car ahead.
        S.s = c.s - (S.len + c.len) / 2;
        S.speed = Math.min(S.speed, c.speed) * (heavy ? 0.85 : 0.5);
        if (heavy) smash(c);
      } else {
        S.speed *= 0.7;
      }
    } else {
      S.x += Math.sign(dx || 1) * 1.2;
      S.speed *= heavy ? 0.85 : 0.6;
    }
    S.crashes++;
    S.invuln = 1.2;
    S.shake = 0.6;
    toast('CRASH!', 'crash');
    return;
  }
}

// --- Per-frame visuals ---
function updatePlayerMesh(t, input) {
  route.toWorld(S.s, S.x, S.y, player.position);
  const turning = -S.steer * 0.12 * Math.min(1, S.speed / 10);
  player.rotation.set(
    S.y < 1 ? route.pitch(S.s) : 0.08,
    route.yaw(S.s) + turning + S.driftYaw,
    S.steer * (S.power === 'fly' ? 0.25 : 0.03) - (player.userData.lean ? S.steer * 0.32 * Math.min(1, S.speed / 8) : 0),
  );
  player.visible = S.invuln <= 0 || Math.floor(t * 12) % 2 === 0;
  player.userData.tailMat.emissiveIntensity = S.mode === 'race' && input.brake ? 3 : 0.6;
}

function updateFx(t) {
  const turbo = S.power === 'turbo';
  flameMat.color.set(turbo ? 0xff7a2a : 0x5fd4ff);
  for (const f of flames) {
    f.visible = S.boosting || turbo || Boolean(modelOf(prefs.car).flame);
    f.scale.z = (turbo ? 1.6 : 0.8) + Math.random() * 0.6;
  }
  powerFx.update(t, S.power);
}

const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
let snapCamera = true;

function updateChaseCamera(dt) {
  const targetFov = Math.min(84, 62 + S.speed * 0.28 + (S.boosting ? 6 : 0));
  S.fov += (targetFov - S.fov) * Math.min(1, dt * 3);
  camera.fov = S.fov;
  camera.updateProjectionMatrix();

  route.toWorld(S.s - 8.5, S.x * 0.8, 3.6 + S.y * 1.1, tmpA);
  route.toWorld(S.s + 14, S.x * 0.9, 1.4 + S.y * 0.8, tmpB);
  // Follow harder at high speed so the camera never falls far behind (the Rocket does 360+ km/h).
  const k = snapCamera ? 1 : Math.min(1, dt * (8 + S.speed * 0.35));
  camPos.lerp(tmpA, k);
  camLook.lerp(tmpB, k);
  snapCamera = false;

  S.shake = Math.max(0, S.shake - dt);
  const shake = () => (Math.random() - 0.5) * S.shake * 0.8;
  camera.position.set(camPos.x + shake(), camPos.y + shake(), camPos.z);
  camera.lookAt(camLook);
}

let orbitAngle = null; // fixed angle for screenshots (dev hook)
let devCam = null; // {pos, look, fov} free camera for screenshots (dev hook)
function updateMenuCamera(t) {
  const a = orbitAngle ?? t * 0.25;
  const c = player.position;
  camera.fov = 50;
  camera.updateProjectionMatrix();
  const r = Math.max(4.2, S.len * 1.8); // bikes get a closer camera
  camera.position.set(c.x + Math.cos(a) * r, c.y + r * 0.33, c.z + Math.sin(a) * r);
  camera.lookAt(c.x, c.y + 0.9, c.z);
  snapCamera = true;
}

let landmarkTimer = 0;
function updateHud(dt) {
  const show = S.mode === 'countdown' || S.mode === 'race';
  ui.hud.classList.toggle('hidden', !show);
  ui.touch.classList.toggle('hidden', !(isTouch && show));

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) ui.toast.className = '';
  }
  ui.countdown.textContent = S.mode === 'countdown' ? Math.ceil(S.countdown) : '';
  if (!show) return;

  const done = clamp(S.s / route.length, 0, 1);
  ui.time.textContent = fmt(S.time);
  ui.dist.textContent = `${(Math.max(0, route.length - S.s) / 1000).toFixed(2)} km`;
  ui.fill.style.width = `${done * 100}%`;
  ui.carIcon.style.left = `${done * 100}%`;
  ui.speed.textContent = Math.round(S.speed * 3.6);
  ui.speedo.classList.toggle('boost', S.boosting || S.power === 'turbo');
  ui.nitro.style.width = `${S.nitro * 100}%`;
  ui.crashes.textContent = S.crashes ? `💥 ${S.crashes}` : '';
  ui.street.textContent = route.nameAt(S.s) || ' ';
  // Landmark callouts: announce a real landmark as it comes up beside the road.
  for (const l of S.landmarks || []) {
    if (l.shown || S.s < l.s - 160 || S.s > l.s + 40) continue;
    l.shown = true;
    ui.landmark.textContent = `${l.side < 0 ? '◀ ' : ''}📍 ${l.name}${l.side > 0 ? ' ▶' : ''}`;
    ui.landmark.classList.add('show');
    clearTimeout(landmarkTimer);
    landmarkTimer = setTimeout(() => ui.landmark.classList.remove('show'), 3200);
  }

  const corner = route.cornerAhead(S.s + 10, 160);
  const safe = corner.v * stats.grip * 1.15;
  const warn = S.y < 1 && safe < 30 && S.speed > safe * 0.95;
  ui.turn.classList.toggle('hidden', !warn);
  if (warn) ui.turn.textContent = `${corner.dir > 0 ? '↱' : '↰'} ${Math.round(safe * 3.6)}`;

  ui.power.classList.toggle('hidden', !S.power || S.power === 'blast');
  if (S.power) {
    const p = POWERS[S.power];
    ui.powerLabel.textContent = `${p.icon} ${p.label}`;
    ui.powerFill.style.width = `${(S.powerTime / p.duration) * 100}%`;
  }
}

// --- Sound ---
let beepAt = 0; // countdown number that last beeped
let hornHeld = false;
// Reused every frame so the sound update allocates nothing.
const soundIn = { active: false, racing: false, speed: 0, throttle: false, brake: false, boost: false, turbo: false, airborne: false, flying: false, drifting: false, top: 45 };

function updateSound(dt, input) {
  const active = S.mode === 'countdown' || S.mode === 'race';
  const racing = S.mode === 'race';
  const turbo = racing && S.power === 'turbo';
  soundIn.active = active;
  soundIn.racing = racing;
  soundIn.speed = S.speed;
  // Touch screens accelerate on their own, so only rev on the start line from a real key.
  soundIn.throttle = racing ? input.gas || S.boosting || turbo : active && input.gas && !isTouch;
  soundIn.brake = racing && input.brake;
  soundIn.boost = racing && S.boosting;
  soundIn.turbo = turbo;
  soundIn.airborne = racing && Boolean(S.airborne);
  soundIn.flying = S.y > 1.5;
  soundIn.drifting = racing && S.drifting;
  soundIn.top = BASE_SPEED * stats.top;
  sound.update(dt, soundIn);
  // Horn (H key or the touch button) while driving.
  const horn = active && input.horn;
  if (horn !== hornHeld) {
    hornHeld = horn;
    if (horn) sound.hornStart();
    else sound.hornStop();
  }
}

// A short whoosh when a car goes by close and fast, panned to its side.
const passPrev = new Float32Array(traffic.cars.length).fill(NaN);
function checkPassBy() {
  const cars = traffic.cars;
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    if (!c.active || c.flying) {
      passPrev[i] = NaN;
      continue;
    }
    const ds = c.s - S.s; // > 0: ahead of the player
    const prev = passPrev[i];
    passPrev[i] = ds;
    const crossed = (prev > 0 && ds <= 0) || (prev < 0 && ds >= 0);
    if (!crossed || Math.abs(ds - prev) > 12) continue; // respawned, not passed
    const dx = c.lat - S.x;
    const rel = Math.abs(S.speed - c.speed);
    if (Math.abs(dx) > 5 || rel < 6 || S.speed < 12 || S.y > 2) continue;
    sound.play('passby', { pan: clamp(dx / 4, -1, 1), strength: clamp(rel / 30, 0.3, 1) });
  }
}

// --- Main loop ---
let t = 0;
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  t += dt;
  if (!route || !player) {
    renderer.render(scene, camera);
    return;
  }
  const input = readInput();

  if (S.mode === 'countdown') {
    S.countdown -= dt;
    const n = Math.ceil(S.countdown);
    if (n > 0 && n !== beepAt) {
      beepAt = n;
      sound.play('beep');
    }
    if (S.countdown <= 0) {
      S.mode = 'race';
      toast('GO!', 'go');
      sound.play('go');
    }
  } else if (S.mode === 'race') {
    S.time += dt;
    drive(dt, input);
    if (S.power && (S.powerTime -= dt) <= 0) S.power = null;
  }
  S.invuln = Math.max(0, S.invuln - dt);

  signals.update(t);
  traffic.update(dt, t, S);
  const cans = nitroCans.update(dt, t, S);
  const boxes = mysteryBoxes.update(dt, t, S);
  if (S.mode === 'race') {
    checkCollisions();
    checkPassBy();
    if (cans) {
      S.nitro = Math.min(1, S.nitro + 0.35 * cans);
      toast('+NITRO', 'nitro');
      sound.play('can');
      progress.add('cans', cans);
    }
    if (boxes) {
      sound.play('box');
      activatePower(randomPower());
      progress.add('boxes', boxes);
    }
    if (S.s >= route.length - 14) finish();
  }
  effects.update(dt);

  if (S.mode === 'finished') {
    const before = player.position.clone();
    if (ending.update(dt, player, camera)) showResult();
    spinWheels(player, before.distanceTo(player.position));
  } else {
    updatePlayerMesh(t, input);
    if (S.mode === 'menu' || S.mode === 'loading') updateMenuCamera(t);
    else updateChaseCamera(dt);
  }
  updateFx(t);
  updateHud(dt);
  updateSound(dt, input);
  if (devCam) {
    camera.position.set(...devCam.pos);
    camera.lookAt(...devCam.look);
    camera.fov = devCam.fov ?? 60;
    camera.updateProjectionMatrix();
  }
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Test hook for automated checks; only exists in the dev server.
if (import.meta.env.DEV) {
  window.__game = {
    S, activatePower, finish, startRace, selectMap, selectCar, progress, sound, traffic, nitroCans, mysteryBoxes,
    get route() { return route; },
    get world() { return world; },
    set orbit(a) { orbitAngle = a; },
    set cam(v) { devCam = v; },
  };
}

selectCar(prefs.car);
selectMap(prefs.map);
progressReady.then(() => { if (S.mode === 'menu') renderMenu(); loadRanks(); });
requestAnimationFrame(frame);
