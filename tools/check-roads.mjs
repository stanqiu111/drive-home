// Road-line guard: checks the painted lines and lanes of every map before a build/deploy.
//   node tools/check-roads.mjs [mapId ...] [--verbose]
// It runs the same functions the game uses (src/lane-layout.js) on public/maps/*.json and
// compares the result with the raw OpenStreetMap lane layout the builder stores in each map
// (route.src), so a mistake in the builder's cleaning can't hide by agreeing with itself.
// Exit code 1 on any failure. `npm run build` runs this first, so Vercel won't deploy a map
// with broken lines. See "Road lines" in CLAUDE.md before changing any limit here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  markingPlan, laneInput, hasLaneData, laneZones, activeSignals, drivableLanes, ourInnerEdge, stopLineExtent, lerpAt,
  LANE_W, MAX_SIDESTEP, DASH_EVERY,
} from '../src/lane-layout.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_DIR = path.join(ROOT, 'public', 'maps');
const OW_GLITCH = 30;     // m: raw one-way/two-way runs shorter than this may be smoothed away
const MIN_LAYOUT = 80;    // m: lane-count changes closer together than this flicker
const END_SLACK = 40;     // m at each end of the route where the rules relax
const TOL = 0.35;         // m: steady-state width tolerance (edges are rounded to 0.1 m)
const HALF_CAR = 0.9;     // m: a car centred in a lane must clear the edge by this much

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const only = args.filter((a) => !a.startsWith('--'));
const ids = JSON.parse(fs.readFileSync(path.join(MAP_DIR, 'index.json'), 'utf8')).map((m) => m.id)
  .filter((id) => !only.length || only.includes(id));

function runs(n, key) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = key(i);
    if (out.length && out[out.length - 1].k === k) out[out.length - 1].b = i;
    else out.push({ k, a: i, b: i });
  }
  return out;
}

function checkMap(id) {
  const data = JSON.parse(fs.readFileSync(path.join(MAP_DIR, `${id}.json`), 'utf8'));
  const full = { step: data.step, ...data.route };
  // Exactly what the game hands to lane-layout.js, plus the raw layout and heights for the checks here.
  const rd = { ...laneInput(full), src: full.src, y: full.y, lift: full.lift };
  const { step } = rd;
  const n = rd.right.length;
  const length = (n - 1) * step;
  const problems = [];
  const bad = (rule, s, detail) => problems.push({ rule, s: Math.round(s), detail });
  const inEnds = (s) => s < END_SLACK || s > length - END_SLACK;

  if (!hasLaneData(rd) || !Array.isArray(rd.src)) {
    bad('data', 0, 'map has no lane data (laneFormat 2 with ow and src): rebuild ALL maps with node tools/build-maps.mjs');
    return { id, problems, lines: 0 };
  }
  const signals = activeSignals(data.signals, length);
  const { boxes } = laneZones(rd, signals);
  const inBox = (s) => boxes.some(([a, b]) => s > a - 2 && s < b + 2);

  // Raw OSM layout per sample, from the run-length list [sample, ow, ours, theirs, ctr, flags].
  const raw = new Array(n);
  rd.src.forEach((r, k) => {
    const end = k + 1 < rd.src.length ? rd.src[k + 1][0] : n;
    for (let i = r[0]; i < end; i++) raw[i] = { ow: r[1], ours: r[2], theirs: r[3], ctr: r[4], guessed: !!(r[5] & 1), unmatched: !!(r[5] & 2), rb: !!(r[5] & 4), link: !!(r[5] & 8) };
  });
  const rawKind = (i) => (raw[i].ow === 1 ? 1 : 0);
  const kind = (i) => (rd.ow[i] === 1 ? 1 : 0);
  // Raw one-way/two-way runs, and whether each sample sits in a real (long enough) one.
  const realKind = new Uint8Array(n);
  for (const r of runs(n, (i) => (raw[i].unmatched ? 'u' : rawKind(i)))) {
    if (r.k === 'u') continue;
    if ((r.b - r.a + 1) * step >= OW_GLITCH) for (let i = r.a; i <= r.b; i++) realKind[i] = 1;
  }

  // 1. One-way vs two-way matches OpenStreetMap, except glitches under OW_GLITCH.
  let flipped = 0;
  for (let i = 0; i < n; i++) if (realKind[i] && kind(i) !== rawKind(i)) flipped++;
  if (flipped) bad('one-way-changed', 0, `${flipped * step} m drawn ${'one-way/two-way'} differently from OpenStreetMap`);

  // 2. Lane-count changes are not jittery (roundabouts and whole short one-way/two-way
  //    stretches may be short; so may the route ends).
  const lay = runs(n, (i) => `${rd.ow[i]}/${rd.lanes[i]}/${rd.ctr ? rd.ctr[i] : 0}`);
  lay.forEach((r, k) => {
    const len = (r.b - r.a + 1) * step;
    if (len >= MIN_LAYOUT || r.a === 0 || r.b === n - 1) return;
    const sameKindNeighbour = [lay[k - 1], lay[k + 1]].some((q) => q && rd.ow[q.a] === rd.ow[r.a]);
    const kept = raw[r.a].rb || raw[r.b].rb || (raw[r.a].link && raw[r.b].link); // roundabouts and ramps keep their own lanes
    if (sameKindNeighbour && !kept) bad('layout-run', r.a * step, `${r.k} (ow/lanes/centre) lasts only ${len} m`);
  });

  // 3. Steady-state widths match the lane layout.
  for (let i = 30; i < n - 30; i++) {
    const steady = Math.abs(rd.right[i - 30] - rd.right[i + 30]) < 0.05 && Math.abs(rd.left[i - 30] - rd.left[i + 30]) < 0.05
      && lay.some((r) => r.a <= i - 30 && r.b >= i + 30);
    if (!steady) continue;
    const ctr = rd.ctr ? rd.ctr[i] : 0;
    const w = rd.right[i] - rd.left[i];
    if (rd.ow[i] === 1 && Math.abs(w - rd.lanes[i] * LANE_W) > TOL) bad('width', i * step, `one-way, ${rd.lanes[i]} lanes but ${w.toFixed(2)} m wide`);
    if (rd.ow[i] !== 1) {
      const ours = rd.right[i] - (ctr * LANE_W) / 2;
      const theirs = -rd.left[i] - (ctr * LANE_W) / 2;
      if (Math.abs(ours - rd.lanes[i] * LANE_W) > TOL) bad('width', i * step, `two-way, ${rd.lanes[i]} lanes our way but ${ours.toFixed(2)} m`);
      if (Math.abs(theirs / LANE_W - Math.round(theirs / LANE_W)) * LANE_W > TOL || Math.round(theirs / LANE_W) < 1) bad('width', i * step, `two-way, oncoming side ${theirs.toFixed(2)} m is not whole lanes`);
    }
  }

  const plan = markingPlan(rd, signals);
  const at = (arr, s) => lerpAt(rd, arr, s);
  // 4. Every line stays on the asphalt and never jumps sideways, within a line or from
  //    one dash to the next of the same lane boundary.
  for (const m of plan) {
    for (let k = 0; k < m.pts.length; k++) {
      const [s, lat] = m.pts[k];
      if (lat < at(rd.left, s) + 0.1 || lat > at(rd.right, s) - 0.1) bad('off-road', s, `${m.color} ${m.slot} line at ${lat.toFixed(2)} outside the road [${at(rd.left, s).toFixed(2)}, ${at(rd.right, s).toFixed(2)}]`);
      if (k && Math.abs(lat - m.pts[k - 1][1]) > MAX_SIDESTEP * Math.max(1, (s - m.pts[k - 1][0]) / step)) bad('side-step', s, `${m.color} ${m.slot} line jumps ${Math.abs(lat - m.pts[k - 1][1]).toFixed(2)} m sideways`);
    }
  }
  const bySlot = new Map();
  for (const m of plan) {
    if (!bySlot.has(m.slot)) bySlot.set(m.slot, []);
    bySlot.get(m.slot).push(m);
  }
  for (const [slot, list] of bySlot) {
    list.sort((a, b) => a.pts[0][0] - b.pts[0][0]);
    for (let k = 1; k < list.length; k++) {
      const [s0, a] = list[k - 1].pts[list[k - 1].pts.length - 1];
      const [s1, b] = list[k].pts[0];
      if (s1 - s0 > DASH_EVERY) continue; // a real break (lane ended, intersection)
      if (Math.abs(b - a) > MAX_SIDESTEP * Math.max(1, (s1 - s0) / step)) bad('dash-jump', s1, `${slot} dashes jump ${Math.abs(b - a).toFixed(2)} m sideways`);
    }
  }
  // 5. Yellow centre lines only where OpenStreetMap says two-way.
  for (const m of plan.filter((p) => p.color === 'yellow')) {
    for (const [s] of m.pts) {
      const i = Math.min(n - 1, Math.round(s / step));
      if (realKind[i] && rawKind(i) === 1) { bad('yellow-on-one-way', s, 'centre line on a one-way carriageway'); break; }
    }
  }
  // 6. Every marked two-way stretch long enough to see has its centre line.
  for (const r of runs(n, (i) => rd.ow[i])) {
    if (r.k !== 0 || (r.b - r.a) * step < 200) continue;
    const s0 = r.a * step + 60;
    const s1 = r.b * step - 60;
    const covered = plan.some((p) => p.color === 'yellow' && p.pts[0][0] <= s1 && p.pts[p.pts.length - 1][0] >= s0);
    if (!covered) bad('missing-yellow', s0, `two-way road from ${r.a * step} to ${r.b * step} m has no centre line`);
  }
  // 7. Traffic lanes (route.lanes) fit on the asphalt everywhere.
  for (let i = 0; i < n; i++) {
    const s = i * step;
    if (inEnds(s)) continue;
    const lanes = Math.min(4, drivableLanes(rd, s));
    const inner = ourInnerEdge(rd, s);
    const outer = at(rd.right, s);
    for (let lane = 0; lane < lanes; lane++) {
      const lat = outer - LANE_W * (lane + 0.5);
      if (lat - HALF_CAR < inner - 0.3 || lat + HALF_CAR > outer + 0.3) { bad('traffic-off-road', s, `lane ${lane} centre at ${lat.toFixed(2)} outside [${inner.toFixed(2)}, ${outer.toFixed(2)}]`); break; }
    }
  }
  // 8. Stop lines cover our lanes, stay on the road and stand before the junction; the gap in
  //    the lane lines covers every side street meeting our road at that junction.
  const mouths = sideRoadMouths(data, rd);
  for (const sig of signals) {
    const s = sig.stop;
    const [a, b] = stopLineExtent(rd, s);
    if (a < at(rd.left, s) - 0.05 || b > at(rd.right, s) + 0.05 || b - a < LANE_W * 0.7) bad('stop-line', s, `stop line [${a.toFixed(2)}, ${b.toFixed(2)}] vs road [${at(rd.left, s).toFixed(2)}, ${at(rd.right, s).toFixed(2)}]`);
    if (!inBox(s + 1)) bad('stop-line', s, 'lines are not broken at this intersection');
    for (const [m0, m1] of mouths) {
      if (m1 < sig.stop - 2 || m0 > sig.end + 2 || m1 < sig.s - 40 || m0 > sig.s + 40) continue;
      if (m0 < sig.stop + 1.5) bad('stop-line', s, `stop line inside a cross street (${m0.toFixed(0)}-${m1.toFixed(0)} m)`);
      else if (m1 > sig.end + 0.5) bad('junction', m1, `lane lines run into a cross street (${m0.toFixed(0)}-${m1.toFixed(0)} m) past the junction gap ending at ${sig.end}`);
    }
  }
  // 9. In real positions, no painted line runs backwards (folds over on a tight turn).
  const tan = (s) => {
    const i = Math.max(1, Math.min(n - 2, Math.round(s / step)));
    const l = Math.hypot(rd.x[i + 1] - rd.x[i - 1], rd.z[i + 1] - rd.z[i - 1]) || 1;
    return [(rd.x[i + 1] - rd.x[i - 1]) / l, (rd.z[i + 1] - rd.z[i - 1]) / l];
  };
  const world = (s, lat) => {
    const [tx, tz] = tan(s);
    return [at(rd.x, s) - tz * lat, at(rd.z, s) + tx * lat];
  };
  for (const m of plan) {
    for (let k = 1; k < m.pts.length; k++) {
      const [s0, l0] = m.pts[k - 1];
      const [s1, l1] = m.pts[k];
      const a = world(s0, l0);
      const b = world(s1, l1);
      const [tx, tz] = tan((s0 + s1) / 2);
      if ((b[0] - a[0]) * tx + (b[1] - a[1]) * tz < -0.05) { bad('fold', s1, `${m.color} ${m.slot} line folds back on a tight turn`); break; }
    }
  }
  checkStructures(data, rd, bad);
  checkBridges(data, full, raw, bad);
  return { id, problems, lines: plan.length };
}

// Bridges: only where OSM has a road (no made-up bridge copied into a gap), and never
// under the ground (the game doesn't cut the ground away under bridges).
function checkBridges(data, rd, raw, bad) {
  const { step } = rd;
  const n = rd.x.length;
  // Made-up bridges: a run of unmatched samples marked as a bridge for 30 m or more.
  let run = 0;
  for (let i = 0; i < n; i++) {
    run = rd.bridge[i] && raw[i].unmatched ? run + 1 : 0;
    if (run === 15) bad('bridge', (i - 14) * step, 'a stretch with no OSM road is drawn as a bridge');
  }
  // Buried bridge decks: ground above the deck surface for 10 m or more.
  const t = data.terrain;
  const buf = Buffer.from(t.h, 'base64');
  const h = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  const heightAt = (x, z) => {
    const fi = (x - t.x0) / t.cell, fj = (z - t.z0) / t.cell, i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= t.nx - 1 || j >= t.nz - 1) return null;
    const a = h[j * t.nx + i], b = h[j * t.nx + i + 1], c = h[(j + 1) * t.nx + i], d = h[(j + 1) * t.nx + i + 1];
    if (a === -32768 || b === -32768 || c === -32768 || d === -32768) return null;
    const u = fi - i, v = fj - j; // same triangle split as world.js makeHeightAt
    return (u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v)) / 10;
  };
  let buried = 0;
  for (let i = 1; i < n - 1; i++) {
    if (!rd.bridge[i]) { buried = 0; continue; }
    const g = heightAt(rd.x[i], rd.z[i]);
    buried = g != null && g > rd.y[i] + 0.3 ? buried + 1 : 0;
    if (buried === 5) bad('bridge', (i - 4) * step, `bridge deck is under the ground (ground ${g.toFixed(1)} m, deck ${rd.y[i].toFixed(1)} m)`);
  }
}

// Where side roads (on the ground) meet our road: [s from, s to] of each one's surface.
function sideRoadMouths(data, rd) {
  const { step } = rd;
  const n = rd.x.length;
  const out = [];
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.floor(rd.x[i] / 25)},${Math.floor(rd.z[i] / 25)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  const nearest = (x, z) => {
    let best = -1;
    let bd = 40;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      for (const i of grid.get(`${Math.floor(x / 25) + a},${Math.floor(z / 25) + b}`) ?? []) {
        const d = Math.hypot(rd.x[i] - x, rd.z[i] - z);
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  };
  for (const r of data.roads ?? []) {
    if (r.o || r.e || r.p.length < 4) continue;
    for (const end of [0, 1]) {
      const k = end ? r.p.length - 2 : 0;
      const kk = end ? r.p.length - 4 : 2;
      const ex = r.p[k] / 10, ez = r.p[k + 1] / 10;
      const i = nearest(ex, ez);
      if (i < 0) continue;
      const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
      const l0 = Math.hypot(rd.x[b] - rd.x[a], rd.z[b] - rd.z[a]) || 1;
      const tx = (rd.x[b] - rd.x[a]) / l0, tz = (rd.z[b] - rd.z[a]) / l0;
      const lat = (ex - rd.x[i]) * -tz + (ez - rd.z[i]) * tx;
      if (Math.abs(lat) > Math.max(rd.right[i], -rd.left[i]) + 8) continue;
      const dx = ex - r.p[kk] / 10, dz = ez - r.p[kk + 1] / 10;
      const l = Math.hypot(dx, dz) || 1;
      const sin = Math.abs((dx * tz - dz * tx) / l);
      if (sin < 0.35) continue; // running alongside, not a cross street
      const half = r.w / 2 / sin;
      out.push([i * step - half, i * step + half]);
    }
  }
  return out;
}

// Road structures (see "Road structures" in CLAUDE.md): nothing raised by the builder may
// stand on the driven road, piers stay off every road, and humps are single smooth rises.
const HUMP_RADIUS = 400;  // m, as in tools/build-maps.mjs
const HUMP_MAX = 9;
const CLEAR_MIN = 5.0;    // m: anything raised over the route must clear its surface by this
function checkStructures(data, rd, bad) {
  const { step } = rd;
  const n = rd.x.length;
  const tx = new Float64Array(n);
  const tz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2);
    const b = Math.min(n - 1, i + 2);
    const l = Math.hypot(rd.x[b] - rd.x[a], rd.z[b] - rd.z[a]) || 1;
    tx[i] = (rd.x[b] - rd.x[a]) / l;
    tz[i] = (rd.z[b] - rd.z[a]) / l;
  }
  const CELL = 25;
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.floor(rd.x[i] / CELL)},${Math.floor(rd.z[i] / CELL)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  const nearest = (x, z) => {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best = -1;
    let bd = 60;
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) {
      for (const i of grid.get(`${cx + a},${cz + b}`) ?? []) {
        const d = Math.hypot(rd.x[i] - x, rd.z[i] - z);
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  };
  const halfW = (i) => Math.max(rd.right[i], -rd.left[i]);
  const lat = (i, x, z) => (x - rd.x[i]) * -tz[i] + (z - rd.z[i]) * tx[i];
  const onRoute = (x, z, pad) => {
    const i = nearest(x, z);
    if (i < 0) return -1;
    const along = (x - rd.x[i]) * tx[i] + (z - rd.z[i]) * tz[i];
    return Math.abs(lat(i, x, z)) < halfW(i) + pad && Math.abs(along) < step * 2 ? i : -1;
  };

  // Humps: each raised stretch rises once, stays level, falls once; gentle crests; bounded.
  const lift = rd.lift;
  if (lift) {
    let i = 0;
    while (i < n) {
      if (lift[i] <= 0) { i++; continue; }
      let j = i;
      while (j < n && lift[j] > 0) j++;
      let peak = i;
      for (let k = i; k < j; k++) if (lift[k] > lift[peak]) peak = k;
      if (lift[peak] > HUMP_MAX) bad('hump', peak * step, `lifted ${lift[peak]} m, more than ${HUMP_MAX} m`);
      for (let k = i + 1; k < j; k++) {
        const up = lift[k] - lift[k - 1];
        if ((k <= peak && up < -0.15) || (k > peak && up > 0.15)) { bad('hump', k * step, 'the road dips between two raised decks (camel back)'); break; }
      }
      for (let k = Math.max(i, 5); k < Math.min(j, n - 5); k++) {
        const curv = Math.abs(lift[k + 5] - 2 * lift[k] + lift[k - 5]) / (5 * step) ** 2;
        if (curv > 1.25 / HUMP_RADIUS + 0.2 / (5 * step) ** 2) { bad('hump', k * step, `crest/dip radius ${(1 / curv).toFixed(0)} m on a hump ramp`); break; }
      }
      i = j;
    }
  }

  // Side roads with builder-given heights: on the route they must be at grade or clear it.
  const roads = data.roads ?? [];
  for (const r of roads) {
    if (!r.h) continue;
    const q = [];
    for (let k = 0; k < r.p.length; k += 2) q.push([r.p[k] / 10, r.p[k + 1] / 10]);
    for (let k = 0; k < q.length - 1; k++) {
      const len = Math.hypot(q[k + 1][0] - q[k][0], q[k + 1][1] - q[k][1]);
      const m = Math.max(1, Math.ceil(len / 1.5));
      for (let u = 0; u <= m; u++) {
        const t = u / m;
        const x = q[k][0] + (q[k + 1][0] - q[k][0]) * t;
        const z = q[k][1] + (q[k + 1][1] - q[k][1]) * t;
        const i = onRoute(x, z, 0.5);
        if (i < 0) continue;
        const h = r.h[k] + (r.h[k + 1] - r.h[k]) * t;
        const above = h - rd.y[i];
        if (above > 0.4 && above < CLEAR_MIN) {
          bad('on-road', i * step, `${r.o ? 'overpass deck' : 'raised side road'} only ${above.toFixed(1)} m above the route`);
          u = m; k = q.length;
        }
      }
    }
  }
  // Piers: never on the route or on another road.
  for (const [px, pz, , , nx, nz, w] of data.piers ?? []) {
    const foot = [-1, -0.5, 0, 0.5, 1].map((f) => [px + nx * w * f, pz + nz * w * f]);
    const i = foot.map(([x, z]) => onRoute(x, z, 0.5)).find((v) => v >= 0);
    if (i != null) bad('pier', i * step, `overpass pier stands on the route at (${px}, ${pz})`);
    for (const [x, z] of foot) for (const r of roads) {
      if (r.o) continue;
      for (let k = 2; k < r.p.length; k += 2) {
        const ax = r.p[k - 2] / 10, az = r.p[k - 1] / 10, bx = r.p[k] / 10, bz = r.p[k + 1] / 10;
        if (Math.min(ax, bx) > x + 40 || Math.max(ax, bx) < x - 40 || Math.min(az, bz) > z + 40 || Math.max(az, bz) < z - 40) continue;
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) < r.w / 2 + 0.3) { bad('pier', 0, `overpass pier stands on a side road at (${x}, ${z})`); k = r.p.length; }
      }
    }
  }
}

let failed = 0;
for (const id of ids) {
  const { problems, lines } = checkMap(id);
  const byRule = {};
  for (const p of problems) (byRule[p.rule] ??= []).push(p);
  if (!problems.length) {
    console.log(`ok   ${id} (${lines} lines)`);
    continue;
  }
  failed++;
  console.log(`FAIL ${id}: ${Object.entries(byRule).map(([r, l]) => `${r} x${l.length}`).join(', ')}`);
  for (const [rule, list] of Object.entries(byRule)) {
    for (const p of list.slice(0, verbose ? 50 : 3)) console.log(`     ${rule} at s=${p.s} m: ${p.detail}`);
  }
}
if (failed) {
  console.log(`\nRoad lines are broken on ${failed} map(s). See "Road lines" in CLAUDE.md.`);
  process.exit(1);
}
console.log('Road lines OK on every map.');
