#!/usr/bin/env node
// Builds public/maps/<id>.json from real Edmonton data.
//
//   node tools/build-maps.mjs            # all maps
//   node tools/build-maps.mjs home       # one map
//
// Sources (all free, no API key):
//   - Route:      OSRM demo server (router.project-osrm.org), fetched once and cached
//   - Roads:      OpenStreetMap, Geofabrik Alberta extract (ODbL)
//   - Buildings:  City of Edmonton Open Data "Rooflines" (jpxi-a9a5), OSM outside city limits
//   - Terrain:    NRCan MRDEM-30 digital terrain model (OGL-Canada)
// Downloads are cached in tools/cache/. Delete a cache file to refresh it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromUrl } from 'geotiff';
import proj4 from 'proj4';
import { createOSMStream } from 'osm-pbf-parser-node';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tools/cache');
const OUT = path.join(ROOT, 'public/maps');
const PBF = path.join(CACHE, 'alberta-latest.osm.pbf');
const UA = 'DriveHomeGame/0.1 (personal hobby project)';

// Every map has a public start point (never a private address). Maps without `start`
// begin in Summerside; the `from` label groups them in the menu.
const START = [-113.4804231, 53.4156855]; // 91 St SW, Summerside (public spot)
const MAPS = [
  { id: 'home', name: 'Downtown', dest: [-113.5066314, 53.5335503] }, // by the Legislature
  { id: 'windermere', name: 'Windermere', dest: [-113.6167789, 53.4232375] },
  { id: 'sherwood', name: 'Sherwood Park', dest: [-113.296631, 53.5256963] },
  { id: 'burger', name: 'Odd Burger', dest: [-113.478038, 53.4260143] },
  { id: 'beachclub', name: 'Summerside Beach Club', dest: [-113.4688974, 53.4172588] },
  { id: 'noodle', name: 'Noodle Feast', dest: [-113.4877410, 53.4685914] },
];

const STEP = 2; // metres between route samples
const LANE_W = 3.5;
const BUILDING_RADIUS = 350;
const SKYLINE_RADIUS = 2500;
const SKYLINE_MIN_H = 35;
const ROAD_RADIUS = 450;
const TERRAIN_RADIUS = 1500;
const CELL = 30; // terrain grid spacing, metres
const MATCH_DIST = 8;

const HIGHWAYS = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]);
const WAY_KEYS = ['highway', 'lanes', 'lanes:forward', 'lanes:backward', 'oneway', 'junction', 'bridge', 'layer',
  'name', 'ref', 'building', 'height', 'building:levels', 'building:colour', 'roof:shape', 'amenity', 'shop', 'tourism',
  'leisure', 'office', 'brand', 'landuse', 'natural', 'water', 'parking', 'man_made', 'operator',
  'destination', 'destination:ref', 'destination:street', 'junction:ref', 'exit_to'];

// Building classes written to the map files (the renderer picks a style per class).
const CLASS = {
  unknown: 0, house: 1, rowhouse: 2, apartments: 3, retail: 4, industrial: 5, office: 6, civic: 7, outbuilding: 8,
  hotel: 9, parking: 10, church: 11, school: 12, bigbox: 13,
};
const OSM_CLASS = {
  house: 'house', detached: 'house', semidetached_house: 'house', residential: 'house', bungalow: 'house', cabin: 'house',
  terrace: 'rowhouse', townhouse: 'rowhouse',
  apartments: 'apartments', dormitory: 'apartments',
  commercial: 'retail', retail: 'retail', supermarket: 'bigbox', kiosk: 'retail',
  industrial: 'industrial', warehouse: 'industrial', manufacture: 'industrial', service: 'industrial', hangar: 'industrial',
  office: 'office',
  public: 'civic', civic: 'civic', government: 'civic', hospital: 'civic', train_station: 'civic', transportation: 'civic',
  fire_station: 'civic', pavilion: 'civic', stadium: 'civic', sports_centre: 'civic', sports_hall: 'civic',
  garage: 'outbuilding', garages: 'outbuilding', shed: 'outbuilding', carport: 'outbuilding', roof: 'outbuilding', hut: 'outbuilding',
  outbuilding: 'outbuilding', allotment_house: 'outbuilding', guardhouse: 'outbuilding', farm_auxiliary: 'outbuilding',
  hotel: 'hotel',
  parking: 'parking',
  church: 'church', religious: 'church', chapel: 'church', mosque: 'church', temple: 'church', cathedral: 'church',
  school: 'school', college: 'school', university: 'school', kindergarten: 'school',
};
// Class from OSM tags; `null` when the tags don't say.
function osmClass(t) {
  if (!t) return null;
  if (t.amenity === 'place_of_worship') return 'church';
  if (['school', 'college', 'university', 'kindergarten'].includes(t.amenity)) return 'school';
  if (t.tourism === 'hotel' || t.tourism === 'motel') return 'hotel';
  if (t.amenity === 'parking' || t.parking) return 'parking';
  if (t.shop && !OSM_CLASS[t.building]) return 'retail';
  if (t.office && (t.building === 'yes' || !t.building)) return 'office';
  return OSM_CLASS[t.building] ?? null;
}
// Fallback by size when nothing is tagged.
function guessClass(area, h) {
  if (h >= 30) return 'office';
  if (area < 80 && h < 5) return 'outbuilding';
  if (area < 320 && h < 12) return 'house';
  if (area >= 2500 && h < 16) return 'bigbox';
  if (h >= 14) return 'apartments';
  if (area >= 700) return 'retail';
  return 'unknown';
}

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ---------- projection: local metres, x = east, z = south ----------
// One global projection (origin = Summerside START) is used while reading data; each
// map's output is then shifted so its own start point sits at (0, 0).
const DEG = Math.PI / 180;
const mLat = (p) => 111132.954 - 559.822 * Math.cos(2 * p * DEG) + 1.175 * Math.cos(4 * p * DEG);
const mLon = (p) => 111412.84 * Math.cos(p * DEG) - 93.5 * Math.cos(3 * p * DEG) + 0.118 * Math.cos(5 * p * DEG);
const [LON0, LAT0] = START;
const project = (lon, lat) => [(lon - LON0) * mLon(lat), -(lat - LAT0) * mLat((lat + LAT0) / 2)];
function unproject(x, z) {
  let lat = LAT0 - z / mLat(LAT0);
  lat = LAT0 - z / mLat((lat + LAT0) / 2);
  return [LON0 + x / mLon(lat), lat];
}

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

const r1 = (v) => Math.round(v * 10) / 10;
const arrMin = (a) => a.reduce((m, v) => (v < m ? v : m), Infinity);
const arrMax = (a) => a.reduce((m, v) => (v > m ? v : m), -Infinity);
const r2 = (v) => Math.round(v * 100) / 100;

function resample(pts, step) {
  const out = [pts[0].slice()];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    let d = step - carry;
    while (d <= len) {
      out.push([ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len]);
      d += step;
    }
    carry = len - (d - step);
  }
  const last = pts[pts.length - 1];
  if (carry > step * 0.3) out.push(last.slice());
  return out;
}

// Moving average with a symmetric window that shrinks at the ends, so the ends stay put.
function smoothPts(pts, k) {
  const n = pts.length;
  return pts.map((_, i) => {
    const kk = Math.min(k, i, n - 1 - i);
    let sx = 0;
    let sz = 0;
    for (let j = i - kk; j <= i + kk; j++) {
      sx += pts[j][0];
      sz += pts[j][1];
    }
    return [sx / (2 * kk + 1), sz / (2 * kk + 1)];
  });
}

function smoothArr(a, k) {
  const n = a.length;
  return a.map((_, i) => {
    const kk = Math.min(k, i, n - 1 - i);
    let s = 0;
    for (let j = i - kk; j <= i + kk; j++) s += a[j];
    return s / (2 * kk + 1);
  });
}

function medianArr(a, k) {
  return a.map((_, i) => {
    const w = a.slice(Math.max(0, i - k), i + k + 1).sort((x, y) => x - y);
    return w[w.length >> 1];
  });
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

// Douglas–Peucker on a closed ring of [x,z].
function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function simplifyRing(ring, tol) {
  if (ring.length <= 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1;
    let bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(ring[i][0], ring[i][1], ring[a][0], ring[a][1], ring[b][0], ring[b][1]);
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
}

// Spatial hash of route sample indices for nearest-point queries.
class RouteIndex {
  constructor(pts, cell = 40) {
    this.pts = pts;
    this.cell = cell;
    this.map = new Map();
    pts.forEach(([x, z], i) => {
      const k = this.key(Math.floor(x / cell), Math.floor(z / cell));
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(i);
    });
  }
  key(cx, cz) { return cx * 100003 + cz; }
  nearest(x, z, maxR) {
    const c = this.cell;
    const rr = Math.ceil(maxR / c);
    const cx = Math.floor(x / c);
    const cz = Math.floor(z / c);
    let best = Infinity;
    let bi = -1;
    for (let i = -rr; i <= rr; i++) {
      for (let j = -rr; j <= rr; j++) {
        const list = this.map.get(this.key(cx + i, cz + j));
        if (!list) continue;
        for (const idx of list) {
          const d = Math.hypot(this.pts[idx][0] - x, this.pts[idx][1] - z);
          if (d < best) { best = d; bi = idx; }
        }
      }
    }
    return best <= maxR ? { i: bi, d: best } : null;
  }
}

// ---------- 1. routes ----------
async function loadRoute(m) {
  const coords = await cached(`route-${m.id}.json`, async () => {
    log(`  fetching route from OSRM…`);
    const u = `https://router.project-osrm.org/route/v1/driving/${(m.start ?? START).join(',')};${m.dest.join(',')}?overview=full&geometries=geojson`;
    const j = await getJSON(u);
    await sleep(1100);
    return j.routes[0].geometry.coordinates;
  });
  let pts = coords.map(([lon, lat]) => project(lon, lat));
  pts = resample(pts, STEP);
  pts = smoothPts(smoothPts(pts, 5), 5);
  pts = resample(pts, STEP);
  return pts;
}

// ---------- 2. OSM corridor extract (one pass over the Alberta file for all maps) ----------
function corridorCells(routes, radius, cell = 100) {
  const set = new Set();
  const rr = Math.ceil(radius / cell);
  for (const pts of routes) {
    for (let i = 0; i < pts.length; i += 10) {
      const cx = Math.floor(pts[i][0] / cell);
      const cz = Math.floor(pts[i][1] / cell);
      for (let a = -rr; a <= rr; a++) for (let b = -rr; b <= rr; b++) set.add(`${cx + a},${cz + b}`);
    }
  }
  return (x, z) => set.has(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
}

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
        if (!t) continue;
        const isRoad = HIGHWAYS.has(t.highway);
        const isBuilding = !!t.building && !isRoad;
        const isArea = !isRoad && !isBuilding && (t.landuse || t.natural === 'water' || t.water || t.leisure === 'park' || t.amenity === 'parking');
        if (!isRoad && !isBuilding && !isArea) continue;
        const c = [];
        let ok = true;
        for (const ref of item.refs) {
          const k = find(ref);
          if (k < 0) { ok = false; break; }
          c.push(lon7[k] / 1e7, lat7[k] / 1e7);
        }
        if (!ok || c.length < 4) continue;
        let near = false;
        if (isRoad || isArea) {
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

// ---------- 3. City of Edmonton rooflines ----------
async function loadRooflines(m, pts) {
  return cached(`rooflines-${m.id}.json`, async () => {
    log('  downloading City of Edmonton building rooflines…');
    const seen = new Set();
    const out = [];
    const add = (rows) => {
      for (const row of rows) {
        const g = row.the_geom;
        const h = parseFloat(row.building_height);
        if (!g || !(h > 0)) continue;
        for (const poly of g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]) {
          const ring = poly[0];
          const key = `${ring[0][0].toFixed(6)},${ring[0][1].toFixed(6)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ h, ring });
        }
      }
    };
    const query = async (where) => {
      for (let offset = 0; ; offset += 20000) {
        const u = `https://data.edmonton.ca/resource/jpxi-a9a5.json?$select=the_geom,building_height&$where=${encodeURIComponent(where)}&$limit=20000&$offset=${offset}&$order=:id`;
        const rows = await getJSON(u);
        add(rows);
        if (rows.length < 20000) break;
      }
    };
    const CHUNK = 500; // route samples per query box (1 km)
    for (let i = 0; i < pts.length; i += CHUNK) {
      const seg = pts.slice(i, i + CHUNK + 1);
      const xs = seg.map((p) => p[0]);
      const zs = seg.map((p) => p[1]);
      const [w, s] = unproject(arrMin(xs) - BUILDING_RADIUS, arrMax(zs) + BUILDING_RADIUS);
      const [e, n] = unproject(arrMax(xs) + BUILDING_RADIUS, arrMin(zs) - BUILDING_RADIUS);
      await query(`within_box(the_geom, ${n}, ${w}, ${s}, ${e}) AND area > 20`);
      process.stdout.write('.');
    }
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const [w, s] = unproject(arrMin(xs) - SKYLINE_RADIUS, arrMax(zs) + SKYLINE_RADIUS);
    const [e, n] = unproject(arrMax(xs) + SKYLINE_RADIUS, arrMin(zs) - SKYLINE_RADIUS);
    await query(`within_box(the_geom, ${n}, ${w}, ${s}, ${e}) AND building_height > ${SKYLINE_MIN_H}`);
    log(` ${out.length} buildings`);
    return out;
  });
}

// ---------- 4. terrain ----------
proj4.defs('EPSG:3979', '+proj=lcc +lat_0=49 +lon_0=-95 +lat_1=49 +lat_2=77 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
let demImage;

async function sampleDEM(points) {
  // points: [[lon, lat]] → elevations (bilinear)
  if (!demImage) {
    const tif = await fromUrl('https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif');
    demImage = await tif.getImage();
  }
  const [ox, oy] = demImage.getOrigin();
  const [rx, ry] = demImage.getResolution();
  const xy = points.map(([lon, lat]) => proj4('EPSG:4326', 'EPSG:3979', [lon, lat]));
  const px = xy.map(([x]) => (x - ox) / rx - 0.5);
  const py = xy.map(([, y]) => (y - oy) / ry - 0.5);
  const x0 = Math.floor(arrMin(px)) - 1;
  const y0 = Math.floor(arrMin(py)) - 1;
  const x1 = Math.ceil(arrMax(px)) + 2;
  const y1 = Math.ceil(arrMax(py)) + 2;
  const [data] = await demImage.readRasters({ window: [x0, y0, x1, y1] });
  const w = x1 - x0;
  const at = (i, j) => data[j * w + i];
  return px.map((fx, k) => {
    const ix = fx - x0;
    const iy = py[k] - y0;
    const i = Math.floor(ix);
    const j = Math.floor(iy);
    const u = ix - i;
    const v = iy - j;
    return at(i, j) * (1 - u) * (1 - v) + at(i + 1, j) * u * (1 - v) + at(i, j + 1) * (1 - u) * v + at(i + 1, j + 1) * u * v;
  });
}

// ---------- 5. per-map build ----------
function roadClass(hw) {
  if (/^(motorway|trunk)/.test(hw)) return 3;
  if (/^(primary|secondary)/.test(hw)) return 2;
  if (/^(tertiary|unclassified)/.test(hw)) return 1;
  return 0;
}

function laneInfo(t, forward) {
  const hw = t.highway;
  const oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || t.oneway === '-1'
    || t.junction === 'roundabout' || ((hw === 'motorway' || hw === 'motorway_link') && t.oneway !== 'no');
  const total = parseInt(t.lanes, 10);
  if (oneway) {
    const l = total > 0 ? total : /link/.test(hw) ? 1 : roadClass(hw) >= 2 ? 2 : 1;
    return { oneway, ours: l, theirs: 0 };
  }
  const fwd = parseInt(t['lanes:forward'], 10);
  const bwd = parseInt(t['lanes:backward'], 10);
  const dflt = roadClass(hw) >= 2 ? 4 : 2;
  const tot = total > 0 ? total : (fwd > 0 && bwd > 0 ? fwd + bwd : dflt);
  let ours = forward ? fwd : bwd;
  if (!(ours > 0)) ours = Math.max(1, Math.floor(tot / 2));
  return { oneway, ours, theirs: Math.max(1, tot - ours) };
}

function roadWidth(t) {
  const lanes = parseInt(t.lanes, 10);
  if (lanes > 0) return lanes * 3.4;
  const hw = t.highway;
  if (/link/.test(hw)) return 5;
  if (hw === 'motorway' || hw === 'trunk') return 8;
  if (hw === 'primary' || hw === 'secondary') return 13;
  if (hw === 'tertiary') return 10;
  return 8;
}

const OSM_HEIGHTS = {
  house: 7, detached: 7, semidetached_house: 7, residential: 7, terrace: 8, garage: 3, garages: 3, shed: 3,
  apartments: 14, commercial: 8, retail: 7, industrial: 9, warehouse: 9, school: 9, church: 12, office: 15,
};
function osmHeight(t) {
  const h = parseFloat(t.height);
  if (h > 0) return h;
  const lv = parseFloat(t['building:levels']);
  if (lv > 0) return lv * 3.2 + 1;
  return OSM_HEIGHTS[t.building] ?? 6;
}

async function buildMap(m, ptsGlobal, osm) {
  log(`\n== ${m.name} (${m.id})`);
  const start = m.start ?? START;
  const [ox, oz] = project(...start);
  const P = (lon, lat) => { const [x, z] = project(lon, lat); return [x - ox, z - oz]; };
  const U = (x, z) => unproject(x + ox, z + oz);
  const pts = ptsGlobal.map(([x, z]) => [x - ox, z - oz]);
  const N = pts.length;
  const index = new RouteIndex(pts);

  // Tangent and right-hand normal per sample.
  const tx = new Float64Array(N);
  const tz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(N - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    tx[i] = (b[0] - a[0]) / l;
    tz[i] = (b[1] - a[1]) / l;
  }
  const lateral = (i, x, z) => (x - pts[i][0]) * -tz[i] + (z - pts[i][1]) * tx[i];

  // Project OSM roads and build a segment hash for matching.
  const roads = osm.ways.filter((w) => HIGHWAYS.has(w.t.highway)).map((w) => {
    const p = [];
    for (let i = 0; i < w.c.length; i += 2) p.push(P(w.c[i], w.c[i + 1]));
    return { t: w.t, p };
  });
  const SEG_CELL = 25;
  const segHash = new Map();
  roads.forEach((r, ri) => {
    for (let k = 0; k < r.p.length - 1; k++) {
      const [ax, az] = r.p[k];
      const [bx, bz] = r.p[k + 1];
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / SEG_CELL) + 1;
      const cells = new Set();
      for (let s = 0; s <= steps; s++) {
        const x = ax + ((bx - ax) * s) / steps;
        const z = az + ((bz - az) * s) / steps;
        cells.add(`${Math.floor(x / SEG_CELL)},${Math.floor(z / SEG_CELL)}`);
      }
      for (const c of cells) {
        if (!segHash.has(c)) segHash.set(c, []);
        segHash.get(c).push([ri, k]);
      }
    }
  });

  // Match each route sample to the OSM road it is driving on.
  const match = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    const [x, z] = pts[i];
    const cx = Math.floor(x / SEG_CELL);
    const cz = Math.floor(z / SEG_CELL);
    let best = MATCH_DIST;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const [ri, k] of segHash.get(`${cx + a},${cz + b}`) ?? []) {
        const [ax, az] = roads[ri].p[k];
        const [bx, bz] = roads[ri].p[k + 1];
        const len = Math.hypot(bx - ax, bz - az) || 1;
        const dot = ((bx - ax) * tx[i] + (bz - az) * tz[i]) / len;
        if (Math.abs(dot) < 0.8) continue;
        const d = segDist(x, z, ax, az, bx, bz);
        if (d < best) { best = d; match[i] = { ri, forward: dot > 0 }; }
      }
    }
  }
  // Fill gaps (intersections, link roads) from the nearest matched neighbour.
  let lastMatch = match.find(Boolean);
  for (let i = 0; i < N; i++) {
    if (match[i]) lastMatch = match[i]; else match[i] = lastMatch;
  }
  log(`  route: ${N} samples, ${(N * STEP / 1000).toFixed(1)} km`);

  // Lanes, edges, class, bridge and names along the route.
  let lanes = [];
  let right = [];
  let left = [];
  const cls = [];
  const bridge = [];
  const names = [];
  for (let i = 0; i < N; i++) {
    const t = roads[match[i].ri].t;
    const li = laneInfo(t, match[i].forward);
    lanes.push(li.ours);
    if (li.oneway) {
      right.push((li.ours * LANE_W) / 2);
      left.push((-li.ours * LANE_W) / 2);
    } else {
      right.push(li.ours * LANE_W);
      left.push(-li.theirs * LANE_W);
    }
    cls.push(roadClass(t.highway));
    bridge.push(t.bridge && t.bridge !== 'no' ? 1 : 0);
    names.push(t.name || t.ref || '');
  }
  lanes = medianArr(lanes, 15);
  right = smoothArr(medianArr(right, 15), 10);
  left = smoothArr(medianArr(left, 15), 10);
  // Ignore tiny bridge blips (culverts mapped as bridges are fine, but single-sample noise is not).
  const bridgeClean = medianArr(bridge, 3);

  // Street name runs: [[sampleIndex, name], …]
  const nameRuns = [];
  for (let i = 0; i < N; i++) {
    if (!nameRuns.length || nameRuns[nameRuns.length - 1][1] !== names[i]) {
      if (nameRuns.length && i - nameRuns[nameRuns.length - 1][0] < 20) nameRuns[nameRuns.length - 1][1] = names[i];
      else nameRuns.push([i, names[i]]);
    }
  }

  // Terrain grid.
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const [x, z] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const gx0 = Math.floor((minX - TERRAIN_RADIUS) / CELL) * CELL;
  const gz0 = Math.floor((minZ - TERRAIN_RADIUS) / CELL) * CELL;
  const nx = Math.ceil((maxX + TERRAIN_RADIUS - gx0) / CELL) + 1;
  const nz = Math.ceil((maxZ + TERRAIN_RADIUS - gz0) / CELL) + 1;
  log(`  terrain grid ${nx}×${nz}, sampling elevation…`);
  const gridLL = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) gridLL.push(U(gx0 + i * CELL, gz0 + j * CELL));
  const dem = await sampleDEM(gridLL);

  // Route elevation: smoothed DEM, straight lines across bridges.
  const routeLL = pts.map(([x, z]) => U(x, z));
  const elev0 = (await sampleDEM([start]))[0];
  let ry = (await sampleDEM(routeLL)).map((e) => e - elev0);
  ry = smoothArr(ry, 15);
  for (let i = 0; i < N; i++) {
    if (!bridgeClean[i]) continue;
    let j = i;
    while (j < N && bridgeClean[j]) j++;
    const a = Math.max(0, i - 8);
    const b = Math.min(N - 1, j + 8);
    for (let k = a; k <= b; k++) ry[k] = ry[a] + ((ry[b] - ry[a]) * (k - a)) / (b - a || 1);
    i = j;
  }
  ry = smoothArr(ry, 6);

  // Distance from each grid vertex to the route (chamfer), then flatten the ground under the road.
  const dist = new Float32Array(nx * nz).fill(1e9);
  for (const [x, z] of pts) {
    const i = Math.round((x - gx0) / CELL);
    const j = Math.round((z - gz0) / CELL);
    if (i >= 0 && j >= 0 && i < nx && j < nz) dist[j * nx + i] = 0;
  }
  const D = CELL * Math.SQRT2;
  for (let pass = 0; pass < 2; pass++) {
    const fwd = pass === 0;
    for (let jj = 0; jj < nz; jj++) {
      const j = fwd ? jj : nz - 1 - jj;
      for (let ii = 0; ii < nx; ii++) {
        const i = fwd ? ii : nx - 1 - ii;
        const s = fwd ? -1 : 1;
        let v = dist[j * nx + i];
        const check = (a, b, w) => {
          if (a >= 0 && b >= 0 && a < nx && b < nz) v = Math.min(v, dist[b * nx + a] + w);
        };
        check(i + s, j, CELL);
        check(i, j + s, CELL);
        check(i + s, j + s, D);
        check(i - s, j + s, D);
        dist[j * nx + i] = v;
      }
    }
  }
  const heights = new Int16Array(nx * nz);
  let waterLevel = Infinity;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (dist[k] > TERRAIN_RADIUS) { heights[k] = -32768; continue; }
      let h = dem[k] - elev0;
      if (dist[k] < 120) {
        const x = gx0 + i * CELL;
        const z = gz0 + j * CELL;
        const nr = index.nearest(x, z, 120);
        if (nr && !bridgeClean[nr.i]) {
          const lat = Math.abs(lateral(nr.i, x, z));
          const halfW = Math.max(right[nr.i], -left[nr.i]) + 3;
          const target = ry[nr.i] - 0.3;
          const k2 = Math.min(1, Math.max(0, (lat - halfW) / 35));
          const w = 1 - k2 * k2 * (3 - 2 * k2);
          h += (target - h) * w;
          if (lat <= halfW + CELL) h = Math.min(h, target);
        }
      }
      waterLevel = Math.min(waterLevel, h);
      heights[k] = Math.max(-32000, Math.min(32000, Math.round(h * 10)));
    }
  }

  // Other roads: OSM segments that are not the route itself.
  const roadIsRoute = (x, z) => {
    const nr = index.nearest(x, z, 10);
    return nr && Math.abs(lateral(nr.i, x, z)) < Math.max(right[nr.i], -left[nr.i]) * 0.5 + 4;
  };
  const otherRoads = [];
  for (const r of roads) {
    let cur = [];
    const flush = () => {
      if (cur.length >= 2) {
        const isBridge = r.t.bridge && r.t.bridge !== 'no';
        otherRoads.push({ w: r1(roadWidth(r.t)), b: isBridge ? 1 : 0, l: parseInt(r.t.layer, 10) || 0, p: cur.flat().map((v) => Math.round(v * 10)) });
      }
      cur = [];
    };
    for (let k = 0; k < r.p.length; k++) {
      const p = r.p[k];
      const onRoute = k > 0 && roadIsRoute(...p) && roadIsRoute(...r.p[k - 1])
        && roadIsRoute((p[0] + r.p[k - 1][0]) / 2, (p[1] + r.p[k - 1][1]) / 2);
      if (onRoute) {
        flush();
        cur = [p];
      } else {
        cur.push(p);
      }
    }
    flush();
  }
  // Bridge roads get explicit end heights so the client can draw a straight deck.
  const sampleGrid = (x, z) => {
    const fi = (x - gx0) / CELL;
    const fj = (z - gz0) / CELL;
    const i = Math.max(0, Math.min(nx - 2, Math.floor(fi)));
    const j = Math.max(0, Math.min(nz - 2, Math.floor(fj)));
    const u = fi - i;
    const v = fj - j;
    const h = (a, b) => heights[b * nx + a] / 10;
    return h(i, j) * (1 - u) * (1 - v) + h(i + 1, j) * u * (1 - v) + h(i, j + 1) * (1 - u) * v + h(i + 1, j + 1) * u * v;
  };
  for (const r of otherRoads) {
    if (!r.b) continue;
    const p = r.p;
    r.y = [r1(sampleGrid(p[0] / 10, p[1] / 10)), r1(sampleGrid(p[p.length - 2] / 10, p[p.length - 1] / 10))];
  }
  log(`  ${otherRoads.length} side road pieces`);

  // Buildings.
  const city = await loadRooflines(m, ptsGlobal);
  const cityCells = new Set();
  const endI = N - 1;
  const endRight = right[endI];
  const keepBuilding = (ring) => {
    for (const [x, z] of ring) {
      const nr = index.nearest(x, z, 40);
      if (nr && Math.abs(lateral(nr.i, x, z)) < Math.max(right[nr.i], -left[nr.i]) + 2.5) return false;
      // Clear a spot at the destination for the ending scene.
      const dx = x - pts[endI][0];
      const dz = z - pts[endI][1];
      const along = dx * tx[endI] + dz * tz[endI];
      const lat = dx * -tz[endI] + dz * tx[endI];
      if (along > -25 && along < 14 && lat > endRight - 1 && lat < endRight + 24) return false;
    }
    return true;
  };
  // OSM buildings and land-use areas, projected, in a grid so city footprints can look up
  // what OpenStreetMap says about them (type, name).
  const osmBuildings = [];
  const areas = [];
  for (const w of osm.ways) {
    if (HIGHWAYS.has(w.t.highway)) continue;
    const ring = [];
    for (let i = 0; i < w.c.length; i += 2) ring.push(P(w.c[i], w.c[i + 1]));
    if (ring.length < 3) continue;
    if (w.t.building) osmBuildings.push({ t: w.t, ring });
    else areas.push({ t: w.t, ring });
  }
  const polyGrid = (list, cell) => {
    const grid = new Map();
    list.forEach((item, idx) => {
      const xs = item.ring.map((p) => p[0]);
      const zs = item.ring.map((p) => p[1]);
      item.box = [arrMin(xs), arrMin(zs), arrMax(xs), arrMax(zs)];
      for (let i = Math.floor(item.box[0] / cell); i <= Math.floor(item.box[2] / cell); i++) {
        for (let j = Math.floor(item.box[1] / cell); j <= Math.floor(item.box[3] / cell); j++) {
          const k = `${i},${j}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(idx);
        }
      }
    });
    return (x, z) => {
      const out = [];
      for (const idx of grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []) {
        const it = list[idx];
        if (x >= it.box[0] && x <= it.box[2] && z >= it.box[1] && z <= it.box[3] && pointInRing(x, z, it.ring)) out.push(it);
      }
      return out;
    };
  };
  const osmAt = polyGrid(osmBuildings, 50);
  const areaAt = polyGrid(areas, 200);
  const landuseAt = (x, z) => {
    let best = null;
    for (const a of areaAt(x, z)) {
      const lu = a.t.landuse || (a.t.leisure === 'park' ? 'park' : a.t.amenity === 'parking' ? 'parking' : null);
      if (!lu) continue;
      const size = (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]);
      if (!best || size < best.size) best = { lu, size }; // the smallest (most specific) area wins
    }
    return best?.lu ?? null;
  };

  const buildings = [];
  const classCount = {};
  const addBuilding = (ring, h, tall, tags) => {
    if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring = ring.slice(0, -1);
    ring = simplifyRing(ring, 0.4);
    if (ring.length < 3 || ringArea(ring) < 20) return;
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const nr = index.nearest(cx, cz, BUILDING_RADIUS);
    if (!nr && !(tall && index.nearest(cx, cz, SKYLINE_RADIUS))) return;
    if (!keepBuilding(ring)) return;
    // What OpenStreetMap knows about this footprint (city footprints: whichever OSM building contains its centre).
    let t = tags;
    if (!t) {
      const hits = osmAt(cx, cz);
      if (hits.length) t = hits[0].t;
    }
    const area = ringArea(ring);
    let cls = osmClass(t);
    if (!cls) {
      const lu = landuseAt(cx, cz);
      if (lu === 'industrial') cls = h < 30 ? 'industrial' : 'office';
      else if (lu === 'retail' || lu === 'commercial') cls = h >= 30 ? 'office' : area >= 2500 ? 'bigbox' : 'retail';
      else if (lu === 'residential') cls = area < 400 && h < 12 ? (area < 80 && h < 5 ? 'outbuilding' : 'house') : h >= 12 ? 'apartments' : area >= 400 ? 'rowhouse' : 'house';
      else cls = guessClass(area, h);
    }
    classCount[cls] = (classCount[cls] || 0) + 1;
    const b = { h: Math.round(h * 10), c: CLASS[cls], p: ring.flatMap(([x, z]) => [Math.round(x * 10), Math.round(z * 10)]) };
    const name = t?.name || t?.brand;
    if (name && area > 150) b.n = name;
    if (t?.['building:levels'] > 0) b.l = parseInt(t['building:levels'], 10);
    if (t?.['roof:shape']) b.r = t['roof:shape'];
    buildings.push(b);
    return [cx, cz];
  };
  for (const b of city) {
    const ring = b.ring.map(([lon, lat]) => P(lon, lat));
    const c = addBuilding(ring, b.h, b.h > SKYLINE_MIN_H, null);
    if (c) cityCells.add(`${Math.floor(c[0] / 100)},${Math.floor(c[1] / 100)}`);
  }
  let osmCount = 0;
  for (const w of osmBuildings) {
    const cx = w.ring[0][0];
    const cz = w.ring[0][1];
    if (cityCells.has(`${Math.floor(cx / 100)},${Math.floor(cz / 100)}`)) continue;
    if (addBuilding(w.ring, osmHeight(w.t), false, w.t)) osmCount++;
  }
  log(`  ${buildings.length} buildings (${osmCount} from OpenStreetMap): ${JSON.stringify(classCount)}`);

  // Exit signs: ramps (link roads) that leave the route carry OSM `destination` tags,
  // which is what the real green overhead signs say.
  const exits = [];
  for (const r of roads) {
    if (!/_link$/.test(r.t.highway)) continue;
    const text = r.t.destination || r.t['destination:street'] || r.t.exit_to;
    if (!text) continue;
    const [x, z] = r.p[0];
    const nr = index.nearest(x, z, 30);
    if (!nr) continue;
    const lat = lateral(nr.i, x, z);
    if (Math.abs(lat) > Math.max(right[nr.i], -left[nr.i]) + 12) continue;
    // The ramp must head roughly the same way as the route (it leaves, not joins).
    const [x2, z2] = r.p[Math.min(1, r.p.length - 1)];
    const dot = (x2 - x) * tx[nr.i] + (z2 - z) * tz[nr.i];
    if (dot < 0) continue;
    const s0 = nr.i * STEP;
    if (s0 < 300 || s0 > (N - 100) * STEP) continue;
    // One sign per destination per interchange (ramps often split into several OSM ways).
    if (exits.some((e) => Math.abs(e.s - s0) < 700 && e.text.join(';') === text)) continue;
    exits.push({ s: s0, side: lat >= 0 ? 1 : -1, text: text.split(';').map((v) => v.trim()).filter(Boolean).slice(0, 3), ref: r.t['destination:ref'] || r.t['junction:ref'] || '' });
  }
  exits.sort((a, b) => a.s - b.s);
  log(`  ${exits.length} exit signs`);

  // Traffic signals on the route.
  const signals = [];
  for (const [lon, lat] of osm.signals) {
    const [x, z] = P(lon, lat);
    const nr = index.nearest(x, z, 30);
    if (!nr) continue;
    if (Math.abs(lateral(nr.i, x, z)) > Math.max(right[nr.i], -left[nr.i]) + 15) continue;
    const s = nr.i * STEP;
    if (s < 60 || s > (N - 30) * STEP) continue;
    if (signals.every((v) => Math.abs(v - s) > 60)) signals.push(s);
  }
  signals.sort((a, b) => a - b);
  log(`  ${signals.length} traffic signals`);

  const out = {
    id: m.id,
    name: m.name,
    origin: start,
    step: STEP,
    route: {
      x: pts.map((p) => r2(p[0])),
      z: pts.map((p) => r2(p[1])),
      y: ry.map(r2),
      lanes,
      right: right.map(r1),
      left: left.map(r1),
      cls,
      bridge: bridgeClean,
      names: nameRuns,
    },
    terrain: { x0: gx0, z0: gz0, cell: CELL, nx, nz, h: Buffer.from(heights.buffer).toString('base64') },
    water: r1(waterLevel + 1.2),
    roads: otherRoads,
    buildings,
    signals,
    exits,
    credits: 'Map data © OpenStreetMap contributors (ODbL) · Contains information licensed under the Open Government Licence – City of Edmonton · Elevation: Natural Resources Canada (OGL-Canada)',
  };
  const file = path.join(OUT, `${m.id}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  log(`  wrote ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);

  // Menu metadata: a simplified polyline for the preview map, plus route facts.
  const poly = simplifyRing(pts, 12).map(([x, z]) => [Math.round(x), Math.round(z)]);
  let curves = 0;
  for (let i = 30; i < N - 30; i += 30) {
    const a = Math.atan2(tz[i - 30], tx[i - 30]);
    const b = Math.atan2(tz[i + 30], tx[i + 30]);
    let d = Math.abs(b - a);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > 0.5) curves++;
  }
  let bridgeM = 0;
  for (const b of bridgeClean) if (b) bridgeM += STEP;
  let climb = 0;
  for (let i = 1; i < N; i++) climb += Math.max(0, ry[i] - ry[i - 1]);
  const highwayM = cls.filter((c) => c === 3).length * STEP;
  return {
    id: m.id,
    name: m.name,
    from: m.from ?? 'Summerside',
    km: Math.round((N * STEP) / 100) / 10,
    poly,
    streets: nameRuns.map((r) => r[1]).filter((v, i, a) => v && a.indexOf(v) === i),
    signals: signals.length,
    curves,
    bridgeM,
    highwayM,
    climb: Math.round(climb),
  };
}

// ---------- main ----------
const wanted = process.argv.slice(2);
const maps = wanted.length ? MAPS.filter((m) => wanted.includes(m.id)) : MAPS;
const allRoutes = [];
for (const m of MAPS) {
  log(`Route ${m.id}…`);
  allRoutes.push(await loadRoute(m));
}
const osm = await extractOSM(allRoutes);
const indexFile = path.join(OUT, 'index.json');
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : [];
for (const m of maps) {
  const meta = await buildMap(m, allRoutes[MAPS.indexOf(m)], osm);
  const k = index.findIndex((e) => e.id === m.id);
  if (k >= 0) index[k] = meta; else index.push(meta);
}
// Keep the menu order the same as MAPS.
index.sort((a, b) => MAPS.findIndex((m) => m.id === a.id) - MAPS.findIndex((m) => m.id === b.id));
fs.writeFileSync(indexFile, JSON.stringify(index));
log('\nDone.');
