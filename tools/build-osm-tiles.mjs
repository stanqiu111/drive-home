#!/usr/bin/env node
// Cuts the OpenStreetMap data the map builder uses, for all of Edmonton, into tiles in
// public/osm/ (format: src/mapgen/osm-tiles.js). tools/build-maps.mjs and the game's
// custom-route builder both read these tiles, so built-in and custom maps come from the
// same data. Run it after changing what is kept (WAY_KEYS, RAIL_KEYS, POI_KEYS, osmWayKind,
// isRail, isPoi) or to pick up newer OpenStreetMap data, then rebuild every map.
//
//   node tools/build-osm-tiles.mjs      # a few minutes
//
// Needs tools/cache/alberta-latest.osm.pbf (about 350 MB) from
// https://download.geofabrik.de/north-america/canada/alberta-latest.osm.pbf

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOSMStream } from 'osm-pbf-parser-node';
import { WAY_KEYS, RAIL_KEYS, osmWayKind, isRail } from '../src/mapgen/core.js';
import { TILE_VERSION, TLON, TLAT, COVER, POI_KEYS, isPoi, tileOf, tileKey } from '../src/mapgen/osm-tiles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PBF = path.join(ROOT, 'tools/cache/alberta-latest.osm.pbf');
const OUT = path.join(ROOT, 'public/osm');
const log = (...a) => console.log(...a);

if (!fs.existsSync(PBF)) throw new Error(`Missing ${PBF}. Download https://download.geofabrik.de/north-america/canada/alberta-latest.osm.pbf there.`);
const pick = (tags, keys) => {
  if (!tags) return null;
  const o = {};
  let any = false;
  for (const k of keys) if (tags[k] !== undefined) { o[k] = tags[k]; any = true; }
  return any ? o : null;
};

// Nodes inside the covered area (sorted by id in the extract, so lookups are a binary search).
let cap = 1 << 22;
let n = 0;
let ids = new Float64Array(cap);
let lat7 = new Int32Array(cap);
let lon7 = new Int32Array(cap);
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

const tiles = new Map(); // key -> { ways: [], signals: [], pois: [] }
const tile = (key) => {
  let t = tiles.get(key);
  if (!t) { t = { ways: [], signals: [], pois: [] }; tiles.set(key, t); }
  return t;
};
const counts = { road: 0, building: 0, area: 0, rail: 0, signals: 0, pois: 0 };
let objects = 0;
const wayKeys = [...new Set([...WAY_KEYS, ...RAIL_KEYS, ...POI_KEYS])];
const nodeKeys = [...new Set(['highway', ...POI_KEYS])];
log('Reading OpenStreetMap Alberta extract…');
for await (const item of createOSMStream(PBF, { withTags: { node: nodeKeys, way: wayKeys, relation: [] } })) {
  if (++objects % 5e6 === 0) log(`  ${(objects / 1e6).toFixed(0)}M objects…`);
  if (item.type === 'node') {
    if (item.lon < COVER.west || item.lon > COVER.east || item.lat < COVER.south || item.lat > COVER.north) continue;
    if (n === cap) {
      cap *= 2;
      const a = new Float64Array(cap); a.set(ids); ids = a;
      const b = new Int32Array(cap); b.set(lat7); lat7 = b;
      const c = new Int32Array(cap); c.set(lon7); lon7 = c;
    }
    if (n && item.id < ids[n - 1]) throw new Error('PBF nodes are not sorted by id');
    ids[n] = item.id;
    const la = Math.round(item.lat * 1e7);
    const lo = Math.round(item.lon * 1e7);
    lat7[n] = la;
    lon7[n] = lo;
    n++;
    const t = item.tags;
    if (!t) continue;
    const key = tileKey(...tileOf(item.lon, item.lat));
    if (t.highway === 'traffic_signals') { tile(key).signals.push(item.id, lo, la); counts.signals++; }
    if (isPoi(t)) { tile(key).pois.push([item.id, lo, la, pick(t, POI_KEYS)]); counts.pois++; }
  } else if (item.type === 'way') {
    const t = item.tags;
    if (!t) continue;
    const kind = osmWayKind(t);
    const rail = !kind && isRail(t);
    const poi = !kind && !rail && isPoi(t);
    if (!kind && !rail && !poi) continue;
    // The way's nodes, in runs inside the covered area. A road or railway that leaves the
    // area keeps each part inside it (as its own way, id × 1000 + part); a closed outline
    // (building, area, place) is all or nothing.
    const runs = [[]];
    for (const ref of item.refs) {
      const k = find(ref);
      if (k < 0) { if (runs[runs.length - 1].length) runs.push([]); continue; }
      runs[runs.length - 1].push(lon7[k], lat7[k]);
    }
    const whole = runs.length === 1;
    const parts = whole ? runs : (kind === 'road' || rail ? runs.filter((r) => r.length >= 4) : []);
    for (const [part, c] of parts.entries()) {
      if (c.length < 4) continue; // degenerate
      addWay(whole ? item.id : item.id * 1000 + part, t, c, kind, rail, poi);
    }
  } else if (item.type === 'relation') {
    break; // relations come last; nothing more to read
  }
}

// Puts one way (or a place's centre) into every tile it touches.
function addWay(id, t, c, kind, rail, poi) {
  if (poi) {
    // A place mapped as an area (a gas station forecourt, a mall's grounds): its centre.
    let sx = 0;
    let sy = 0;
    const m = c.length / 2 - (c[0] === c[c.length - 2] && c[1] === c[c.length - 1] ? 1 : 0);
    for (let k = 0; k < m; k++) { sx += c[2 * k]; sy += c[2 * k + 1]; }
    const lo = Math.round(sx / m);
    const la = Math.round(sy / m);
    tile(tileKey(...tileOf(lo / 1e7, la / 1e7))).pois.push([-id, lo, la, pick(t, POI_KEYS)]);
    counts.pois++;
    return;
  }
  const tags = rail ? pick(t, RAIL_KEYS) : pick(t, WAY_KEYS);
  counts[rail ? 'rail' : kind]++;
  // Every tile a segment passes through (sampled every ~100 m).
  const keys = new Set();
  for (let k = 0; k < c.length; k += 2) {
    keys.add(tileKey(...tileOf(c[k] / 1e7, c[k + 1] / 1e7)));
    if (k + 2 >= c.length) break;
    const dLon = (c[k + 2] - c[k]) / 1e7;
    const dLat = (c[k + 3] - c[k + 1]) / 1e7;
    const steps = Math.ceil(Math.hypot(dLon * 66000, dLat * 111000) / 100);
    for (let s = 1; s < steps; s++) keys.add(tileKey(...tileOf(c[k] / 1e7 + (dLon * s) / steps, c[k + 1] / 1e7 + (dLat * s) / steps)));
  }
  const d = c.slice();
  for (let k = c.length - 2; k >= 2; k -= 2) { d[k] = c[k] - c[k - 2]; d[k + 1] = c[k + 1] - c[k - 1]; }
  const way = [id, tags, d];
  for (const key of keys) tile(key).ways.push(way);
}
log(`  ${n} nodes in the area; kept ${JSON.stringify(counts)}`);

// Write the tiles (each with its own tag table) and the index.
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 't'), { recursive: true });
let bytes = 0;
const keys = [...tiles.keys()].sort();
for (const key of keys) {
  const t = tiles.get(key);
  const table = [];
  const index = new Map();
  const ti = (tags) => {
    const s = JSON.stringify(tags);
    if (!index.has(s)) { index.set(s, table.length); table.push(tags); }
    return index.get(s);
  };
  const ways = t.ways.map(([id, tags, d]) => [id, ti(tags), d]);
  const pois = t.pois.map(([id, lo, la, tags]) => [id, lo, la, ti(tags)]);
  const json = JSON.stringify({ v: TILE_VERSION, tags: table, ways, signals: t.signals, pois });
  fs.writeFileSync(path.join(OUT, 't', `${key}.json`), json);
  bytes += json.length;
}
const pbfDate = fs.statSync(PBF).mtime.toISOString().slice(0, 10);
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ v: TILE_VERSION, tlon: TLON, tlat: TLAT, cover: COVER, osmDate: pbfDate, tiles: keys }));
log(`Wrote ${keys.length} tiles, ${(bytes / 1e6).toFixed(1)} MB, to ${path.relative(ROOT, OUT)}/`);
