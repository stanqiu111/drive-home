import * as THREE from 'three';
import './style.css';
import { createWorld, loadMapData } from './world.js';
import { makeCar, spinWheels, initCarEnvironment, CAR_MODELS, CAR_IDS, PAINTS } from './cars.js';
import { Traffic } from './traffic.js';
import { Signals } from './signals.js';
import { Collectibles, makeNitroCan } from './pickups.js';
import { POWERS, randomPower, makeMysteryBox, PowerVisuals } from './powers.js';
import { leaderboardEnabled, topScores, submitScore } from './leaderboard.js';
import { progress, progressReady, ACHIEVEMENTS } from './progress.js';
import { Effects } from './effects.js';
import { Ending } from './ending.js';
import { buildFun, FUN_RIDES, FUN_IDS } from './funrides.js';
import { readInput, setupTouch, isTouch } from './input.js';

const MAPS = [
  { id: 'home', name: 'Downtown', sub: 'Home · Gateway Blvd & Walterdale Bridge', km: 15.6, cheer: 'FINALLY HOME!!', ending: 'game' },
  { id: 'windermere', name: 'Windermere', sub: 'West along Ellerslie Rd', km: 11.3, cheer: 'MADE IT!!', ending: 'shopping' },
  { id: 'sherwood', name: 'Sherwood Park', sub: 'Anthony Henday, east', km: 22.2, cheer: 'MADE IT!!', ending: 'bbq' },
  { id: 'burger', name: 'Odd Burger', sub: 'Quick burger run on Ellerslie Rd', km: 1.5, cheer: 'MADE IT!!', ending: 'burger' },
  { id: 'beachclub', name: 'Summerside Beach Club', sub: 'Residents’ lake club, around the corner', km: 1.6, cheer: 'MADE IT!!', ending: 'beach' },
  { id: 'noodle', name: 'Noodle Feast', sub: 'Parsons Place, up 99 St', km: 7.1, cheer: 'MADE IT!!', ending: 'noodle' },
];

const BASE_SPEED = 45; // m/s ≈ 162 km/h before car stats
const NITRO_BONUS = 21; // m/s on top of the car's top speed
const TURBO_SPEED = 90; // m/s ≈ 324 km/h
const FLY_HEIGHT = 7;
const BLAST_RANGE = 110;
const RUSH_HOUR_SPEED = 8; // m/s, roughly what the real commute averages at rush hour
const PREFS_KEY = 'driveHome.prefs';

const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), time: $('time'), dist: $('dist'), fill: $('progress-fill'), carIcon: $('car-icon'),
  speed: $('speed'), speedo: $('speedo'), nitro: $('nitro-fill'), crashes: $('crashes'), street: $('street'), turn: $('turn'),
  power: $('power'), powerLabel: $('power-label'), powerFill: $('power-fill'),
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
    signals = new Signals(scene, route, data.signals.filter((s) => s < route.length - 120));
    traffic.setWorld(route, signals);
    nitroCans.setRoute(route);
    mysteryBoxes.setRoute(route);
    ending.setRoute(route, world.heightAt, mapInfo().cheer, mapInfo().ending);
    ui.credits.textContent = data.credits;
    reset();
    S.mode = 'menu';
  } catch (e) {
    console.error(e);
    ui.loading.textContent = `Could not load the map: ${e.message}`;
    return;
  }
  ui.loading.classList.remove('show');
}

function renderMenu() {
  ui.mapList.innerHTML = MAPS.map((m) => {
    const best = loadBest(m.id);
    return `<button class="tile ${m.id === prefs.map ? 'sel' : ''}" data-map="${m.id}">
      <b>${m.name}</b><span>${m.sub}</span>
      <small>${m.km} km${best ? ` · best ${fmt(best)}` : ''}</small></button>`;
  }).join('');
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
    const desc = f.locked && !locked ? '259 km/h and smashes straight through traffic' : f.desc;
    return `<button class="tile car fun ${id === prefs.car ? 'sel' : ''} ${locked ? 'locked' : ''}" data-car="${id}">
      <small>${f.locked ? (locked ? '🔒 Locked' : '🚀 Unlocked') : 'Fun ride'}</small><b>${f.name}</b>
      ${bar('Speed', f.stats.top)}${bar('Accel', f.stats.accel)}${bar('Grip', f.stats.grip)}
      <span>${desc}</span></button>`;
  }).join('');
  renderAchievements();
  const car = modelOf(prefs.car);
  $('pick').innerHTML = `<b>${mapInfo().name}</b> in the <b>${CAR_MODELS[prefs.car] ? `${car.brand} ` : ''}${car.name}</b>`;
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

// Achievement pop-ups, one after another.
const achQueue = [];
let achBusy = false;
function popAchievement(text) {
  achQueue.push(text);
  if (achBusy) return;
  achBusy = true;
  const next = () => {
    const t = achQueue.shift();
    if (!t) {
      achBusy = false;
      return;
    }
    $('achieve').textContent = t;
    $('achieve').classList.add('show');
    setTimeout(() => {
      $('achieve').classList.remove('show');
      setTimeout(next, 350);
    }, 2600);
  };
  next();
}
progress.onChange((fresh) => {
  for (const a of fresh) popAchievement(`🏅 ${a.icon} ${a.name}!`);
  if (fresh.length && progress.rocketUnlocked) popAchievement('🚀 ROCKET UNLOCKED! Pick it in the garage');
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
  Object.assign(S, {
    s: 8, y: 0, speed: 0, steer: 0, nitro: 1, boosting: false, drifting: false, driftYaw: 0,
    power: null, powerTime: 0, time: 0, crashes: 0, smashed: 0, reds: 0, invuln: 0, shake: 0,
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
}

function showResult() {
  const id = prefs.map;
  const best = loadBest(id);
  const isRecord = best === null || S.time < best;
  if (isRecord) saveBest(id, S.time);
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
});
setupTouch(ui.touch);

// --- Powers ---
function activatePower(kind) {
  S.power = kind;
  S.powerTime = POWERS[kind].duration;
  toast(`${POWERS[kind].icon} ${POWERS[kind].label}!`, 'power');
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
    S.nitro = Math.max(0, S.nitro - dt * 0.3);
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
  S.y += ((S.power === 'fly' ? FLY_HEIGHT : 0) - S.y) * Math.min(1, dt * 3);
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
      continue;
    }
    if (S.invuln > 0) return;

    if (Math.abs(ds) > (S.len + c.len) * 0.3) {
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
  const targetFov = 62 + S.speed * 0.28 + (S.boosting ? 6 : 0);
  S.fov += (targetFov - S.fov) * Math.min(1, dt * 3);
  camera.fov = S.fov;
  camera.updateProjectionMatrix();

  route.toWorld(S.s - 8.5, S.x * 0.8, 3.6 + S.y * 1.1, tmpA);
  route.toWorld(S.s + 14, S.x * 0.9, 1.4 + S.y * 0.8, tmpB);
  const k = snapCamera ? 1 : Math.min(1, dt * 8);
  camPos.lerp(tmpA, k);
  camLook.lerp(tmpB, k);
  snapCamera = false;

  S.shake = Math.max(0, S.shake - dt);
  const shake = () => (Math.random() - 0.5) * S.shake * 0.8;
  camera.position.set(camPos.x + shake(), camPos.y + shake(), camPos.z);
  camera.lookAt(camLook);
}

let orbitAngle = null; // fixed angle for screenshots (dev hook)
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
    if (S.countdown <= 0) {
      S.mode = 'race';
      toast('GO!', 'go');
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
    if (cans) {
      S.nitro = Math.min(1, S.nitro + 0.35 * cans);
      toast('+NITRO', 'nitro');
      progress.add('cans', cans);
    }
    if (boxes) {
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
    S, activatePower, finish, startRace, selectMap, selectCar, progress,
    get route() { return route; },
    set orbit(a) { orbitAngle = a; },
  };
}

selectCar(prefs.car);
selectMap(prefs.map);
progressReady.then(() => { if (S.mode === 'menu') renderMenu(); });
requestAnimationFrame(frame);
