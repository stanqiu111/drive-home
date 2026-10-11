// The map builder's logic, shared by tools/build-maps.mjs (Node: the maps that ship with the
// game) and the custom-route builder in the game (src/mapgen/worker.js), so a custom route
// is built by exactly the same code from the same data as the built-in maps. Plain
// JavaScript with no Node or browser APIs: downloads come in through the `io` callbacks of
// buildMapData(). Rules for what it writes: "Road lines" and "Road structures" in CLAUDE.md.
//
// Sources (all free, no API key):
//   - Route:      OSRM demo server (router.project-osrm.org)
//   - Roads:      OpenStreetMap (ODbL), packed into public/osm/ by tools/build-osm-tiles.mjs
//   - Buildings:  City of Edmonton Open Data "Rooflines" (jpxi-a9a5), OSM outside city limits
//   - Zoning:     City of Edmonton Zoning Bylaw 20001 (fixa-tstc)
//   - Terrain:    NRCan MRDEM-30 digital terrain model (OGL-Canada), see dem.js

import { LANDMARK_LIST } from '../landmark-list.js';
import { SKYLINE_TOWERS } from '../landmarks/skyline-data.js';
import { LANE_W, LANE_FORMAT, TAPER_MAX, laneInput, stopLineExtent } from '../lane-layout.js';

// The built-in maps are projected around one global origin (Summerside, 91 St SW: a public
// spot); each map's output is then shifted so its own start sits at (0, 0). Custom routes
// are projected around their own start, which is how the game places landmarks
// (landmarks.js projectTo), so nothing drifts on routes far from Summerside.
export const START = [-113.4804231, 53.4156855];

export const STEP = 2; // metres between route samples
// Lane layout cleaning, in route samples (2 m). See "Road lines" in CLAUDE.md.
const LAYOUT_MIN_RUN = 40;    // 80 m: shorter lane-count changes join a neighbour
const OW_MIN_RUN = 15;        // 30 m: shorter one-way/two-way flips are glitches
const UNMATCHED_MIN_RUN = 15; // 30 m: longer stretches with no OSM road are unmarked lanes
const GUESS_SEARCH = 400;     // 800 m: how far to look for a tagged way of the same street
const BASE_WINDOW = 75;       // 150 m: one-way right edge follows the fewest lanes this near
// Road structures (see "Road structures" in CLAUDE.md).
const HUMP_CLEAR = 7.0;   // m: a hump's deck top above the ground of what passes under it
const HUMP_MAX = 9;       // m: never lift a route bridge more than this
const HUMP_RADIUS = 400;  // m: smallest crest/dip radius on a hump ramp
const HUMP_GRADE = 0.06;  // steepest hump ramp
export const BUILDING_RADIUS = 350;
export const SKYLINE_RADIUS = 2500;
export const SKYLINE_MIN_H = 35;
export const ROAD_RADIUS = 450;
export const TERRAIN_RADIUS = 1500;
export const CELL = 30; // terrain grid spacing, metres
export const MATCH_DIST = 8;

export const HIGHWAYS = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]);
export const WAY_KEYS = ['highway', 'lanes', 'lanes:forward', 'lanes:backward', 'oneway', 'junction', 'bridge', 'layer',
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

// ---------- projection: local metres, x = east, z = south ----------
const DEG = Math.PI / 180;
const mLat = (p) => 111132.954 - 559.822 * Math.cos(2 * p * DEG) + 1.175 * Math.cos(4 * p * DEG);
const mLon = (p) => 111412.84 * Math.cos(p * DEG) - 93.5 * Math.cos(3 * p * DEG) + 0.118 * Math.cos(5 * p * DEG);
export function makeProjection([LON0, LAT0]) {
  const project = (lon, lat) => [(lon - LON0) * mLon(lat), -(lat - LAT0) * mLat((lat + LAT0) / 2)];
  function unproject(x, z) {
    let lat = LAT0 - z / mLat(LAT0);
    lat = LAT0 - z / mLat((lat + LAT0) / 2);
    return [LON0 + x / mLon(lat), lat];
  }
  return { project, unproject };
}
export const GLOBAL_PROJ = makeProjection(START);

// ---------- helpers ----------
export const r1 = (v) => Math.round(v * 10) / 10;
export const arrMin = (a) => a.reduce((m, v) => (v < m ? v : m), Infinity);
export const arrMax = (a) => a.reduce((m, v) => (v > m ? v : m), -Infinity);
const r2 = (v) => Math.round(v * 100) / 100;

export function resample(pts, step) {
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
export function smoothPts(pts, k) {
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

export function smoothArr(a, k) {
  const n = a.length;
  return a.map((_, i) => {
    const kk = Math.min(k, i, n - 1 - i);
    let s = 0;
    for (let j = i - kk; j <= i + kk; j++) s += a[j];
    return s / (2 * kk + 1);
  });
}

// ---------- lane layout (see "Road lines" in CLAUDE.md) ----------
const layoutKey = (l) => `${l.ow}/${l.ours}/${l.theirs}/${l.ctr}`;

function runsOf(arr, key) {
  const runs = [];
  for (let i = 0; i < arr.length; i++) {
    const k = key(arr[i]);
    const last = runs[runs.length - 1];
    if (last && last.k === k) last.b = i;
    else runs.push({ k, a: i, b: i });
  }
  return runs;
}

// Repeatedly give the shortest run under `minRun` samples the layout of a neighbour.
// `pick(run, prev, next)` returns 'prev', 'next' or null (keep the run as it is).
function absorbShortRuns(arr, key, minRun, pick) {
  const kept = new Set();
  for (;;) {
    const runs = runsOf(arr, key);
    let j = -1;
    for (let k = 0; k < runs.length; k++) {
      const len = runs[k].b - runs[k].a + 1;
      if (len < minRun && runs.length > 1 && !kept.has(runs[k].a) && (j < 0 || len < runs[j].b - runs[j].a + 1)) j = k;
    }
    if (j < 0) return arr;
    const r = runs[j];
    const side = pick(arr, r, runs[j - 1], runs[j + 1]);
    if (!side) { kept.add(r.a); continue; }
    const from = side === 'prev' ? arr[runs[j - 1].b] : arr[runs[j + 1].a];
    for (let i = r.a; i <= r.b; i++) arr[i] = { ...arr[i], ow: from.ow, ours: from.ours, theirs: from.theirs, ctr: from.ctr, guessed: from.guessed };
  }
}

function cleanLaneLayout(raw, names) {
  const n = raw.length;
  // The raw layout, run-length encoded, goes into the map file so tools/check-roads.mjs can
  // compare the cleaned result with OpenStreetMap: [sample, ow, ours, theirs, ctr, flags]
  // with flags 1 = lane counts guessed, 2 = no OSM road matched, 4 = roundabout, 8 = ramp (link).
  const flags = (l) => (l.guessed ? 1 : 0) | (l.unmatched ? 2 : 0) | (l.rb ? 4 : 0) | (l.link ? 8 : 0);
  const src = runsOf(raw, (l) => `${layoutKey(l)}/${flags(l)}`).map((r) => {
    const l = raw[r.a];
    return [r.a, l.ow, l.ours, l.theirs, l.ctr, flags(l)];
  });
  const lay = raw.map((l) => ({ ...l }));

  // 1. Long stretches with no OSM road (parking lots, service roads at the ends) are
  //    unmarked two-way lanes, not a copy of the street before them.
  for (const r of runsOf(lay, (l) => (l.unmatched ? 1 : 0))) {
    if (r.k !== 1 || r.b - r.a + 1 < UNMATCHED_MIN_RUN) continue;
    for (let i = r.a; i <= r.b; i++) Object.assign(lay[i], { ow: 2, ours: 1, theirs: 1, ctr: 0, guessed: false });
  }
  // 2. Untagged ways take the lane counts of the nearest tagged way of the same street and
  //    kind (one-way or not), so a default never overrides real data next to it.
  for (const r of runsOf(lay, (l) => (l.guessed ? 1 : 0))) {
    if (r.k !== 1) continue;
    const name = names[r.a];
    let best = null;
    for (let d = 1; d <= GUESS_SEARCH && !best; d++) {
      for (const i of [r.a - d, r.b + d]) {
        if (i < 0 || i >= n || lay[i].guessed || lay[i].ow !== lay[r.a].ow || !name || names[i] !== name) continue;
        best = lay[i];
        break;
      }
    }
    if (best) for (let i = r.a; i <= r.b; i++) Object.assign(lay[i], { ours: best.ours, theirs: best.theirs, ctr: best.ctr, guessed: false });
  }
  // 3. One-way vs two-way is real geometry (a median starts or ends), so only glitches
  //    shorter than OW_MIN_RUN are smoothed away, into the longer neighbour.
  const kind = (l) => (l.ow === 1 ? 1 : 0);
  absorbShortRuns(lay, kind, OW_MIN_RUN, (arr, r, prev, next) => {
    if (!prev) return 'next';
    if (!next) return 'prev';
    return prev.b - prev.a >= next.b - next.a ? 'prev' : 'next';
  });
  // 4. Lane-count changes shorter than LAYOUT_MIN_RUN (OSM splits ways at turn bays and
  //    intersections) join a neighbour of the same kind: never a roundabout or a ramp
  //    (30 m or more), tagged counts before guessed ones, then the longer. Never across a
  //    one-way/two-way change.
  absorbShortRuns(lay, layoutKey, LAYOUT_MIN_RUN, (arr, r, prev, next) => {
    if (arr[r.a].rb || (arr[r.a].link && arr[r.b].link && r.b - r.a + 1 >= OW_MIN_RUN)) return null;
    const score = (q) => {
      if (!q || kind(arr[q.a]) !== kind(arr[r.a]) || arr[q.a].ow !== arr[r.a].ow) return -1;
      return (arr[q.a].rb ? 0 : 4e6) + (arr[q.a].guessed ? 0 : 2e6) + (q.b - q.a);
    };
    const sp = score(prev), sn = score(next);
    if (sp < 0 && sn < 0) return null;
    return sp >= sn ? 'prev' : 'next';
  });
  return { layout: lay, src };
}

// Road edges from the cleaned layout. Two-way roads: the middle of the road is the route
// line. One-way carriageways: the right edge follows the through lanes (the fewest lanes
// within 150 m), so turn bays open on the median side and the lanes we drive in stay put.
function laneEdges(layout) {
  const n = layout.length;
  const R = new Array(n);
  const L = new Array(n);
  const owRuns = runsOf(layout, (l) => (l.ow === 1 ? 1 : 0));
  for (const run of owRuns) {
    for (let i = run.a; i <= run.b; i++) {
      const l = layout[i];
      if (l.ow !== 1) {
        R[i] = (l.ctr / 2 + l.ours) * LANE_W;
        L[i] = -(l.ctr / 2 + l.theirs) * LANE_W;
        continue;
      }
      let base = l.ours;
      for (let j = Math.max(run.a, i - BASE_WINDOW); j <= Math.min(run.b, i + BASE_WINDOW); j++) base = Math.min(base, layout[j].ours);
      R[i] = (base * LANE_W) / 2;
      L[i] = R[i] - l.ours * LANE_W;
    }
  }
  // Tapers: ~40 m across a lane change, ~100 m where a median starts or ends.
  const nearOw = new Float32Array(n);
  for (let k = 1; k < owRuns.length; k++) {
    const c = owRuns[k].a;
    for (let i = Math.max(0, c - 45); i < Math.min(n, c + 45); i++) nearOw[i] = Math.max(nearOw[i], Math.min(1, (45 - Math.abs(i - c)) / 15));
  }
  const taper = (a) => {
    const short = smoothArr(a, 10);
    const long = smoothArr(a, 25);
    const sm = short.map((v, i) => v + (long[i] - v) * nearOw[i]);
    const fwd = sm.slice();
    const bwd = sm.slice();
    for (let i = 1; i < n; i++) fwd[i] = Math.max(fwd[i - 1] - TAPER_MAX, Math.min(fwd[i - 1] + TAPER_MAX, fwd[i]));
    for (let i = n - 2; i >= 0; i--) bwd[i] = Math.max(bwd[i + 1] - TAPER_MAX, Math.min(bwd[i + 1] + TAPER_MAX, bwd[i]));
    return sm.map((_, i) => (fwd[i] + bwd[i]) / 2);
  };
  return { right: taper(R), left: taper(L) };
}

function medianArr(a, k) {
  return a.map((_, i) => {
    const w = a.slice(Math.max(0, i - k), i + k + 1).sort((x, y) => x - y);
    return w[w.length >> 1];
  });
}

// Side roads only where the map has ground. The OSM extract holds the streets along every
// route, so without this each map file carried ~1,000 km of roads the game can't draw (they
// lie off its terrain) but still had to index on every load. `inside(x, z)` says whether a
// point is on the map's ground (plus a margin); a piece that leaves it is cut into the runs
// that stay on it. Segments are tested every 20 m, so long straight ones aren't lost.
const ROAD_CLIP_MARGIN = 100;
function clipRoadsToGround(roads, inside) {
  const out = [];
  for (const r of roads) {
    const n = r.p.length / 2;
    const at = (k) => [r.p[2 * k] / 10, r.p[2 * k + 1] / 10];
    let run = null;
    for (let k = 1; k < n; k++) {
      const [ax, az] = at(k - 1);
      const [bx, bz] = at(k);
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 20));
      let keep = false;
      for (let m = 0; m <= steps && !keep; m++) keep = inside(ax + ((bx - ax) * m) / steps, az + ((bz - az) * m) / steps);
      if (!keep) { run = null; continue; }
      if (!run) {
        run = { ...r, p: r.p.slice(2 * (k - 1), 2 * k) };
        out.push(run);
      }
      run.p.push(r.p[2 * k], r.p[2 * k + 1]);
    }
  }
  return out;
}

// ---------- road structures (see "Road structures" in CLAUDE.md) ----------
// Decides, per map, which side roads are raised and how high, so the game only draws what
// it is given and tools/check-roads.mjs can check it. Side-road pieces get `h` (height of
// each point, metres) when they are not simply on the ground, plus `o: 1` for an overpass
// deck over the route or `e: 1` for a raised road on an earth embankment. Returns piers.
const OVERPASS_CLEAR = 6.8; // m: overpass deck top above the route surface
const SIDE_GRADE = 0.08;    // steepest side-road ramp
const PIER_EVERY = 22;      // m between overpass piers
function sideRoadStructures({ otherRoads, pts, tx, tz, ry, lift, bridgeClean, right, left, index, lateral, ground, rawGround, routeGround, N }) {
  const ptsOf = (r) => { const q = []; for (let k = 0; k < r.p.length; k += 2) q.push([r.p[k] / 10, r.p[k + 1] / 10]); return q; };
  const setPts = (r, q) => { r.p = q.flat().map((v) => Math.round(v * 10)); };
  const halfW = (i) => Math.max(right[i], -left[i]);
  const along = (q) => { const acc = [0]; for (let k = 1; k < q.length; k++) acc.push(acc[k - 1] + Math.hypot(q[k][0] - q[k - 1][0], q[k][1] - q[k - 1][1])); return acc; };
  // Split long segments so heights can follow a ramp.
  const densify = (q, step) => {
    const out = [q[0]];
    for (let k = 1; k < q.length; k++) {
      const n = Math.max(1, Math.ceil(Math.hypot(q[k][0] - q[k - 1][0], q[k][1] - q[k - 1][1]) / step));
      for (let m = 1; m <= n; m++) out.push([q[k - 1][0] + ((q[k][0] - q[k - 1][0]) * m) / n, q[k - 1][1] + ((q[k][1] - q[k - 1][1]) * m) / n]);
    }
    return out;
  };
  const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  // Where a polyline crosses the route line: { k: route sample, a: segment index, u: 0..1 along it }.
  const crossRoute = (q) => {
    for (let a = 0; a < q.length - 1; a++) {
      const mx = (q[a][0] + q[a + 1][0]) / 2;
      const mz = (q[a][1] + q[a + 1][1]) / 2;
      const len = Math.hypot(q[a + 1][0] - q[a][0], q[a + 1][1] - q[a][1]);
      const nr = index.nearest(mx, mz, len / 2 + 40);
      if (!nr) continue;
      for (let k = Math.max(0, nr.i - 40); k < Math.min(N - 1, nr.i + 40); k++) {
        if (!segmentsCross(q[a], q[a + 1], pts[k], pts[k + 1])) continue;
        const la = lateral(k, ...q[a]);
        const lb = lateral(k, ...q[a + 1]);
        return { k, a, u: la / (la - lb || 1) };
      }
    }
    return null;
  };
  const inCorridor = (x, z, pad) => {
    const nr = index.nearest(x, z, 60);
    return nr ? Math.abs(lateral(nr.i, x, z)) < halfW(nr.i) + pad : false;
  };
  const piers = [];
  const used = new Set();

  // 1. Side bridges that cross OVER the route: lift the deck to clear it, ramp the roads
  //    joined to its ends back down to the ground.
  for (const [idx, r] of otherRoads.entries()) {
    if (!r.b || !r.y) continue;
    const q = densify(ptsOf(r), 6);
    const c = crossRoute(q);
    if (!c || bridgeClean[c.k] || lift[c.k] > 0.5) continue; // not over us, or we pass over it
    const acc = along(q);
    const total = acc[acc.length - 1] || 1;
    const straight = acc.map((d) => r.y[0] + ((r.y[1] - r.y[0]) * d) / total + 0.4);
    const atCross = straight[c.a] + (straight[c.a + 1] - straight[c.a]) * c.u;
    const need = ry[c.k] + OVERPASS_CLEAR;
    const delta = Math.max(0, need - atCross);
    setPts(r, q);
    r.h = straight.map((y) => r1(y + delta));
    r.o = 1;
    used.add(idx);
    // Approaches: follow the road pieces joined to each end of the deck.
    for (const end of [0, 1]) {
      const E = end ? q[q.length - 1] : q[0];
      const hE = end ? r.h[r.h.length - 1] : r.h[0];
      const rise = hE - ground(...E);
      if (rise < 0.5) continue;
      const L = Math.max(60, rise / SIDE_GRADE);
      let from = E;
      let done = 0;
      for (let hop = 0; hop < 4 && done < L; hop++) {
        let next = -1;
        let flip = false;
        for (const [j, o] of otherRoads.entries()) {
          if (used.has(j)) continue;
          const oq = ptsOf(o);
          if (Math.hypot(oq[0][0] - from[0], oq[0][1] - from[1]) < 2) { next = j; flip = false; break; }
          if (Math.hypot(oq[oq.length - 1][0] - from[0], oq[oq.length - 1][1] - from[1]) < 2) { next = j; flip = true; break; }
        }
        if (next < 0) break;
        const o = otherRoads[next];
        let oq = densify(ptsOf(o), 6);
        if (flip) oq = oq.reverse();
        const oacc = along(oq);
        o.h = oq.map(([x, z], k) => {
          const w = smooth01(1 - (done + oacc[k]) / L);
          const g = ground(x, z) + 0.08;
          let h = g + (hE - (ground(...E) + 0.08)) * w;
          // Never raise an approach inside the route corridor (it would be a wall on the road).
          if (inCorridor(x, z, 3) && h > g + 0.3) h = g;
          return r1(h);
        });
        if (flip) { oq = oq.reverse(); o.h.reverse(); }
        setPts(o, oq);
        o.e = 1;
        used.add(next);
        done += oacc[oacc.length - 1];
        from = flip ? oq[0] : oq[oq.length - 1];
      }
    }
    // Piers under the deck, never on the route or on another road.
    for (let d = PIER_EVERY / 2; d < total - 4; d += PIER_EVERY) {
      let k = 0;
      while (k < acc.length - 2 && acc[k + 1] < d) k++;
      const t = (d - acc[k]) / ((acc[k + 1] - acc[k]) || 1);
      const x = q[k][0] + (q[k + 1][0] - q[k][0]) * t;
      const z = q[k][1] + (q[k + 1][1] - q[k][1]) * t;
      const top = r.h[k] + (r.h[k + 1] - r.h[k]) * t - 1.4;
      const g = ground(x, z);
      if (top - g < 2.5) continue;
      const dx = q[k + 1][0] - q[k][0];
      const dz = q[k + 1][1] - q[k][1];
      const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l;
      const nz = dx / l;
      const w = r.w * 0.6;
      // The whole pier footprint (a wall across the deck) must stay off every road.
      const foot = [-1, -0.5, 0, 0.5, 1].map((f) => [x + nx * w * f, z + nz * w * f]);
      if (foot.some(([fx, fz]) => inCorridor(fx, fz, 1.5) || onOtherRoad(otherRoads, idx, fx, fz, ptsOf))) continue;
      piers.push([r1(x), r1(z), r1(top), r1(g - 1), r1(nx), r1(nz), r1(w)]);
    }
  }

  // 2. The other half of a divided road beside a raised hump rides at the same lift.
  for (const [idx, r] of otherRoads.entries()) {
    if (used.has(idx)) continue;
    const q0 = ptsOf(r);
    let hit = false;
    for (const [x, z] of q0) {
      const nr = index.nearest(x, z, 45);
      if (nr && lift[nr.i] > 0.3) { hit = true; break; }
    }
    if (!hit) continue;
    const q = densify(q0, 6);
    const acc = along(q);
    const total = acc[acc.length - 1] || 1;
    let raised = false;
    const h = q.map(([x, z], k) => {
      const base = r.b && r.y ? r.y[0] + ((r.y[1] - r.y[0]) * acc[k]) / total + 0.4 : ground(x, z) + 0.08;
      const nr = index.nearest(x, z, 45);
      if (!nr || lift[nr.i] <= 0.05) return base;
      const a = q[Math.max(0, k - 1)];
      const b = q[Math.min(q.length - 1, k + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      if (Math.abs(((b[0] - a[0]) * tx[nr.i] + (b[1] - a[1]) * tz[nr.i]) / l) < 0.85) return base;
      if (Math.abs(lateral(nr.i, x, z)) < halfW(nr.i) + 1) return base;
      raised = true;
      // Level with our road plus the natural height difference between the two carriageways
      // (none over the bridge itself), blended in as the hump ramps up.
      const diff = bridgeClean[nr.i] ? 0 : Math.max(-1.5, Math.min(1.5, rawGround(x, z) - routeGround(nr.i)));
      const w = Math.min(1, lift[nr.i] / 1.5);
      return Math.max(base, base + (ry[nr.i] + diff + 0.08 - base) * w);
    });
    if (!raised) continue;
    setPts(r, q);
    r.h = h.map(r1);
    r.e = 1;
  }
  return { piers };
}

function onOtherRoad(otherRoads, self, x, z, ptsOf) {
  for (const [j, o] of otherRoads.entries()) {
    if (j === self) continue;
    const q = ptsOf(o);
    for (let k = 0; k < q.length - 1; k++) {
      if (Math.min(q[k][0], q[k + 1][0]) > x + 60 || Math.max(q[k][0], q[k + 1][0]) < x - 60
        || Math.min(q[k][1], q[k + 1][1]) > z + 60 || Math.max(q[k][1], q[k + 1][1]) < z - 60) continue;
      if (segDist(x, z, q[k][0], q[k][1], q[k + 1][0], q[k + 1][1]) < o.w / 2 + 1) return true;
    }
  }
  return false;
}

// True when segment a-b crosses segment c-d (points as [x, z]).
function segmentsCross(a, b, c, d) {
  const cr = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cr(c, d, a), d2 = cr(c, d, b), d3 = cr(a, b, c), d4 = cr(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

// Douglas–Peucker on a closed ring of [x,z].
// Index polygons on a grid; returns (x, z) → polygons containing the point.
function polyGridFor(list, cell) {
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
}

export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function simplifyRing(ring, tol) {
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

export function ringArea(ring) {
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
  // Sample indices in the grid cells that overlap a box (a superset of the samples in it).
  inBox(x0, z0, x1, z1) {
    const c = this.cell;
    const out = [];
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) {
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const list = this.map.get(this.key(i, j));
        if (list) out.push(...list);
      }
    }
    return out;
  }
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

// ---------- route ----------
// OSRM route coordinates ([lon, lat]) → route samples every STEP metres, smoothed.
export function routeFromCoords(coords, proj = GLOBAL_PROJ) {
  let pts = coords.map(([lon, lat]) => proj.project(lon, lat));
  pts = resample(pts, STEP);
  pts = smoothPts(smoothPts(pts, 5), 5);
  pts = resample(pts, STEP);
  return pts;
}
export { osrmRouteUrl } from './edmonton.js';


// ---------- OSM data near the routes ----------
export function corridorCells(routes, radius, cell = 100) {
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

// What the builder keeps from OpenStreetMap: drivable roads, buildings, and land-use /
// water / park / parking areas ('road' | 'building' | 'area' | null).
export function osmWayKind(t) {
  if (!t) return null;
  if (HIGHWAYS.has(t.highway)) return 'road';
  if (t.building) return 'building';
  if (t.landuse || t.natural === 'water' || t.water || t.leisure === 'park' || t.amenity === 'parking') return 'area';
  return null;
}
// Railways (a route bridge over one gets the same clearance as over a road). Tunnels and
// abandoned lines are left out.
export const RAIL_KINDS = new Set(['rail', 'light_rail', 'subway', 'tram', 'narrow_gauge', 'preserved']);
export const RAIL_KEYS = ['railway', 'tunnel', 'bridge', 'layer', 'service'];
export const isRail = (t) => !!t && RAIL_KINDS.has(t.railway) && !(t.tunnel && t.tunnel !== 'no');
// Keeps only the ways near the routes, the same way for every source: roads and areas with
// any node within ROAD_RADIUS + 100 m, buildings whose first node is within
// BUILDING_RADIUS + 100 m, railways within 300 m. `ways`/`rails` are [{ t, c: [lon, lat, …] }].
export function osmNearRoutes({ ways, rails, signals, pois = [] }, routes, proj = GLOBAL_PROJ) {
  const inRoad = corridorCells(routes, ROAD_RADIUS + 100);
  const inBuilding = corridorCells(routes, BUILDING_RADIUS + 100);
  const inRail = corridorCells(routes, 300);
  const anyNode = (c, inside) => {
    for (let i = 0; i < c.length; i += 2) if (inside(...proj.project(c[i], c[i + 1]))) return true;
    return false;
  };
  return {
    ways: ways.filter((w) => (osmWayKind(w.t) === 'building' ? inBuilding(...proj.project(w.c[0], w.c[1])) : anyNode(w.c, inRoad))),
    rails: rails.filter((r) => anyNode(r.c, inRail)),
    signals,
    pois: pois.filter((p) => inBuilding(...proj.project(p.c[0], p.c[1]))),
  };
}


// ---------- City of Edmonton rooflines and zoning ----------
// `getJSON(url)` fetches with retries; `tick()` is called after each query (progress).
const SODA_PAGE = 20000;
async function sodaQuery(base, select, where, getJSON, onRows) {
  for (let offset = 0; ; offset += SODA_PAGE) {
    const u = `${base}?$select=${select}&$where=${encodeURIComponent(where)}&$limit=${SODA_PAGE}&$offset=${offset}&$order=:id`;
    const rows = await getJSON(u);
    onRows(rows);
    if (rows.length < SODA_PAGE) break;
  }
}
// The rooflines near a route: one query per kilometre of route (BUILDING_RADIUS around it),
// then the tall towers within SKYLINE_RADIUS for the skyline.
export function rooflineQueries(pts, proj = GLOBAL_PROJ) {
  const out = [];
  const CHUNK = 500; // route samples per query box (1 km)
  for (let i = 0; i < pts.length; i += CHUNK) {
    const seg = pts.slice(i, i + CHUNK + 1);
    const xs = seg.map((p) => p[0]);
    const zs = seg.map((p) => p[1]);
    const [w, s] = proj.unproject(arrMin(xs) - BUILDING_RADIUS, arrMax(zs) + BUILDING_RADIUS);
    const [e, n] = proj.unproject(arrMax(xs) + BUILDING_RADIUS, arrMin(zs) - BUILDING_RADIUS);
    out.push(`within_box(the_geom, ${n}, ${w}, ${s}, ${e}) AND area > 20`);
  }
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const [w, s] = proj.unproject(arrMin(xs) - SKYLINE_RADIUS, arrMax(zs) + SKYLINE_RADIUS);
  const [e, n] = proj.unproject(arrMax(xs) + SKYLINE_RADIUS, arrMin(zs) - SKYLINE_RADIUS);
  out.push(`within_box(the_geom, ${n}, ${w}, ${s}, ${e}) AND building_height > ${SKYLINE_MIN_H}`);
  return out;
}
// Downloads them all (`parallel` queries at a time; results are kept in query order, so the
// buildings come out in the same order however the downloads finish).
export async function loadRooflines(pts, getJSON, { proj = GLOBAL_PROJ, parallel = 1, tick = () => {} } = {}) {
  const queries = rooflineQueries(pts, proj);
  const results = new Array(queries.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < queries.length) {
      const q = next++;
      const rows = [];
      await sodaQuery('https://data.edmonton.ca/resource/jpxi-a9a5.json', 'the_geom,building_height', queries[q], getJSON, (r) => rows.push(...r));
      results[q] = rows;
      tick(++done, queries.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, queries.length) }, worker));
  const seen = new Set();
  const out = [];
  for (const rows of results) {
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
  }
  return out;
}
// Zoning (Bylaw 20001 polygons) in the route's bounding box: zone codes decide a style
// class where OpenStreetMap doesn't say what a footprint is.
export async function loadZoning(pts, getJSON, { proj = GLOBAL_PROJ } = {}) {
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const [w, s] = proj.unproject(arrMin(xs) - BUILDING_RADIUS - 100, arrMax(zs) + BUILDING_RADIUS + 100);
  const [e, n] = proj.unproject(arrMax(xs) + BUILDING_RADIUS + 100, arrMin(zs) - BUILDING_RADIUS - 100);
  const poly = `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
  const out = [];
  await sodaQuery('https://data.edmonton.ca/resource/fixa-tstc.json', 'zoning,geometry_multipolygon', `intersects(geometry_multipolygon,'${poly}')`, getJSON, (rows) => {
    for (const row of rows) {
      const g = row.geometry_multipolygon;
      if (!g || !row.zoning) continue;
      for (const polyg of g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]) out.push({ z: row.zoning, ring: polyg[0] });
    }
  });
  return out;
}

// Zone code → class (or null for "no information"). Height/area refine it.
function zoneClass(code, area, h) {
  const z = code.split(' ')[0];
  if (/^(RS|RSF|RR|GLDF|GLD|PLD|SLD|CCSD|RAES|RCES)$/.test(z)) return area < 80 && h < 5 ? 'outbuilding' : area > 450 && h > 9 ? 'apartments' : 'house';
  if (/^(GRH|BRH|SRH|PRH|RVRH|SRA)$/.test(z)) return area < 80 && h < 5 ? 'outbuilding' : 'rowhouse';
  if (/^RSM/.test(z)) return area < 250 ? 'rowhouse' : 'apartments';
  if (/^(RM|GLRA|GMRA|ALA|BLMR|BMR|HDR|CCMD|CCHD|RCRM|RTCMR|RTCR|RL|RCRL)/.test(z)) return h < 9 && area < 300 ? 'rowhouse' : 'apartments';
  if (/^(MU|CCA|JAMSC|CMU|CPMU|RMU|MMUT|TC-MU|MUN|CMUV|HA|AED)/.test(z)) return h >= 30 ? 'office' : area >= 2500 && h < 14 ? 'bigbox' : 'retail';
  if (/^CN$/.test(z)) return 'retail';
  if (/^(CG|MRC|ASC|AUVC|ECB|CCNC|TC-C|UC3ES)$/.test(z)) return area >= 2500 ? 'bigbox' : 'retail';
  if (/^CB$/.test(z)) return h >= 25 ? 'office' : 'retail';
  if (/^(BE|EIB|IBES|UW)$/.test(z)) return area < 300 ? 'retail' : 'industrial';
  if (/^(IM|IH|EIM|EET|ILES|INDES|PU)/.test(z)) return 'industrial';
  if (/^(PS|PSN|UF|UI|AJ)$/.test(z)) return area >= 1500 && h < 16 ? 'school' : 'civic';
  if (/^(A|NA|AG|FD|AES|A[1-7])$/.test(z)) return area < 150 ? 'outbuilding' : 'industrial';
  return null;
}
const HERITAGE_ZONES = /^(HA|JAMSC)\b/;

// ---------- per-map build ----------
function roadClass(hw) {
  if (/^(motorway|trunk)/.test(hw)) return 3;
  if (/^(primary|secondary)/.test(hw)) return 2;
  if (/^(tertiary|unclassified)/.test(hw)) return 1;
  return 0;
}

// Lane layout of an OSM way in our direction of travel. `guessed` = no lane tags, so the
// counts are class defaults; `ctr` = lanes in the middle of a two-way road that belong to
// neither direction (a centre two-way turn lane).
function laneInfo(t, forward) {
  const hw = t.highway;
  const roundabout = t.junction === 'roundabout' || t.junction === 'circular';
  const oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || t.oneway === '-1'
    || roundabout || ((hw === 'motorway' || hw === 'motorway_link') && t.oneway !== 'no');
  const total = parseInt(t.lanes, 10);
  if (oneway) {
    const l = total > 0 ? total : /link/.test(hw) ? 1 : roadClass(hw) >= 2 ? 2 : 1;
    return { oneway, ours: l, theirs: 0, ctr: 0, guessed: !(total > 0), roundabout };
  }
  const fwd = parseInt(t['lanes:forward'], 10);
  const bwd = parseInt(t['lanes:backward'], 10);
  if (fwd > 0 && bwd > 0) {
    const ctr = total > fwd + bwd ? 1 : 0;
    return { oneway, ours: forward ? fwd : bwd, theirs: forward ? bwd : fwd, ctr, guessed: false, roundabout };
  }
  const dflt = roadClass(hw) >= 2 ? 4 : 2;
  const tot = total > 0 ? total : dflt;
  let ours = forward ? fwd : bwd;
  if (!(ours > 0)) ours = Math.max(1, Math.floor(tot / 2));
  return { oneway, ours, theirs: Math.max(1, tot - ours), ctr: 0, guessed: !(total > 0), roundabout };
}

// Width of a side road (drawn from OSM, not driven): one-way ways without a lanes tag are
// two lanes (links one), not the two-way class width, so the other half of a divided road
// isn't drawn over ours.
function roadWidth(t) {
  const lanes = parseInt(t.lanes, 10);
  if (lanes > 0) return lanes * 3.4;
  const hw = t.highway;
  if (/link/.test(hw)) return 5;
  if (t.oneway === 'yes' || t.oneway === '-1' || t.junction === 'roundabout') return (roadClass(hw) >= 2 ? 2 : 1) * 3.4;
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

// Builds one map. `m` = { id, name, from?, start?, dest }; `ptsGlobal` = route samples in
// `io.proj` coordinates (routeFromCoords); `osm` = { ways, rails, signals, pois } near the
// route (osmNearRoutes). `io` brings the downloads and reports:
//   io.proj                 projection of ptsGlobal and osm (default GLOBAL_PROJ)
//   io.rooflines(m, pts)    City building footprints (loadRooflines)
//   io.zoning(m, pts)       City zoning polygons (loadZoning)
//   io.sampleDEM([[lon, lat]]) → elevations (dem.js)
//   io.log(...), io.progress(fraction 0..1, label)
// Returns { out: the map file's contents, meta: its entry in public/maps/index.json }.
export async function buildMapData(m, ptsGlobal, osm, io) {
  const log = io.log ?? (() => {});
  const progress = io.progress ?? (() => {});
  const { project, unproject } = io.proj ?? GLOBAL_PROJ;
  const loadRooflines = io.rooflines;
  const loadZoning = io.zoning;
  const sampleDEM = io.sampleDEM;
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
  // Fill gaps (intersections, link roads) from the nearest matched neighbour; remember which
  // samples really matched an OSM road (long gaps are parking lots and service roads).
  const matched = match.map(Boolean);
  let lastMatch = match.find(Boolean);
  for (let i = 0; i < N; i++) {
    if (match[i]) lastMatch = match[i]; else match[i] = lastMatch;
  }
  log(`  route: ${N} samples, ${(N * STEP / 1000).toFixed(1)} km`);
  progress(0.05, 'Matching the route to the streets');

  // Lanes, edges, class, bridge and names along the route. See "Road lines" in CLAUDE.md:
  // the lane layout is cleaned as one unit, the raw layout is kept for the checker, and
  // the renderer never guesses.
  const raw = [];
  const cls = [];
  const bridge = [];
  const names = [];
  for (let i = 0; i < N; i++) {
    const t = roads[match[i].ri].t;
    const li = laneInfo(t, match[i].forward);
    raw.push({ ow: li.oneway ? 1 : 0, ours: li.ours, theirs: li.oneway ? 0 : li.theirs, ctr: li.ctr, guessed: li.guessed, rb: li.roundabout, link: /_link$/.test(t.highway), unmatched: !matched[i] });
    cls.push(roadClass(t.highway));
    bridge.push(t.bridge && t.bridge !== 'no' ? 1 : 0);
    names.push(t.name || t.ref || '');
  }
  const { layout, src } = cleanLaneLayout(raw, names);
  const ow = layout.map((l) => l.ow);
  const lanes = layout.map((l) => l.ours);
  const ctr = layout.map((l) => l.ctr);
  const { right, left } = laneEdges(layout);
  // Ignore tiny bridge blips (culverts mapped as bridges are fine, but single-sample noise is not).
  // Bridges only where OSM says so. Samples with no OSM road (gaps, and the parking-lot
  // stretch at a route's end) were filled from the road before them; they are a bridge only
  // when the matched roads on both sides of the gap are bridges. (Snow Valley's last 400 m
  // once copied a creek bridge, so the road was drawn as a straight deck under the ground.)
  for (let i = 0; i < N; i++) {
    if (matched[i]) continue;
    let j = i;
    while (j < N && !matched[j]) j++;
    const both = i > 0 && j < N && bridge[i - 1] && bridge[j];
    for (let k = i; k < j; k++) bridge[k] = both ? 1 : 0;
    i = j;
  }
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
  progress(0.1, 'Downloading the terrain');
  const gridLL = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) gridLL.push(U(gx0 + i * CELL, gz0 + j * CELL));
  const dem = await sampleDEM(gridLL);

  progress(0.3, 'Shaping hills, bridges and overpasses');
  // Route elevation: smoothed DEM, straight lines across bridges.
  const routeLL = pts.map(([x, z]) => U(x, z));
  const elev0 = (await sampleDEM([start]))[0];
  const routeDem = await sampleDEM(routeLL);
  let ry = routeDem.map((e) => e - elev0);
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
  // Overpass humps. The DEM is bare earth, so a route bridge over another road or a railway
  // shows no structure: the bridge run is lifted so the deck clears whatever passes under
  // it. Bridges over creeks or paths keep their real height. See "Road structures" in
  // CLAUDE.md. Each hump: a plateau over the bridge, ramps gentle enough for a 6% grade and
  // a crest radius of at least HUMP_RADIUS; neighbouring humps merge instead of stacking.
  const routeWays = new Set(match.filter(Boolean).map((mm) => mm.ri));
  const bbox = (p) => {
    let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
    for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return [x0, z0, x1, z1];
  };
  const underCandidates = [
    ...roads.map((r, ri) => ({ ri, kind: 'road', name: r.t.name || r.t.ref || r.t.highway, bridge: r.t.bridge && r.t.bridge !== 'no', p: r.p }))
      .filter((c) => !routeWays.has(c.ri) && !c.bridge),
    ...(osm.rails ?? []).filter((r) => !(r.t.bridge && r.t.bridge !== 'no')).map((r) => {
      const p = [];
      for (let k = 0; k < r.c.length; k += 2) p.push(P(r.c[k], r.c[k + 1]));
      return { kind: 'rail', name: r.t.name || `railway (${r.t.railway})`, p };
    }),
  ].map((c) => ({ ...c, box: bbox(c.p) }));
  // Route samples in [a, b] where something crosses under the route line.
  const crossingsUnder = (a, b) => {
    const seg = pts.slice(a, b + 2);
    const [x0, z0, x1, z1] = bbox(seg);
    const out = [];
    for (const c of underCandidates) {
      if (c.box[2] < x0 - 5 || c.box[0] > x1 + 5 || c.box[3] < z0 - 5 || c.box[1] > z1 + 5) continue;
      for (let k = a; k <= b && k < N - 1; k++) {
        for (let q = 0; q < c.p.length - 1; q++) {
          if (segmentsCross(pts[k], pts[k + 1], c.p[q], c.p[q + 1])) out.push({ k, kind: c.kind, name: c.name, ri: c.ri });
        }
      }
    }
    return out;
  };
  const humps = [];
  const underWays = new Set(); // OSM roads that pass under a hump
  for (let i = 0; i < N; i++) {
    if (!bridgeClean[i]) continue;
    let j = i;
    while (j < N && bridgeClean[j]) j++;
    const endH = Math.max(ry[Math.max(0, i - 1)], ry[Math.min(N - 1, j)]);
    let minGround = Infinity;
    for (let k = i; k < j; k++) minGround = Math.min(minGround, routeDem[k] - elev0);
    if (endH - minGround < 6 && (j - i) * STEP < 400) {
      const under = crossingsUnder(Math.max(0, i - 4), Math.min(N - 1, j + 4));
      // Lift only as much as the deck needs to clear what is underneath.
      let lift = 0;
      for (const u of under) lift = Math.max(lift, routeDem[u.k] - elev0 + HUMP_CLEAR - ry[u.k]);
      lift = Math.min(HUMP_MAX, lift);
      if (under.length && lift > 0.3) {
        const a = Math.min(i, ...under.map((u) => u.k - 6));
        const b = Math.max(j, ...under.map((u) => u.k + 6));
        humps.push({ a: Math.max(0, a), b: Math.min(N - 1, b), lift, under: [...new Set(under.map((u) => `${u.kind}: ${u.name}`))] });
        for (const u of under) if (u.ri != null) underWays.add(u.ri);
      } else if (!under.length) {
        log(`  bridge at s=${i * STEP} m kept at its real height (nothing passes under it)`);
      }
    }
    i = j;
  }
  const rampOf = (lift) => Math.ceil(Math.max(90, Math.sqrt(6 * HUMP_RADIUS * lift), (1.5 * lift) / HUMP_GRADE) / STEP);
  // Merge humps whose ramps would meet, so the road never dips between two decks.
  humps.sort((p, q) => p.a - q.a);
  const merged = [];
  for (const h of humps) {
    const prev = merged[merged.length - 1];
    if (prev && h.a - prev.b < rampOf(prev.lift) + rampOf(h.lift)) {
      prev.b = Math.max(prev.b, h.b);
      prev.lift = Math.max(prev.lift, h.lift);
      prev.under = [...new Set([...prev.under, ...h.under])];
    } else merged.push({ ...h });
  }
  const lift = new Float32Array(N);
  for (const h of merged) {
    const R = rampOf(h.lift);
    for (let k = Math.max(0, h.a - R); k <= Math.min(N - 1, h.b + R); k++) {
      const t = k < h.a ? (k - (h.a - R)) / R : k > h.b ? 1 - (k - h.b) / R : 1;
      const w = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
      lift[k] = Math.max(lift[k], h.lift * w);
    }
  }
  for (let k = 0; k < N; k++) ry[k] += lift[k];
  for (const h of merged) log(`  overpass hump s=${h.a * STEP}-${h.b * STEP} m, +${h.lift.toFixed(1)} m over ${h.under.join('; ')}`);

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
          // Beside a raised hump ramp the ground forms a short embankment (about 1:2), so
          // side roads nearby stay at their own level instead of being lifted with it.
          const blendW = lift[nr.i] > 0.3 ? Math.max(8, lift[nr.i] * 2) : 35;
          const k2 = Math.min(1, Math.max(0, (lat - halfW) / blendW));
          const w = 1 - k2 * k2 * (3 - 2 * k2);
          h += (target - h) * w;
          if (lat <= halfW + CELL) h = Math.min(h, target);
        }
      }
      waterLevel = Math.min(waterLevel, h);
      heights[k] = Math.max(-32000, Math.min(32000, Math.round(h * 10)));
    }
  }

  progress(0.4, 'Laying out the side streets');
  // Other roads: OSM segments that are not the route itself.
  const roadIsRoute = (x, z) => {
    const nr = index.nearest(x, z, 10);
    return nr && Math.abs(lateral(nr.i, x, z)) < Math.max(right[nr.i], -left[nr.i]) * 0.5 + 4;
  };
  // Beside a raised hump ramp, a side road that meets the route there can't join it (the
  // route is up on an embankment), so it stops at the foot of the embankment.
  const besideRamp = (x, z, dx, dz) => {
    const nr = index.nearest(x, z, 40);
    if (!nr || bridgeClean[nr.i] || lift[nr.i] <= 1) return false;
    const l = Math.hypot(dx, dz) || 1;
    if (Math.abs((dx * tx[nr.i] + dz * tz[nr.i]) / l) > 0.85) return false; // parallel: a twin carriageway
    return Math.abs(lateral(nr.i, x, z)) < Math.max(right[nr.i], -left[nr.i]) + lift[nr.i] * 2 + 3;
  };
  const otherRoads = [];
  roads.forEach((r, ri) => {
    let cur = [];
    const flush = () => {
      if (cur.length >= 2) {
        const isBridge = r.t.bridge && r.t.bridge !== 'no';
        otherRoads.push({ w: r1(roadWidth(r.t)), b: isBridge ? 1 : 0, l: parseInt(r.t.layer, 10) || 0, p: cur.flat().map((v) => Math.round(v * 10)), ri });
      }
      cur = [];
    };
    for (let k = 0; k < r.p.length; k++) {
      const p = r.p[k];
      const onRoute = k > 0 && roadIsRoute(...p) && roadIsRoute(...r.p[k - 1])
        && roadIsRoute((p[0] + r.p[k - 1][0]) / 2, (p[1] + r.p[k - 1][1]) / 2);
      const q = r.p[k > 0 ? k - 1 : Math.min(k + 1, r.p.length - 1)];
      const blocked = !underWays.has(ri) && besideRamp(p[0], p[1], p[0] - q[0], p[1] - q[1]);
      if (blocked) {
        flush();
      } else if (onRoute) {
        flush();
        cur = [p];
      } else {
        cur.push(p);
      }
    }
    flush();
  });
  const onGround = clipRoadsToGround(otherRoads, (x, z) => {
    const i = Math.round((x - gx0) / CELL);
    const j = Math.round((z - gz0) / CELL);
    return i >= 0 && j >= 0 && i < nx && j < nz && dist[j * nx + i] <= TERRAIN_RADIUS + ROAD_CLIP_MARGIN;
  });
  log(`  side roads clipped to the map's ground: ${otherRoads.length} → ${onGround.length} pieces`);
  otherRoads.length = 0;
  for (const r of onGround) otherRoads.push(r);
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

  // Natural ground (before the road was cut in or built up), for side roads that ride beside it.
  const rawGround = (x, z) => {
    const fi = Math.max(0, Math.min(nx - 1.001, (x - gx0) / CELL));
    const fj = Math.max(0, Math.min(nz - 1.001, (z - gz0) / CELL));
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const u = fi - i;
    const v = fj - j;
    const h = (a, b) => dem[b * nx + a] - elev0;
    return h(i, j) * (1 - u) * (1 - v) + h(i + 1, j) * u * (1 - v) + h(i, j + 1) * (1 - u) * v + h(i + 1, j + 1) * u * v;
  };
  const routeGround = (i) => routeDem[i] - elev0;
  const structures = sideRoadStructures({ otherRoads, pts, tx, tz, ry, lift, bridgeClean, right, left, index, lateral, ground: sampleGrid, rawGround, routeGround, N });
  for (const r of otherRoads) delete r.ri;

  // Buildings.
  progress(0.5, 'Downloading the buildings');
  const city = await loadRooflines(m, ptsGlobal);
  progress(0.75, 'Downloading the zoning');
  const zoning = await loadZoning(m, ptsGlobal);
  progress(0.8, 'Placing the buildings');
  const zonePolys = zoning.map((zp) => ({ t: zp.z, ring: zp.ring.map(([lon, lat]) => P(lon, lat)) }));
  const zoneHits = polyGridFor(zonePolys, 150);
  const zoneAt = (x, z) => {
    let best = null;
    for (const zp of zoneHits(x, z)) {
      const size = (zp.box[2] - zp.box[0]) * (zp.box[3] - zp.box[1]);
      if (!best || size < best.size) best = { z: zp.t, size };
    }
    return best?.z ?? null;
  };
  const skylineTowers = SKYLINE_TOWERS.map((T) => ({ ...T, xy: P(T.lon, T.lat) }));
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
    // The road can also cross a big footprint far from all its corners (a custom route that
    // starts in a mall's parkade): drop it when the road line or either road edge is inside.
    const xs = ring.map((q) => q[0]);
    const zs = ring.map((q) => q[1]);
    for (const i of index.inBox(arrMin(xs), arrMin(zs), arrMax(xs), arrMax(zs))) {
      const [x, z] = pts[i];
      if (pointInRing(x, z, ring)
        || pointInRing(x - tz[i] * right[i], z + tx[i] * right[i], ring)
        || pointInRing(x - tz[i] * left[i], z + tx[i] * left[i], ring)) return false;
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
  const polyGrid = polyGridFor;
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

  // Landmarks on this map: generic footprints under hand-made models are dropped, and the
  // ones the route passes get a callout (name + where along the route).
  const landmarkXY = LANDMARK_LIST.map((L) => ({ ...L, xy: P(L.lon, L.lat) }));
  const excluded = (x, z) => landmarkXY.some((L) => (L.excludeR > 0 && Math.hypot(L.xy[0] - x, L.xy[1] - z) < L.excludeR)
    || (L.excludeBox && Math.abs(x - L.xy[0] - (L.excludeBox[2] ?? 0)) < L.excludeBox[0] && Math.abs(z - L.xy[1] - (L.excludeBox[3] ?? 0)) < L.excludeBox[1]))
    || skylineTowers.some((T) => Math.hypot(T.xy[0] - x, T.xy[1] - z) < (T.excludeR || 0));
  const mapLandmarks = [];
  for (const L of landmarkXY) {
    if (!L.callout) continue;
    const nr = index.nearest(L.xy[0], L.xy[1], L.seeFrom);
    if (!nr) continue;
    // Side as seen while it comes up (the callout shows from 160 m before), measured to the
    // middle of the site rather than the model origin.
    const cx = L.xy[0] + (L.excludeBox?.[2] ?? 0), cz = L.xy[1] + (L.excludeBox?.[3] ?? 0);
    const side = lateral(Math.max(0, nr.i - Math.round(100 / STEP)), cx, cz) >= 0 ? 1 : -1;
    mapLandmarks.push({ name: L.callout, s: nr.i * STEP, side, x: Math.round(L.xy[0]), z: Math.round(L.xy[1]) });
  }
  mapLandmarks.sort((a, b) => a.s - b.s);
  log(`  landmarks on route: ${mapLandmarks.map((l) => l.name).join(', ') || 'none'}`);

  // Named places from OpenStreetMap points (shops, restaurants, gas stations…): each lends
  // its name, brand and kind to the footprint it stands in; the others near the road are
  // listed in `pois` (a gas station whose canopy has no footprint, a kiosk).
  const places = (osm.pois ?? []).map((pl) => ({ t: pl.t, xy: P(pl.c[0], pl.c[1]), used: false }));
  const PLACE_CELL = 50;
  const placeGrid = new Map();
  for (const pl of places) {
    const k = `${Math.floor(pl.xy[0] / PLACE_CELL)},${Math.floor(pl.xy[1] / PLACE_CELL)}`;
    if (!placeGrid.has(k)) placeGrid.set(k, []);
    placeGrid.get(k).push(pl);
  }
  const placesIn = (ring) => {
    const xs = ring.map((q) => q[0]);
    const zs = ring.map((q) => q[1]);
    const [x0, z0, x1, z1] = [arrMin(xs), arrMin(zs), arrMax(xs), arrMax(zs)];
    const out = [];
    for (let i = Math.floor(x0 / PLACE_CELL); i <= Math.floor(x1 / PLACE_CELL); i++) {
      for (let j = Math.floor(z0 / PLACE_CELL); j <= Math.floor(z1 / PLACE_CELL); j++) {
        for (const pl of placeGrid.get(`${i},${j}`) ?? []) if (!pl.used && pointInRing(pl.xy[0], pl.xy[1], ring)) out.push(pl);
      }
    }
    return out;
  };
  const placeKind = (t) => (t ? t.amenity || t.shop || t.tourism || t.leisure || t.office || null : null);
  const placeRank = (t) => (t.brand ? 4 : 0) + (t.shop || t.amenity ? 2 : 0) + (t.name ? 1 : 0);

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
    if (excluded(cx, cz)) return;
    // What OpenStreetMap knows about this footprint (city footprints: whichever OSM building contains its centre).
    let t = tags;
    if (!t) {
      const hits = osmAt(cx, cz);
      if (hits.length) t = hits[0].t;
    }
    const area = ringArea(ring);
    let cls = osmClass(t);
    const zone = zoneAt(cx, cz);
    if (!cls && zone) cls = zoneClass(zone, area, h);
    if (!cls) {
      const lu = landuseAt(cx, cz);
      if (lu === 'industrial') cls = h < 30 ? 'industrial' : 'office';
      else if (lu === 'retail' || lu === 'commercial') cls = h >= 30 ? 'office' : area >= 2500 ? 'bigbox' : 'retail';
      else if (lu === 'residential') cls = area < 400 && h < 12 ? (area < 80 && h < 5 ? 'outbuilding' : 'house') : h >= 12 ? 'apartments' : area >= 400 ? 'rowhouse' : 'house';
      else cls = guessClass(area, h);
    }
    classCount[cls] = (classCount[cls] || 0) + 1;
    const b = { h: Math.round(h * 10), c: CLASS[cls], p: ring.flatMap(([x, z]) => [Math.round(x * 10), Math.round(z * 10)]) };
    // Its name (the building's own, else the main place inside), brand and kind; other named
    // tenants (a strip mall's shops) in `ps`.
    const tenants = placesIn(ring).sort((a, c) => placeRank(c.t) - placeRank(a.t));
    for (const pl of tenants) pl.used = true;
    const main = t && (t.name || t.brand) ? t : tenants[0]?.t ?? null;
    const name = main?.name || main?.brand;
    if (name && area > 150) b.n = name;
    if (main?.brand) b.br = main.brand;
    const kind = placeKind(main) ?? placeKind(t);
    if (kind) b.k = kind;
    const others = tenants.map((pl) => pl.t).filter((pt) => pt !== main && (pt.name || pt.brand)).slice(0, 8);
    if (others.length) b.ps = others.map((pt) => [pt.name || pt.brand, pt.brand || '', placeKind(pt) || '']);
    if (t?.['building:levels'] > 0) b.l = parseInt(t['building:levels'], 10);
    if (t?.['roof:shape']) b.r = t['roof:shape'];
    if (zone && HERITAGE_ZONES.test(zone)) b.hz = 1;
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
  const pois = [];
  for (const pl of places) {
    if (pl.used) continue;
    const [x, z] = pl.xy;
    if (!index.nearest(x, z, 200) || excluded(x, z)) continue;
    const o = { k: placeKind(pl.t) || '', x: r1(x), z: r1(z) };
    if (pl.t.name) o.n = pl.t.name;
    if (pl.t.brand) o.br = pl.t.brand;
    pois.push(o);
  }
  log(`  ${buildings.filter((b) => b.k).length} buildings with a known use, ${buildings.filter((b) => b.br).length} with a brand; ${pois.length} other places by the road (${pois.filter((o) => o.k === 'fuel').length} gas stations)`);

  progress(0.95, 'Signs and traffic lights');
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

  // Traffic signals on the route, as [s, stop, end]: the signal, its stop line and the far
  // side of the junction (see "Road lines" in CLAUDE.md). OSM puts signal nodes on our road,
  // on the cross street or on the other carriageway; nodes within 60 m form one junction,
  // and the first node actually on our road wins. The stop line and the gap in the lane
  // lines come from where the cross streets meet our road, not from a fixed distance.
  const sigNodes = [];
  for (const [lon, lat] of osm.signals) {
    const [x, z] = P(lon, lat);
    const nr = index.nearest(x, z, 30);
    if (!nr) continue;
    const off = Math.abs(lateral(nr.i, x, z)) - Math.max(right[nr.i], -left[nr.i]);
    if (off > 15) continue;
    const s = nr.i * STEP;
    if (s < 60 || s > (N - 30) * STEP) continue;
    sigNodes.push({ s, onRoad: off <= 4, off });
  }
  sigNodes.sort((a, b) => a.s - b.s);
  const sigClusters = [];
  for (const nd of sigNodes) {
    const last = sigClusters[sigClusters.length - 1];
    if (last && nd.s - last[last.length - 1].s <= 60) last.push(nd); else sigClusters.push([nd]);
  }
  // Where side roads meet our road: [s from, s to] of each one's surface along the route.
  const mouths = [];
  for (const r of otherRoads) {
    if (r.o || r.e) continue;
    for (const end of [0, 1]) {
      const k = end ? r.p.length - 2 : 0;
      const kk = end ? r.p.length - 4 : 2;
      if (kk < 0 || kk >= r.p.length) continue;
      const ex = r.p[k] / 10, ez = r.p[k + 1] / 10;
      const nr = index.nearest(ex, ez, 40);
      if (!nr || Math.abs(lateral(nr.i, ex, ez)) > Math.max(right[nr.i], -left[nr.i]) + 8) continue;
      const dx = ex - r.p[kk] / 10, dz = ez - r.p[kk + 1] / 10;
      const l = Math.hypot(dx, dz) || 1;
      const sin = Math.abs((dx * tz[nr.i] - dz * tx[nr.i]) / l);
      const half = r.w / 2 / Math.max(0.35, sin);
      mouths.push([nr.i * STEP - half, nr.i * STEP + half]);
    }
  }
  // The lanes as the game will read them (edges rounded as in the file), so stop lines are
  // placed where our lanes really are.
  const laneRd = laneInput({
    step: STEP, x: pts.map((q) => r2(q[0])), z: pts.map((q) => r2(q[1])), right: right.map(r1), left: left.map(r1),
    lanes, ow, ctr: ctr.some(Boolean) ? ctr : undefined, laneFormat: LANE_FORMAT,
  });
  const signals = [];
  for (const cl of sigClusters) {
    const on = cl.filter((nd) => nd.onRoad);
    const s = on.length ? on[0].s : cl.reduce((a, b) => (b.off < a.off ? b : a)).s;
    // The junction: side-road mouths near the signal, around the one closest to it.
    const near = mouths.filter(([a, b]) => b > s - 35 && a < s + 35);
    let lo = s;
    let hi = s;
    if (near.length) {
      const mid = (m) => (m[0] + m[1]) / 2;
      const c = mid(near.reduce((a, b) => (Math.abs(mid(b) - s) < Math.abs(mid(a) - s) ? b : a)));
      // Grow from the closest mouth: any mouth within 7 m of the junction so far joins it
      // (the other leg of the cross street, a skewed corner, a slip lane), also past the
      // 35 m searched first, up to 40 m from the signal (the far legs of a wide junction:
      // tools/check-roads.mjs looks that far).
      lo = c;
      hi = c;
      for (let grew = true; grew;) {
        grew = false;
        for (const [a, b] of mouths) {
          if (b < s - 40 || a > s + 40) continue;
          if (b < lo - 7 || a > hi + 7 || (a >= lo && b <= hi)) continue;
          lo = Math.min(lo, a);
          hi = Math.max(hi, b);
          grew = true;
        }
      }
    }
    let stop = Math.max(10, lo - 4.6); // stop line, then the crosswalk (1.2-4.2 m past it), then the junction
    // Our lanes must be most of a lane wide at the stop line. Where a two-way street turns
    // into a one-way ramp at the junction the road already narrows before it: move the stop
    // line back to full width (at most 20 m).
    for (let back = 0; back < 20; back += 0.5) {
      const [a, b] = stopLineExtent(laneRd, stop);
      if (b - a >= LANE_W * 0.7 + 0.1 || stop <= 10) break;
      stop -= 0.5;
    }
    if (signals.length && stop < signals[signals.length - 1][2] + 5) continue;
    signals.push([Math.round(s), Math.round(stop * 10) / 10, Math.round((hi + 1.5) * 10) / 10]);
  }
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
      laneFormat: LANE_FORMAT,
      ...(lift.some((v) => v > 0) ? { lift: Array.from(lift, r1) } : {}),
      ow,
      ...(ctr.some(Boolean) ? { ctr } : {}),
      src,
      cls,
      bridge: bridgeClean,
      names: nameRuns,
    },
    terrain: { x0: gx0, z0: gz0, cell: CELL, nx, nz, h: toBase64(new Uint8Array(heights.buffer)) },
    water: r1(waterLevel + 1.2),
    roads: otherRoads,
    piers: structures.piers,
    buildings,
    ...(pois.length ? { pois } : {}),
    signals,
    exits,
    landmarks: mapLandmarks,
    credits: 'Map data © OpenStreetMap contributors (ODbL) · Contains information licensed under the Open Government Licence – City of Edmonton · Elevation: Natural Resources Canada (OGL-Canada)',
  };

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
  progress(1, 'Done');
  const meta = {
    id: m.id,
    name: m.name,
    from: m.from ?? 'Summerside',
    origin: start,
    km: Math.round((N * STEP) / 100) / 10,
    poly,
    landmarks: mapLandmarks.map((l) => ({ name: l.name, s: l.s, x: l.x, z: l.z })),
    streets: nameRuns.map((r) => r[1]).filter((v, i, a) => v && a.indexOf(v) === i),
    signals: signals.length,
    curves,
    bridgeM,
    highwayM,
    climb: Math.round(climb),
  };
  return { out, meta };
}

// Base64 of bytes, in Node and in browsers.
function toBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
