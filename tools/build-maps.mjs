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
import { createOSMStream } from 'osm-pbf-parser-node';
import {
  START, GLOBAL_PROJ, ROAD_RADIUS, BUILDING_RADIUS, WAY_KEYS, RAIL_KEYS,
  osmWayKind, isRail, corridorCells, routeFromCoords, osrmRouteUrl, loadRooflines, loadZoning, buildMapData,
} from '../src/mapgen/core.js';
import { sampleDEM } from '../src/mapgen/dem.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tools/cache');
const OUT = path.join(ROOT, 'public/maps');
const PBF = path.join(CACHE, 'alberta-latest.osm.pbf');
const UA = 'DriveHomeGame/0.1 (personal hobby project)';
const { project, unproject } = GLOBAL_PROJ;

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

// ---------- 2. OSM corridor extract (one pass over the Alberta file for all maps) ----------
async function extractOSM(routes) {
  return cached('osm-corridor.json', async () => {
    if (!fs.existsSync(PBF)) throw new Error(`Missing ${PBF}. Download https://download.geofabrik.de/north-america/canada/alberta-latest.osm.pbf there.`);
    log('Reading OpenStreetMap Alberta extract (one-time, a few minutes)…');
    const inRoad = corridorCells(routes, ROAD_RADIUS + 100);
    const inBuilding = corridorCells(routes, BUILDING_RADIUS + 100);

    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (const pts of routes) for (const [x, z] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const [lonA, latA] = unproject(minX - 3000, maxZ + 3000);
    const [lonB, latB] = unproject(maxX + 3000, minZ - 3000);

    let cap = 1 << 20;
    let n = 0;
    let ids = new Float64Array(cap);
    let lat7 = new Int32Array(cap);
    let lon7 = new Int32Array(cap);
    let sorted = true;
    const signals = [];
    const ways = [];
    let count = 0;

    const find = (id) => {
      let lo = 0;
      let hi = n - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const v = ids[mid];
        if (v === id) return mid;
        if (v < id) lo = mid + 1; else hi = mid - 1;
      }
      return -1;
    };

    for await (const item of createOSMStream(PBF, { withTags: { node: ['highway'], way: WAY_KEYS, relation: [] } })) {
      if (++count % 5e6 === 0) log(`  ${(count / 1e6).toFixed(0)}M objects…`);
      if (item.type === 'node') {
        if (item.lon < lonA || item.lon > lonB || item.lat < latA || item.lat > latB) continue;
        if (n === cap) {
          cap *= 2;
          const a = new Float64Array(cap); a.set(ids); ids = a;
          const b = new Int32Array(cap); b.set(lat7); lat7 = b;
          const c = new Int32Array(cap); c.set(lon7); lon7 = c;
        }
        if (n && item.id < ids[n - 1]) sorted = false;
        ids[n] = item.id;
        lat7[n] = Math.round(item.lat * 1e7);
        lon7[n] = Math.round(item.lon * 1e7);
        n++;
        if (item.tags?.highway === 'traffic_signals') signals.push([item.lon, item.lat]);
      } else if (item.type === 'way') {
        if (!sorted) throw new Error('PBF nodes are not sorted by id');
        const t = item.tags;
        const kind = osmWayKind(t);
        if (!kind) continue;
        const c = [];
        let ok = true;
        for (const ref of item.refs) {
          const k = find(ref);
          if (k < 0) { ok = false; break; }
          c.push(lon7[k] / 1e7, lat7[k] / 1e7);
        }
        if (!ok || c.length < 4) continue;
        let near = false;
        if (kind !== 'building') {
          for (let i = 0; i < c.length && !near; i += 2) near = inRoad(...project(c[i], c[i + 1]));
        } else {
          near = inBuilding(...project(c[0], c[1]));
        }
        if (near) ways.push({ t, c });
      } else if (item.type === 'relation') {
        break; // relations come last; nothing more to read
      }
    }
    log(`  kept ${ways.length} ways, ${signals.length} signals from ${n} nodes`);
    return { ways, signals };
  });
}

// Railways near the routes (own pass and cache file): a route bridge over a railway gets the
// same clearance as one over a road.
async function extractRail(routes) {
  return cached('osm-rail.json', async () => {
    if (!fs.existsSync(PBF)) throw new Error(`Missing ${PBF}. Download https://download.geofabrik.de/north-america/canada/alberta-latest.osm.pbf there.`);
    log('Reading OpenStreetMap railways (one-time, a few minutes)…');
    const near = corridorCells(routes, 300);
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (const pts of routes) for (const [x, z] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const [lonA, latA] = unproject(minX - 1000, maxZ + 1000);
    const [lonB, latB] = unproject(maxX + 1000, minZ - 1000);
    let cap = 1 << 20;
    let n = 0;
    let ids = new Float64Array(cap);
    let lat7 = new Int32Array(cap);
    let lon7 = new Int32Array(cap);
    const find = (id) => {
      let lo = 0;
      let hi = n - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (ids[mid] === id) return mid;
        if (ids[mid] < id) lo = mid + 1; else hi = mid - 1;
      }
      return -1;
    };
    const rails = [];
    for await (const item of createOSMStream(PBF, { withTags: { node: [], way: RAIL_KEYS, relation: [] } })) {
      if (item.type === 'node') {
        if (item.lon < lonA || item.lon > lonB || item.lat < latA || item.lat > latB) continue;
        if (n === cap) {
          cap *= 2;
          const a = new Float64Array(cap); a.set(ids); ids = a;
          const b = new Int32Array(cap); b.set(lat7); lat7 = b;
          const c = new Int32Array(cap); c.set(lon7); lon7 = c;
        }
        ids[n] = item.id;
        lat7[n] = Math.round(item.lat * 1e7);
        lon7[n] = Math.round(item.lon * 1e7);
        n++;
      } else if (item.type === 'way') {
        const t = item.tags;
        if (!isRail(t)) continue;
        const c = [];
        for (const ref of item.refs) {
          const k = find(ref);
          if (k >= 0) c.push(lon7[k] / 1e7, lat7[k] / 1e7);
        }
        let ok = false;
        for (let i = 0; i < c.length && !ok; i += 2) ok = near(...project(c[i], c[i + 1]));
        if (ok && c.length >= 4) rails.push({ t, c });
      } else if (item.type === 'relation') {
        break;
      }
    }
    log(`  kept ${rails.length} railway ways`);
    return rails;
  });
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
const osm = await extractOSM(allRoutes);
osm.rails = await extractRail(allRoutes);
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
