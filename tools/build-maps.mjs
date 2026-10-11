#!/usr/bin/env node
// Builds public/maps/<id>.json from real Edmonton data.
//
//   node tools/build-maps.mjs            # all maps
//   node tools/build-maps.mjs home       # one map
//
// The building itself is src/mapgen/core.js, shared with the game's custom-route builder;
// this file only fetches and caches the data and writes the files. Sources (all free, no
// API key): see core.js. Downloads are cached in tools/cache/. Delete a cache file to
// refresh it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { START, GLOBAL_PROJ, osmNearRoutes, routeFromCoords, osrmRouteUrl, loadRooflines, loadZoning, buildMapData } from '../src/mapgen/core.js';
import { tilesForRoutes, mergeTiles } from '../src/mapgen/osm-tiles.js';
import { sampleDEM } from '../src/mapgen/dem.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tools/cache');
const OUT = path.join(ROOT, 'public/maps');
const UA = 'DriveHomeGame/0.1 (personal hobby project)';

// Every map has a public start point (never a private address). Maps without `start`
// begin in Summerside (START); the `from` label groups them in the menu.
const MAPS = [
  { id: 'home', name: 'Downtown', dest: [-113.5066314, 53.5335503] }, // by the Legislature
  { id: 'windermere', name: 'Windermere', dest: [-113.6167789, 53.4232375] },
  { id: 'sherwood', name: 'Sherwood Park', dest: [-113.296631, 53.5256963] },
  { id: 'burger', name: 'Odd Burger', dest: [-113.478038, 53.4260143] },
  { id: 'beachclub', name: 'Summerside Beach Club', dest: [-113.4688974, 53.4172588] },
  { id: 'noodle', name: 'Noodle Feast', dest: [-113.4877410, 53.4685914] },
  // From downtown: 107 St NW just north of 97 Ave, a public street on the east edge of the
  // Legislature grounds (the exact end of the home route is a grounds loop road OSRM dislikes).
  { id: 'snowvalley', name: 'Snow Valley', from: 'Downtown', start: [-113.504, 53.535], dest: [-113.5574, 53.4849] },
  { id: 'refinery', name: 'Refinery Row', from: 'Downtown', start: [-113.504, 53.535], dest: [-113.2935455, 53.5309686] },
];

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ---------- helpers ----------
async function cached(name, fn) {
  const f = path.join(CACHE, name);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fn();
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
}

async function getJSON(url) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (r.ok) return await r.json();
      log(`  HTTP ${r.status}, retrying…`);
    } catch (e) {
      log(`  ${e.message}, retrying…`);
    }
    await sleep(2000 * (i + 1));
  }
  throw new Error(`fetch failed: ${url}`);
}

// ---------- 1. routes ----------
async function loadRoute(m) {
  const coords = await cached(`route-${m.id}.json`, async () => {
    log(`  fetching route from OSRM…`);
    const j = await getJSON(osrmRouteUrl(m.start ?? START, m.dest));
    await sleep(1100);
    return j.routes[0].geometry.coordinates;
  });
  return routeFromCoords(coords, GLOBAL_PROJ);
}

// ---------- 2. OpenStreetMap: the tiles in public/osm/ (tools/build-osm-tiles.mjs) ----------
// The same tiles the game's custom-route builder downloads, so built-in and custom maps get
// the same data. Kept: what lies near any of the routes (osmNearRoutes).
function loadOSM(routes) {
  const dir = path.join(ROOT, 'public/osm');
  if (!fs.existsSync(path.join(dir, 'index.json'))) throw new Error('Missing public/osm/: run node tools/build-osm-tiles.mjs first.');
  const have = new Set(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).tiles);
  const keys = new Set();
  for (const pts of routes) for (const k of tilesForRoutes([pts], GLOBAL_PROJ)) keys.add(k);
  const missing = [...keys].filter((k) => !have.has(k));
  if (missing.length > keys.size * 0.02) throw new Error(`${missing.length} OpenStreetMap tiles missing: the routes leave the area in osm-tiles.js COVER.`);
  const tiles = [...keys].filter((k) => have.has(k)).map((k) => JSON.parse(fs.readFileSync(path.join(dir, 't', `${k}.json`), 'utf8')));
  const osm = osmNearRoutes(mergeTiles(tiles), routes, GLOBAL_PROJ);
  log(`OpenStreetMap: ${tiles.length} tiles, kept ${osm.ways.length} ways, ${osm.rails.length} railways, ${osm.signals.length} signals, ${osm.pois.length} places`);
  return osm;
}

// ---------- 3. City of Edmonton rooflines and zoning (cached per map) ----------
const io = {
  proj: GLOBAL_PROJ,
  log,
  sampleDEM,
  rooflines: (m, pts) => cached(`rooflines-${m.id}.json`, async () => {
    log('  downloading City of Edmonton building rooflines…');
    const out = await loadRooflines(pts, getJSON, { tick: () => process.stdout.write('.') });
    log(` ${out.length} buildings`);
    return out;
  }),
  zoning: (m, pts) => cached(`zoning-${m.id}.json`, async () => {
    log('  downloading City of Edmonton zoning…');
    const out = await loadZoning(pts, getJSON);
    log(`  ${out.length} zoning polygons`);
    return out;
  }),
};

// ---------- main ----------
const wanted = process.argv.slice(2);
const maps = wanted.length ? MAPS.filter((m) => wanted.includes(m.id)) : MAPS;
const allRoutes = [];
for (const m of MAPS) {
  log(`Route ${m.id}…`);
  allRoutes.push(await loadRoute(m));
}
const osm = loadOSM(allRoutes);
const indexFile = path.join(OUT, 'index.json');
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : [];
for (const m of maps) {
  const { out, meta } = await buildMapData(m, allRoutes[MAPS.indexOf(m)], osm, io);
  const file = path.join(OUT, `${m.id}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  log(`  wrote ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
  const k = index.findIndex((e) => e.id === m.id);
  if (k >= 0) index[k] = meta; else index.push(meta);
}
// Keep the menu order the same as MAPS.
index.sort((a, b) => MAPS.findIndex((m) => m.id === a.id) - MAPS.findIndex((m) => m.id === b.id));
fs.writeFileSync(indexFile, JSON.stringify(index));
log('\nDone.');
